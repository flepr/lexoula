// Λεξούλα — lecture d'un texte : onglet Κείμενα de l'appli et page publique d'un texte partagé (t/)
// © 2026 Φοίβος Λεπέρ (Fabien Lepère). Tous droits réservés.
//
// Écoute : quand les fichiers audio de tous les paragraphes existent, un lecteur « podcast » (podcast.js) lit le texte
// d'un seul tenant ; sinon « Tout écouter » enchaîne les paragraphes, avec la voix de l'appareil pour ceux qui manquent.
import { t, pick, LOCALES, getLang } from "./i18n.js";
import { esc } from "./util.js";
import { TTS, say, stopSpeech, isReady, markReady, audioIndexLoaded } from "./tts.js";
import { audioKey, plainText } from "../supabase/functions/_shared/speech.js";
import { mountPodcast, podState, playParagraph } from "./podcast.js";

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';
export const ICON_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2"/></svg>';

const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString(LOCALES[getLang()], { day: "numeric", month: "short" }) : "");
const HAS_WEBAUDIO = typeof window !== "undefined" && !!(window.OfflineAudioContext || window.webkitOfflineAudioContext);

// état de la lecture du texte ouvert (traductions affichées, paragraphe lu à la voix de l'appareil)
const RD = { id: null, all: false, open: new Set(), playing: null, playAll: false, podFail: false, scrolled: -1 };
export function readerStopped() { RD.playing = null; RD.playAll = false; }

// paragraphe grec : les mots du vivier deviennent des boutons
function markup(gr, o) {
  return esc(gr).replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, (m, a, id) =>
    o.wordOf(id) ? `<button class="vw${o.starred?.(id) ? " st" : ""}" data-w="${id}">${a}</button>` : a);
}

// o : { top (HTML au-dessus du titre), wordOf(id), starred(id), onWord(id), audioKnown (liste des fichiers prêts connue),
//       share() ou null, artist, album }. Liste des fichiers pas encore chargée : on tente l'assemblage, qui repasse
//       sur « Tout écouter » s'il manque un fichier.
export function renderReaderView(el, x, o) {
  if (RD.id !== x.id) { stopSpeech(); Object.assign(RD, { id: x.id, all: false, open: new Set(), playing: null, playAll: false, podFail: false, scrolled: -1 }); }
  const shown = (i) => RD.all || RD.open.has(i);
  const plain = x.paragraphs.map((p) => plainText(p.gr));
  const keys = plain.map((s) => audioKey(s));
  const pod = HAS_WEBAUDIO && !RD.podFail && keys.length > 0 && keys.every(Boolean) && (!o.audioKnown || !audioIndexLoaded() || keys.every(isReady));

  el.innerHTML = `<div class="reader">
    ${o.top || ""}
    <div><div class="meta"><span class="badge ${x.kind === "long" ? "long" : ""}">${esc(x.kind === "long" ? t("long_text") : t("short_text"))}</span>${esc(fmtDate(x.created_at))}</div>
    <h2 lang="el" class="rtitle">${esc(x.title)}</h2><p class="muted">${esc(pick(x.title_tr))}</p></div>
    <div class="btnrow rtools">
      ${!pod && TTS.ok ? `<button class="btn ghost small" id="rlisten" aria-pressed="${RD.playAll}"></button>` : ""}
      <button class="btn ghost small" id="rall">${esc(RD.all ? t("hide_translations") : t("translate_all"))}</button>
      ${o.share ? `<button class="btn ghost small" id="rshare">${ICON_SHARE}<span>${esc(t("share"))}</span></button>` : ""}
    </div>
    ${pod ? `<div class="podbox" id="podbox"></div>` : ""}
    ${x.paragraphs.map((p, i) => `<div class="para" data-i="${i}">
      <p lang="el">${markup(p.gr, o)}</p>
      ${shown(i) ? `<div class="tr">${esc(pick(p.tr))}</div>` : ""}
      <div class="ptools">${pod || TTS.ok ? `<button data-pl="${i}"></button>` : ""}<button data-pt="${i}">${esc(shown(i) ? t("hide") : t("translation"))}</button></div>
    </div>`).join("")}
  </div>`;
  const q = (s) => el.querySelector(s);

  // état des boutons de lecture et paragraphe surligné, sans redessiner la page
  const playLabels = () => {
    const ps = pod ? podState() : null;
    el.querySelectorAll("[data-pl]").forEach((b) => {
      const i = +b.dataset.pl;
      const on = pod ? ps.solo === i && ps.playing : RD.playing === i;
      b.textContent = on ? "■ " + t("stop") : t("listen");
      b.setAttribute("aria-pressed", String(on));
    });
    el.querySelectorAll(".para").forEach((d) => {
      const i = +d.dataset.i;
      d.classList.toggle("cur", pod ? ps.para === i : RD.playAll && RD.playing === i);
    });
    const lb = q("#rlisten");
    if (lb) {
      lb.innerHTML = `${RD.playAll ? ICON_STOP : ICON_PLAY}<span>${esc(RD.playAll ? t("stop") : t("listen_all"))}</span>`;
      lb.setAttribute("aria-pressed", String(RD.playAll));
    }
  };
  const follow = (i) => {
    // la page suit le paragraphe lu, pendant une écoute continue seulement
    if (i < 0 || i === RD.scrolled || document.hidden) return;
    RD.scrolled = i;
    q(`.para[data-i="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  if (pod) {
    // la sous-barre du podcast reste visible sous l'en-tête de l'appli
    const top = document.querySelector(".top");
    document.documentElement.style.setProperty("--pod-top", `${top ? Math.round(top.getBoundingClientRect().height) + 8 : 8}px`);
    mountPodcast(q("#podbox"), {
      id: x.id, keys, title: x.title, artist: o.artist || "Λεξούλα", album: o.album || pick(x.title_tr) || "Λεξούλα",
      onPara: (i) => {
        playLabels();
        const ps = podState();
        if (ps.playing && ps.solo == null) follow(i); else if (i < 0) RD.scrolled = -1;
      },
      onFail: (found) => { markReady(found); RD.podFail = true; if (el.isConnected && RD.id === x.id) renderReaderView(el, x, o); },
    });
  }

  // sans podcast : chaque paragraphe à son tour
  const stopAll = () => { stopSpeech(); RD.playing = null; RD.playAll = false; playLabels(); };
  const playFrom = (i) => {
    if (i >= x.paragraphs.length) return stopAll();
    RD.playing = i;
    playLabels();
    q(`.para[data-i="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    say(plain[i], () => { if (RD.playAll && RD.playing === i) playFrom(i + 1); });
  };
  playLabels();
  const lb = q("#rlisten");
  if (lb) lb.onclick = () => {
    if (RD.playAll) return stopAll();
    stopSpeech();
    RD.playAll = true;
    playFrom(0);
  };
  q("#rall").onclick = () => { RD.all = !RD.all; RD.open.clear(); renderReaderView(el, x, o); };
  const sh = q("#rshare");
  if (sh) sh.onclick = () => o.share();
  el.onclick = (e) => {
    const w = e.target.closest("[data-w]");
    if (w) return o.onWord(w.dataset.w);
    const pl = e.target.closest("[data-pl]");
    if (pl) {
      const i = +pl.dataset.pl;
      if (pod) { RD.scrolled = i; playParagraph(i); return playLabels(); }
      if (RD.playing === i) return stopAll();
      stopSpeech(); // un paragraphe seul : la lecture complète s'arrête
      RD.playAll = false;
      RD.playing = i;
      playLabels();
      say(plain[i], () => { if (!RD.playAll && RD.playing === i) { RD.playing = null; playLabels(); } });
      return;
    }
    const pt = e.target.closest("[data-pt]");
    if (pt) {
      const i = +pt.dataset.pt;
      if (RD.all) { RD.all = false; x.paragraphs.forEach((_, k) => RD.open.add(k)); RD.open.delete(i); }
      else if (RD.open.has(i)) RD.open.delete(i); else RD.open.add(i);
      renderReaderView(el, x, o);
    }
  };
}

// ───────────────────────────────── partage en deux temps (décision du 03/11/2026)
// 1) fiche de l'appli : lien affiché, « Copier le lien » copie le lien seul ;
// 2) son bouton « Partager » ouvre la feuille du téléphone (message « Un texte en grec… : <titre> » + lien).
// toast(msg) : message bref, propre à chaque page (position différente avec ou sans barre d'onglets).
async function phoneShare(x, url, toast) {
  if (navigator.share) {
    try { await navigator.share({ title: x.title, text: t("share_msg", { title: x.title }), url }); return true; }
    catch (e) { if (e?.name === "AbortError") return true; }
  }
  try { await navigator.clipboard.writeText(url); toast(t("link_copied")); return true; } catch { return false; }
}
export function openShareSheet(x, url, toast) {
  const root = document.getElementById("sheet-root");
  if (!root) return;
  root.innerHTML = `<div class="sheet-bg" id="sbg"></div><div class="sheet" role="dialog" aria-label="${esc(t("share"))}"><div class="wrap stack">
    <span class="eyebrow">${esc(t("share"))}</span>
    <span class="hw" lang="el">${esc(x.title)}</span>
    <p class="muted small">${esc(t("share_text_help"))}</p>
    <input class="sharelink" readonly value="${esc(url)}" aria-label="URL">
    <div class="btnrow">
      ${navigator.share ? `<button class="btn" id="sgo">${ICON_SHARE}<span>${esc(t("share"))}</span></button>` : ""}
      <button class="btn ${navigator.share ? "ghost" : ""}" id="scopy">${esc(t("copy_link"))}</button>
    </div>
    <button class="btn ghost" id="sclose">${esc(t("close"))}</button></div></div>`;
  const q = (id) => root.querySelector(id);
  const close = () => (root.innerHTML = "");
  q("#sbg").onclick = close;
  q("#sclose").onclick = close;
  const sg = q("#sgo");
  if (sg) sg.onclick = async () => { if (await phoneShare(x, url, toast)) close(); };
  q("#scopy").onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast(t("link_copied")); close(); }
    catch { const i = q(".sharelink"); i.focus(); i.select(); } // copie refusée : le lien est sélectionné, à copier à la main
  };
}
