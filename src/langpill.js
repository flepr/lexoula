// Pastille de langue des premiers écrans (connexion, navigateur d'Instagram, code de classe, onboarding, page publique
// d'un texte) : globe + code de la langue ; un menu dessiné par l'appli liste les 8 langues, chacune dans sa langue,
// puis « Ελληνικά » (interface en grec, traductions dans la langue choisie avant). Décision du 09/11/2026.
import { t, getLang, LANGS, LANG_LABELS } from "./i18n.js";
import { esc } from "./util.js";

const GLOBE = `<svg class="lp-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/></svg>`;
const CHEV = `<svg class="lp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
const CHECK = `<svg class="lp-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>`;

// where : "top" (coin haut droit de l'écran), "foot" (pied de l'écran Instagram, menu ouvert vers le haut) ou "bar"
// (barre du haut de la page publique)
export function langPillHtml(where = "top") {
  const l = getLang();
  return `<div class="lpill-wrap lp-${where}"><button type="button" class="lpill" aria-haspopup="listbox" aria-expanded="false"
    aria-label="${esc(t("language"))}: ${esc(LANG_LABELS[l])}">${GLOBE}<span>${l.toUpperCase()}</span>${CHEV}</button></div>`;
}

function menuHtml() {
  const cur = getLang();
  const item = (l) => `<button type="button" role="option" class="lp-opt" lang="${l}" data-lang="${l}" aria-selected="${l === cur}">
    <span>${esc(LANG_LABELS[l])}</span>${l === cur ? CHECK : ""}</button>`;
  return `<div class="lmenu" role="listbox" aria-label="${esc(t("language"))}">
    ${LANGS.map(item).join("")}
    <div class="lp-sep" role="separator"></div>
    <button type="button" role="option" class="lp-opt el" lang="el" data-lang="el" aria-selected="${cur === "el"}">
      <span class="lp-two"><span>${esc(LANG_LABELS.el)}</span><small lang="${esc(cur)}">${esc(t("ui_greek_sub"))}</small></span>${cur === "el" ? CHECK : ""}</button>
  </div>`;
}

// onPick(lang) : appelé quand une autre langue est choisie ; à l'appelant de changer la langue et de redessiner
export function bindLangPill(root, onPick) {
  const wrap = root.querySelector(".lpill-wrap");
  if (!wrap) return;
  const btn = wrap.querySelector(".lpill");
  const close = () => {
    wrap.querySelector(".lmenu")?.remove();
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", esc_);
  };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  const esc_ = (e) => { if (e.key === "Escape") { close(); btn.focus(); } };
  btn.onclick = () => {
    if (wrap.querySelector(".lmenu")) return close();
    wrap.insertAdjacentHTML("beforeend", menuHtml());
    btn.setAttribute("aria-expanded", "true");
    const menu = wrap.querySelector(".lmenu");
    menu.onclick = (e) => {
      const o = e.target.closest("[data-lang]");
      if (!o) return;
      const l = o.dataset.lang;
      close();
      if (l !== getLang()) onPick(l);
    };
    menu.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", esc_);
  };
}
