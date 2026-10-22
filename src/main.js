// Λεξούλα — point d'entrée
// © 2026 Φοίβος Λεπέρ (Fabien Lepère). Tous droits réservés.
import "./styles.css";
import { sb } from "./supabase.js";
import { S, loadAll, loadProfile, loadWords, loadTexts, loadLists, loadProgress, isStaff, streakCount, setWriteErrorHandler } from "./store.js";
import { t, setLang, guessLang, LANGS } from "./i18n.js";
import { $, esc, toast } from "./util.js";
import { onStarChange } from "./ui.js";
import { setSessionEnd } from "./session.js";
import { renderLogin } from "./views/login.js";
import { renderOnboarding } from "./views/onboarding.js";
import { renderHome, renderWords, renderTexts, renderProgress, setNavigator, refreshWordList } from "./views/student.js";
import { renderTeacher } from "./views/teacher.js";

const app = $("#app");
const VIEWS = ["today", "words", "read", "progress", "teacher"];

// langue de départ : choix mémorisé, sinon langue du navigateur
let stored = null;
try { stored = localStorage.getItem("lx_lang"); } catch { /* */ }
setLang(LANGS.includes(stored) ? stored : guessLang());

// code d'invitation dans l'adresse (?join=CODE) : mémorisé le temps de la connexion
(() => {
  const u = new URL(location.href);
  const code = u.searchParams.get("join");
  if (code) {
    try { localStorage.setItem("lx_join", code.trim().toUpperCase()); } catch { /* */ }
    u.searchParams.delete("join");
    history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
  }
})();
const pendingJoin = () => { try { return localStorage.getItem("lx_join") || ""; } catch { return ""; } };

setWriteErrorHandler(() => toast(t("error_generic")));

// ───────────────────────────────── coque de l'appli
function shell() {
  const tabs = [
    ["today", "Σήμερα", t("tab_today")],
    ["words", "Λέξεις", t("tab_words")],
    ["read", "Κείμενα", t("tab_read")],
    ["progress", "Πρόοδος", t("tab_progress")],
    ...(isStaff() ? [["teacher", "Τάξεις", t("tab_teacher")]] : []),
  ];
  app.innerHTML = `
    <header class="top"><div class="wrap">
      <div class="brand" lang="el">Λεξούλα</div>
      <div class="streak" id="streak"></div>
    </div></header>
    <main class="wrap" id="main">${VIEWS.map((v) => `<section data-view="${v}" id="v-${v}" hidden></section>`).join("")}</main>
    <nav class="tabs" aria-label="Λεξούλα"><div class="wrap" style="grid-template-columns:repeat(${tabs.length},1fr)">
      ${tabs.map(([k, g, l]) => `<button class="tab" data-tab="${k}"><span class="g" lang="el">${g}</span>${esc(l)}</button>`).join("")}
    </div></nav>`;
  app.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) go(b.dataset.tab); });
}

function go(v) {
  if (!VIEWS.includes(v) || (v === "teacher" && !isStaff())) v = "today";
  if (v !== "read") S.reading = null;
  S.view = v;
  document.querySelectorAll("[data-view]").forEach((s) => (s.hidden = s.dataset.view !== v));
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === v ? "page" : "false"));
  render();
  window.scrollTo(0, 0);
}
setNavigator(go);

function render() {
  const n = streakCount();
  const st = $("#streak");
  if (st) st.innerHTML = n ? `<b>${n}</b> ${esc(t("streak"))}` : "";
  const el = $(`#v-${S.view}`);
  if (!el) return;
  if (S.view === "today") renderHome(el);
  else if (S.view === "words") renderWords(el);
  else if (S.view === "read") renderTexts(el);
  else if (S.view === "progress") renderProgress(el);
  else if (S.view === "teacher") renderTeacher(el);
}

setSessionEnd(() => render());
onStarChange(() => {
  if (S.session) return;
  if (S.view === "today") render();
  if (S.view === "words" && S.lex.filter === "star") refreshWordList();
  if (S.view === "read" && S.reading) render();
});

// ───────────────────────────────── démarrage
function showLoading() {
  app.innerHTML = `<div class="boot"><div class="logo" lang="el">Λεξούλα</div><p class="muted">${esc(t("loading"))}</p></div>`;
}

async function startApp() {
  showLoading();
  try {
    await loadProfile();
    if (S.profile?.native_lang && S.profile.onboarded) setLang(S.profile.native_lang);
    const code = pendingJoin();
    if (!S.profile?.onboarded) {
      return renderOnboarding(app, { code, onDone: () => startApp() });
    }
    if (code) {
      const { data, error } = await sb.rpc("join_group", { p_code: code });
      try { localStorage.removeItem("lx_join"); } catch { /* */ }
      if (error) toast(/invalid_code/.test(error.message) ? t("code_wrong") : t("error_generic"));
      else if (data?.[0]) toast(t("joined", { name: data[0].name }));
    }
    await loadAll();
    try { localStorage.setItem("lx_lang", S.profile.native_lang); } catch { /* */ }
    shell();
    const h = location.hash.slice(1);
    go(VIEWS.includes(h) ? h : "today");
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="boot"><div class="logo" lang="el">Λεξούλα</div><p class="err">${esc(t("error_generic"))}</p>
      <button class="btn" onclick="location.reload()">↻</button></div>`;
  }
}

async function showLogin() {
  const code = pendingJoin();
  let invite = null;
  if (code) {
    const { data } = await sb.rpc("peek_group", { p_code: code });
    invite = data?.[0] || null;
  }
  renderLogin(app, { invite });
}

let started = false;
sb.auth.onAuthStateChange((event, session) => {
  if (session?.user && !started) {
    started = true;
    S.user = session.user;
    setTimeout(startApp, 0); // hors du callback d'auth (recommandé par supabase-js)
  } else if (!session && event === "SIGNED_OUT") {
    started = false;
    S.user = null;
    showLogin();
  }
});
sb.auth.getSession().then(({ data }) => { if (!data.session && !started) showLogin(); });

// rafraîchir quand on revient sur l'appli (et tant que des mots ou des textes sont en préparation)
let lastRefresh = Date.now();
async function refresh(force) {
  if (!S.ready || S.session || !S.user) return;
  if (!force && Date.now() - lastRefresh < 60_000) return;
  lastRefresh = Date.now();
  try {
    await Promise.all([loadWords(), loadTexts(), loadLists(), loadProgress()]);
    if (!S.session) render();
  } catch (e) { console.warn(e); }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
setInterval(() => {
  const busy = S.pending > 0 || S.texts.some((x) => x.status === "translating") || S.lists.some((l) => l.ready + l.failed < l.total);
  if (busy && document.visibilityState === "visible") refresh(true);
}, 45_000);

// appli installable (hors ligne minimal)
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
