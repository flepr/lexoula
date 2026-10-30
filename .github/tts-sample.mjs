// Échantillon de synthèse vocale Gemini : node .github/tts-sample.mjs input.json outDir
// Lancé par .github/workflows/tts-sample.yml. Clé dans GEMINI_API_KEY (secret GitHub), jamais affichée.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [, , inputPath, outDir] = process.argv;
const KEY = process.env.GEMINI_API_KEY;
const MODELS = (process.env.MODELS || "gemini-3.1-flash-tts-preview").split(",").map((s) => s.trim()).filter(Boolean);
const VOICE = process.env.VOICE || "Achird";
const STYLE = process.env.STYLE || "Read aloud in a warm, welcoming tone.";
const API = "https://generativelanguage.googleapis.com/v1beta";
mkdirSync(outDir, { recursive: true });

// mêmes transformations que l'appli (src/ui.js, src/tts.js)
const headword = (w) => String(w.gr || "").split(" · ")[0].replace(/, -.*$/, "");
const speechText = (t) => String(t || "")
  .replace(/\[\[([^|\]]+)\|[^\]]+\]\]/g, "$1")
  .replace(/(^|[\s(«])(ο|η|το)\/(ο|η|το)\s+([^\s,·;.]+)/g, (m, p, a, b, w) => `${p}${a} ${w}, ${b} ${w}`)
  .replace(/·/g, ",")
  .replace(/\s\/\s/g, ", ");

const input = JSON.parse(readFileSync(inputPath, "utf8"));
const items = [];
for (const w of input.words || []) {
  items.push({ kind: "word", text: speechText(headword(w)) });
  items.push({ kind: "example", text: speechText(w.ex) });
}
const paras = (input.text || []).map((p) => speechText(typeof p === "string" ? p : p.gr)).filter(Boolean);
if (paras.length) items.push({ kind: "text", text: paras.slice(0, 2).join("\n\n") });

const notice = (title, msg) => console.log(`::notice title=${title}::${String(msg).replace(/%/g, "%25").replace(/\r?\n/g, "%0A").slice(0, 3000)}`);
const warn = (title, msg) => console.log(`::warning title=${title}::${String(msg).replace(/%/g, "%25").replace(/\r?\n/g, "%0A").slice(0, 3000)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// cherche dans la réponse le plus long champ base64 (l'audio), son type MIME et les compteurs d'usage
function dig(o, found = { data: "", mime: "", usage: null }) {
  if (!o || typeof o !== "object") return found;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && v.length > 2000 && v.length > found.data.length && /^[A-Za-z0-9+/=_-]+$/.test(v.slice(0, 200))) {
      found.data = v;
      found.mime = o.mime_type || o.mimeType || found.mime;
    } else if (/usage/i.test(k) && v && typeof v === "object") {
      found.usage = v;
    } else if (typeof v === "object") dig(v, found);
  }
  return found;
}

async function post(url, body) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": KEY }, body: JSON.stringify(body) });
    const txt = await r.text();
    if (r.ok) return JSON.parse(txt);
    if ((r.status === 429 || r.status >= 500) && i < 3) { await sleep(8000 * (i + 1)); continue; }
    throw new Error(`HTTP ${r.status}: ${txt.slice(0, 400)}`);
  }
}

// API Interactions (documentation actuelle), sinon generateContent (consigne dans le texte)
const via = {};
async function synth(model, text) {
  const tries = via[model] ? [via[model]] : ["interactions", "generateContent"];
  let last;
  for (const how of tries) {
    try {
      const res = how === "interactions"
        ? await post(`${API}/interactions`, {
            model,
            input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: STYLE }] }] }],
            response_format: { type: "audio" },
            generation_config: { speech_config: [{ voice: VOICE }] },
          })
        : await post(`${API}/models/${model}:generateContent`, {
            contents: [{ parts: [{ text: `${STYLE.replace(/\.$/, "")}:\n${text}` }] }],
            generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
          });
      const f = dig(res);
      if (!f.data) throw new Error(`pas d'audio dans la réponse : ${JSON.stringify(res).slice(0, 300)}`);
      via[model] = how;
      return { ...f, how };
    } catch (e) { last = e; warn(`${model} via ${how}`, e.message); }
  }
  throw last;
}

function toWav(b64) {
  const buf = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (buf.subarray(0, 4).toString() === "RIFF") return buf;
  const h = Buffer.alloc(44), sr = 24000;
  h.write("RIFF", 0); h.writeUInt32LE(36 + buf.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(buf.length, 40);
  return Buffer.concat([h, buf]);
}

const manifest = { voice: VOICE, style: STYLE, items: [] };
for (const model of MODELS) {
  let n = 0, secs = 0;
  for (const [i, it] of items.entries()) {
    try {
      const t0 = Date.now();
      const r = await synth(model, it.text);
      const wav = toWav(r.data);
      const seconds = (wav.length - 44) / 48000;
      const base = `${model}-${String(i).padStart(2, "0")}-${it.kind}`;
      writeFileSync(`${outDir}/${base}.wav`, wav);
      const ff = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${outDir}/${base}.wav`, "-ac", "1", "-b:a", "64k", `${outDir}/${base}.mp3`]);
      if (ff.status !== 0) throw new Error(`ffmpeg : ${ff.stderr}`);
      manifest.items.push({ model, kind: it.kind, text: it.text, file: `${base}.mp3`, seconds: +seconds.toFixed(2), ms: Date.now() - t0, how: r.how, mime: r.mime, usage: r.usage });
      n++; secs += seconds;
    } catch (e) {
      manifest.items.push({ model, kind: it.kind, text: it.text, error: e.message });
    }
  }
  notice(model, `${n}/${items.length} fichiers, ${secs.toFixed(1)} s d'audio, via ${via[model] || "—"}`);
}
writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
if (!manifest.items.some((x) => x.file)) { console.log("::error::aucun audio généré"); process.exit(1); }
