// Synthèse vocale grecque (voix du système)
// Sur iPhone, le bouton silencieux coupe la synthèse vocale sans écouteurs :
// on passe la session audio en mode « lecture » et on joue un son muet pendant la parole.
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
