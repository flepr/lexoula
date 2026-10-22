// Composants partagés : boutons écouter / étoile, formes d'affichage des mots
import { esc, toast } from "./util.js";
import { TTS, say, ICON_SAY } from "./tts.js";
import { isStar, toggleStar } from "./store.js";
import { t, pick } from "./i18n.js";

export const headword = (w) => String(w.gr || "").split(" · ")[0].replace(/, -.*$/, "");
export const meaning = (w) => pick(w.tr);
export const speakForm = (w) => (w.fem ? `${w.ans?.[0] || headword(w)}, ${w.fem}, ${w.neu}` : String(w.gr || "").replace(/, -.*$/, ""));

export const sayBtn = (text, label) =>
  TTS.ok ? `<button class="say" data-say="${esc(text)}" aria-label="${esc(label || t("listen"))}">${ICON_SAY}</button>` : "";

const ICON_STAR = (on) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9z"/></svg>`;

export function starBtn(id) {
  const on = isStar(id);
  return `<button class="star${on ? " on" : ""}" data-star="${esc(id)}" aria-pressed="${on}" aria-label="${esc(on ? t("star_removed") : t("star_add_label"))}">${ICON_STAR(on)}</button>`;
}

let afterStar = () => {};
export const onStarChange = (fn) => (afterStar = fn);

document.addEventListener("click", (e) => {
  const s = e.target.closest("[data-say]");
  if (s) { e.stopPropagation(); say(s.dataset.say); return; }
  const b = e.target.closest("[data-star]");
  if (b) {
    e.stopPropagation();
    const id = b.dataset.star;
    const on = toggleStar(id);
    document.querySelectorAll(`[data-star="${CSS.escape(id)}"]`).forEach((x) => { x.outerHTML = starBtn(id); });
    toast(on ? t("star_added") : t("star_removed"));
    afterStar(id, on);
  }
}, true);
