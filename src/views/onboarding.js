// Premier lancement : langue maternelle, prénom, classe
import { sb } from "../supabase.js";
import { S, saveProfile } from "../store.js";
import { t, LANGS, LANG_LABELS, setLang } from "../i18n.js";
import { $, esc, toast, creditHtml } from "../util.js";

export function renderOnboarding(root, { code, onDone }) {
  const st = { lang: S.profile?.onboarded && S.profile.native_lang ? S.profile.native_lang : null, name: S.profile?.display_name || "", code: code || "", err: "", busy: false, preview: null };

  setLang(st.lang || "en");

  const peek = async () => {
    if (!st.code) return;
    const { data } = await sb.rpc("peek_group", { p_code: st.code });
    st.preview = data?.[0] || null;
    draw();
  };

  const draw = () => {
    root.innerHTML = `<div class="onb">
      <h1 class="logo small" lang="el">Λεξούλα</h1>
      <h2>${esc(t("welcome"))}</h2>
      <form id="of" class="stack card" novalidate>
        <fieldset>
          <legend>${esc(t("choose_lang"))}</legend>
          <p class="muted small">${esc(t("choose_lang_help"))}</p>
          <div class="langgrid">${LANGS.map((l) => `<label class="langopt"><input type="radio" name="lang" value="${l}" ${l === st.lang ? "checked" : ""}><span>${LANG_LABELS[l]}</span></label>`).join("")}</div>
        </fieldset>
        <label for="nm">${esc(t("your_name"))}</label>
        <input id="nm" autocomplete="given-name" maxlength="60" value="${esc(st.name)}">
        <span class="muted small">${esc(t("name_help"))}</span>
        <label for="cc">${esc(t("join_title"))}</label>
        <input id="cc" class="code" autocapitalize="characters" maxlength="12" placeholder="${esc(t("class_code"))}" value="${esc(st.code)}">
        <span class="muted small">${st.preview ? esc(t("invited_to", { name: st.preview.name })) : esc(t("join_help"))}</span>
        ${st.err ? `<p class="err" role="alert">${esc(st.err)}</p>` : ""}
        <button class="btn" type="submit" ${st.busy ? "disabled" : ""}>${esc(t("continue"))}</button>
      </form>
      ${creditHtml()}
    </div>`;
    root.querySelectorAll('input[name="lang"]').forEach((r) => r.addEventListener("change", () => {
      st.lang = r.value; st.name = $("#nm").value; st.code = $("#cc").value; setLang(st.lang); draw();
    }));
    $("#cc").addEventListener("change", () => { st.code = $("#cc").value.trim(); st.name = $("#nm").value; peek(); });
    $("#of").onsubmit = async (e) => {
      e.preventDefault();
      st.name = $("#nm").value.trim();
      st.code = $("#cc").value.trim();
      if (!st.lang) { st.err = t("choose_lang_needed"); return draw(); }
      st.busy = true; st.err = ""; draw();
      try {
        if (st.code) {
          const { data, error } = await sb.rpc("join_group", { p_code: st.code });
          if (error) { st.err = /invalid_code/.test(error.message) ? t("code_wrong") : t("error_generic"); st.busy = false; return draw(); }
          if (data?.[0]) toast(t("joined", { name: data[0].name }));
        }
        await saveProfile({ native_lang: st.lang, display_name: st.name || S.profile?.display_name || null, onboarded: true });
        try { localStorage.removeItem("lx_join"); } catch { /* */ }
        onDone();
      } catch (err) {
        console.warn(err);
        st.err = t("error_generic"); st.busy = false; draw();
      }
    };
  };
  draw();
  peek();
}
