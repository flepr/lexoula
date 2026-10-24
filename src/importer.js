// Import ponctuel d'une progression venue d'une autre appli (lien « …#import=<données> »).
// Les données voyagent dans le fragment de l'adresse : elles ne passent ni par le serveur web ni par le dépôt.
// Format (JSON encodé en base64url) : { id, p: [[gr, box, due, seen, ok, ko, last, known, star], …], d: [[jour, n, ok], …] }
// Fusion sans perte : compteurs additionnés, boîte et échéance de la révision la plus récente, étoile et « connu » conservés.
import { sb } from "./supabase.js";
import { S, saveProfile, loadProgress } from "./store.js";
import { t } from "./i18n.js";
import { esc, toast } from "./util.js";

const KEY = "lx_import";

// à l'ouverture : mettre les données de côté (elles doivent survivre à la connexion) et nettoyer l'adresse
export function captureImport() {
  const m = location.hash.match(/^#import=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  try { localStorage.setItem(KEY, m[1]); } catch { /* */ }
  history.replaceState(null, "", location.pathname + location.search);
}

function decode(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0))));
}
const norm = (s) => String(s || "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase().replace(/σ(?=$|[\s,.;:!?·)/-])/g, "ς");

function ask(message) {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "modal-bg";
    root.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3 class="kbt">${esc(t("import_title"))}</h3><p class="small">${esc(message)}</p>
      <div class="btnrow"><button class="btn ghost" data-a="0">${esc(t("cancel"))}</button><button class="btn" data-a="1">${esc(t("import_btn"))}</button></div></div>`;
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (!b) return;
      root.remove();
      resolve(b.dataset.a === "1");
    });
    document.body.appendChild(root);
  });
}

// une fois l'appli chargée (profil, mots et progression connus)
export async function runPendingImport() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { /* */ }
  if (!raw) return false;
  const drop = () => { try { localStorage.removeItem(KEY); } catch { /* */ } };
  let data;
  try { data = decode(raw); } catch { drop(); toast(t("error_generic")); return false; }
  const done = S.settings.imports || [];
  if (done.includes(data.id)) { drop(); toast(t("import_already")); return false; }

  const nDays = (data.d || []).length;
  if (!(await ask(t("import_confirm", { words: (data.p || []).length, days: nDays, email: S.profile?.email || S.user?.email || "" })))) { drop(); return false; }

  // mots du compte : correspondance par la forme saisie dans la liste, puis par l'entrée du dictionnaire
  const { data: words, error } = await sb.rpc("my_words");
  if (error) { toast(t("error_generic")); return false; }
  const byKey = new Map();
  for (const w of words || []) { byKey.set(norm(w.input), w.id); if (w.data?.gr && !byKey.has(norm(w.data.gr))) byKey.set(norm(w.data.gr), w.id); }

  const rows = [];
  let missing = 0;
  for (const [gr, box, due, seen, ok, ko, last, known, star] of data.p || []) {
    const id = byKey.get(norm(gr));
    if (!id) { missing++; continue; }
    const cur = S.progress.get(id);
    const newer = !cur || (last || "") > (cur.last || "");
    rows.push({
      user_id: S.user.id, lexeme_id: id,
      box: newer ? box : cur.box, due: newer ? due : cur.due,
      last: [cur?.last, last].filter(Boolean).sort().pop() || null,
      seen: (cur?.seen || 0) + seen, ok: (cur?.ok || 0) + ok, ko: (cur?.ko || 0) + ko,
      known: !!(cur?.known || known), star: !!(cur?.star || star), updated_at: new Date().toISOString(),
    });
  }
  const acts = (data.d || []).map(([day, n, ok]) => {
    const cur = S.activity.get(day);
    return { user_id: S.user.id, day, n: (cur?.n || 0) + n, ok: (cur?.ok || 0) + ok };
  });

  const r1 = rows.length ? await sb.from("progress").upsert(rows, { onConflict: "user_id,lexeme_id" }) : { error: null };
  const r2 = acts.length ? await sb.from("activity").upsert(acts, { onConflict: "user_id,day" }) : { error: null };
  if (r1.error || r2.error) { console.warn(r1.error || r2.error); toast(t("error_generic")); return false; }
  await saveProfile({ settings: { ...S.settings, imports: [...done, data.id] } });
  drop();
  await loadProgress();
  toast(t("import_done", { n: rows.length, m: missing }));
  return true;
}
