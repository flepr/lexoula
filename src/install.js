// Installer Λεξούλα sur l'écran d'accueil : détection de l'appareil, instructions iPhone / Android / ordinateur,
// étape de fin d'onboarding, carte de rappel (J+1, J+3, J+7, J+14, J+21) et entrée des réglages.
import QRCode from "qrcode";
import { esc, toast, today } from "./util.js";
import { t } from "./i18n.js";

const UA = navigator.userAgent || "";
export const isIOS = () => /iPhone|iPad|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/i.test(UA);
export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.matchMedia?.("(display-mode: fullscreen)").matches || navigator.standalone === true;
// navigateurs intégrés aux applis (Instagram, Facebook, Messenger, LinkedIn, Snapchat…) : on ne peut pas y installer
const inAppBrowser = () => /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Messenger|LinkedInApp|Snapchat|Line\/|MicroMessenger|TikTok|musical_ly/i.test(UA);
const platform = () => (isIOS() ? "ios" : isAndroid() ? "android" : "desktop");
const appUrl = () => location.origin + location.pathname;

// Android et ordinateur (Chrome, Edge) : le navigateur propose l'installation en un geste
let deferred = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; });
window.addEventListener("appinstalled", () => { deferred = null; stopReminders(); });

// ───────────────────────────────── calendrier des rappels (gardé sur l'appareil)
const STEPS = [1, 3, 7, 14, 21];
const KEY = "lx_install";
const readState = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; } };
const writeState = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* */ } };
const elapsed = (start) => Math.round((Date.parse(today()) - Date.parse(start)) / 86400000);

// point de départ du calendrier : la fin de l'onboarding, ou la première ouverture après cette mise à jour
export function startReminders() {
  const s = readState();
  if (!s.start) writeState({ ...s, start: today(), done: s.done || [] });
}
function stopReminders() { writeState({ ...readState(), stop: true }); }
function markSeen() {
  const s = readState();
  const n = s.start ? elapsed(s.start) : 0;
  writeState({ ...s, done: [...new Set([...(s.done || []), ...STEPS.filter((d) => d <= n)])] });
}
// la carte est-elle à montrer aujourd'hui ?
function cardDue() {
  if (isStandalone()) return false;
  const s = readState();
  if (!s.start || s.stop) return false;
  const n = elapsed(s.start);
  return STEPS.some((d) => d <= n && !(s.done || []).includes(d));
}

// ───────────────────────────────── contenu : avantages et instructions
const ICON_SHARE = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2"/></svg>`;
const ICON_DOTS = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`;
const ICON_MORE = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;

// typographie française : espaces insécables avant « : ; ? ! » et dans les guillemets (évite « Ajouter » coupé)
const nb = (s) => s.replace(/« /g, "«\u00a0").replace(/ »/g, "\u00a0»").replace(/ ([:;?!])/g, "\u00a0$1");
const tx = (key) => esc(nb(t(key)));
const steps = (items) => `<ol class="isteps">${items.map((x) => `<li>${x}</li>`).join("")}</ol>`;
// les pictogrammes sont insérés à la place de {share}, {more}, {dots}
const withIcons = (s) => esc(nb(s)).replace("{share}", ICON_SHARE).replace("{more}", ICON_MORE).replace("{dots}", ICON_DOTS);

function iosPane() {
  return steps([withIcons(t("inst_ios_1")), tx("inst_ios_2"), tx("inst_ios_3"), tx("inst_ios_4")]);
}
function androidPane() {
  return `${deferred && isAndroid() ? `<button class="btn" data-inst-now>${esc(t("inst_button"))}</button><p class="muted small">${esc(t("inst_and_or"))}</p>` : ""}
    ${steps([withIcons(t("inst_and_1")), tx("inst_and_2"), tx("inst_and_3")])}
    <p class="muted small">${tx("inst_and_other")}</p>`;
}
function desktopPane() {
  return `<div class="iqr-row"><div class="qr" data-inst-qr aria-label="QR"></div><p class="small">${tx("inst_desk")}</p></div>
    ${deferred && !isAndroid() ? `<p class="muted small">${tx("inst_desk_here")}</p><div><button class="btn small ghost" data-inst-now>${esc(t("inst_button"))}</button></div>` : ""}`;
}

// bloc complet : avertissement « navigateur d'une appli », onglets iPhone / Android / Ordinateur, ouvert sur le bon onglet
function guide(sel) {
  const p = sel || platform();
  return `${inAppBrowser() ? `<div class="notice stack-s"><span>${tx("inst_inapp")}</span><div><button class="btn small" data-inst-copy>${esc(t("inst_copy_link"))}</button></div></div>` : ""}
    <div class="seg itabs" role="tablist">
      ${[["ios", "iPhone"], ["android", "Android"], ["desktop", t("inst_tab_desktop")]].map(([k, l]) => `<button role="tab" data-inst-tab="${k}" aria-pressed="${k === p}">${esc(l)}</button>`).join("")}
    </div>
    <div class="ipane" data-inst-pane>${p === "ios" ? iosPane() : p === "android" ? androidPane() : desktopPane()}</div>`;
}

// branche les onglets et les boutons d'un bloc guide() déjà inséré dans `box`
function bindGuide(box, onInstalled) {
  const fill = () => {
    const q = box.querySelector("[data-inst-qr]");
    if (q) QRCode.toString(appUrl(), { type: "svg", margin: 1, color: { dark: "#1B231E", light: "#FFFFFF" } }).then((svg) => { q.innerHTML = svg; }).catch(() => {});
    box.querySelectorAll("[data-inst-now]").forEach((b) => (b.onclick = async () => {
      if (!deferred) return;
      deferred.prompt();
      const { outcome } = await deferred.userChoice.catch(() => ({}));
      deferred = null;
      if (outcome === "accepted") { stopReminders(); onInstalled?.(); }
    }));
  };
  box.querySelectorAll("[data-inst-tab]").forEach((b) => (b.onclick = () => {
    box.querySelectorAll("[data-inst-tab]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    const k = b.dataset.instTab;
    box.querySelector("[data-inst-pane]").innerHTML = k === "ios" ? iosPane() : k === "android" ? androidPane() : desktopPane();
    fill();
  }));
  const c = box.querySelector("[data-inst-copy]");
  if (c) c.onclick = async () => { try { await navigator.clipboard.writeText(appUrl()); toast(t("copied")); } catch { toast(appUrl()); } };
  fill();
}

// ───────────────────────────────── fenêtre « Comment installer »
export function showInstallSheet() {
  let root = document.getElementById("inst-root");
  if (!root) { root = document.createElement("div"); root.id = "inst-root"; document.body.appendChild(root); }
  root.innerHTML = `<div class="sheet-bg kb" data-inst-close></div><div class="sheet kb" role="dialog" aria-label="${esc(t("inst_title"))}"><div class="wrap stack">
    <h3 class="kbt">${esc(t("inst_title"))}</h3>
    <p class="small muted">${tx("inst_why")}</p>
    ${guide()}
    <button class="btn ghost" data-inst-close>${esc(t("close"))}</button>
  </div></div>`;
  const close = () => (root.innerHTML = "");
  root.querySelectorAll("[data-inst-close]").forEach((b) => (b.onclick = close));
  bindGuide(root, close);
}

// ───────────────────────────────── étape de fin d'onboarding (plein écran)
export function shouldOfferInstallStep() { return !isStandalone(); }
export function renderInstallStep(root, { onDone }) {
  startReminders();
  root.innerHTML = `<div class="onb">
    <h1 class="logo small" lang="el">Λεξούλα</h1>
    <div class="card stack">
      <h2 class="sent-title">${esc(t("inst_title"))}</h2>
      <p class="small">${tx("inst_why")}</p>
      ${guide()}
      <button class="btn" data-inst-ok>${esc(t("inst_done"))}</button>
      <button class="btn ghost" data-inst-later>${esc(t("inst_later"))}</button>
      <p class="muted small center">${tx("inst_later_help")}</p>
    </div>
  </div>`;
  root.querySelector("[data-inst-ok]").onclick = () => { stopReminders(); onDone(); };
  root.querySelector("[data-inst-later]").onclick = () => onDone();
  bindGuide(root, onDone);
}

// ───────────────────────────────── carte de l'écran Aujourd'hui
export function installCard() {
  if (!cardDue()) return "";
  return `<div class="card stack instcard" id="instcard">
    <div class="toolbar"><span class="eyebrow">${esc(t("install_app"))}</span><button class="iclose" id="inst-x" aria-label="${esc(t("close"))}">×</button></div>
    <p class="small">${tx("inst_card")}</p>
    <div class="btnrow"><button class="btn" id="inst-how">${esc(t("inst_how"))}</button><button class="btn ghost" id="inst-already">${esc(t("inst_already"))}</button></div>
  </div>`;
}
export function bindInstallCard(el) {
  const card = el.querySelector("#instcard");
  if (!card) return;
  const hide = () => card.remove();
  el.querySelector("#inst-x").onclick = () => { markSeen(); hide(); };
  el.querySelector("#inst-already").onclick = () => { stopReminders(); hide(); };
  el.querySelector("#inst-how").onclick = () => { markSeen(); hide(); showInstallSheet(); };
}

// ───────────────────────────────── réglages
export function installSettingsCard() {
  return `<div class="card stack"><span class="eyebrow">${esc(t("install_app"))}</span>
    ${isStandalone() ? `<p class="small">${esc(t("inst_installed"))}</p>`
      : `<p class="small">${tx("inst_why")}</p><div><button class="btn small" id="inst-open">${esc(t("inst_how"))}</button></div>`}
  </div>`;
}
export function bindInstallSettings(el) {
  const b = el.querySelector("#inst-open");
  if (b) b.onclick = () => showInstallSheet();
}
