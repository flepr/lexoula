// Espace professeur et administration
import QRCode from "qrcode";
import { sb } from "../supabase.js";
import { S, isAdmin, loadGroups, loadLists, loadTexts, loadWords } from "../store.js";
import { t, LOCALES, getLang } from "../i18n.js";
import { $, esc, today, toast, confirmBox, parseWordLines, nameCase } from "../util.js";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString(LOCALES[getLang()], { day: "numeric", month: "short", year: "numeric" }) : "—");
const inviteUrl = (code) => `${location.origin}${location.pathname}?join=${encodeURIComponent(code)}`;
const errMsg = (e) => (/forbidden/.test(e?.message || "") ? t("forbidden") : /already_running/.test(e?.message || "") ? t("already_running") : t("error_generic"));

export async function renderTeacher(el) {
  const gid = S.teacher.groupId;
  const g = gid && S.groups.find((x) => x.id === gid);
  if (g) return renderGroup(el, g);
  const mine = S.groups.filter((x) => x.teacher_id === S.user.id || isAdmin());
  el.innerHTML = `
    <div><h2>${esc(t("my_groups"))}</h2></div>
    ${mine.map((x) => `<button class="card tcard" data-g="${esc(x.id)}">
      <div class="meta"><span class="badge">${esc(x.level || "—")}</span>${esc(x.kind === "individual" ? t("kind_individual") : t("kind_group"))}${x.archived ? " · 🗄" : ""}</div>
      <span class="t">${esc(x.name)}</span>
      <span class="muted small">${esc(t("class_code"))} : <b class="mono">${esc(x.invite_code)}</b></span></button>`).join("")}
    <details class="card" ${mine.length ? "" : "open"}><summary>${esc(t("new_group"))}</summary>
      <form id="ng" class="stack" novalidate>
        <label for="gn">${esc(t("group_name"))}</label><input id="gn" maxlength="120" placeholder="Ομαδικό Β2 φθινόπωρο 2026" required>
        <div class="grid2">
          <div class="stack"><label for="gl">${esc(t("level"))}</label><select id="gl">${LEVELS.map((l) => `<option ${l === "B1" ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          <div class="stack"><label for="gk">${esc(t("kind_group"))} / ${esc(t("kind_individual"))}</label><select id="gk"><option value="group">${esc(t("kind_group"))}</option><option value="individual">${esc(t("kind_individual"))}</option></select></div>
        </div>
        <button class="btn" type="submit">${esc(t("create"))}</button>
      </form></details>
    ${isAdmin() ? `<div id="adm"></div>` : ""}`;
  el.onclick = (e) => { const b = e.target.closest("[data-g]"); if (b) { S.teacher.groupId = b.dataset.g; renderTeacher(el); window.scrollTo(0, 0); } };
  $("#ng").onsubmit = async (e) => {
    e.preventDefault();
    const name = $("#gn").value.trim();
    if (!name) return $("#gn").focus();
    const { data, error } = await sb.rpc("create_group", { p_name: name, p_level: $("#gl").value, p_kind: $("#gk").value });
    if (error) return toast(errMsg(error));
    await loadGroups();
    S.teacher.groupId = data;
    renderTeacher(el);
  };
  if (isAdmin()) renderAdmin($("#adm"));
}

async function renderGroup(el, g) {
  const lists = S.lists.filter((l) => l.group_id === g.id);
  const texts = S.texts.filter((x) => x.group_id === g.id);
  const url = inviteUrl(g.invite_code);
  el.innerHTML = `
    <button class="link" id="gback">${esc(t("back"))}</button>
    <div><span class="eyebrow">${esc(g.level || "")} · ${esc(g.kind === "individual" ? t("kind_individual") : t("kind_group"))}</span><h2>${esc(g.name)}</h2></div>

    <div class="card stack">
      <span class="eyebrow">${esc(t("invite_link"))}</span>
      <div class="invite-row"><code class="mono" id="iurl">${esc(url)}</code><button class="btn small" id="copy">${esc(t("copy"))}</button></div>
      <div class="invite-codes">
        <div class="stack-s"><div class="qr" id="qr" aria-label="QR"></div><span class="muted small">${esc(t("qr_help"))}</span></div>
        <div class="class-code"><span class="eyebrow">${esc(t("class_code"))}</span><b class="mono">${esc(g.invite_code)}</b></div>
      </div>
      <div><button class="btn ghost small" id="regen">${esc(t("new_code"))}</button></div>
    </div>

    <div class="card stack">
      <span class="eyebrow">${esc(t("add_list"))}</span>
      <form id="lf" class="stack" novalidate>
        <div class="grid2">
          <div class="stack"><label for="lt">${esc(t("lesson_title"))}</label><input id="lt" maxlength="80" value="Μάθημα ${lists.length + 1}"></div>
          <div class="stack"><label for="ld">${esc(t("lesson_date"))}</label><input id="ld" type="date" value="${today()}"></div>
        </div>
        <label for="lw">${esc(t("words_input"))}</label>
        <textarea id="lw" rows="9" lang="el" spellcheck="false" placeholder="ο πατριός\nη μητριά - stepmother\nυιοθετώ"></textarea>
        <span class="muted small">${esc(t("words_help"))}</span>
        <div class="toolbar"><span class="muted small" id="ln"></span><button class="btn" type="submit">${esc(t("send"))}</button></div>
      </form>
    </div>

    <div class="card stack"><span class="eyebrow">${esc(t("lists"))}</span>
      ${lists.map((l) => `<div class="setting"><span><b>${esc(l.title)}</b> · ${esc(fmtDate(l.lesson_date))}<br>
        <span class="muted small">${l.ready}/${l.total} ${esc(l.ready + l.failed >= l.total ? t("status_ready") : t("status_preparing"))}${l.failed ? ` · <span class="errtext">${esc(t("status_errors", { n: l.failed }))}</span>` : ""}</span></span>
        <span class="inline">${l.failed ? `<button class="btn small ghost" data-retry="${esc(l.id)}">${esc(t("retry"))}</button>` : ""}<button class="btn small ghost dangertext" data-dellist="${esc(l.id)}">${esc(t("delete"))}</button></span></div>`).join("") || `<p class="muted small">—</p>`}
    </div>

    <div class="card stack"><span class="eyebrow">${esc(t("texts_tab"))}</span>
      <div class="btnrow"><button class="btn ghost small" data-gen="short">${esc(t("gen_short"))}</button><button class="btn ghost small" data-gen="long">${esc(t("gen_long"))}</button></div>
      ${texts.map((x) => `<div class="setting"><span><b lang="el">${esc(x.title)}</b><br><span class="muted small">${esc(x.kind === "long" ? t("long_text") : t("short_text"))} · ${esc(fmtDate(x.created_at))}${x.status !== "ready" ? " · " + esc(t("text_preparing")) : ""}</span></span>
        <button class="btn small ghost dangertext" data-deltext="${esc(x.id)}">${esc(t("delete"))}</button></div>`).join("")}
    </div>

    <div class="card stack"><span class="eyebrow">${esc(t("students"))}</span><div id="studs" class="muted small">${esc(t("loading"))}</div></div>
    <div class="card stack"><span class="eyebrow">${esc(t("hard_words"))}</span><div id="hard" class="muted small">${esc(t("loading"))}</div></div>

    <details class="card"><summary>${esc(t("group_settings"))}</summary>
      <form id="gs" class="stack" novalidate>
        <label for="sn">${esc(t("group_name"))}</label><input id="sn" maxlength="120" value="${esc(g.name)}">
        ${isAdmin() ? `<label for="stc">${esc(t("group_teacher"))}</label><select id="stc"><option>${esc(t("loading"))}</option></select>` : ""}
        <label for="sl">${esc(t("level"))}</label><select id="sl">${LEVELS.map((l) => `<option ${l === g.level ? "selected" : ""}>${l}</option>`).join("")}</select>
        <label class="setting switch"><span>${esc(t("texts_auto"))}</span><input type="checkbox" id="sta" ${g.texts_enabled ? "checked" : ""}></label>
        <label class="setting switch"><span>${esc(t("archive"))}</span><input type="checkbox" id="sar" ${g.archived ? "checked" : ""}></label>
        <button class="btn" type="submit">${esc(t("save"))}</button>
      </form></details>`;

  $("#gback").onclick = () => { S.teacher.groupId = null; renderTeacher(el); };
  if (isAdmin()) fillTeacherSelect(g);
  QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#1B231E", light: "#FFFFFF" } }).then((svg) => { const q = $("#qr"); if (q) q.innerHTML = svg; }).catch(() => {});
  $("#copy").onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast(t("copied")); }
    catch { const r = document.createRange(); r.selectNodeContents($("#iurl")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  };
  $("#regen").onclick = async () => {
    if (!(await confirmBox(t("new_code_confirm"), t("new_code"), t("cancel")))) return;
    const { error } = await sb.rpc("regenerate_invite", { p_group: g.id });
    if (error) return toast(errMsg(error));
    await loadGroups();
    renderTeacher(el);
  };
  const lw = $("#lw"), ln = $("#ln");
  lw.addEventListener("input", () => (ln.textContent = t("n_lines", { n: parseWordLines(lw.value).length })));
  $("#lf").onsubmit = async (e) => {
    e.preventDefault();
    const items = parseWordLines(lw.value);
    if (!items.length) return lw.focus();
    const btn = e.submitter; if (btn) btn.disabled = true;
    const { error } = await sb.rpc("submit_list", { p_group: g.id, p_title: $("#lt").value.trim() || "Μάθημα", p_date: $("#ld").value || today(), p_items: items });
    if (btn) btn.disabled = false;
    if (error) return toast(errMsg(error));
    toast(t("list_added"));
    await Promise.all([loadLists(), loadWords()]);
    renderTeacher(el);
  };
  el.querySelectorAll("[data-retry]").forEach((b) => (b.onclick = async () => {
    const { error } = await sb.rpc("retry_list", { p_list: b.dataset.retry });
    if (error) return toast(errMsg(error));
    await loadLists(); renderTeacher(el);
  }));
  el.querySelectorAll("[data-dellist]").forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox(t("delete") + " ?", t("delete"), t("cancel")))) return;
    const { error } = await sb.from("lists").delete().eq("id", b.dataset.dellist);
    if (error) return toast(errMsg(error));
    await Promise.all([loadLists(), loadWords()]); renderTeacher(el);
  }));
  el.querySelectorAll("[data-gen]").forEach((b) => (b.onclick = async () => {
    const { error } = await sb.rpc("request_text", { p_group: g.id, p_kind: b.dataset.gen });
    toast(error ? errMsg(error) : t("text_requested"));
  }));
  el.querySelectorAll("[data-deltext]").forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox(t("delete") + " ?", t("delete"), t("cancel")))) return;
    const { error } = await sb.from("texts").delete().eq("id", b.dataset.deltext);
    if (error) return toast(errMsg(error));
    await loadTexts(); renderTeacher(el);
  }));
  $("#gs").onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from("groups").update({
      name: $("#sn").value.trim() || g.name, level: $("#sl").value, texts_enabled: $("#sta").checked, archived: $("#sar").checked,
    }).eq("id", g.id);
    if (error) return toast(errMsg(error));
    toast(t("saved")); await loadGroups(); renderTeacher(el);
  };

  // élèves et mots difficiles
  const [{ data: studs, error: e1 }, { data: hard, error: e2 }] = await Promise.all([
    sb.rpc("group_overview", { p_group: g.id }),
    sb.rpc("group_hard_words", { p_group: g.id, p_limit: 15 }),
  ]);
  const sbox = $("#studs"), hbox = $("#hard");
  if (!sbox) return;
  sbox.innerHTML = e1 ? esc(t("error_generic")) : !studs?.length ? esc(t("no_students")) : `<div class="tablewrap"><table class="tbl">
    <thead><tr><th>${esc(t("name_label"))}</th><th>${esc(t("seen"))}</th><th>${esc(t("acquired"))}</th><th>★</th><th>${esc(t("last30"))}</th><th>${esc(t("last_active"))}</th><th></th></tr></thead>
    <tbody>${studs.map((s) => `<tr><td>${esc(s.display_name || s.email || "—")}</td>${s.shares
      ? `<td>${s.words_seen}</td><td>${s.words_acquired}</td><td>${s.starred}</td><td>${s.answers_30d ? Math.round((s.success_30d / s.answers_30d) * 100) + " %" : "—"} <span class="muted">(${s.answers_30d})</span></td><td>${esc(fmtDate(s.last_active))}</td>`
      : `<td colspan="5" class="muted">${esc(t("not_shared"))}</td>`}<td><button class="btn small ghost" data-edstud="${esc(s.user_id)}">${esc(t("edit"))}</button></td></tr>`).join("")}</tbody></table></div>`;
  sbox.querySelectorAll("[data-edstud]").forEach((b) => (b.onclick = async () => {
    const { data: list, error } = await sb.rpc("staff_list_students");
    if (error) return toast(errMsg(error));
    const u = (list || []).find((x) => x.id === b.dataset.edstud);
    if (u) editUser(u, async () => { await loadGroups(); renderTeacher(el); });
  }));
  hbox.innerHTML = e2 ? esc(t("error_generic")) : !hard?.length ? "—" : `<div class="wordchips">${hard.map((h) => `<span lang="el" title="★ ${h.stars} · ✗ ${h.errors}">${esc(h.data?.gr || "")} <small class="muted">★${h.stars} ✗${h.errors}</small></span>`).join("")}</div>`;
}

// administrateur : choisir le professeur responsable de la classe
async function fillTeacherSelect(g) {
  const sel = $("#stc");
  if (!sel) return;
  const { data, error } = await sb.rpc("admin_list_users");
  if (error) { sel.innerHTML = `<option>${esc(t("error_generic"))}</option>`; return; }
  const staff = (data || []).filter((u) => u.role === "teacher" || u.role === "admin");
  sel.innerHTML = staff.map((u) => `<option value="${esc(u.id)}" ${u.id === g.teacher_id ? "selected" : ""}>${esc((u.display_name || "—") + " · " + (u.email || ""))}</option>`).join("");
  sel.onchange = async () => {
    const { error: err } = await sb.rpc("admin_set_teacher", { p_group: g.id, p_user: sel.value });
    if (err) return toast(errMsg(err));
    g.teacher_id = sel.value;
    await loadGroups();
    toast(t("saved"));
  };
}

async function renderAdmin(box) {
  box.innerHTML = `<div class="card stack"><span class="eyebrow">${esc(t("admin"))} · ${esc(t("users"))}</span><div id="ul" class="muted small">${esc(t("loading"))}</div></div>`;
  const { data, error } = await sb.rpc("admin_list_users");
  const ul = box.querySelector("#ul");
  if (error) { ul.textContent = t("error_generic"); return; }
  const users = data || [];
  const roles = [["student", t("role_student")], ["teacher", t("role_teacher")], ["admin", t("role_admin")]];
  ul.innerHTML = `<div class="tablewrap"><table class="tbl"><thead><tr><th>${esc(t("name_label"))}</th><th>E-mail</th><th>${esc(t("classes"))}</th><th></th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr><td>${esc(u.display_name || "—")}</td><td class="mono small">${esc(u.email || "")}</td><td class="small">${esc(u.groups || "—")}</td>
      <td><select data-role="${esc(u.id)}" ${u.id === S.user.id ? "disabled" : ""}>${roles.map(([v, l]) => `<option value="${v}" ${v === u.role ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></td>
      <td><button class="btn small ghost" data-edit="${esc(u.id)}">${esc(t("edit"))}</button></td></tr>`).join("")}
  </tbody></table></div>`;
  ul.querySelectorAll("[data-role]").forEach((s) => (s.onchange = async () => {
    const { error: err } = await sb.rpc("admin_set_role", { p_user: s.dataset.role, p_role: s.value });
    toast(err ? errMsg(err) : t("saved"));
  }));
  ul.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => {
    const u = users.find((x) => x.id === b.dataset.edit);
    if (u) editUser(u, () => renderAdmin(box));
  }));
}

// professeur ou administrateur : nom et classes d'un élève
// (un professeur ne voit et ne coche que ses propres classes ; le serveur applique la même règle)
function editUser(u, after) {
  const root = $("#sheet-root");
  const mine = new Set(u.group_ids || []);
  const groups = S.groups.filter((g) => isAdmin() || g.teacher_id === S.user.id).sort((a, b) => a.name.localeCompare(b.name));
  root.innerHTML = `<div class="sheet-bg" id="ubg"></div><div class="sheet" role="dialog" aria-label="${esc(t("edit"))}"><form class="wrap stack" id="uf" novalidate>
    <span class="eyebrow">${esc(u.email || "")}</span>
    <label for="un">${esc(t("name_label"))}</label>
    <input id="un" maxlength="60" autocapitalize="words" value="${esc(u.display_name || "")}">
    <span class="eyebrow">${esc(t("classes"))}</span>
    ${groups.length ? groups.map((g) => `<label class="setting switch"><span>${esc(g.name)}${g.level ? ` · ${esc(g.level)}` : ""}${g.archived ? " · 🗄" : ""}</span>
      <input type="checkbox" value="${esc(g.id)}" ${mine.has(g.id) ? "checked" : ""}></label>`).join("") : `<p class="muted small">${esc(t("no_groups_yet"))}</p>`}
    <div class="btnrow"><button class="btn" type="submit">${esc(t("save"))}</button><button class="btn ghost" type="button" id="ucancel">${esc(t("cancel"))}</button></div>
  </form></div>`;
  const close = () => (root.innerHTML = "");
  $("#ubg").onclick = close;
  $("#ucancel").onclick = close;
  $("#uf").onsubmit = async (e) => {
    e.preventDefault();
    const name = nameCase($("#un").value);
    const ids = [...root.querySelectorAll('input[type="checkbox"]:checked')].map((c) => c.value);
    const [r1, r2] = await Promise.all([
      name !== (u.display_name || "") ? sb.rpc("set_student_name", { p_user: u.id, p_name: name }) : { error: null },
      sb.rpc("set_student_groups", { p_user: u.id, p_groups: ids }),
    ]);
    if (r1.error || r2.error) return toast(errMsg(r1.error || r2.error));
    close();
    toast(t("saved"));
    if (u.id === S.user.id) await Promise.all([loadGroups(), loadWords(), loadLists()]);
    after();
  };
}

