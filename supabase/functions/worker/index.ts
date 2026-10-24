// Λεξούλα — worker IA
// © 2026 Φοίβος Λεπέρ (Fabien Lepère). Tous droits réservés.
//
// Réveillé chaque minute par pg_cron (public.kick_worker) quand des tâches attendent.
// Types de tâches :
//   enrich    : compléter jusqu'à 5 mots (traductions en 8 langues, formes, exemple, leurres, exercices)
//   text      : écrire un texte grec (court ou long) avec les mots d'un groupe
//   translate : traduire un texte dans une partie des 8 langues

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { LANGS, LANG_NAMES, THEMES, THEME_HELP } from "../_shared/themes.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
const BUDGET_MS = 115_000; // le free tier coupe vers 150 s

type Job = { id: number; type: string; payload: Record<string, unknown>; attempts: number };

// ───────────────────────────────────────────── appel à Claude (sortie structurée via un outil)
async function claude(system: string, user: string, tool: Record<string, unknown>, maxTokens: number) {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY manquante");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      tools: [tool],
      // Sonnet 5.5 refuse l'appel d'outil forcé : on laisse « auto » et on le demande dans le message
      tool_choice: { type: "auto" },
      thinking: { type: "between_tools" },
      messages: [{ role: "user", content: `${user}\n\nReply only by calling the tool \`${tool.name}\` once, with the complete data. Do not write any other text.` }],
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 600);
    throw new Error(`anthropic ${res.status}: ${body}`);
  }
  const json = await res.json();
  if (json.stop_reason === "max_tokens") throw new Error("réponse tronquée (max_tokens)");
  if (json.stop_reason === "refusal") throw new Error("refus du modèle");
  const block = (json.content ?? []).find((b: { type: string; name?: string }) => b.type === "tool_use" && b.name === tool.name);
  if (block) return block.input as Record<string, unknown>;
  // repli : un objet JSON écrit en texte
  const text = (json.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { /* */ } }
  throw new Error("réponse sans tool_use");
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
    .slice(0, 400);
}

async function doEnrich(db: SupabaseClient, job: Job) {
  const ids = (job.payload.lexeme_ids as string[]) ?? [];
  const level = String(job.payload.level ?? "B1");
  const listId = job.payload.list_id as string | undefined;
  const { data: lexemes, error } = await db.from("lexemes").select("id, input, hint, status").in("id", ids);
  if (error) throw error;
  const todo = (lexemes ?? []).filter((l) => l.status !== "ready");
  if (todo.length) {
    const list = listId ? await groupOfList(db, listId) : null;
    const pool = list ? await vocabularyPool(db, list.group_id, list.owner_id) : [];
    const lines = todo.map((l, i) => `${i + 1}. ${l.input}${l.hint ? `   (teacher's hint: ${l.hint})` : ""}`).join("\n");
    const user = `CEFR level of the learners: ${level}.

Vocabulary pool of this class (use it for decoys when possible):
${pool.join(" · ") || "(empty)"}

Inputs (one entry per line, keep the numbering in "index"):
${lines}`;
    const out = await claude(ENRICH_SYSTEM, user, ENRICH_TOOL, 4000 + 2600 * todo.length);
    const entries = (out.entries as Record<string, unknown>[]) ?? [];
    for (let i = 0; i < todo.length; i++) {
      const lx = todo[i];
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
  if (listId) await afterListProgress(db, listId);
}

// quand tous les mots d'une liste de groupe sont prêts : proposer un texte court
async function afterListProgress(db: SupabaseClient, listId: string) {
  const list = await groupOfList(db, listId);
  if (!list?.group_id) return;
  const { data: items } = await db.from("list_items").select("lexemes(status)").eq("list_id", listId);
  const pending = (items ?? []).some((i: Record<string, any>) => i.lexemes?.status === "pending");
  if (pending) return;
  const { data: busy } = await db.from("jobs").select("id").in("type", ["text", "translate"]).in("status", ["pending", "running"])
    .eq("payload->>group_id", list.group_id).limit(1);
  if (busy?.length) return;
  await db.from("jobs").insert({ type: "text", payload: { group_id: list.group_id, kind: "short", reason: "new_list", list_id: listId } });
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
- Use as many of the target words as naturally possible, inflected correctly in context (the form may differ from the dictionary form).
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

async function doText(db: SupabaseClient, job: Job) {
  const groupId = String(job.payload.group_id);
  const kind = job.payload.kind === "long" ? "long" : "short";
  const { data: group } = await db.from("groups").select("id, name, level").eq("id", groupId).maybeSingle();
  if (!group) return;
  const level = group.level ?? "B1";
  const { data: lists } = await db.from("lists").select("id, lesson_date").eq("group_id", groupId).order("lesson_date", { ascending: false });
  if (!lists?.length) return;
  const { data: items } = await db.from("list_items").select("list_id, lexeme_id, lexemes(id, status, data)").in("list_id", lists.map((l) => l.id));
  const latest = lists[0].id;
  const words = new Map<string, { id: string; gr: string; tr: string; recent: boolean }>();
  for (const it of (items ?? []) as Record<string, any>[]) {
    const lx = it.lexemes;
    if (!lx || lx.status !== "ready" || !lx.data?.gr) continue;
    const prev = words.get(lx.id);
    words.set(lx.id, { id: lx.id, gr: lx.data.gr, tr: lx.data.tr?.en ?? "", recent: (prev?.recent ?? false) || it.list_id === latest });
  }
  if (words.size < 5) return;

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

  const out = await claude(TEXT_SYSTEM, user, TEXT_TOOL, kind === "long" ? 6000 : 3000);
  const used = new Set<string>();
  const paragraphs = ((out.paragraphs as string[]) ?? []).map((p) => {
    const gr = nfc(p).replace(/\[\[([^|\]]+)\|(\d+)\]\]/g, (_m, form: string, n: string) => {
      const w = chosen[Number(n) - 1];
      if (!w) return form;
      used.add(w.id);
      return `[[${form}|${w.id}]]`;
    });
    return { gr, tr: {} };
  }).filter((p) => p.gr);
  if (!paragraphs.length) throw new Error("texte vide");

  const { data: text, error } = await db.from("texts").insert({
    group_id: groupId, kind, title: nfc(out.title) || "Κείμενο", paragraphs, word_ids: [...used], status: "translating",
  }).select("id").single();
  if (error) throw error;
  await db.from("jobs").insert([
    { type: "translate", payload: { text_id: text.id, group_id: groupId, langs: ["en", "fr", "de", "es"] } },
    { type: "translate", payload: { text_id: text.id, group_id: groupId, langs: ["it", "ru", "pl", "tr"] } },
  ]);
}

const TRANSLATE_SYSTEM = `You translate Modern Greek reading texts for language learners. Translate faithfully and naturally (not word-for-word), paragraph by paragraph, keeping the same number of paragraphs, so a learner can check their understanding.`;

async function doTranslate(db: SupabaseClient, job: Job) {
  const textId = String(job.payload.text_id);
  const langs = ((job.payload.langs as string[]) ?? []).filter((l) => (LANGS as readonly string[]).includes(l));
  const { data: text } = await db.from("texts").select("id, title, paragraphs").eq("id", textId).maybeSingle();
  if (!text || !langs.length) return;
  const plain = (text.paragraphs as { gr: string }[]).map((p) => p.gr.replace(/\[\[([^|\]]+)\|[^\]]+\]\]/g, "$1"));
  const tool = {
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
  const user = `Translate into ${langs.map((l) => LANG_NAMES[l]).join(", ")}.

Title: ${text.title}

${plain.map((p, i) => `Paragraph ${i + 1}:\n${p}`).join("\n\n")}`;
  const out = await claude(TRANSLATE_SYSTEM, user, tool, 1500 + plain.join(" ").length * langs.length);
  const tp = (out.paragraphs as Record<string, string>[]) ?? [];
  if (tp.length !== plain.length) throw new Error(`nombre de paragraphes différent (${tp.length}/${plain.length})`);

  // relire juste avant d'écrire (l'autre moitié des langues a pu arriver entre-temps)
  const { data: fresh } = await db.from("texts").select("title_tr, paragraphs").eq("id", textId).single();
  const titleTr = { ...(fresh!.title_tr ?? {}), ...(out.title as Record<string, string>) };
  const paragraphs = (fresh!.paragraphs as { gr: string; tr: Record<string, string> }[]).map((p, i) => ({
    gr: p.gr, tr: { ...(p.tr ?? {}), ...Object.fromEntries(langs.map((l) => [l, nfc(tp[i]?.[l])])) },
  }));
  const complete = LANGS.every((l) => titleTr[l] && paragraphs.every((p) => p.tr[l]));
  await db.from("texts").update({ title_tr: titleTr, paragraphs, status: complete ? "ready" : "translating" }).eq("id", textId);
}

// ───────────────────────────────────────────── boucle
async function runLoop(db: SupabaseClient) {
  const start = Date.now();
  while (Date.now() - start < BUDGET_MS - 45_000) {
    const { data: jobs, error } = await db.rpc("claim_jobs", { p_limit: 1 });
    if (error) { console.error("claim_jobs", error); return; }
    const job = (jobs as Job[] | null)?.[0];
    if (!job) return;
    try {
      if (job.type === "enrich") await doEnrich(db, job);
      else if (job.type === "text") await doText(db, job);
      else if (job.type === "translate") await doTranslate(db, job);
      await db.from("jobs").update({ status: "done", last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 1000);
      console.error(`job ${job.id} (${job.type})`, msg);
      const final = job.attempts >= 3;
      const delayMin = Math.pow(2, job.attempts) * 2;
      await db.from("jobs").update({
        status: final ? "error" : "pending",
        last_error: msg,
        run_after: new Date(Date.now() + delayMin * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      if (final && job.type === "enrich") {
        const ids = (job.payload.lexeme_ids as string[]) ?? [];
        await db.from("lexemes").update({ status: "error", error: msg.slice(0, 300) }).in("id", ids).eq("status", "pending");
        if (job.payload.list_id) await afterListProgress(db, String(job.payload.list_id));
      }
      if (final && (job.type === "translate" || job.type === "text") && job.payload.text_id) {
        await db.from("texts").update({ status: "error" }).eq("id", String(job.payload.text_id));
      }
    }
  }
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
