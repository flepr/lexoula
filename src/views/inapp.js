// Écran « Ouvre Λεξούλα dans Safari / Chrome » : l'adresse a été ouverte dans le navigateur intégré d'une appli
// (Instagram, Facebook, Messenger…). Google y refuse la connexion et l'appli ne peut pas s'y installer.
// Repris de MuscleMap. Le lien copié (et le bouton Chrome d'Android) remet le code de classe et le texte à ouvrir
// dans l'adresse : Safari ou Chrome ne voient pas ce que le navigateur de l'appli a gardé de côté.
import { t, tDevice, getLang } from "../i18n.js";
import { $, esc, toast } from "../util.js";
import { isAndroid, hostApp } from "../install.js";
import { langPillHtml, bindLangPill } from "../langpill.js";

// typographie française : espaces insécables avant « : ; ? ! » et dans les guillemets
const nb = (s) => s.replace(/« /g, "« ").replace(/ »/g, " »").replace(/ ([:;?!])/g, " $1");
const tx = (key, vars) => esc(nb(t(key, vars)));
const txd = (key) => esc(nb(tDevice(key))); // étapes qui citent le menu d'Instagram : langue du téléphone

const ARROW = `<svg viewBox="0 0 74 74" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 62C20 34 36 18 62 12"/><path d="M40 10l22 2-6 21"/></svg>`;
const COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`;
const OUT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`;

// Android : ouvre la même adresse dans le navigateur du téléphone (Instagram bloque l'équivalent sur iPhone)
const intentUrl = (url) => { const u = new URL(url); return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;end`; };

// url : adresse à ouvrir dans le navigateur (code de classe et texte compris) ; invite : classe à rejoindre (peek_group)
export function renderInApp(root, { url, invite, onStay, onLang }) {
  const and = isAndroid();
  const browser = and ? "Chrome" : "Safari";
  const app = hostApp();
  const dots = `<span class="kdots">${and ? "⋮" : "•••"}</span>`;
  root.innerHTML = `<div class="inapp-arrow" aria-hidden="true">${ARROW}</div>
    <div class="login inapp">
      <h1 class="logo" lang="el">Λεξούλα</h1>
      ${invite ? `<div class="card stack invite"><span class="invite-title">${esc(t("invited_to", { name: invite.name }))}</span>${invite.teacher ? `<span class="muted small">${esc(t("teacher"))}${getLang() === "fr" ? "\u00a0: " : ": "}${esc(invite.teacher)}${invite.level ? " · " + esc(invite.level) : ""}</span>` : ""}</div>` : ""}
      <div class="stack">
        <h2>${tx(and ? "inapp_title_and" : "inapp_title_ios")}</h2>
        <p class="muted">${app ? tx("inapp_why", { app }) : tx("inapp_why_other")}</p>
      </div>
      ${and ? `<a class="btn" href="${esc(intentUrl(url))}">${tx("inapp_open_and")}${OUT}</a><p class="muted small center">${tx("inapp_or")}</p>` : ""}
      <div class="card"><ol class="isteps inapp-steps">
        <li>${txd("inapp_step1").replace("{dots}", dots)}</li>
        <li>${txd(and ? "inapp_step2_and" : "inapp_step2_ios")}</li>
      </ol></div>
      ${invite ? `<p class="muted small">${tx("inapp_keeps", { name: invite.name })}</p>` : ""}
      <div class="inapp-foot">
        <button class="btn sso" type="button" id="iacopy">${COPY}${esc(t("inst_copy_link"))}</button>
        <span class="muted small">${tx("inapp_paste", { browser })}</span>
        <button class="inapp-stay" type="button" id="iastay">${esc(t("inapp_stay"))}</button>
        ${onLang ? langPillHtml("foot") : ""}
      </div>
    </div>`;
  $("#iacopy").onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast(t("copied")); } catch { toast(url); }
  };
  $("#iastay").onclick = () => onStay();
  if (onLang) bindLangPill(root, onLang);
}
