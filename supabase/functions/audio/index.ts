// Λεξούλα — fonction « audio » : fichiers audio des mots, des phrases d'exemple et des textes
// © 2026 Φοίβος Λεπέρ (Fabien Lepère). Tous droits réservés.
//
// Réveillée par pg_cron (public.kick_audio) quand il y a du nouveau. Elle calcule tout ce que l'appli peut lire
// (module partagé ../_shared/speech.js), cherche ce qui manque dans la table public.audio, le fait lire par
// Google Gemini TTS et dépose des MP3 dans le bucket public « audio ».
//
// Robustesse (décision du 30/10/2026) :
//  * modèle principal gemini-3.1-flash-tts-preview (en preview) ; s'il disparaît (404, modèle inconnu ou retiré),
//    il est mis de côté 7 jours et le modèle stable gemini-3.8-flash-tts prend le relais, même voix et même consigne ;
//  * crédits épuisés, plafond atteint ou clé refusée : pause de 6 h, puis nouvel essai ; quota par minute : le délai
//    indiqué par Google (8 requêtes au plus par réveil pour rester sous la limite) ; quota du jour (≈ 100 requêtes pour
//    le modèle preview) : pause jusqu'à minuit heure du Pacifique, où Google le remet à zéro ;
//  * un texte qui échoue 3 fois est abandonné ; dans tous ces cas l'appli lit avec la voix de l'appareil.
// Limites Supabase : 2 s de calcul par appel (l'encodage MP3 en consomme l'essentiel), 150 s au total.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { Mp3Encoder } from "npm:@breezystack/lamejs@1.2.7";
import { Buffer } from "node:buffer";
import { lexemeSpeech, plainText, spoken, audioKey, AUDIO_BUCKET } from "../_shared/speech.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const API = "https://generativelanguage.googleapis.com/v1beta";
const VOICE = "Achird";
const STYLE = "Read aloud in a warm, welcoming tone.";
const MODELS = [
  { id: "gemini-3.1-flash-tts-preview", api: "generate" },
  { id: "gemini-3.8-flash-tts", api: "interactions" },
] as const;
// prix en dollars par million de jetons (25 jetons audio par seconde)
const price = (model: string) =>
  model.startsWith("gemini-3.8-flash-tts")
    ? (Date.now() < Date.UTC(2027, 0, 1) ? { in: 0.5, out: 9 } : { in: 1, out: 18 })
    : { in: 1, out: 20 };

const WALL_MS = 100_000;
const PER_RUN = Number(Deno.env.get("AUDIO_PER_RUN") || 8); // requêtes par réveil (une fois par minute) : sous la limite par minute du modèle preview
const CPU_MS = Number(Deno.env.get("AUDIO_CPU_MS") || 900); // décodage + encodage mesurés, sous la limite de 2 s
const MAX_ATTEMPTS = 3;
const MODEL_RETRY_DAYS = 7;

type Row = { key: string; status: string; attempts: number; updated_at: string };
type Usage = { n: number; in: number; out: number };
class ApiError extends Error {
  constructor(public kind: "model" | "pause" | "transient" | "item", msg: string, public pauseMin = 0) { super(msg); }
}

const stamp = () => new Date().toISOString();

async function pageAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(JSON.stringify(error));
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

// ───────────────────────────────────────────── ce que l'appli peut lire
async function wanted(db: SupabaseClient) {
  const lex = await pageAll<Record<string, unknown>>((a, b) =>
    db.from("lexemes").select("gr:data->>gr, ex:data->>ex, fem:data->>fem, neu:data->>neu, ans:data->ans").eq("status", "ready").range(a, b));
  const texts = await pageAll<{ paragraphs: unknown }>((a, b) => db.from("texts").select("paragraphs").eq("status", "ready").range(a, b));
  const need = new Map<string, string>();
  const add = (t: unknown) => { const k = audioKey(t); if (k && !need.has(k)) need.set(k, spoken(t)); };
  for (const w of lex) lexemeSpeech(w).forEach(add);
  for (const x of texts) for (const p of (Array.isArray(x.paragraphs) ? x.paragraphs : [])) add(plainText(typeof p === "string" ? p : (p as { gr?: string })?.gr));
  return { need, textCount: texts.length };
}

// ───────────────────────────────────────────── appel à Gemini
// minutes jusqu'à minuit (heure du Pacifique, remise à zéro des quotas journaliers de Google) + 5 min
export function minutesToPacificMidnight(now = new Date()) {
  const p = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const next = new Date(p); next.setHours(24, 5, 0, 0);
  return Math.max(5, Math.round((next.getTime() - p.getTime()) / 60_000));
}

export function classify(status: number, body: string): ApiError {
  const quota = /"quotaId":\s*"([^"]+)"/.exec(body)?.[1], limit = /"quotaValue":\s*"?(\d+)/.exec(body)?.[1];
  const msg = quota ? `HTTP ${status}: quota ${quota}${limit ? ` = ${limit}` : ""}` : `HTTP ${status}: ${body.slice(0, 300)}`;
  if (status === 404 || (status === 400 && /not found|deprecat|no longer|unsupported model|unknown model|is not supported for (this|generate)/i.test(body)))
    return new ApiError("model", msg);
  if (status === 402 || status === 401 || status === 403) return new ApiError("pause", msg, 360);
  if (status === 429) {
    // le message « You exceeded your current quota » est le même pour toutes les limites : on regarde le détail
    if (/prepay|depleted|spend.?cap|spending/i.test(body)) return new ApiError("pause", msg, 360); // crédits ou plafond
    if (/PerDay/i.test(body)) return new ApiError("pause", msg, minutesToPacificMidnight());        // quota du jour
    const wait = Number(/"retryDelay":\s*"(\d+)/.exec(body)?.[1]) || 60;                           // quota par minute
    return new ApiError("pause", msg, Math.min(10, Math.max(1, wait / 60)));
  }
  if (status >= 500) return new ApiError("transient", msg, 2);
  return new ApiError("item", msg);
}

// plus long champ base64 de la réponse (l'audio), son type et les compteurs de jetons
export function dig(o: unknown, f = { data: "", mime: "", usage: null as Record<string, number> | null }) {
  if (!o || typeof o !== "object") return f;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 1000 && v.length > f.data.length && /^[A-Za-z0-9+/=_-]+$/.test(v.slice(0, 100))) {
      f.data = v;
      const r = o as Record<string, string>;
      f.mime = r.mime_type || r.mimeType || f.mime;
    } else if (/usage/i.test(k) && v && typeof v === "object") f.usage = v as Record<string, number>;
    else if (typeof v === "object") dig(v, f);
  }
  return f;
}

async function synth(model: typeof MODELS[number], text: string) {
  const body = model.api === "interactions"
    ? {
        model: model.id,
        input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: STYLE }] }] }],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice: VOICE }] },
      }
    : {
        contents: [{ parts: [{ text: `${STYLE.replace(/\.$/, "")}:\n${text}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
      };
  const url = model.api === "interactions" ? `${API}/interactions` : `${API}/models/${model.id}:generateContent`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) { throw new ApiError("transient", String(e), 2); }
  const txt = await res.text();
  if (!res.ok) throw classify(res.status, txt);
  const f = dig(JSON.parse(txt));
  if (!f.data) throw new ApiError("item", `pas d'audio : ${txt.slice(0, 200)}`);
  return f;
}

// PCM 16 bits mono (WAV ou brut) → échantillons et fréquence
export function toPcm(b64: string, mime: string) {
  let buf = Buffer.from(b64, "base64");
  let rate = Number(/rate=(\d+)/.exec(mime || "")?.[1]) || 24000;
  if (buf.subarray(0, 4).toString("latin1") === "RIFF") {
    rate = buf.readUInt32LE(24);
    let p = 12;
    while (p + 8 <= buf.length && buf.subarray(p, p + 4).toString("latin1") !== "data") p += 8 + buf.readUInt32LE(p + 4);
    buf = buf.subarray(p + 8);
  }
  const even = buf.length - (buf.length % 2);
  const copy = new Uint8Array(even); copy.set(buf.subarray(0, even));
  return { pcm: new Int16Array(copy.buffer), rate };
}

// MP3 mono ; au-delà de 30 s, rééchantillonné à 16 kHz pour tenir dans le temps de calcul
export function toMp3(pcm: Int16Array, rate: number) {
  let s = pcm, r = rate, kbps = 64;
  if (pcm.length / rate > 30 && rate > 16000) {
    const n = Math.floor(pcm.length * 16000 / rate), out = new Int16Array(n), step = rate / 16000;
    for (let i = 0; i < n; i++) { const x = i * step, j = Math.floor(x), t = x - j; out[i] = pcm[j] + ((pcm[Math.min(j + 1, pcm.length - 1)] - pcm[j]) * t) | 0; }
    s = out; r = 16000; kbps = 48;
  }
  const enc = new Mp3Encoder(1, r, kbps), parts: Uint8Array[] = [];
  for (let i = 0; i < s.length; i += 11520) parts.push(new Uint8Array(enc.encodeBuffer(s.subarray(i, i + 11520))));
  parts.push(new Uint8Array(enc.flush()));
  const total = parts.reduce((a, p) => a + p.length, 0), mp3 = new Uint8Array(total);
  let o = 0; for (const p of parts) { mp3.set(p, o); o += p.length; }
  return mp3;
}

// ───────────────────────────────────────────── état partagé (app_config)
async function getConfig(db: SupabaseClient, key: string) {
  const { data } = await db.from("app_config").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? {}) as Record<string, any>;
}
const setConfig = (db: SupabaseClient, key: string, value: unknown) => db.from("app_config").upsert({ key, value });

async function run(db: SupabaseClient) {
  const start = Date.now(), startIso = stamp();
  const state = await getConfig(db, "audio_state");
  state.dead ??= {};
  state.running_since = startIso;
  await setConfig(db, "audio_state", state);
  const usage = new Map<string, Usage>();
  let cpu = 0, done = 0, calls = 0, more = false;
  try {
    if (!GEMINI_KEY) { console.error("GEMINI_API_KEY absente"); state.pause_until = new Date(start + 6 * 3600_000).toISOString(); return; }
    const { need, textCount } = await wanted(db);
    const rows = await pageAll<Row>((a, b) => db.from("audio").select("key, status, attempts, updated_at").range(a, b));
    const have = new Map(rows.map((r) => [r.key, r]));
    const ago = (r: Row) => start - new Date(r.updated_at).getTime();
    const todo = [...need].filter(([k]) => {
      const r = have.get(k);
      if (!r) return true;
      if (r.status === "ready" || r.attempts >= MAX_ATTEMPTS) return false;
      return ago(r) > (r.status === "pending" ? 10 : 30) * 60_000;
    }).sort((a, b) => a[1].length - b[1].length); // mots d'abord, textes ensuite

    const alive = () => MODELS.filter((m) => !state.dead[m.id] || start - new Date(state.dead[m.id]).getTime() > MODEL_RETRY_DAYS * 86400_000);
    let stop = false;
    for (const [key, text] of todo) {
      if (stop || Date.now() - start > WALL_MS || calls >= PER_RUN) { more = true; break; }
      const estCpu = text.length * 2.2; // ≈ 2 ms de calcul par caractère grec
      if (cpu > 0 && cpu + estCpu > CPU_MS) { more = true; break; }
      const prev = have.get(key);
      const attempts = (prev?.attempts ?? 0) + 1;
      await db.from("audio").upsert({ key, text, status: "pending", attempts, last_error: null, updated_at: stamp() });
      let lastErr = "";
      let ok = false;
      for (const m of alive()) {
        try {
          calls++;
          const f = await synth(m, text);
          const t0 = performance.now();
          const { pcm, rate } = toPcm(f.data, f.mime);
          const seconds = pcm.length / rate;
          if (seconds < 0.25 || seconds > 4 + text.length * 0.25) { cpu += performance.now() - t0; throw new ApiError("item", `durée anormale : ${seconds.toFixed(1)} s pour ${text.length} caractères`); }
          const mp3 = toMp3(pcm, rate);
          cpu += performance.now() - t0;
          const up = await db.storage.from(AUDIO_BUCKET).upload(`${key}.mp3`, mp3, { contentType: "audio/mpeg", cacheControl: "31536000", upsert: true });
          if (up.error) throw new ApiError("transient", `stockage : ${up.error.message}`, 2);
          await db.from("audio").update({ status: "ready", model: m.id, seconds: Number(seconds.toFixed(2)), bytes: mp3.length, last_error: null, updated_at: stamp() }).eq("key", key);
          const u = usage.get(m.id) ?? { n: 0, in: 0, out: 0 };
          const fu = f.usage ?? {};
          u.n++;
          u.in += Number(fu.promptTokenCount ?? fu.total_input_tokens ?? fu.input_tokens ?? 0);
          u.out += Number(fu.candidatesTokenCount ?? fu.total_output_tokens ?? fu.output_tokens ?? 0) || Math.round(seconds * 25);
          usage.set(m.id, u);
          ok = true; done++;
          break;
        } catch (e) {
          const err = e instanceof ApiError ? e : new ApiError("item", String(e));
          lastErr = `${m.id} · ${err.message}`;
          console.error(lastErr);
          if (err.kind === "model") { state.dead[m.id] = stamp(); continue; } // modèle suivant
          if (err.kind === "pause" || err.kind === "transient") {
            state.pause_until = new Date(Date.now() + err.pauseMin * 60_000).toISOString();
            stop = true;
          }
          break;
        }
      }
      if (!ok) {
        // pause ou incident passager : la tentative ne compte pas
        const keep = stop ? attempts - 1 : attempts;
        await db.from("audio").update({ status: "error", attempts: keep, last_error: (lastErr || "aucun modèle disponible").slice(0, 500), updated_at: stamp() }).eq("key", key);
        if (!alive().length) { state.pause_until = new Date(Date.now() + 86400_000).toISOString(); stop = true; }
        if (stop) more = true;
      }
    }
    // balayage complet : on retient l'heure du début (les mots enrichis pendant le balayage seront repris)
    const sweep = await getConfig(db, "audio_sweep");
    await setConfig(db, "audio_sweep", { at: more ? (sweep.at ?? null) : startIso, more, texts: textCount, done, left: Math.max(0, todo.length - done) });
  } finally {
    for (const [model, u] of usage) {
      const p = price(model), cost = (u.in * p.in + u.out * p.out) / 1e6;
      const { error } = await db.from("ai_usage").insert({
        job_type: "audio", kind: null, mode: "sync", model, units: u.n,
        input_tokens: u.in, output_tokens: u.out, cost_usd: cost.toFixed(6), std_usd: cost.toFixed(6),
      });
      if (error) console.error("ai_usage", error.message);
    }
    delete state.running_since;
    await setConfig(db, "audio_state", state);
    console.log(`audio : ${done} fichier(s), ${cpu.toFixed(0)} ms de calcul, ${Date.now() - start} ms`);
  }
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret") ?? "";
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: ok } = await db.rpc("worker_secret_ok", { p_secret: secret });
  if (!ok) return new Response("forbidden", { status: 403 });
  const work = run(db).catch((e) => console.error("audio", e));
  // @ts-ignore EdgeRuntime est fourni par Supabase
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
    return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "content-type": "application/json" } });
  }
  await work;
  return new Response(JSON.stringify({ done: true }), { headers: { "content-type": "application/json" } });
});
