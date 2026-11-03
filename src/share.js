// Λεξούλα — page publique d'un texte partagé : app.lexoula.gr/t/?s=<code> (décision du 03/11/2026)
// © 2026 Φοίβος Λεπέρ (Fabien Lepère). Tous droits réservés.
//
// Élève de la classe déjà connecté (même domaine que l'appli, donc même session) : redirection vers le texte dans
// l'appli. Sinon : lecture du texte, sens des mots soulignés, traductions et écoute « podcast », sans compte ;
// un bouton invite à ouvrir l'appli (le texte s'y ouvrira dès que la personne aura rejoint la classe).
import "./styles.css";
import { createClient } from "@supabase/supabase-js";
import { sb, SUPABASE_URL, SUPABASE_KEY } from "./supabase.js";
import { t, pick, setLang, getLang, guessLang, LANGS, LANG_LABELS } from "./i18n.js";
import { $, esc, creditHtml } from "./util.js";
import { TTS, say, stopSpeech, markReady, ICON_SAY } from "./tts.js";
import { speakForm, audioKey } from "../supabase/functions/_shared/speech.js";
import { renderReaderView } from "./reader.js";

const app = $("#app");
const token = (new URLSearchParams(location.search).get("s") || "").trim();

let stored = null;
try { stored = localStorage.getItem("lx_lang"); } catch { /* */ }
setLang(LANGS.includes(stored) ? stored : guessLang());

function message(text, retry = false) {
  app.innerHTML = `<div class="onb">
    <h1 class="logo small" lang="el">Λεξούλα</h1>
    <div class="card stack"><p>${esc(text)}</p>
      ${retry ? `<button class="btn" id="retry">${esc(t("retry"))}</button>` : ""}
      <a class="btn ghost" href="https://lexoula.gr/">${esc(t("gate_site"))}</a></div>
    ${creditHtml()}
  </div>`;
  $("#retry")?.addEventListener("click", boot);
}

// session expirée ou refusée : on relit le texte en visiteur
async function fetchText() {
  const r = await sb.rpc("shared_text", { p_token: token });
  if (!r.error) return r;
  const anon = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return anon.rpc("shared_text", { p_token: token });
}

async function boot() {
  if (!token) return message(t("pub_not_found"));
  app.innerHTML = `<div class="boot"><div class="logo" lang="el">Λεξούλα</div><p class="muted">${esc(t("loading"))}</p></div>`;
  let res;
  try { res = await fetchText(); } catch (e) { res = { error: e }; }
  if (res.error) { console.warn(res.error); return message(t("pub_error"), true); }
  const d = res.data;
  if (!d) return message(t("pub_not_found"));
  if (d.disabled) return message(t("pub_disabled"));
  if (d.member) { location.replace(new URL(`../#read/${d.id}`, location.href).href); return; }
  render(d);
}

function render(d) {
  const words = new Map((d.words || []).map((w) => [w.id, w]));
  const x = { id: d.id, kind: d.kind, title: d.title, title_tr: d.title_tr || {}, paragraphs: d.paragraphs || [], created_at: d.created_at };
  document.title = `${x.title} — Λεξούλα`;
  app.innerHTML = `
    <header class="top"><div class="wrap">
      <a class="brand" href="https://lexoula.gr/" lang="el">Λεξούλα</a>
      <select id="lang" class="langsel" aria-label="${esc(t("language"))}">${LANGS.map((l) => `<option value="${l}" ${l === getLang() ? "selected" : ""}>${esc(LANG_LABELS[l])}</option>`).join("")}</select>
    </div></header>
    <main class="wrap pubmain">
      <div id="rd"></div>
      <p class="muted small">${esc(t("pub_help"))}</p>
      <section class="card stack cta">
        <h3>${esc(t("pub_cta_title"))}</h3>
        <p>${esc(t("pub_cta_text"))}</p>
        <button class="btn" id="openapp">${esc(t("pub_open_app"))}</button>
        <p class="muted small">${esc(t("pub_cta_invite"))}</p>
      </section>
      ${creditHtml()}
      <p class="credit"><a href="../privacy.html">${esc(t("privacy_link"))}</a></p>
    </main>`;
  const canShare = !!(navigator.share || navigator.clipboard);
  renderReaderView($("#rd"), x, {
    wordOf: (id) => words.get(id),
    onWord: (id) => openWord(words.get(id)),
    audioKnown: false,
    share: canShare ? () => shareThis(x) : null,
    album: "Λεξούλα",
  });
  $("#lang").onchange = (e) => {
    setLang(e.target.value);
    try { localStorage.setItem("lx_lang", getLang()); } catch { /* */ }
    render(d);
  };
  $("#openapp").onclick = () => {
    stopSpeech();
    try { localStorage.setItem("lx_open", JSON.stringify({ id: x.id, s: token, at: Date.now() })); } catch { /* */ }
    location.href = new URL("../", location.href).href;
  };
}

async function shareThis(x) {
  const url = location.href.split("#")[0];
  if (navigator.share) {
    try { await navigator.share({ title: x.title, text: t("share_msg", { title: x.title }), url }); return; }
    catch (e) { if (e?.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); toastMsg(t("link_copied")); } catch { /* ignoré */ }
}

function toastMsg(msg) {
  const el = document.createElement("div");
  el.className = "toast pubtoast";
  el.setAttribute("role", "status");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function openWord(w) {
  if (!w) return;
  const root = $("#sheet-root");
  const note = pick(w.note);
  const form = speakForm(w);
  root.innerHTML = `<div class="sheet-bg" id="sbg"></div><div class="sheet" role="dialog" aria-label="${esc(w.gr)}"><div class="wrap stack">
    <div class="sheethead"><span class="hw" lang="el">${esc(w.gr)}</span>${TTS.ok ? `<button class="say" id="ssay" aria-label="${esc(t("listen"))}">${ICON_SAY}</button>` : ""}</div>
    <span class="fr">${esc(pick(w.tr))}</span>
    ${w.forms ? `<span class="muted small" lang="el">${esc(w.forms)}</span>` : ""}
    ${note ? `<span class="muted small">${esc(note)}</span>` : ""}
    <button class="btn ghost" id="sclose">${esc(t("close"))}</button></div></div>`;
  const close = () => (root.innerHTML = "");
  $("#sbg").onclick = close;
  $("#sclose").onclick = close;
  // fichier audio du mot s'il existe (bucket public), sinon voix de l'appareil
  $("#ssay")?.addEventListener("click", () => { markReady([audioKey(form)]); say(form); });
}

boot();
