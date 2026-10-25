// Estimation du coût de l'IA à l'import de mots, réservée aux professeurs et aux admins.
// Le serveur renvoie le nombre de mots nouveaux et les coûts moyens mesurés (en $, tarif direct) ;
// on applique ici la remise du traitement par lots (−50 %) et on convertit en euros.
import { sb } from "./supabase.js";
import { isStaff } from "./store.js";
import { t, LOCALES, getLang } from "./i18n.js";
import { $, parseWordLines } from "./util.js";

function eur(v) {
  const f = new Intl.NumberFormat(LOCALES[getLang()], { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0.005 ? `< ${f.format(0.01)}` : f.format(v);
}

// bloc à placer sous le champ des mots (vide pour un élève)
export function costBox() {
  if (!isStaff()) return "";
  return `<div class="costbox" id="cost" hidden aria-live="polite">
    <span class="muted small" id="costtxt"></span>
    <label class="toggle" id="fastrow"><input type="checkbox" id="fast"> <span id="fasttxt"></span></label>
  </div>`;
}

// relie le bloc au champ ; renvoie une fonction qui dit si le traitement rapide est demandé
export function wireCost(textarea, groupId) {
  if (!isStaff() || !$("#cost")) return () => false;
  const box = $("#cost"), txt = $("#costtxt"), fast = $("#fast"), fastTxt = $("#fasttxt"), fastRow = $("#fastrow");
  let est = null, timer = 0, seq = 0;

  const draw = () => {
    if (!est) { box.hidden = true; return; }
    const full = est.new_words * est.word_usd + est.text_usd; // tarif direct, en $
    if (full <= 0) {
      txt.textContent = t("cost_none");
      fastRow.hidden = true; fast.checked = false;
      box.hidden = false;
      return;
    }
    const rate = Number(est.usd_eur) || 0.86;
    const batchEur = (full / 2) * rate, fastEur = full * rate;
    const detail = [t("cost_words", { n: est.new_words }), est.text_usd > 0 ? t("cost_text") : ""].filter(Boolean).join(" + ");
    txt.textContent = t(fast.checked ? "cost_est_fast" : "cost_est", { eur: eur(fast.checked ? fastEur : batchEur), detail });
    fastTxt.textContent = t("cost_fast", { eur: eur(fastEur - batchEur) });
    fastRow.hidden = false;
    box.hidden = false;
  };

  const refresh = async () => {
    const items = parseWordLines(textarea.value);
    const mine = ++seq;
    if (!items.length) { est = null; draw(); return; }
    const { data, error } = await sb.rpc("estimate_import", { p_group: groupId ?? null, p_items: items });
    if (mine !== seq) return; // une saisie plus récente a pris le relais
    est = error ? null : data;
    draw();
  };

  textarea.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(refresh, 600); });
  fast.addEventListener("change", draw);
  if (textarea.value.trim()) refresh();
  return () => fast.checked;
}
