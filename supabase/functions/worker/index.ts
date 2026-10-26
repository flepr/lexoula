// Λεξούλα — worker IA
// © 2026 Φοίβος Λεπέρ (Fabien Lepère). Tous droits réservés.
//
// Réveillé chaque minute par pg_cron (public.kick_worker) quand des tâches attendent ou qu'un lot est en cours.
// Types de tâches :
//   enrich    : compléter jusqu'à 4 mots (traductions en 8 langues, formes, exemple, leurres, exercices)
//   text      : écrire un texte grec (court ou long) avec les mots d'un groupe
//   translate : traduire un texte dans une partie des 8 langues
//
// Deux modes (colonne jobs.mode) :
//   batch : par défaut. Les tâches sont regroupées dans un lot de l'API Message Batches (−50 %, prêt en général
//           en moins d'une heure, 24 h au plus). Filet de sécurité : un lot non terminé au bout de 2 h est annulé ;
//           ce qui a déjà été traité est gardé (payé au tarif batch), le reste (non facturé) repasse en direct.
//   sync  : appels directs, plein tarif ; « traitement rapide » demandé par un professeur ou un admin, et reprises.
// Cache des consignes : activé seulement quand assez de requêtes partagent les mêmes consignes pour être rentable.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { LANGS, LANG_NAMES, THEMES, THEME_HELP } from "../_shared/themes.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
const BUDGET_MS = 115_000; // le free tier coupe vers 150 s
const API = "https://api.anthropic.com/v1";
const BATCH_TIMEOUT_MS = 2 * 3600_000; // filet de sécurité
const BATCH_MAX_JOBS = 100;

type Job = { id: number; type: string; mode: string; payload: Record<string, unknown>; attempts: number; ctx?: Record<string, unknown> | null };
type Tool = { name: string; description: string; input_schema: Record<string, unknown> };
// Requête préparée : consignes fixes (system), partie partagée entre plusieurs requêtes (vivier), partie propre.
type Prepared = {
  system: string;
  shared?: string;
  user: string;
  tool: Tool;
  maxTokens: number;
  ctx: Record<string, unknown>; // repris à la réception : enrich {ids}, text {chosen, kind}, translate {langs, n, kind}
};
type Usage = {
  input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};

const headers = () => ({ "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" });

// ───────────────────────────────────────────── construction d'une requête (sortie structurée via un outil)
// cache : marque les consignes (et, si demandé, la partie partagée) comme réutilisables pendant 5 minutes.
function buildParams(p: Prepared, cache: { system: boolean; shared: boolean }) {
  const cc = { cache_control: { type: "ephemeral" } };
  const content: Record<string, unknown>[] = [];
  if (p.shared) content.push({ type: "text", text: p.shared, ...(cache.shared ? cc : {}) });
  content.push({ type: "text", text: `${p.user}\n\nReply only by calling the tool \`${p.tool.name}\` once, with the complete data. Do not write any other text.` });
  return {
    model: MODEL,
    max_tokens: p.maxTokens,
    system: [{ type: "text", text: p.system, ...(cache.system ? cc : {}) }],
    tools: [p.tool],
    // Sonnet 5.5 refuse l'appel d'outil forcé : on laisse « auto » et on le demande dans le message
    tool_choice: { type: "auto" },
    thinking: { type: "between_tools" },
    messages: [{ role: "user", content }],
  };
}

// lit la réponse d'un message (appel direct ou résultat de lot)
function parseMessage(json: Record<string, any>, toolName: string) {
  if (json.stop_reason === "max_tokens") throw new Error("réponse tronquée (max_tokens)");
  if (json.stop_reason === "refusal") throw new Error("refus du modèle");
  const block = (json.content ?? []).find((b: { type: string; name?: string }) => b.type === "tool_use" && b.name === toolName);
  if (block) return block.input as Record<string, unknown>;
  // repli : un objet JSON écrit en texte
  const text = (json.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { /* */ } }
  throw new Error("réponse sans tool_use");
}

async function callDirect(params: Record<string, unknown>, toolName: string) {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY manquante");
  const res = await fetch(`${API}/messages`, { method: "POST", headers: headers(), body: JSON.stringify(params) });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 600)}`);
  const json = await res.json();
  return { out: parseMessage(json, toolName), usage: (json.usage ?? {}) as Usage };
}

// ───────────────────────────────────────────── coûts
// Tarif direct en $ par million de tokens ; lecture du cache en fraction du prix d'entrée.
// Écriture du cache : ×1,25 (5 min) ou ×2 (1 h). Lots : −50 % sur tout.
const PRICES: Record<string, { in: number; out: number; read: number }> = {
  "claude-sonnet-5-5": { in: 2, out: 10, read: 0.05 },
  "claude-sonnet-5": { in: 2, out: 10, read: 0.1 },
  "claude-opus-5-5": { in: 4, out: 20, read: 0.05 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, read: 0.1 },
  "claude-fable-5-1": { in: 10, out: 50, read: 0.025 },
};

function costOf(u: Usage, mode: string) {
  const p = PRICES[MODEL] ?? PRICES["claude-sonnet-5-5"];
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h);
  const std = ((u.input_tokens ?? 0) * p.in + (u.cache_read_input_tokens ?? 0) * p.in * p.read
    + w5m * p.in * 1.25 + w1h * p.in * 2 + (u.output_tokens ?? 0) * p.out) / 1e6;
  return { std, cost: mode === "batch" ? std / 2 : std };
}

async function recordUsage(db: SupabaseClient, job: Job, ctx: Record<string, unknown> | null | undefined, mode: string, u: Usage) {
  const { std, cost } = costOf(u, mode);
  const { error } = await db.from("ai_usage").insert({
    job_type: job.type, kind: (ctx?.kind as string) ?? null, mode, model: MODEL,
    units: Array.isArray(ctx?.ids) ? (ctx!.ids as unknown[]).length : 0,
    input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0,
    cache_read_tokens: u.cache_read_input_tokens ?? 0, cache_write_tokens: u.cache_creation_input_tokens ?? 0,
    cost_usd: cost.toFixed(6), std_usd: std.toFixed(6),
  });
  if (error) console.error("ai_usage", error.message);
}

// taux USD → EUR de la Banque centrale européenne, rafraîchi une fois par jour (sans clé, sans échéance)
async function refreshFx(db: SupabaseClient) {
  try {
    const { data } = await db.from("app_config").select("value").eq("key", "usd_eur").maybeSingle();
    const last = (data?.value as { date?: string } | undefined)?.date;
    if (last && Date.now() - new Date(last).getTime() < 20 * 3600_000) return;
    const res = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    const m = (await res.text()).match(/currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/);
    const eurUsd = m ? Number(m[1]) : 0;
    if (!(eurUsd > 0.5 && eurUsd < 2)) return;
    await db.from("app_config").upsert({ key: "usd_eur", value: { rate: Number((1 / eurUsd).toFixed(4)), date: new Date().toISOString() } });
  } catch (e) {
    console.error("fx", String(e));
  }
}

const langObj = (desc: string, langs: readonly string[] = LANGS) => ({
  type: "object",
  description: desc,
  properties: Object.fromEntries(langs.map((l) => [l, { type: "string", description: LANG_NAMES[l] }])),
  required: [...langs],
});

// ───────────────────────────────────────────── enrichissement des mots
const ENRICH_SYSTEM = `You are an expert teacher of Modern Greek and a meticulous lexicographer. You prepare vocabulary entries for a spaced-repetition app used by adult learners of Greek whose native languages are ${LANGS.map((l) => LANG_NAMES[l]).join(", ")}.

For each Greek input (a word or expression a teacher listed after a lesson, sometimes with an English hint), produce one entry. Rules:

GREEK (always monotonic orthography, standard Modern Greek as really spoken in Greece and Cyprus):
- gr: the dictionary/display form. Nouns with article ("ο πατριός"); nouns used for both sexes as "ο/η συνοδηγός"; adjectives as "αυθόρμητος, -η, -ο"; verbs in 1st person singular present ("υιοθετώ"); expressions as usually cited. Keep the teacher's choice when it is correct; fix obvious typos and say so in "corrected".
- ans: forms accepted when the learner types the word (no article), e.g. ["πατριός"]; include common variants (["ξενυχτάω","ξενυχτώ"]).
- forms: key forms in Greek only (plural, genitive if irregular, aorist, passive aorist, feminine…), e.g. "αόρ. υιοθέτησα · παθ. υιοθετήθηκα". Empty string if nothing useful.
- aor (verbs only): perfective past 1st singular, e.g. ["υιοθέτησα"]; aor_of: the lemma to show in the "give the aorist" drill if different from ans[0] (otherwise ""). Empty for non-verbs.
- fem / neu (adjectives only): feminine and neuter nominative singular. Empty strings otherwise.
- ex: ONE natural, idiomatic example sentence (8–16 words) at the given CEFR level, the kind of sentence a Greek would really say; no names of real public figures. It must contain the word in some inflected form.
- cl: the exact substring of ex that is the target word (as inflected in the sentence). It MUST appear verbatim in ex.
- cd: exactly 4 decoys for a fill-in-the-blank question built from ex. Each decoy MUST have exactly the same grammatical form as cl: same part of speech; for nouns/adjectives same gender, number and case; for verbs same tense, aspect, mood, person, number and voice; for expressions the same structure. Each decoy must be clearly WRONG in meaning in that sentence (never a synonym or a word that could also fit). Prefer words from the provided vocabulary pool, otherwise common words of the level. Respect final -ν rules of the preceding article/negation (τη/στη/μη before continuants, την/στην/μην before vowels and stops). If cl carries a second accent from an enclitic (συναισθήματά του), decoys must too. Lowercase unless proper nouns (then decoys are other proper nouns).
- dr: for verbs and adjectives, one drill where the learner must TYPE an inflected form: {sentence with "___", answers:[accepted forms], hint: grammatical label in each language (e.g. "aorist, 3rd singular")}. Empty array for other parts of speech.

TRANSLATIONS (in each of the 8 languages, written for a learner whose native language it is):
- tr: the precise equivalent(s) a native speaker would really use, short (max ~8 words), separate distinct senses with " ; ". Never translate word-for-word when an idiomatic equivalent exists.
- note: 0–2 short sentences only when genuinely useful: register (formal/colloquial/vulgar), false friends, important nuance vs a near-synonym, construction (e.g. "+ σε"), or a striking etymology. Empty string otherwise.
- ex_tr: natural translation of ex.

theme: one of: ${THEMES.join(", ")}.
${THEME_HELP}

pos: n (noun), v (verb), adj (adjective), adv (adverb), expr (expression / phrase).`;

const ENRICH_TOOL = {
  name: "save_entries",
  description: "Save the vocabulary entries.",
  input_schema: {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer", description: "number of the input line" },
            gr: { type: "string" },
            ans: { type: "array", items: { type: "string" } },
            pos: { type: "string", enum: ["n", "v", "adj", "adv", "expr"] },
            theme: { type: "string", enum: [...THEMES] },
            forms: { type: "string" },
            aor: { type: "array", items: { type: "string" } },
            aor_of: { type: "string" },
            fem: { type: "string" },
            neu: { type: "string" },
            ex: { type: "string" },
            cl: { type: "string" },
            cd: { type: "array", items: { type: "string" } },
            dr: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sentence: { type: "string" },
                  answers: { type: "array", items: { type: "string" } },
                  hint: langObj("grammatical label of the expected form"),
                },
                required: ["sentence", "answers", "hint"],
              },
            },
            tr: langObj("meaning"),
            note: langObj("usage note or empty string"),
            ex_tr: langObj("translation of ex"),
            corrected: { type: "string", description: "explanation if the input was corrected, else empty" },
          },
          required: ["index", "gr", "ans", "pos", "theme", "forms", "ex", "cl", "cd", "tr", "note", "ex_tr"],
        },
      },
    },
    required: ["entries"],
  },
};

const nfc = (s: unknown) => String(s ?? "").normalize("NFC").trim();

function cleanEntry(e: Record<string, unknown>) {
  const ex = nfc(e.ex);
  let cl = nfc(e.cl);
  if (cl && !ex.includes(cl)) {
    const i = ex.toLocaleLowerCase("el").indexOf(cl.toLocaleLowerCase("el"));
    cl = i >= 0 ? ex.slice(i, i + cl.length) : "";
  }
  const ans = (Array.isArray(e.ans) ? e.ans : []).map(nfc).filter(Boolean);
  const gr = nfc(e.gr);
  if (!ans.length && gr) ans.push(gr.replace(/^(ο|η|το|οι|τα|ο\/η)\s+/, "").replace(/,\s*-.*$/, ""));
  const cd = [...new Set((Array.isArray(e.cd) ? e.cd : []).map(nfc).filter(Boolean))]
    .filter((x) => x.toLocaleLowerCase("el") !== cl.toLocaleLowerCase("el"))
    .slice(0, 4);
  const dr = (Array.isArray(e.dr) ? e.dr : [])
    .map((d: Record<string, unknown>) => [nfc(d.sentence), (Array.isArray(d.answers) ? d.answers : []).map(nfc).filter(Boolean), d.hint ?? {}])
    .filter((d) => String(d[0]).includes("___") && (d[1] as string[]).length);
  return {
    gr,
    ans,
    pos: e.pos,
    th: THEMES.includes(e.theme as typeof THEMES[number]) ? e.theme : "ideas",
    forms: nfc(e.forms),
    aor: (Array.isArray(e.aor) ? e.aor : []).map(nfc).filter(Boolean),
    aorOf: nfc(e.aor_of),
    fem: nfc(e.fem),
    neu: nfc(e.neu),
    ex,
    cl,
    cd,
    dr,
    tr: e.tr ?? {},
    note: e.note ?? {},
    exTr: e.ex_tr ?? {},
    corrected: nfc(e.corrected),
  };
}

async function groupOfList(db: SupabaseClient, listId: string) {
  const { data } = await db.from("lists").select("id, group_id, owner_id").eq("id", listId).maybeSingle();
  return data;
}

async function vocabularyPool(db: SupabaseClient, groupId: string | null, ownerId: string | null) {
  let q = db.from("lists").select("id");
  q = groupId ? q.eq("group_id", groupId) : q.eq("owner_id", ownerId);
  const { data: lists } = await q;
  const ids = (lists ?? []).map((l) => l.id);
  if (!ids.length) return [];
  const { data: items } = await db.from("list_items").select("lexemes(input, data, status)").in("list_id", ids).limit(600);
  return (items ?? [])
    .map((i: Record<string, any>) => i.lexemes?.data?.gr || i.lexemes?.input)
    .filter(Boolean)
    .slice(0, 400)
    .sort((a: string, b: string) => a.localeCompare(b, "el")); // ordre stable : même texte d'une requête à l'autre (cache)
}

async function prepareEnrich(db: SupabaseClient, job: Job, pools: Map<string, string[]>): Promise<Prepared | null> {
  const ids = (job.payload.lexeme_ids as string[]) ?? [];
  const level = String(job.payload.level ?? "B1");
  const listId = job.payload.list_id as string | undefined;
  const { data: lexemes, error } = await db.from("lexemes").select("id, input, hint, status").in("id", ids);
  if (error) throw error;
  const todo = (lexemes ?? []).filter((l) => l.status !== "ready");
  if (!todo.length) return null;
  const list = listId ? await groupOfList(db, listId) : null;
  const poolKey = list ? `${list.group_id ?? ""}|${list.owner_id ?? ""}` : "";
  let pool = pools.get(poolKey);
  if (!pool) {
    pool = list ? await vocabularyPool(db, list.group_id, list.owner_id) : [];
    pools.set(poolKey, pool);
  }
  const lines = todo.map((l, i) => `${i + 1}. ${l.input}${l.hint ? `   (teacher's hint: ${l.hint})` : ""}`).join("\n");
  return {
    system: ENRICH_SYSTEM,
    shared: `CEFR level of the learners: ${level}.

Vocabulary pool of this class (use it for decoys when possible):
${pool.join(" · ") || "(empty)"}`,
    user: `Inputs (one entry per line, keep the numbering in "index"):
${lines}`,
    tool: ENRICH_TOOL,
    maxTokens: 4000 + 2600 * todo.length,
    ctx: { ids: todo.map((l) => l.id) },
  };
}

async function finishEnrich(db: SupabaseClient, job: Job, ctx: Record<string, unknown> | null, out: Record<string, unknown> | null) {
  const listId = job.payload.list_id as string | undefined;
  const ids = (ctx?.ids as string[]) ?? [];
  if (out && ids.length) {
    const { data: rows } = await db.from("lexemes").select("id, status").in("id", ids);
    const byId = new Map((rows ?? []).map((r) => [r.id, r]));
    const entries = (out.entries as Record<string, unknown>[]) ?? [];
    for (let i = 0; i < ids.length; i++) {
      const lx = byId.get(ids[i]);
      if (!lx || lx.status === "ready") continue;
      const e = entries.find((x) => Number(x.index) === i + 1);
      if (!e) {
        await db.from("lexemes").update({ status: "error", error: "entrée manquante dans la réponse", updated_at: new Date().toISOString() }).eq("id", lx.id);
        continue;
      }
      const data = cleanEntry(e);
      const missing = LANGS.filter((l) => !String((data.tr as Record<string, string>)[l] ?? "").trim());
      if (!data.gr || missing.length > 2) {
        await db.from("lexemes").update({ status: "error", error: `entrée incomplète (${missing.join(",")})`, updated_at: new Date().toISOString() }).eq("id", lx.id);
        continue;
      }
      await db.from("lexemes").update({ status: "ready", data, error: null, updated_at: new Date().toISOString() }).eq("id", lx.id);
    }
  }
  if (listId) await afterListProgress(db, listId, job.mode);
}

// quand tous les mots d'une liste de groupe sont prêts : proposer un texte court (même mode que la liste)
async function afterListProgress(db: SupabaseClient, listId: string, mode = "batch") {
  const list = await groupOfList(db, listId);
  if (!list?.group_id) return;
  const { data: items } = await db.from("list_items").select("lexemes(status)").eq("list_id", listId);
  const pending = (items ?? []).some((i: Record<string, any>) => i.lexemes?.status === "pending");
  if (pending) return;
  const { data: busy } = await db.from("jobs").select("id").in("type", ["text", "proofread", "translate"]).in("status", ["pending", "running", "batched"])
    .eq("payload->>group_id", list.group_id).limit(1);
  if (busy?.length) return;
  await db.from("jobs").insert({ type: "text", mode, payload: { group_id: list.group_id, kind: "short", reason: "new_list", list_id: listId } });
}

// ───────────────────────────────────────────── textes
// Repères par niveau du CECRL : longueur [court, long], nombre de mots du vivier visés [court, long],
// grammaire et style attendus. Le texte entier doit rester à la portée de la classe.
const LEVEL_GUIDE: Record<string, { length: [string, string]; words: [number, number]; long: string; guide: string }> = {
  A1: {
    length: ["60–90 words", "150–200 words"], words: [8, 14],
    long: "a simple story or a short dialogue about everyday life",
    guide: "absolute beginners. Very short sentences (5–10 words), mostly present tense; a few common past forms (ήμουν, πήγα, έφαγα) only in the long text. Only και, αλλά, γιατί, μετά as connectors; no relative or complex subordinate clauses. Apart from the target words, use only the most frequent everyday words (family, food, home, days, numbers, simple verbs). Concrete, everyday situations; dialogue is welcome.",
  },
  A2: {
    length: ["90–120 words", "220–280 words"], words: [12, 20],
    long: "a story or a dialogue with a few characters",
    guide: "elementary learners. Short sentences (8–14 words); present, aorist (simple past), future with θα, simple να-clauses. Simple subordinate clauses with όταν, γιατί, που, αν. Everyday vocabulary besides the target words; no idioms except very common ones. Familiar situations (shopping, travel, work, friends, plans).",
  },
  B1: {
    length: ["130–170 words", "320–400 words"], words: [16, 26],
    long: "a story or a discussion with two points of view",
    guide: "intermediate learners. Sentences of moderate length with common subordinate clauses; all common tenses (including imperfect and continuous future), subjunctive with να, common passive forms. Connectors such as όμως, επειδή, ενώ, γι' αυτό, παρόλο που. Opinions, feelings, experiences, simple arguments; a few common idioms explained by context.",
  },
  B2: {
    length: ["150–190 words", "380–480 words"], words: [20, 32],
    long: "a story or a discussion with several points of view",
    guide: "upper-intermediate learners. Varied sentence structure with relative and concessive clauses, passive voice, participles in -μένος, varied connectors (ωστόσο, επομένως, αντίθετα, εφόσον). Abstract and social topics, argumentation, some idiomatic expressions. Natural but not literary.",
  },
  C1: {
    length: ["170–210 words", "450–550 words"], words: [22, 36],
    long: "an essay-like discussion, an opinion piece or a nuanced story",
    guide: "advanced learners. Complex syntax and long, well-linked sentences; active participles in -οντας, nominalisations, formal connectors (εντούτοις, συνεπώς, δεδομένου ότι, όχι μόνο… αλλά και), shifts of register, idioms and figurative language. Press, essay or literary style; nuanced viewpoints.",
  },
  C2: {
    length: ["180–230 words", "500–600 words"], words: [22, 36],
    long: "a literary, journalistic or essayistic piece with subtle argumentation",
    guide: "near-native learners. Native-level prose: rich and precise vocabulary, idioms, irony and implicit meaning, learned fixed expressions inherited from katharevousa where natural (εν τω μεταξύ, κατά κόρον, εκ των υστέρων), sophisticated syntax and style comparable to quality Greek press or literature.",
  },
};

const TEXT_SYSTEM = `You are a Greek writer and an experienced teacher of Modern Greek. You write reading texts for a class of adult learners, re-using vocabulary they studied in their lessons, so they meet those words again in real context.

Rules:
- Natural, idiomatic Modern Greek as a Greek would write it (monotonic orthography, correct accents). No translationese.
- Varied, engaging situations from real life (everyday life, family, work, travel in Greece and Cyprus, food, culture, history, society, nature, short stories with recurring characters…). Do not reuse the topics of the previous texts listed.
- Use as many of the target words as naturally possible, inflected correctly in context. The list gives DICTIONARY forms only: verbs in the 1st person singular present (μεταφέρω), nouns in the nominative singular with their article, adjectives in the masculine. Never copy that form into the text unless the sentence really needs it: conjugate verbs for their subject, tense, aspect and mood (η Ελένη ήθελε να μεταφέρει…, not να μεταφέρω), decline nouns and adjectives for case, number and gender, and drop the article when the sentence does not need it.
- Write each sentence as a Greek would, then tag the words: the tag wraps the form the sentence requires.
- Mark EVERY occurrence of a target word with [[form used in the text|N]] where N is the number of the word in the list. Do not mark other words. Never invent numbers.
- Respect the requested length and follow the CEFR level guide given in the request strictly: the whole text (grammar, sentence length, and every word that is not a target word) must be comfortable for a learner of that level.
- No real public figures, nothing offensive. Split into 3–8 paragraphs.`;

const TEXT_TOOL = {
  name: "save_text",
  description: "Save the Greek text.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "short Greek title" },
      paragraphs: { type: "array", items: { type: "string" }, description: "paragraphs in Greek with [[form|N]] tags" },
    },
    required: ["title", "paragraphs"],
  },
};

function shuffle<T>(a: T[]) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

async function prepareText(db: SupabaseClient, job: Job): Promise<Prepared | null> {
  const groupId = String(job.payload.group_id);
  const kind = job.payload.kind === "long" ? "long" : "short";
  const { data: group } = await db.from("groups").select("id, name, level").eq("id", groupId).maybeSingle();
  if (!group) return null;
  const level = group.level ?? "B1";
  const { data: lists } = await db.from("lists").select("id, lesson_date").eq("group_id", groupId).order("lesson_date", { ascending: false });
  if (!lists?.length) return null;
  const { data: items } = await db.from("list_items").select("list_id, lexeme_id, lexemes(id, status, data)").in("list_id", lists.map((l) => l.id));
  const latest = lists[0].id;
  const words = new Map<string, { id: string; gr: string; tr: string; recent: boolean }>();
  for (const it of (items ?? []) as Record<string, any>[]) {
    const lx = it.lexemes;
    if (!lx || lx.status !== "ready" || !lx.data?.gr) continue;
    const prev = words.get(lx.id);
    words.set(lx.id, { id: lx.id, gr: lx.data.gr, tr: lx.data.tr?.en ?? "", recent: (prev?.recent ?? false) || it.list_id === latest });
  }
  if (words.size < 5) return null;

  // mots difficiles du groupe (élèves qui partagent leur progression)
  const memberIds = ((await db.from("group_members").select("user_id, profiles(share_progress)").eq("group_id", groupId)).data ?? [])
    .filter((m: Record<string, any>) => m.profiles?.share_progress).map((m: Record<string, any>) => m.user_id);
  const hard = new Map<string, number>();
  if (memberIds.length) {
    const { data: prog } = await db.from("progress").select("lexeme_id, star, ko").in("user_id", memberIds).or("star.eq.true,ko.gt.0").limit(2000);
    for (const p of prog ?? []) hard.set(p.lexeme_id, (hard.get(p.lexeme_id) ?? 0) + (p.star ? 3 : 0) + (p.ko ?? 0));
  }

  const lv = LEVEL_GUIDE[level] ?? LEVEL_GUIDE.B1;
  const target = kind === "long" ? lv.words[1] : lv.words[0];
  const all = [...words.values()];
  const recent = all.filter((w) => w.recent);
  const hardOnes = all.filter((w) => !w.recent && hard.has(w.id)).sort((a, b) => (hard.get(b.id)! - hard.get(a.id)!));
  const others = shuffle(all.filter((w) => !w.recent && !hard.has(w.id)));
  const picked = [...recent.slice(0, Math.ceil(target * 0.5)), ...hardOnes.slice(0, Math.ceil(target * 0.3)), ...others];
  const chosen = [...new Map(picked.map((w) => [w.id, w])).values()].slice(0, Math.min(target + 10, all.length));

  const { data: prev } = await db.from("texts").select("title").eq("group_id", groupId).order("created_at", { ascending: false }).limit(12);
  const length = kind === "long" ? lv.length[1] : lv.length[0];
  const user = `Class: ${group.name} — CEFR level ${level}.
Level guide for ${level}: ${lv.guide}
Write a ${kind === "long" ? `LONG text for this level that requires some concentration (${lv.long})` : "SHORT text that reads quickly"} of ${length}, using at least ${Math.min(Math.round(target * 0.8), chosen.length)} of the target words (more only if it stays natural for the level).

Previous texts (choose a different topic): ${(prev ?? []).map((t) => t.title).join(" · ") || "none"}

Target words (number. dictionary form — English meaning):
${chosen.map((w, i) => `${i + 1}. ${w.gr} — ${w.tr}`).join("\n")}`;

  return {
    system: TEXT_SYSTEM, user, tool: TEXT_TOOL, maxTokens: kind === "long" ? 6000 : 3000,
    ctx: { chosen: chosen.map((w) => w.id), kind },
  };
}

async function finishText(db: SupabaseClient, job: Job, ctx: Record<string, unknown> | null, out: Record<string, unknown> | null) {
  if (!out || !ctx) return;
  const groupId = String(job.payload.group_id);
  const kind = ctx.kind === "long" ? "long" : "short";
  const chosen = (ctx.chosen as string[]) ?? [];
  const used = new Set<string>();
  const paragraphs = ((out.paragraphs as string[]) ?? []).map((p) => {
    const gr = nfc(p).replace(/\[\[([^|\]]+)\|(\d+)\]\]/g, (_m, form: string, n: string) => {
      const id = chosen[Number(n) - 1];
      if (!id) return form;
      used.add(id);
      return `[[${form}|${id}]]`;
    });
    return { gr, tr: {} };
  }).filter((p) => p.gr);
  if (!paragraphs.length) throw new Error("texte vide");

  const { data: text, error } = await db.from("texts").insert({
    group_id: groupId, kind, title: nfc(out.title) || "Κείμενο", paragraphs, word_ids: [...used], status: "translating",
  }).select("id").single();
  if (error) throw error;
  // relecture (grammaire, conjugaisons et accords des mots du vivier), puis traduction
  await db.from("jobs").insert({ type: "proofread", mode: job.mode, payload: { text_id: text.id, group_id: groupId } });
}

async function queueTranslate(db: SupabaseClient, textId: string, groupId: string, mode: string) {
  await db.from("jobs").insert([
    { type: "translate", mode, payload: { text_id: textId, group_id: groupId, langs: ["en", "fr", "de", "es"] } },
    { type: "translate", mode, payload: { text_id: textId, group_id: groupId, langs: ["it", "ru", "pl", "tr"] } },
  ]);
}

// ───────────────────────────────────────────── relecture des textes
// Le texte est écrit en une passe à partir des formes de dictionnaire : un verbe peut rester à la
// 1re personne (« ήθελε να μεταφέρω »). Un relecteur signale les fautes ; on n'applique que des
// remplacements exacts et sûrs (balises conservées), le reste du texte ne bouge pas.
const PROOF_SYSTEM = `You are a meticulous proofreader of Modern Greek and an experienced teacher. You check reading texts written for learners before they are published.

The text re-uses vocabulary from the class. Each such word is tagged [[form in the text|N]], where N refers to the numbered word list (dictionary forms: verbs in the 1st person singular present, nouns in the nominative singular, adjectives in the masculine). The writer sometimes copies the dictionary form instead of inflecting it.

Check every sentence, and above all every tagged word:
- verbs: person and number agree with the subject; tense, aspect (imperfective/perfective after να, θα, ας) and mood fit the sentence;
- nouns, adjectives, articles and participles: case, number and gender agree;
- accents and spelling (monotonic), final -ν of articles and negations;
- a tagged form must be a form of word N itself.
Report only real errors, not style preferences. If the text is correct, return an empty list.

For each error give the paragraph number, the exact wrong snippet copied character for character from the paragraph (including any [[…|N]] tag, and long enough to occur only once in that paragraph), and the corrected snippet (keep the tag with the same number around the corrected form).`;

const PROOF_TOOL = {
  name: "save_corrections",
  description: "Save the corrections (an empty list if the text is correct).",
  input_schema: {
    type: "object",
    properties: {
      corrections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            paragraph: { type: "integer", description: "paragraph number, from 1" },
            wrong: { type: "string", description: "exact snippet as it appears in the paragraph, tags included" },
            right: { type: "string", description: "corrected snippet, same tags" },
            reason: { type: "string", description: "short explanation in English" },
          },
          required: ["paragraph", "wrong", "right", "reason"],
        },
      },
    },
    required: ["corrections"],
  },
};

async function prepareProofread(db: SupabaseClient, job: Job): Promise<Prepared | null> {
  const textId = String(job.payload.text_id);
  const { data: text } = await db.from("texts").select("id, title, kind, paragraphs, word_ids").eq("id", textId).maybeSingle();
  if (!text) return null;
  const ids = [...new Set([...(text.word_ids ?? []),
    ...(text.paragraphs as { gr: string }[]).flatMap((p) => [...p.gr.matchAll(/\[\[[^|\]]+\|([^\]]+)\]\]/g)].map((m) => m[1]))])];
  const { data: lx } = ids.length ? await db.from("lexemes").select("id, data").in("id", ids) : { data: [] };
  const dict = new Map((lx ?? []).map((l: Record<string, any>) => [l.id, l.data ?? {}]));
  const num = new Map(ids.map((id, i) => [id, i + 1]));
  const plain = (text.paragraphs as { gr: string }[]).map((p) =>
    p.gr.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, (_m, f: string, id: string) => `[[${f}|${num.get(id)}]]`));
  const user = `Title: ${text.title}

Word list (number. dictionary form — English meaning):
${ids.map((id, i) => `${i + 1}. ${dict.get(id)?.gr ?? "?"} — ${dict.get(id)?.tr?.en ?? ""}`).join("\n")}

${plain.map((p, i) => `Paragraph ${i + 1}:\n${p}`).join("\n\n")}`;
  return {
    system: PROOF_SYSTEM, user, tool: PROOF_TOOL, maxTokens: 3000,
    ctx: { ids, kind: text.kind, plain },
  };
}

async function finishProofread(db: SupabaseClient, job: Job, ctx: Record<string, unknown> | null, out: Record<string, unknown> | null) {
  const textId = String(job.payload.text_id);
  const groupId = String(job.payload.group_id);
  const existing = !!job.payload.existing; // texte déjà traduit : on corrige le grec sans retraduire
  const { data: text } = await db.from("texts").select("id, title, paragraphs").eq("id", textId).maybeSingle();
  if (!text) return; // supprimé entre-temps
  const ids = (ctx?.ids as string[]) ?? [];
  const plain = ((ctx?.plain as string[]) ?? []).slice();
  const tagNums = (s: string) => [...s.matchAll(/\[\[[^|\]]+\|(\d+)\]\]/g)].map((m) => m[1]).sort().join(",");
  let applied = 0;
  const log: string[] = [];
  for (const c of ((out?.corrections as Record<string, unknown>[]) ?? [])) {
    const i = Number(c.paragraph) - 1, wrong = nfc(c.wrong), right = nfc(c.right);
    if (!(i >= 0 && i < plain.length) || !wrong || !right || wrong === right) continue;
    if (plain[i].split(wrong).length !== 2) continue;           // introuvable ou ambigu : on n'y touche pas
    if (tagNums(wrong) !== tagNums(right)) continue;             // balises perdues ou inventées
    if (right.length > wrong.length * 2 + 20) continue;          // réécriture trop large
    plain[i] = plain[i].replace(wrong, right);
    applied++;
    log.push(`§${i + 1} ${wrong} → ${right}`);
    console.log(`relecture ${textId} §${i + 1}: ${wrong} → ${right} (${String(c.reason ?? "")})`);
  }
  if (applied) {
    const toIds = (s: string) => s.replace(/\[\[([^|\]]+)\|(\d+)\]\]/g, (_m, f: string, n: string) => ids[Number(n) - 1] ? `[[${f}|${ids[Number(n) - 1]}]]` : f);
    const before = (text.paragraphs as { gr: string; tr: Record<string, string> }[]);
    if (before.length === plain.length) {
      const paragraphs = before.map((p, i) => ({ ...p, gr: toIds(plain[i]) }));
      await db.from("texts").update({ paragraphs }).eq("id", textId);
      // copies identiques (classe de démonstration) : même correction, sans nouvel appel
      const { data: twins } = await db.from("texts").select("id, paragraphs").eq("title", text.title).neq("id", textId);
      for (const tw of twins ?? []) {
        const tp = tw.paragraphs as { gr: string; tr: Record<string, string> }[];
        if (tp.length === before.length && tp.every((p, i) => p.gr === before[i].gr)) {
          await db.from("texts").update({ paragraphs: tp.map((p, i) => ({ ...p, gr: paragraphs[i].gr })) }).eq("id", tw.id);
        }
      }
    }
  }
  // trace des corrections appliquées (visible dans diagnose.yml)
  await db.from("jobs").update({ ctx: { applied: log, proposed: ((out?.corrections as unknown[]) ?? []).length } }).eq("id", job.id);
  if (!existing) await queueTranslate(db, textId, groupId, job.mode);
}

const TRANSLATE_SYSTEM = `You translate Modern Greek reading texts for language learners. Translate faithfully and naturally (not word-for-word), paragraph by paragraph, keeping the same number of paragraphs, so a learner can check their understanding.`;

function translateTool(langs: string[]): Tool {
  return {
    name: "save_translation",
    description: "Save the translations.",
    input_schema: {
      type: "object",
      properties: {
        title: langObj("title", langs),
        paragraphs: { type: "array", items: langObj("one paragraph", langs) },
      },
      required: ["title", "paragraphs"],
    },
  };
}

async function prepareTranslate(db: SupabaseClient, job: Job): Promise<Prepared | null> {
  const textId = String(job.payload.text_id);
  const langs = ((job.payload.langs as string[]) ?? []).filter((l) => (LANGS as readonly string[]).includes(l));
  const { data: text } = await db.from("texts").select("id, title, kind, paragraphs").eq("id", textId).maybeSingle();
  if (!text || !langs.length) return null;
  const plain = (text.paragraphs as { gr: string }[]).map((p) => p.gr.replace(/\[\[([^|\]]+)\|[^\]]+\]\]/g, "$1"));
  const user = `Translate into ${langs.map((l) => LANG_NAMES[l]).join(", ")}.

Title: ${text.title}

${plain.map((p, i) => `Paragraph ${i + 1}:\n${p}`).join("\n\n")}`;
  return {
    system: TRANSLATE_SYSTEM, user, tool: translateTool(langs), maxTokens: 1500 + plain.join(" ").length * langs.length,
    ctx: { langs, n: plain.length, kind: text.kind },
  };
}

async function finishTranslate(db: SupabaseClient, job: Job, ctx: Record<string, unknown> | null, out: Record<string, unknown> | null) {
  if (!out || !ctx) return;
  const textId = String(job.payload.text_id);
  const langs = (ctx.langs as string[]) ?? [];
  const tp = (out.paragraphs as Record<string, string>[]) ?? [];
  if (tp.length !== Number(ctx.n)) throw new Error(`nombre de paragraphes différent (${tp.length}/${ctx.n})`);

  // relire juste avant d'écrire (l'autre moitié des langues a pu arriver entre-temps)
  const { data: fresh } = await db.from("texts").select("title_tr, paragraphs").eq("id", textId).maybeSingle();
  if (!fresh) return; // texte supprimé entre-temps
  const titleTr = { ...(fresh.title_tr ?? {}), ...(out.title as Record<string, string>) };
  const paragraphs = (fresh.paragraphs as { gr: string; tr: Record<string, string> }[]).map((p, i) => ({
    gr: p.gr, tr: { ...(p.tr ?? {}), ...Object.fromEntries(langs.map((l) => [l, nfc(tp[i]?.[l])])) },
  }));
  const complete = LANGS.every((l) => titleTr[l] && paragraphs.every((p) => p.tr[l]));
  await db.from("texts").update({ title_tr: titleTr, paragraphs, status: complete ? "ready" : "translating" }).eq("id", textId);
}

// ───────────────────────────────────────────── orchestration
const TOOL_NAME: Record<string, string> = { enrich: "save_entries", text: "save_text", proofread: "save_corrections", translate: "save_translation" };
const stamp = () => new Date().toISOString();

function prepare(db: SupabaseClient, job: Job, pools: Map<string, string[]>) {
  if (job.type === "enrich") return prepareEnrich(db, job, pools);
  if (job.type === "text") return prepareText(db, job);
  if (job.type === "proofread") return prepareProofread(db, job);
  if (job.type === "translate") return prepareTranslate(db, job);
  return Promise.resolve(null);
}

function finish(db: SupabaseClient, job: Job, ctx: Record<string, unknown> | null, out: Record<string, unknown> | null) {
  if (job.type === "enrich") return finishEnrich(db, job, ctx, out);
  if (job.type === "text") return finishText(db, job, ctx, out);
  if (job.type === "proofread") return finishProofread(db, job, ctx, out);
  if (job.type === "translate") return finishTranslate(db, job, ctx, out);
  return Promise.resolve();
}

async function markDone(db: SupabaseClient, job: Job) {
  await db.from("jobs").update({ status: "done", last_error: null, updated_at: stamp() }).eq("id", job.id);
}

// échec : nouvelle tentative plus tard (en direct si toSync), erreur définitive après 4 tentatives
async function failJob(db: SupabaseClient, job: Job, msg: string, toSync = false) {
  console.error(`job ${job.id} (${job.type}, ${job.mode})`, msg);
  const final = job.attempts >= 3;
  const delayMin = Math.pow(2, job.attempts) * 2;
  await db.from("jobs").update({
    status: final ? "error" : "pending",
    last_error: msg.slice(0, 1000),
    run_after: new Date(Date.now() + delayMin * 60_000).toISOString(),
    batch_id: null,
    ...(toSync ? { mode: "sync" } : {}),
    updated_at: stamp(),
  }).eq("id", job.id);
  if (final && job.type === "enrich") {
    const ids = (job.payload.lexeme_ids as string[]) ?? [];
    await db.from("lexemes").update({ status: "error", error: msg.slice(0, 300) }).in("id", ids).eq("status", "pending");
    if (job.payload.list_id) await afterListProgress(db, String(job.payload.list_id), job.mode);
  }
  // relecture impossible : le texte part quand même en traduction, tel quel
  if (final && job.type === "proofread" && job.payload.text_id && !job.payload.existing) {
    await queueTranslate(db, String(job.payload.text_id), String(job.payload.group_id), job.mode);
  }
  if (final && job.type === "translate" && job.payload.text_id) {
    await db.from("texts").update({ status: "error" }).eq("id", String(job.payload.text_id));
  }
}

// requête d'un lot annulé ou expiré : non facturée, elle repasse tout de suite en direct sans compter de tentative
async function requeueSync(db: SupabaseClient, job: Job) {
  await db.from("jobs").update({
    status: "pending", mode: "sync", batch_id: null, attempts: Math.max(0, job.attempts - 1),
    run_after: stamp(), last_error: "lot annulé ou expiré : traitement direct", updated_at: stamp(),
  }).eq("id", job.id);
}

// ── appels directs (traitement rapide, reprises)
async function runSync(db: SupabaseClient, deadline: number) {
  const { count } = await db.from("jobs").select("id", { count: "exact", head: true })
    .eq("status", "pending").eq("mode", "sync").eq("type", "enrich").lte("run_after", stamp());
  // Cache des consignes (5 min) : écrire coûte 1,25 fois le prix, relire 0,05 fois. Rentable dès 2 requêtes
  // qui se suivent ; inutile pour quelques mots isolés (une seule requête).
  let enrichLeft = count ?? 0;
  let lastWrite = 0;
  while (Date.now() < deadline) {
    const { data: jobs, error } = await db.rpc("claim_jobs_mode", { p_mode: "sync", p_limit: 1 });
    if (error) { console.error("claim_jobs_mode", error); return; }
    const job = (jobs as Job[] | null)?.[0];
    if (!job) return;
    try {
      const prep = await prepare(db, job, new Map()); // vivier relu à chaque fois : il change à mesure que les mots sont prêts
      if (prep) {
        let cache = false;
        if (job.type === "enrich") {
          cache = enrichLeft >= 2 || Date.now() - lastWrite < 270_000;
          enrichLeft--;
        }
        const r = await callDirect(buildParams(prep, { system: cache, shared: false }), prep.tool.name);
        if (cache) lastWrite = Date.now();
        await recordUsage(db, job, prep.ctx, "sync", r.usage);
        await finish(db, job, prep.ctx, r.out);
      } else {
        await finish(db, job, null, null);
      }
      await markDone(db, job);
    } catch (e) {
      await failJob(db, job, String((e as Error)?.message ?? e));
    }
  }
}

// ── envoi d'un lot
async function submitBatch(db: SupabaseClient) {
  const { data, error } = await db.rpc("claim_jobs_mode", { p_mode: "batch", p_limit: BATCH_MAX_JOBS });
  if (error) { console.error("claim_jobs_mode", error); return; }
  const jobs = (data as Job[] | null) ?? [];
  if (!jobs.length) return;
  const pools = new Map<string, string[]>();
  const ready: { job: Job; prep: Prepared }[] = [];
  for (const job of jobs) {
    try {
      const prep = await prepare(db, job, pools);
      if (prep) ready.push({ job, prep });
      else { await finish(db, job, null, null); await markDone(db, job); }
    } catch (e) {
      await failJob(db, job, String((e as Error)?.message ?? e));
    }
  }
  if (!ready.length) return;

  // Cache dans un lot : les requêtes sont traitées en parallèle, la relecture du cache n'est pas garantie
  // (30 à 98 % selon Anthropic). Avec une durée de 5 min, une relecture manquée coûte 1,25 fois le prix au lieu
  // de 2 fois avec 1 h : c'est rentable dès qu'un tiers environ des requêtes relit le cache. On ne l'active
  // qu'à partir de 4 requêtes qui partagent les mêmes consignes (et, pour le vivier, le même vivier).
  const enrichN = ready.filter((r) => r.job.type === "enrich").length;
  const sharedN = new Map<string, number>();
  for (const r of ready) if (r.job.type === "enrich" && r.prep.shared) sharedN.set(r.prep.shared, (sharedN.get(r.prep.shared) ?? 0) + 1);
  const cacheOn = enrichN >= 4;
  const requests = ready.map(({ job, prep }) => {
    const e = job.type === "enrich" && cacheOn;
    return {
      custom_id: `job-${job.id}`,
      params: buildParams(prep, { system: e, shared: e && (sharedN.get(prep.shared ?? "") ?? 0) >= 4 }),
    };
  });

  try {
    if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY manquante");
    const res = await fetch(`${API}/messages/batches`, { method: "POST", headers: headers(), body: JSON.stringify({ requests }) });
    if (!res.ok) throw new Error(`anthropic batch ${res.status}: ${(await res.text()).slice(0, 600)}`);
    const batch = await res.json();
    // Le lot existe chez Anthropic : on ne le renvoie jamais. Si l'écriture du suivi échoue, pollBatches
    // le retrouve à partir des tâches marquées « batched ».
    for (const { job, prep } of ready) {
      const { error: e1 } = await db.from("jobs").update({ status: "batched", batch_id: batch.id, ctx: prep.ctx, updated_at: stamp() }).eq("id", job.id);
      if (e1) console.error(`job ${job.id} : suivi du lot`, e1.message);
    }
    const { error: e2 } = await db.from("ai_batches").insert({ id: batch.id, job_ids: ready.map((r) => r.job.id), cached: cacheOn });
    if (e2) console.error(`lot ${batch.id} : suivi`, e2.message);
    console.log(`lot ${batch.id} : ${ready.length} requêtes${cacheOn ? " (cache)" : ""}`);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    for (const { job } of ready) await failJob(db, job, msg);
  }
}

// ── suivi des lots : réception des résultats, filet de sécurité à 2 h
async function pollBatches(db: SupabaseClient, deadline: number) {
  // lots orphelins : tâches « batched » dont le lot n'a pas de ligne de suivi
  const { data: waiting } = await db.from("jobs").select("id, batch_id, updated_at").eq("status", "batched").not("batch_id", "is", null);
  const known = new Set(((await db.from("ai_batches").select("id").in("id", [...new Set((waiting ?? []).map((j) => j.batch_id))])).data ?? []).map((b) => b.id));
  const orphans = new Map<string, { ids: number[]; at: string }>();
  for (const j of waiting ?? []) {
    if (known.has(j.batch_id)) continue;
    const o = orphans.get(j.batch_id) ?? { ids: [] as number[], at: String(j.updated_at) };
    o.ids.push(j.id);
    if (j.updated_at < o.at) o.at = j.updated_at;
    orphans.set(j.batch_id, o);
  }
  for (const [id, o] of orphans) {
    const { error } = await db.from("ai_batches").upsert({ id, job_ids: o.ids, created_at: o.at }, { onConflict: "id", ignoreDuplicates: true });
    if (error) console.error(`lot ${id} : suivi`, error.message);
  }

  const { data: batches } = await db.from("ai_batches").select("id, status, created_at")
    .in("status", ["in_progress", "canceling", "ended"]).order("created_at");
  for (const b of batches ?? []) {
    if (Date.now() > deadline) return;
    try {
      const res = await fetch(`${API}/messages/batches/${b.id}`, { headers: headers() });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const info = await res.json();
      if (info.processing_status === "ended") {
        if (b.status !== "ended") await db.from("ai_batches").update({ status: "ended", polled_at: stamp() }).eq("id", b.id);
        await processBatch(db, b.id, info.results_url, deadline);
        continue;
      }
      if (b.status === "in_progress" && Date.now() - new Date(b.created_at).getTime() > BATCH_TIMEOUT_MS) {
        const c = await fetch(`${API}/messages/batches/${b.id}/cancel`, { method: "POST", headers: headers() });
        if (!c.ok) throw new Error(`annulation ${c.status}: ${(await c.text()).slice(0, 300)}`);
        await db.from("ai_batches").update({ status: "canceling", cancel_requested_at: stamp(), polled_at: stamp() }).eq("id", b.id);
        console.log(`lot ${b.id} : annulé après 2 h, le reste passera en direct`);
      } else {
        await db.from("ai_batches").update({ polled_at: stamp() }).eq("id", b.id);
      }
    } catch (e) {
      console.error(`lot ${b.id}`, String((e as Error)?.message ?? e));
    }
  }
}

// Traite les résultats d'un lot terminé. Ne touche qu'aux tâches encore « batched » : on peut le relancer sans risque.
async function processBatch(db: SupabaseClient, batchId: string, resultsUrl: string, deadline: number) {
  const { data } = await db.from("jobs").select("id, type, mode, payload, attempts, ctx").eq("batch_id", batchId).eq("status", "batched");
  const pending = new Map(((data as Job[] | null) ?? []).map((j) => [j.id, j]));
  if (pending.size) {
    const res = await fetch(resultsUrl, { headers: headers() });
    if (!res.ok) throw new Error(`résultats ${res.status}: ${(await res.text()).slice(0, 300)}`);
    for (const line of (await res.text()).split("\n")) {
      if (Date.now() > deadline) return; // la suite au prochain réveil
      if (!line.trim()) continue;
      let r: Record<string, any>;
      try { r = JSON.parse(line); } catch { continue; }
      const job = pending.get(Number(String(r.custom_id).replace(/^job-/, "")));
      if (!job) continue;
      pending.delete(job.id);
      const type = r.result?.type;
      if (type === "succeeded") {
        const msg = r.result.message ?? {};
        await recordUsage(db, job, job.ctx, "batch", msg.usage ?? {});
        try {
          await finish(db, job, job.ctx ?? null, parseMessage(msg, TOOL_NAME[job.type]));
          await markDone(db, job);
        } catch (e) {
          await failJob(db, job, String((e as Error)?.message ?? e), true);
        }
      } else if (type === "errored") {
        await failJob(db, job, `lot : ${JSON.stringify(r.result?.error ?? {}).slice(0, 400)}`, true);
      } else {
        await requeueSync(db, job); // canceled / expired : non facturé
      }
    }
    for (const job of pending.values()) await requeueSync(db, job); // absente des résultats
  }
  await db.from("ai_batches").update({ status: "processed", processed_at: stamp() }).eq("id", batchId);
}

async function runLoop(db: SupabaseClient) {
  const start = Date.now();
  await refreshFx(db);
  await pollBatches(db, start + BUDGET_MS - 20_000);
  await submitBatch(db);
  await runSync(db, start + BUDGET_MS - 45_000);
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret") ?? "";
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: ok } = await db.rpc("worker_secret_ok", { p_secret: secret });
  if (!ok) return new Response("forbidden", { status: 403 });
  const work = runLoop(db).catch((e) => console.error("loop", e));
  // @ts-ignore EdgeRuntime est fourni par Supabase
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
    return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "content-type": "application/json" } });
  }
  await work;
  return new Response(JSON.stringify({ done: true }), { headers: { "content-type": "application/json" } });
});
