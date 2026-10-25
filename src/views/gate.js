// Écran d'entrée pour un compte qui n'a encore rejoint aucune classe :
// l'appli est réservée aux élèves invités par leur professeur (décision du 25/10/2026).
import { sb } from "../supabase.js";
import { t } from "../i18n.js";
import { $, esc, creditHtml } from "../util.js";

export function renderGate(root, { onJoined }) {
  root.innerHTML = `<div class="onb">
    <h1 class="logo small" lang="el">Λεξούλα</h1>
    <h2>${esc(t("gate_title"))}</h2>
    <form id="gf" class="stack card" novalidate>
      <p>${esc(t("gate_text"))}</p>
      <label for="gc">${esc(t("class_code"))}</label>
      <input id="gc" class="code" autocapitalize="characters" autocomplete="off" maxlength="12" placeholder="${esc(t("class_code"))}">
      <p class="err small" id="gerr" role="alert" hidden></p>
      <button class="btn" type="submit">${esc(t("join"))}</button>
      <p class="muted small">${esc(t("gate_teacher"))}</p>
    </form>
    <div class="btnrow">
      <a class="btn ghost" href="https://lexoula.gr/">${esc(t("gate_site"))}</a>
      <button class="btn ghost" type="button" id="gso">${esc(t("sign_out"))}</button>
    </div>
    ${creditHtml()}
  </div>`;
  const err = $("#gerr");
  const showErr = (m) => { err.textContent = m; err.hidden = false; };
  $("#gso").onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $("#gf").onsubmit = async (e) => {
    e.preventDefault();
    const code = $("#gc").value.trim();
    if (!code) { showErr(t("code_empty")); return $("#gc").focus(); }
    const btn = $("#gf button[type=submit]");
    btn.disabled = true;
    const { data, error } = await sb.rpc("join_group", { p_code: code });
    btn.disabled = false;
    if (error) return showErr(/invalid_code/.test(error.message) ? t("code_wrong") : t("error_generic"));
    onJoined(data?.[0]?.name || "");
  };
}
