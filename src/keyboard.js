// Aide « clavier grec » : comment l'ajouter sur iPhone ou Android, ou passer les exercices d'écriture.
// Entièrement dans la langue de l'interface, même les menus du téléphone (décision du 11/11/2026).
import { esc } from "./util.js";
import { t } from "./i18n.js";

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(navigator.userAgent);

// opts : { onSkip?: () => void, onDone?: () => void, message?: string }
export function showKbHelp(opts = {}) {
  let root = document.getElementById("kb-root");
  if (!root) { root = document.createElement("div"); root.id = "kb-root"; document.body.appendChild(root); }
  const ios = isIOS(), android = isAndroid();
  const iosBlock = `<details class="kbos" ${ios || !android ? "open" : ""}><summary>iPhone / iPad</summary>
      <p class="kbpath">${esc(t("kb_ios"))}</p><p class="small">${esc(t("kb_ios_switch"))}</p><p class="small">${esc(t("kb_accent"))}</p></details>`;
  const andBlock = `<details class="kbos" ${android ? "open" : ""}><summary>Android</summary>
      <p class="kbpath">${esc(t("kb_android"))}</p><p class="small muted">${esc(t("kb_android_other"))}</p><p class="small">${esc(t("kb_android_switch"))}</p><p class="small">${esc(t("kb_accent_android"))}</p></details>`;
  root.innerHTML = `<div class="sheet-bg kb" id="kbbg"></div><div class="sheet kb" role="dialog" aria-label="${esc(t("kb_title"))}"><div class="wrap stack">
    ${opts.message ? `<p class="notice">${esc(opts.message)}</p>` : ""}
    <h3 class="kbt">${esc(t("kb_title"))}</h3>
    <p class="small muted">${esc(t("kb_intro"))}</p>
    ${android ? andBlock + iosBlock : iosBlock + andBlock}
    <button class="btn" id="kbok">${esc(t("kb_done"))}</button>
    ${opts.onSkip ? `<button class="btn ghost" id="kbskip">${esc(t("kb_skip"))}</button><p class="muted small center">${esc(t("kb_skip_help"))}</p>` : ""}
  </div></div>`;
  const close = () => (root.innerHTML = "");
  root.querySelector("#kbbg").onclick = () => { close(); opts.onDone?.(); };
  root.querySelector("#kbok").onclick = () => { close(); opts.onDone?.(); };
  const sk = root.querySelector("#kbskip");
  if (sk) sk.onclick = () => { close(); opts.onSkip(); };
}

// des lettres latines et aucune lettre grecque : le clavier grec n'est sans doute pas installé
export const looksLatin = (s) => /[a-z]/i.test(s) && !/[Ͱ-Ͽἀ-῿]/.test(s);
