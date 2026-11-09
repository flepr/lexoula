// Premier lancement : langue maternelle, prénom, classe
import { sb } from "../supabase.js";
import { S, saveProfile } from "../store.js";
import { t, LANGS, LANG_LABELS, setLang, setTrLang, getLang, getTrLang, rememberLang } from "../i18n.js";
import { langPillHtml, bindLangPill } from "../langpill.js";
import { $, esc, toast, creditHtml, nameCase, nameFromEmailPart } from "../util.js";

export function renderOnboarding(root, { code, onDone }) {
  // nom proposé : celui du compte, mis en forme ; s'il vient de l'adresse e-mail (« vincent.moro »), on le rend lisible
  const rawName = S.profile?.display_name || "";
  const emailPart = (S.profile?.email || S.user?.email || "").split("@")[0];
  // grille pré-cochée : langue maternelle déjà connue, sinon celle de la pastille (langue des traductions en cours)
  const st = { lang: S.profile?.onboarded && S.profile.native_lang ? S.profile.native_lang : getTrLang(), name: rawName && rawName === emailPart ? nameFromEmailPart(rawName) : nameCase(rawName), code: code || "", err: "", busy: false, preview: null };

  // Pastille et grille sont liées : une langue choisie dans l'une coche l'autre, sauf « Ελληνικά » (interface
  // en grec), qui laisse la grille telle quelle ; tant que l'interface est en grec, la grille ne règle que les
  // traductions. À la fin, l'interface reste en grec si la pastille l'indique (réglage uiLang, 09/11/2026).
  if (getLang() === "el") setTrLang(st.lang); else setLang(st.lang);

  const peek = async () => {
    if (!st.code) return;
    const { data } = await sb.rpc("peek_group", { p_code: st.code });
    st.preview = data?.[0] || null;
    draw();
  };

  const draw = () => {
    root.innerHTML = `<div class="onb">
      ${langPillHtml()}
      <h1 class="logo small" lang="el">Λεξούλα</h1>
      <h2>${esc(t("welcome"))}</h2>
      <form id="of" class="stack card" novalidate>
        <fieldset>
          <legend>${esc(t("choose_lang"))}</legend>
          <p class="muted small">${esc(t(getLang() === "el" ? "choose_lang_help_tr" : "choose_lang_help"))}</p>
          <div class="langgrid">${LANGS.map((l) => `<label class="langopt"><input type="radio" name="lang" value="${l}" ${l === st.lang ? "checked" : ""}><span>${LANG_LABELS[l]}</span></label>`).join("")}</div>
        </fieldset>
        <label for="nm">${esc(t("name_label"))}</label>
        <input id="nm" autocomplete="name" autocapitalize="words" maxlength="60" value="${esc(st.name)}">
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
      st.lang = r.value; st.name = $("#nm").value; st.code = $("#cc").value;
      if (getLang() === "el") setTrLang(st.lang); else setLang(st.lang);
      rememberLang(); draw();
    }));
    bindLangPill(root, (l) => {
      st.name = $("#nm").value; st.code = $("#cc").value;
      setLang(l);
      if (l !== "el") st.lang = l;
      rememberLang(); draw();
    });
    $("#nm").addEventListener("blur", () => { $("#nm").value = nameCase($("#nm").value); });
    $("#cc").addEventListener("change", () => { st.code = $("#cc").value.trim(); st.name = $("#nm").value; peek(); });
    $("#of").onsubmit = async (e) => {
      e.preventDefault();
      st.name = nameCase($("#nm").value);
      st.code = $("#cc").value.trim();
      if (!st.lang) { st.err = t("choose_lang_needed"); return draw(); }
      st.busy = true; st.err = ""; draw();
      try {
        if (st.code) {
          const { data, error } = await sb.rpc("join_group", { p_code: st.code });
          if (error) { st.err = /invalid_code/.test(error.message) ? t("code_wrong") : t("error_generic"); st.busy = false; return draw(); }
          if (data?.[0]) toast(t("joined", { name: data[0].name }));
        }
        await saveProfile({ native_lang: st.lang, display_name: st.name || S.profile?.display_name || null, onboarded: true,
          settings: { ...S.settings, uiLang: getLang() === "el" ? "el" : "native" } });
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
