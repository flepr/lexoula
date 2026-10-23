// Écran de connexion : Google, Microsoft ou code reçu par e-mail
import { sb } from "../supabase.js";
import { t } from "../i18n.js";
import { $, esc } from "../util.js";

const redirectTo = () => window.location.origin + window.location.pathname;

export function renderLogin(root, { invite }) {
  const st = { step: "start", email: "", busy: false, err: "" };

  const draw = () => {
    root.innerHTML = `<div class="login">
      <div class="login-brand">
        <h1 class="logo" lang="el">Λεξούλα</h1>
        <p class="tagline">${esc(t("tagline"))}</p>
      </div>
      ${invite ? `<div class="card stack invite"><span class="invite-title">${esc(t("invited_to", { name: invite.name }))}</span>${invite.teacher ? `<span class="muted small">${esc(t("teacher"))} : ${esc(invite.teacher)}${invite.level ? " · " + esc(invite.level) : ""}</span>` : ""}</div>` : ""}
      <div class="login-box card">
        ${st.step === "start" ? `
          <button class="btn sso" id="g"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8.1z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>${esc(t("continue_google"))}</button>
          <button class="btn sso" id="m"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#F25022" d="M2 2h9.5v9.5H2z"/><path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z"/><path fill="#00A4EF" d="M2 12.5h9.5V22H2z"/><path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z"/></svg>${esc(t("continue_microsoft"))}</button>
          <div class="sep"><span>${esc(t("or_email"))}</span></div>
          <form id="ef" class="stack" novalidate>
            <label for="em">${esc(t("email_label"))}</label>
            <input id="em" type="email" inputmode="email" autocomplete="email" autocapitalize="off" value="${esc(st.email)}" required>
            <button class="btn" type="submit" ${st.busy ? "disabled" : ""}>${esc(t("send_code"))}</button>
          </form>` : `
          <form id="cf" class="stack" novalidate>
            <p class="small">${esc(t("code_sent", { email: st.email }))}</p>
            <label for="cd">${esc(t("code_label"))}</label>
            <input id="cd" class="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="8" required>
            <button class="btn" type="submit" ${st.busy ? "disabled" : ""}>${esc(t("verify"))}</button>
            <button class="link" type="button" id="back">${esc(t("change_email"))}</button>
          </form>`}
        ${st.err ? `<p class="err" role="alert">${esc(st.err)}</p>` : ""}
      </div>
      <p class="muted small center">${esc(t("privacy_short"))} <a href="privacy.html">${esc(t("privacy_link"))}</a></p>
      <p class="credit">${esc(t("credit"))}</p>
    </div>`;

    if (st.step === "start") {
      $("#g").onclick = () => sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
      $("#m").onclick = () => sb.auth.signInWithOAuth({ provider: "azure", options: { redirectTo: redirectTo(), scopes: "email openid profile" } });
      $("#ef").onsubmit = async (e) => {
        e.preventDefault();
        const email = $("#em").value.trim().toLowerCase();
        st.email = email;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { st.err = t("email_invalid"); return draw(); }
        st.busy = true; st.err = ""; draw();
        const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: redirectTo() } });
        st.busy = false;
        if (error) { console.warn(error); st.err = t("send_failed"); return draw(); }
        st.step = "code"; draw();
        setTimeout(() => $("#cd")?.focus(), 50);
      };
    } else {
      $("#back").onclick = () => { st.step = "start"; st.err = ""; draw(); };
      $("#cf").onsubmit = async (e) => {
        e.preventDefault();
        const token = $("#cd").value.replace(/\D/g, "");
        if (token.length < 6) { st.err = t("code_invalid"); return draw(); }
        st.busy = true; st.err = ""; draw();
        const { error } = await sb.auth.verifyOtp({ email: st.email, token, type: "email" });
        st.busy = false;
        if (error) { console.warn(error); st.err = t("code_invalid"); draw(); }
        // en cas de succès, onAuthStateChange prend le relais
      };
    }
  };
  draw();
}
