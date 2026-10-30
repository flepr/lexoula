// Lecture à voix haute : fichiers audio générés côté serveur (voix Gemini, fonction « audio »),
// sinon synthèse vocale grecque de l'appareil.
// Sur iPhone, le bouton silencieux coupe la synthèse vocale sans écouteurs (pas les fichiers) :
// pour la voix de l'appareil, on passe la session audio en mode « lecture » et on joue un son muet pendant la parole.
import { t } from "./i18n.js";
import { sb, SUPABASE_URL } from "./supabase.js";
import { spoken, audioKey, AUDIO_BUCKET } from "../supabase/functions/_shared/speech.js";
export { speechText } from "../supabase/functions/_shared/speech.js";

const HAS_SYNTH = typeof window !== "undefined" && "speechSynthesis" in window;
export const TTS = { ok: HAS_SYNTH || typeof Audio !== "undefined", voice: null };

// voix grecque la plus naturelle disponible : sur iPhone et Mac, « premium » puis « enhanced » (à télécharger dans
// les réglages) avant la voix « compact » installée d'office, nettement plus robotique
const QUALITY = (v) => { const id = `${v.voiceURI || ""} ${v.name || ""}`.toLowerCase(); return /premium/.test(id) ? 3 : /enhanced|amélior|natural|neural/.test(id) ? 2 : /super-compact/.test(id) ? -1 : /compact/.test(id) ? 0 : 1; };
function pickVoice() {
  if (!HAS_SYNTH) return;
  const vs = (speechSynthesis.getVoices() || []).filter((v) => /^el(-|_|$)/i.test(v.lang));
  TTS.voice = vs.sort((x, y) => QUALITY(y) - QUALITY(x))[0] || null;
}
if (HAS_SYNTH) {
  pickVoice();
  try { speechSynthesis.addEventListener("voiceschanged", pickVoice); } catch { /* ancien navigateur */ }
  // diagnostic : app.lexoula.gr/?voices affiche les voix grecques vues par le navigateur et celle retenue
  if (new URLSearchParams(location.search).has("voices")) {
    setTimeout(() => {
      pickVoice();
      const all = speechSynthesis.getVoices() || [];
      const el = all.filter((v) => /^el(-|_|$)/i.test(v.lang));
      alert(`${all.length} voices, ${el.length} Greek:\n\n${el.map((v) => `${v.name} · ${v.voiceURI}${v.localService ? "" : " (online)"}`).join("\n") || "—"}\n\n→ ${TTS.voice ? TTS.voice.voiceURI : "default (none chosen)"}`);
    }, 1500);
  }
}

function silentWav() {
  const sr = 8000, n = 1600, buf = new Uint8Array(44 + n), dv = new DataView(buf.buffer);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); };
  wr(0, "RIFF"); dv.setUint32(4, 36 + n, true); wr(8, "WAVE"); wr(12, "fmt "); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr, true);
  dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); wr(36, "data"); dv.setUint32(40, n, true); buf.fill(128, 44);
  let s = "";
  buf.forEach((b) => (s += String.fromCharCode(b)));
  return "data:audio/wav;base64," + btoa(s);
}
const KEEP = { a: null, t: 0 };
function audioOn() {
  try { if (navigator.audioSession && navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback"; } catch { /* non pris en charge */ }
  try {
    if (!KEEP.a) { KEEP.a = new Audio(silentWav()); KEEP.a.loop = true; KEEP.a.setAttribute("playsinline", ""); }
    clearTimeout(KEEP.t);
    const p = KEEP.a.play();
    if (p && p.catch) p.catch(() => {});
  } catch { /* ignoré */ }
}
function audioOff() {
  clearTimeout(KEEP.t);
  KEEP.t = setTimeout(() => { try { KEEP.a && KEEP.a.pause(); } catch { /* ignoré */ } }, 400);
}

// Le site ne peut pas savoir si l'iPhone est en mode silencieux (aucune API) : quand on lit un mot sur
// iPhone ou iPad, on affiche un rappel discret, au plus une fois par jour, jusqu'à « Ne plus afficher ».
const IOS = typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
const MUTE_KEY = "lexoula.muteTip";
function muteTip() {
  if (!IOS || document.getElementById("mutetip")) return;
  const day = new Date().toISOString().slice(0, 10);
  let seen = "";
  try { seen = localStorage.getItem(MUTE_KEY) || ""; } catch { /* stockage indisponible */ }
  if (seen === "never" || seen === day) return;
  try { localStorage.setItem(MUTE_KEY, day); } catch { /* ignoré */ }
  const el = document.createElement("div");
  el.id = "mutetip";
  el.className = "toast mutetip";
  el.setAttribute("role", "status");
  el.innerHTML = `<p></p><div class="mt-actions"><button type="button" data-k="ok"></button><button type="button" data-k="never"></button></div>`;
  el.querySelector("p").textContent = t("mute_tip");
  el.querySelector('[data-k="ok"]').textContent = t("mute_ok");
  el.querySelector('[data-k="never"]').textContent = t("mute_never");
  const close = () => el.remove();
  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.k === "never") { try { localStorage.setItem(MUTE_KEY, "never"); } catch { /* ignoré */ } }
    close();
  };
  const foot = document.querySelector(".session .sfoot"); // pendant une session : juste au-dessus des boutons
  if (foot) el.style.bottom = `${foot.getBoundingClientRect().height + 12}px`;
  document.body.appendChild(el);
  setTimeout(close, 12000);
}

// ───────────────────────────────── fichiers audio
// liste des fichiers prêts (table « audio », lisible par les comptes connectés), rechargée au plus toutes les 10 min
const READY = new Set();
let indexAt = 0;
export async function loadAudioIndex(force = false) {
  if (!force && Date.now() - indexAt < 600_000) return;
  indexAt = Date.now();
  try {
    const keys = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("audio").select("key").eq("status", "ready").range(from, from + 999);
      if (error) throw error;
      keys.push(...data.map((r) => r.key));
      if (data.length < 1000) break;
    }
    READY.clear();
    keys.forEach((k) => READY.add(k));
  } catch (e) { indexAt = 0; console.warn("audio index", e); }
}
const fileUrl = (key) => `${SUPABASE_URL}/storage/v1/object/public/${AUDIO_BUCKET}/${key}.mp3`;
// un seul lecteur, réutilisé : une fois lancé par un geste, iOS le laisse enchaîner les paragraphes
let player = null;
function playFile(key, id, onEnd, fallback) {
  if (!player) { player = new Audio(); player.preload = "auto"; player.setAttribute("playsinline", ""); }
  const p = player;
  const fail = () => { if (id !== current) return; READY.delete(key); fallback(); };
  p.onended = () => { if (id === current) onEnd?.(); };
  p.onerror = fail;
  p.src = fileUrl(key);
  const r = p.play();
  if (r && r.catch) r.catch((e) => { if (e?.name !== "AbortError") fail(); });
}

let current = 0; // numéro de la lecture en cours : une lecture interrompue ne déclenche pas son « fin »
export function stopSpeech() {
  current++;
  try { player?.pause(); } catch { /* ignoré */ }
  if (!HAS_SYNTH) return;
  try { speechSynthesis.cancel(); } catch { /* ignoré */ }
  audioOff();
}

export function say(text, onEnd) {
  if (!text) return;
  const id = ++current;
  try { player?.pause(); } catch { /* ignoré */ }
  try { if (HAS_SYNTH) speechSynthesis.cancel(); } catch { /* ignoré */ }
  const key = audioKey(text);
  if (key && READY.has(key)) {
    try { playFile(key, id, onEnd, () => synth(text, id, onEnd)); return; } catch { /* voix de l'appareil */ }
  }
  synth(text, id, onEnd);
}

function synth(text, id, onEnd) {
  if (!HAS_SYNTH) { onEnd?.(); return; }
  try {
    muteTip();
    audioOn();
    speechSynthesis.cancel();
    pickVoice(); // sur iPhone, la liste des voix arrive tard et « voiceschanged » n'est pas toujours émis
    const u = new SpeechSynthesisUtterance(spoken(text));
    u.lang = "el-GR";
    u.rate = 0.88;
    if (TTS.voice) u.voice = TTS.voice;
    u.onend = u.onerror = () => { if (id !== current) return; audioOff(); onEnd?.(); };
    speechSynthesis.speak(u);
  } catch { /* ignoré */ }
}

export const ICON_SAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
