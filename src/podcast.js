// Λεξούλα — écouter un texte « comme un podcast » (décision du 03/11/2026)
// © 2026 Φοίβος Λεπέρ (Fabien Lepère). Tous droits réservés.
//
// Les fichiers audio des paragraphes (voix Gemini, fonction « audio ») sont assemblés dans le navigateur en un seul
// fichier WAV, avec un court silence entre les paragraphes. Un seul élément <audio> lit donc tout le texte : la lecture
// continue écran verrouillé, et l'écran verrouillé, le centre de contrôle et les écouteurs pilotent le texte entier
// (lecture, pause, ±10 s, barre de progression) grâce à l'API Media Session.
// Pourquoi dans le navigateur : les paragraphes ont été encodés à 24 ou 16 kHz selon leur longueur, et coller des MP3
// de fréquences différentes donne un fichier que les lecteurs gèrent mal ; réencoder un texte entier dépasserait les
// 2 s de calcul d'une fonction Supabase. Le navigateur décode et rééchantillonne lui-même (Web Audio), sans coût.
import { fileUrl, onSpeechStop, stopSpeech } from "./tts.js";
import { t } from "./i18n.js";
import { esc } from "./util.js";

const GAP = 0.8;   // silence entre deux paragraphes (s)
const EDGE = 0.25; // silence au début et à la fin (s)
const SKIP = 10;   // saut des boutons ±10 s (s)
const RATES = [1, 0.8, 1.2];

// ───────────────────────────────── assemblage
const built = new Map(); // id du texte → Promise<{ url, starts, ends, duration }>

function offlineCtx() {
  const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!C) throw new Error("no_webaudio");
  for (const rate of [24000, 44100]) { try { return new C(1, rate, rate); } catch { /* fréquence refusée */ } }
  throw new Error("no_webaudio");
}
const decode = (ctx, buf) => new Promise((res, rej) => {
  const p = ctx.decodeAudioData(buf, res, rej);
  if (p && p.then) p.then(res, rej);
});

function wav(pcm, rate) {
  const h = new DataView(new ArrayBuffer(44));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); h.setUint32(4, 36 + pcm.byteLength, true); str(8, "WAVE");
  str(12, "fmt "); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  str(36, "data"); h.setUint32(40, pcm.byteLength, true);
  return new Blob([h.buffer, pcm.buffer], { type: "audio/wav" });
}

async function assemble(keys) {
  const got = await Promise.all(keys.map(async (k) => {
    try { const r = await fetch(fileUrl(k)); return r.ok ? await r.arrayBuffer() : null; } catch { return null; }
  }));
  if (got.some((b) => !b)) {
    const e = new Error("missing_audio");
    e.found = keys.filter((k, i) => got[i]); // fichiers présents : lus un par un à défaut de podcast
    throw e;
  }
  const ctx = offlineCtx(), rate = ctx.sampleRate;
  const chans = [];
  for (const b of got) chans.push((await decode(ctx, b)).getChannelData(0));
  const edge = Math.round(EDGE * rate), gap = Math.round(GAP * rate);
  const n = 2 * edge + chans.reduce((a, c) => a + c.length, 0) + gap * (chans.length - 1);
  const pcm = new Int16Array(n), starts = [], ends = [];
  let o = edge;
  chans.forEach((c, i) => {
    starts.push(o / rate);
    for (let j = 0; j < c.length; j++) { const v = c[j]; pcm[o + j] = v < -1 ? -32768 : v > 1 ? 32767 : (v * 32767) | 0; }
    o += c.length;
    ends.push(o / rate);
    if (i < chans.length - 1) o += gap;
  });
  return { url: URL.createObjectURL(wav(pcm, rate)), starts, ends, duration: n / rate };
}

function prepare(id, keys) {
  if (!built.has(id)) {
    const p = assemble(keys).catch((e) => { built.delete(id); throw e; });
    built.set(id, p);
    // on garde les deux derniers textes assemblés en mémoire (≈ 3 Mo par minute d'audio)
    while (built.size > 2) {
      const [oldId, old] = built.entries().next().value;
      if (oldId === P.id) break;
      built.delete(oldId);
      old.then((d) => URL.revokeObjectURL(d.url)).catch(() => {});
    }
  }
  return built.get(id);
}

// ───────────────────────────────── lecteur (un seul pour toute l'appli)
const P = { id: null, data: null, audio: null, box: null, meta: null, onPara: null, para: -1, stopAt: null, solo: null, rate: 1, drag: false, own: false };

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>';
const skipIcon = (fwd) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${fwd ? "M12 4.5A7.5 7.5 0 1 0 19.5 12" : "M12 4.5A7.5 7.5 0 1 1 4.5 12"}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="${fwd ? "M10.6 1.9v5.2l3.8-2.6z" : "M13.4 1.9v5.2L9.6 4.5z"}" fill="currentColor"/><text x="12" y="15.3" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor" font-family="system-ui, sans-serif">${SKIP}</text></svg>`;

const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const ms = () => (typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null);

function el() {
  if (P.audio) return P.audio;
  const a = new Audio();
  a.preload = "auto";
  a.setAttribute("playsinline", "");
  a.addEventListener("timeupdate", tick);
  a.addEventListener("play", () => { sync(); position(); });
  a.addEventListener("pause", () => { sync(); position(); });
  a.addEventListener("seeked", position);
  a.addEventListener("ratechange", position);
  a.addEventListener("ended", () => { P.stopAt = null; P.solo = null; a.currentTime = 0; setPara(-1); sync(); });
  P.audio = a;
  return a;
}

// toute autre lecture (un mot, un paragraphe à la voix de l'appareil) ou la sortie du texte met le podcast en pause
onSpeechStop(() => { if (!P.own && P.audio && !P.audio.paused) P.audio.pause(); });

function setPara(i) {
  if (i === P.para) return;
  P.para = i;
  P.onPara?.(i);
}

function tick() {
  const a = P.audio, d = P.data;
  if (!a || !d) return;
  const now = a.currentTime;
  if (P.stopAt != null && now >= P.stopAt) { P.stopAt = null; P.solo = null; a.pause(); setPara(-1); drawTime(); return; }
  let i = -1;
  for (let k = 0; k < d.starts.length; k++) if (now >= d.starts[k] - 0.05) i = k;
  if (!a.paused || P.solo != null) setPara(i); else if (a.paused && now === 0) setPara(-1);
  drawTime();
}

function position() {
  const s = ms(), a = P.audio, d = P.data;
  if (!s || !a || !d || !s.setPositionState) return;
  try { s.setPositionState({ duration: d.duration, playbackRate: a.playbackRate || 1, position: Math.min(a.currentTime, d.duration) }); } catch { /* ignoré */ }
}

function claimSession() {
  const s = ms();
  if (!s) return;
  try {
    const icon = new URL("icon-512.png", document.baseURI).href;
    s.metadata = new MediaMetadata({
      title: P.meta?.title || "Λεξούλα",
      artist: P.meta?.artist || "Λεξούλα",
      album: P.meta?.album || "Λεξούλα",
      artwork: [{ src: icon, sizes: "512x512", type: "image/png" }],
    });
  } catch { /* ignoré */ }
  const set = (k, fn) => { try { s.setActionHandler(k, fn); } catch { /* action non prise en charge */ } };
  set("play", () => play());
  set("pause", () => P.audio?.pause());
  set("stop", () => P.audio?.pause());
  set("seekbackward", (e) => seekBy(-(e?.seekOffset || SKIP)));
  set("seekforward", (e) => seekBy(e?.seekOffset || SKIP));
  set("seekto", (e) => { if (e?.seekTime != null) seekTo(e.seekTime); });
}

function play() {
  const a = el();
  if (!P.data) return;
  if (a.src !== P.data.url) a.src = P.data.url;
  P.own = true; stopSpeech(); P.own = false; // coupe la voix de l'appareil ou un mot en cours, pas le podcast
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch { /* non pris en charge */ }
  a.playbackRate = P.rate;
  claimSession();
  const r = a.play();
  if (r && r.catch) r.catch(() => sync());
}

function seekTo(sec) {
  const a = el(), d = P.data;
  if (!d) return;
  if (a.src !== d.url) a.src = d.url;
  a.currentTime = Math.max(0, Math.min(sec, d.duration - 0.05));
  tick(); position();
}
function seekBy(delta) { P.stopAt = null; P.solo = null; seekTo((P.audio?.currentTime || 0) + delta); }

// ───────────────────────────────── interface
function sync() {
  const box = P.box;
  if (!box?.isConnected) return;
  const playing = P.audio && !P.audio.paused;
  const b = box.querySelector('[data-pod="toggle"]');
  if (b) { b.innerHTML = playing ? ICON_PAUSE : ICON_PLAY; b.setAttribute("aria-label", playing ? t("pause") : t("listen_all")); }
  const r = box.querySelector('[data-pod="rate"]');
  if (r) r.textContent = `${String(P.rate).replace(".", t("decimal_sep"))}×`;
  drawTime();
  P.onPara?.(P.para);
}
function drawTime() {
  const box = P.box, d = P.data;
  if (!box?.isConnected || !d) return;
  const now = P.audio?.currentTime || 0;
  const bar = box.querySelector(".pod-bar");
  if (bar && !P.drag) { bar.value = String(Math.round((now / d.duration) * 1000)); bar.style.setProperty("--p", `${(now / d.duration) * 100}%`); }
  const c = box.querySelector(".pod-cur"), l = box.querySelector(".pod-left");
  if (c && !P.drag) c.textContent = fmt(now);
  if (l && !P.drag) l.textContent = `−${fmt(d.duration - now)}`;
}

function draw() {
  const box = P.box;
  if (!box?.isConnected) return;
  if (!P.data) {
    box.innerHTML = `<div class="pod pod-wait"><span class="pod-spin" aria-hidden="true"></span>${esc(t("pod_preparing"))}</div>`;
    return;
  }
  box.innerHTML = `<div class="pod" role="group" aria-label="${esc(t("listen_all"))}">
    <button class="pod-skip" data-pod="back" aria-label="${esc(t("pod_back", { n: SKIP }))}">${skipIcon(false)}</button>
    <button class="pod-play" data-pod="toggle"></button>
    <button class="pod-skip" data-pod="fwd" aria-label="${esc(t("pod_fwd", { n: SKIP }))}">${skipIcon(true)}</button>
    <div class="pod-info">
      <input class="pod-bar" type="range" min="0" max="1000" step="1" value="0" aria-label="${esc(t("pod_position"))}">
      <div class="pod-time"><span class="pod-cur">0:00</span><span class="pod-left">−${fmt(P.data.duration)}</span></div>
    </div>
    <button class="pod-rate" data-pod="rate" aria-label="${esc(t("pod_speed"))}"></button>
  </div>`;
  box.onclick = (e) => {
    const b = e.target.closest("[data-pod]");
    if (!b) return;
    const k = b.dataset.pod;
    if (k === "toggle") { if (P.audio && !P.audio.paused) P.audio.pause(); else { P.stopAt = null; P.solo = null; play(); } }
    else if (k === "back") seekBy(-SKIP);
    else if (k === "fwd") seekBy(SKIP);
    else if (k === "rate") { P.rate = RATES[(RATES.indexOf(P.rate) + 1) % RATES.length]; if (P.audio) P.audio.playbackRate = P.rate; sync(); }
  };
  const bar = box.querySelector(".pod-bar");
  bar.oninput = () => {
    P.drag = true;
    const sec = (bar.value / 1000) * P.data.duration;
    bar.style.setProperty("--p", `${bar.value / 10}%`);
    box.querySelector(".pod-cur").textContent = fmt(sec);
    box.querySelector(".pod-left").textContent = `−${fmt(P.data.duration - sec)}`;
  };
  bar.onchange = () => { P.drag = false; P.stopAt = null; P.solo = null; seekTo((bar.value / 1000) * P.data.duration); };
  sync();
}

// ───────────────────────────────── API
// Affiche le lecteur d'un texte dans `box`. onPara(i) : paragraphe en cours (-1 : aucun) ; onFail(found) : pas de
// podcast possible (fichier manquant, navigateur trop ancien), `found` = fichiers présents.
export function mountPodcast(box, { id, keys, title, artist, album, onPara, onFail }) {
  if (P.id !== id) {
    if (P.audio) { P.audio.pause(); P.audio.removeAttribute("src"); try { P.audio.load(); } catch { /* ignoré */ } }
    Object.assign(P, { id, data: null, para: -1, stopAt: null, solo: null });
  }
  Object.assign(P, { box, onPara, meta: { title, artist, album } });
  draw();
  if (P.data) return;
  prepare(id, keys).then((d) => {
    if (P.id !== id) return;
    P.data = d;
    const a = el();
    if (a.src !== d.url) a.src = d.url; // prêt à démarrer au premier geste, sans attente
    draw();
  }).catch((e) => {
    if (P.id !== id) return;
    console.warn("podcast", e);
    box.hidden = true;
    onFail?.(e?.found || []);
  });
}

export const podState = () => ({ ready: !!P.data, playing: !!(P.audio && !P.audio.paused), para: P.para, solo: P.solo });

// « Écouter » sous un paragraphe : ce paragraphe seul, depuis le podcast
export function playParagraph(i) {
  const d = P.data;
  if (!d || i < 0 || i >= d.starts.length) return;
  if (P.solo === i && P.audio && !P.audio.paused) { P.audio.pause(); P.solo = null; P.stopAt = null; sync(); return; }
  P.solo = i;
  P.stopAt = d.ends[i] + 0.15;
  seekTo(d.starts[i]);
  setPara(i);
  play();
}
