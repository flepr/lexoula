import { t } from "./i18n.js";
// Petits utilitaires partagés
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const today = () => new Date().toLocaleDateString("sv-SE");
export const addDays = (d, n) => {
  const t = new Date(d + "T12:00:00");
  t.setDate(t.getDate() + n);
  return t.toLocaleDateString("sv-SE");
};
export const shuffle = (a) => {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
export const pickOne = (a) => a[Math.floor(Math.random() * a.length)];

export const stripAcc = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");

// normalisation d'une réponse tapée (casse, ponctuation, sigma final, article)
export function norm(s) {
  s = String(s || "").normalize("NFC").trim().toLocaleLowerCase("el");
  s = s.replace(/[.,;:!?«»"“”'’·…()\-–—]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/σ(?=\s|$)/g, "ς");
  s = s.replace(/^(ο|η|το|οι|τα|τον|την|του|της|ο\/η)\s+/, "");
  return s;
}

export const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const lowFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// fenêtre de confirmation intégrée à la page
export function confirmBox(message, okLabel, cancelLabel) {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "modal-bg";
    root.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><p>${esc(message)}</p>
      <div class="btnrow"><button class="btn ghost" data-a="0">${esc(cancelLabel)}</button><button class="btn danger" data-a="1">${esc(okLabel)}</button></div></div>`;
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (!b && e.target !== root) return;
      root.remove();
      resolve(b ? b.dataset.a === "1" : false);
    });
    document.body.appendChild(root);
    root.querySelector('[data-a="1"]').focus();
  });
}

// découpe une liste collée : « mot<TAB>traduction », « mot - traduction », « mot = traduction »
const GREEK = /[Ͱ-Ͽἀ-῿]/;
export function parseWordLines(text) {
  const out = [];
  const seen = new Set();
  for (let raw of String(text || "").split(/\r?\n/)) {
    raw = raw.replace(/^\s*(\d+[.)]|[-•*])\s+/, "").trim();
    if (!raw) continue;
    let gr = raw, hint = "";
    const parts = raw.split(/\t+|\s+[–—-]\s+|\s+=\s+|\s*\|\s*/);
    if (parts.length > 1) {
      const gi = parts.findIndex((p) => GREEK.test(p));
      if (gi >= 0) {
        gr = parts[gi].trim();
        hint = parts.filter((_, i) => i !== gi).join(" ; ").trim();
      }
    }
    if (!GREEK.test(gr)) continue;
    const key = gr.normalize("NFC").toLocaleLowerCase("el").replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ input: gr, hint });
  }
  return out;
}

// crédit (identique partout) : Στέφανος d'abord, liens Instagram
export function creditHtml(cls = "credit") {
  const ig = (h, url) => `<a href="${url}" target="_blank" rel="noopener">@${h}</a>`;
  return `<p class="${cls}">${esc(t("credit_lessons"))} <span lang="el">Στέφανος Βασιλείου</span> (Stefanos Vasileiou) · ${ig("learngreekwithstefanos", "https://www.instagram.com/learngreekwithstefanos/")}<br>
    ${esc(t("credit_app"))} <span lang="el">Φοίβος Λεπέρ</span> (Fabien Lepère) · ${ig("flepr", "https://www.instagram.com/flepr/")}</p>`;
}

// « paula » → « Paula », « jean-pierre dupont » → « Jean-Pierre Dupont » (le reste du mot est laissé tel quel)
export const nameCase = (s) => String(s || "").trim().replace(/\s+/g, " ").replace(/(^|[\s\-'’])(\p{L})/gu, (m, p, c) => p + c.toLocaleUpperCase());
// « vincent.moro42 » → « Vincent Moro »
export const nameFromEmailPart = (s) => nameCase(String(s || "").replace(/[0-9]+/g, " ").replace(/[._+\-]+/g, " "));
