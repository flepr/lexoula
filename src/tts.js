// Synthèse vocale grecque (voix du système)
// Sur iPhone, le bouton silencieux coupe la synthèse vocale sans écouteurs :
// on passe la session audio en mode « lecture » et on joue un son muet pendant la parole.
import { t } from "./i18n.js";

export const TTS = { ok: typeof window !== "undefined" && "speechSynthesis" in window, voice: null };

function pickVoice() {
  if (!TTS.ok) return;
  const vs = speechSynthesis.getVoices() || [];
  TTS.voice = vs.find((v) => /^el(-|_|$)/i.test(v.lang)) || null;
}
if (TTS.ok) {
  pickVoice();
  try { speechSynthesis.addEventListener("voiceschanged", pickVoice); } catch { /* ancien navigateur */ }
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

// « ο/η συνοδηγός » → « ο συνοδηγός, η συνοδηγός »
export function speechText(t) {
  return String(t || "")
    .replace(/\[\[([^|\]]+)\|[^\]]+\]\]/g, "$1")
    .replace(/(^|[\s(«])(ο|η|το)\/(ο|η|το)\s+([^\s,·;.]+)/g, (m, p, a, b, w) => `${p}${a} ${w}, ${b} ${w}`)
    .replace(/·/g, ",")
    .replace(/\s\/\s/g, ", ");
}

let current = 0; // numéro de la lecture en cours : une lecture interrompue ne déclenche pas son « fin »
export function stopSpeech() {
  if (!TTS.ok) return;
  current++;
  try { speechSynthesis.cancel(); } catch { /* ignoré */ }
  audioOff();
}

export function say(text, onEnd) {
  if (!TTS.ok || !text) return;
  try {
    const id = ++current;
    muteTip();
    audioOn();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(speechText(text));
    u.lang = "el-GR";
    u.rate = 0.88;
    if (TTS.voice) u.voice = TTS.voice;
    u.onend = u.onerror = () => { if (id !== current) return; audioOff(); onEnd?.(); };
    speechSynthesis.speak(u);
  } catch { /* ignoré */ }
}

export const ICON_SAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
