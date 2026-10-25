// Vues élève : aujourd'hui, vocabulaire, lecture, progrès et réglages
import { sb } from "../supabase.js";
import { S, level, isStar, dueInfo, markKnown, streakCount, latestAdded, saveProfile, loadWords, loadLists, loadGroups, isStaff } from "../store.js";
import { t, pick, LANGS, LANG_LABELS, LOCALES, getLang, setLang } from "../i18n.js";
import { THEME_IDS, themeName, themeGr } from "../themes.js";
import { $, esc, today, addDays, stripAcc, toast, confirmBox, parseWordLines, creditHtml, nameCase } from "../util.js";
import { costBox, wireCost } from "../cost.js";
import { TTS, say, stopSpeech } from "../tts.js";
import { showKbHelp } from "../keyboard.js";
import { headword, meaning, speakForm, sayBtn, starBtn } from "../ui.js";
import { startSession } from "../session.js";
import { installCard, bindInstallCard, installSettingsCard, bindInstallSettings } from "../install.js";

const LEVELS = [
  { k: "new", key: "lv_new", c: "var(--lv-new)" },
  { k: "weak", key: "lv_weak", c: "var(--lv-weak)" },
  { k: "mid", key: "lv_mid", c: "var(--lv-mid)" },
  { k: "ok", key: "lv_ok", c: "var(--lv-ok)" },
];
const fmtDate = (d, opts = { day: "numeric", month: "short" }) =>
  d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString(LOCALES[getLang()], opts) : "";

let nav = () => {};
export const setNavigator = (fn) => (nav = fn);

// ───────────────────────────────── aujourd'hui
export function renderHome(el) {
  const h = new Date().getHours();
  // pas de prénom : il faudrait le vocatif grec (Φοίβος → Φοίβο), impossible à déduire de façon fiable
  const hello = h < 12 ? "Καλημέρα!" : h < 18 ? "Γεια σου!" : "Καλησπέρα!";
  const { due, fresh } = dueInfo();
  const size = S.settings.size || 15;
  const done = S.activity.get(today());
  const last = latestAdded();
  const newest = S.words.filter((w) => w.added === last);
  const starred = S.words.filter((w) => isStar(w.id));
  const days14 = Array.from({ length: 14 }, (_, i) => addDays(today(), i - 13));
  const txt = S.texts.find((x) => x.status === "ready");
  const noGroup = !S.memberOf?.size && !isStaff();

  el.innerHTML = `
    <div><span class="eyebrow">${esc(new Date().toLocaleDateString(LOCALES[getLang()], { weekday: "long", day: "numeric", month: "long" }))}</span>
    <p class="hello" lang="el">${esc(hello)}</p></div>
    ${installCard()}
    ${S.pending ? `<p class="notice">${esc(t("preparing", { n: S.pending }))}</p>` : ""}
    ${S.words.length ? `
    <div class="card today">
      <span class="eyebrow">${esc(t("session_card"))} · ${esc(t("n_questions", { n: size, m: Math.round(size * 0.7) }))}</span>
      <div class="nums">
        <div class="num"><b>${due}</b><span>${esc(t("to_review"))}</span></div>
        <div class="num"><b>${fresh}</b><span>${esc(t("never_seen"))}</span></div>
        <div class="num"><b>${done ? done.n : 0}</b><span>${esc(t("answers_today"))}</span></div>
      </div>
      <button class="btn" id="start">${esc(done ? t("again") : t("start"))}</button>
      <div class="days" aria-label="${esc(t("last14"))}">${days14.map((d) => `<i class="day${S.activity.get(d)?.n > 0 ? " on" : ""}${d === today() ? " today" : ""}" title="${esc(fmtDate(d))}"></i>`).join("")}</div>
    </div>
    <div class="card stack">
      <div class="toolbar"><span class="eyebrow">${esc(t("latest_list"))} · ${esc(fmtDate(last))} · ${newest.length}</span><button class="link" id="see-new">${esc(t("see_list"))}</button></div>
      <div class="wordchips">${newest.slice(0, 14).map((w) => `<span lang="el">${esc(headword(w))}</span>`).join("")}${newest.length > 14 ? `<span class="muted">+${newest.length - 14}</span>` : ""}</div>
    </div>
    <div class="card stack starcard">
      <span class="eyebrow">${esc(t("star_title"))} · ${starred.length}</span>
      ${starred.length ? `<div class="wordchips">${starred.slice(0, 12).map((w) => `<span lang="el">${esc(headword(w))}</span>`).join("")}${starred.length > 12 ? `<span class="muted">+${starred.length - 12}</span>` : ""}</div>
      <div class="btnrow"><button class="btn" id="starsess">${esc(t("review_these"))}</button><button class="btn ghost" id="starlist">${esc(t("see_list"))}</button></div>`
      : `<p class="muted small">${esc(t("star_empty"))}</p>`}
    </div>
    ${txt ? textCard(txt, "open-last") : ""}` : (noGroup ? "" : `<div class="card"><p class="muted">${esc(t("no_words"))}</p></div>`)}`;

  $("#start")?.addEventListener("click", () => startSession());
  $("#see-new")?.addEventListener("click", () => { S.lex.filter = "week"; nav("words"); });
  $("#starsess")?.addEventListener("click", () => startSession({ star: true }));
  $("#starlist")?.addEventListener("click", () => { S.lex.filter = "star"; nav("words"); });
  $("#open-last")?.addEventListener("click", () => { S.reading = txt.id; nav("read"); });
  bindJoin(el);
  bindInstallCard(el);
}

function bindJoin(el) {
  const f = el.querySelector("#jf");
  if (!f) return;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const code = f.querySelector("#jc").value.trim();
    const err = el.querySelector("#jerr");
    const showErr = (m) => { err.textContent = m; err.hidden = false; };
    if (!code) { showErr(t("code_empty")); return f.querySelector("#jc").focus(); }
    const { data, error } = await sb.rpc("join_group", { p_code: code });
    if (error) return showErr(/invalid_code/.test(error.message) ? t("code_wrong") : t("error_generic"));
    toast(t("joined", { name: data?.[0]?.name || "" }));
    await Promise.all([loadGroups(), loadWords(), loadLists()]);
    nav(S.view);
  };
}

function textCard(x, id) {
  return `<button class="card tcard" ${id ? `id="${id}"` : `data-t="${esc(x.id)}"`}>
    <div class="meta"><span class="badge ${x.kind === "long" ? "long" : ""}">${esc(x.kind === "long" ? t("long_text") : t("short_text"))}</span>${esc(fmtDate(x.created_at))} · ${esc(t("n_lesson_words", { n: x.word_ids?.length || 0 }))}</div>
    <span class="t" lang="el">${esc(x.title)}</span><span class="muted">${esc(pick(x.title_tr))}</span></button>`;
}

// ───────────────────────────────── vocabulaire
export function renderWords(el) {
  const last = latestAdded();
  const counts = {
    all: S.words.length,
    star: S.words.filter((w) => isStar(w.id)).length,
    week: S.words.filter((w) => w.added === last).length,
    weak: S.words.filter((w) => level(w.id) === "weak").length,
  };
  const used = new Set(S.words.map((w) => w.th));
  const chips = [["all", t("all")], ["star", t("starred")], ["week", t("latest_list")], ["weak", t("weak")],
    ...THEME_IDS.filter((id) => used.has(id)).map((id) => [id, themeName(id)])];
  el.innerHTML = `
    <div class="stack">
      <input id="lexq" class="search" type="search" placeholder="${esc(t("search"))}" value="${esc(S.lex.q)}" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="chips" role="group">${chips.map(([k, l]) => `<button class="chip" data-f="${esc(k)}" aria-pressed="${S.lex.filter === k}">${esc(l)}${counts[k] != null ? `<span class="c">${counts[k]}</span>` : ""}</button>`).join("")}</div>
      <div class="toolbar"><span class="muted small" id="lexcount"></span>
        <label class="toggle"><input type="checkbox" id="lexex" ${S.lex.examples ? "checked" : ""}> ${esc(t("show_examples"))}</label></div>
    </div>
    <div id="lexlist"></div>
    <details class="card addwords" id="addw"><summary>${esc(t("add_my_words"))}</summary>
      <form id="pf" class="stack" novalidate>
        <label for="pt">${esc(t("list_title"))}</label><input id="pt" maxlength="80" value="${esc(fmtDate(today(), { day: "numeric", month: "long" }))}">
        <label for="pw">${esc(t("words_input"))}</label><textarea id="pw" rows="7" lang="el" spellcheck="false"></textarea>
        <span class="muted small">${esc(t("words_help"))}</span>
        ${costBox()}
        <div class="toolbar"><span class="muted small" id="pn"></span><button class="btn small" type="submit">${esc(t("submit_list"))}</button></div>
      </form></details>`;
  $("#lexq").addEventListener("input", (e) => { S.lex.q = e.target.value; drawList(); });
  el.querySelector(".chips").addEventListener("click", (e) => { const c = e.target.closest("[data-f]"); if (!c) return; S.lex.filter = c.dataset.f; renderWords(el); });
  $("#lexex").addEventListener("change", (e) => { S.lex.examples = e.target.checked; drawList(); });
  const pw = $("#pw"), pn = $("#pn");
  pw.addEventListener("input", () => { pn.textContent = t("n_lines", { n: parseWordLines(pw.value).length }); });
  const wantsFast = wireCost(pw, null);
  $("#pf").onsubmit = async (e) => {
    e.preventDefault();
    const items = parseWordLines(pw.value);
    if (!items.length) return;
    const { error } = await sb.rpc("submit_list", { p_group: null, p_title: $("#pt").value.trim() || "—", p_date: today(), p_items: items, p_fast: wantsFast() });
    if (error) return toast(/weekly_limit/.test(error.message) ? t("weekly_limit") : t("error_generic"));
    toast(t("list_sent"));
    pw.value = ""; pn.textContent = "";
    await loadWords();
    renderWords(el);
  };
  drawList();
}

function drawList() {
  const last = latestAdded(), f = S.lex.filter, q = stripAcc(S.lex.q.trim().toLocaleLowerCase());
  const list = S.words.filter((w) => {
    if (f === "week" && w.added !== last) return false;
    if (f === "weak" && level(w.id) !== "weak") return false;
    if (f === "star" && !isStar(w.id)) return false;
    if (!["all", "week", "weak", "star"].includes(f) && w.th !== f) return false;
    if (q) {
      const hay = stripAcc(`${w.gr} ${meaning(w)} ${w.forms || ""} ${(w.ans || []).join(" ")}`.toLocaleLowerCase());
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  $("#lexcount").textContent = t("n_words", { n: list.length });
  const groups = THEME_IDS.map((id) => ({ id, ws: list.filter((w) => (THEME_IDS.includes(w.th) ? w.th : "ideas") === id) }))
    .filter((g) => g.ws.length);
  const html = groups.map((g) => `<div class="group">
      <div class="ghead"><div><h3>${esc(themeName(g.id))}</h3><span class="g" lang="el">${esc(themeGr(g.id))}</span></div><span class="n">${g.ws.length}</span></div>
      ${g.ws.sort((a, b) => headword(a).localeCompare(headword(b), "el")).map(rowHTML).join("")}</div>`).join("");
  const box = $("#lexlist");
  box.innerHTML = html || `<p class="muted pad">${esc(f === "star" && !q ? t("star_empty") : t("none_match"))}</p>`;
  box.onclick = (e) => {
    const a = e.target.closest("[data-act]");
    if (a) { markKnown(a.dataset.id, a.dataset.act === "known"); toast(a.dataset.act === "known" ? t("removed_from_review") : t("back_in_review")); drawList(); return; }
    const r = e.target.closest(".row");
    if (!r || e.target.closest("button")) return;
    S.lex.open = S.lex.open === r.dataset.id ? null : r.dataset.id;
    drawList();
  };
}

function rowHTML(w) {
  const lv = LEVELS.find((l) => l.k === level(w.id));
  const p = S.progress.get(w.id);
  const open = S.lex.examples || S.lex.open === w.id;
  const note = pick(w.note);
  return `<div class="row" data-id="${esc(w.id)}" tabindex="0">
    <span class="dot" style="background:${lv.c}" title="${esc(t(lv.key))}"></span>
    <div class="main">
      <div class="hw" lang="el">${esc(w.gr)}${w.added === latestAdded() ? `<span class="newtag">${esc(t("new_badge"))}</span>` : ""}${w.personal ? `<span class="newtag soft">${esc(t("personal_badge"))}</span>` : ""}</div>
      <div class="fr">${esc(meaning(w))}</div>
      ${w.forms ? `<div class="forms" lang="el">${esc(w.forms)}</div>` : ""}
      ${note ? `<div class="note">${esc(note)}</div>` : ""}
    </div>
    <div class="ra">${sayBtn(speakForm(w))}${starBtn(w.id)}</div>
    ${open ? `<div class="more">
      ${w.ex ? `<div class="exrow"><div><div class="ex" lang="el">${esc(w.ex)}</div><div class="exfr">${esc(pick(w.exTr))}</div></div>${sayBtn(w.ex)}</div>` : ""}
      <div class="acts">${p?.known ? `<button class="btn ghost small" data-act="unknown" data-id="${esc(w.id)}">${esc(t("back_to_review"))}</button>` : `<button class="btn ghost small" data-act="known" data-id="${esc(w.id)}">${esc(t("i_know"))}</button>`}</div>
    </div>` : ""}
  </div>`;
}

export function refreshWordList() { if ($("#lexlist")) drawList(); }

// ───────────────────────────────── lecture
export function renderTexts(el) {
  const x = S.reading && S.texts.find((tx) => tx.id === S.reading);
  if (x) return renderReader(el, x);
  const ready = S.texts.filter((tx) => tx.status === "ready");
  if (!ready.length) { el.innerHTML = `<div class="card"><p class="muted">${esc(t("no_texts"))}</p></div>`; return; }
  el.innerHTML = `<div><h2>${esc(t("texts_title"))}</h2><p class="muted">${esc(t("texts_help"))}</p></div>
    ${ready.map((tx) => textCard(tx)).join("")}`;
  el.onclick = (e) => { const b = e.target.closest("[data-t]"); if (b) { S.reading = b.dataset.t; renderTexts(el); window.scrollTo(0, 0); } };
}

function markup(gr) {
  return esc(gr).replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, (m, a, id) =>
    S.byId.has(id) ? `<button class="vw${isStar(id) ? " st" : ""}" data-w="${id}">${a}</button>` : a);
}
const plain = (gr) => gr.replace(/\[\[([^|\]]+)\|[^\]]+\]\]/g, "$1");

function renderReader(el, x) {
  if (S.rd.id !== x.id) { stopSpeech(); S.rd = { id: x.id, all: false, open: new Set(), playing: null }; }
  const R = S.rd, shown = (i) => R.all || R.open.has(i);
  el.innerHTML = `<div class="reader">
    <button class="link" id="rback">${esc(t("all_texts"))}</button>
    <div><div class="meta"><span class="badge ${x.kind === "long" ? "long" : ""}">${esc(x.kind === "long" ? t("long_text") : t("short_text"))}</span>${esc(fmtDate(x.created_at))}</div>
    <h2 lang="el" class="rtitle">${esc(x.title)}</h2><p class="muted">${esc(pick(x.title_tr))}</p></div>
    <div class="toolbar"><button class="btn ghost small" id="rall">${esc(R.all ? t("hide_translations") : t("translate_all"))}</button></div>
    ${x.paragraphs.map((p, i) => `<div class="para">
      <p lang="el">${markup(p.gr)}</p>
      ${shown(i) ? `<div class="tr">${esc(pick(p.tr))}</div>` : ""}
      <div class="ptools">${TTS.ok ? `<button data-pl="${i}" aria-pressed="${R.playing === i}">${esc(R.playing === i ? "■ " + t("stop") : t("listen"))}</button>` : ""}<button data-pt="${i}">${esc(shown(i) ? t("hide") : t("translation"))}</button></div>
    </div>`).join("")}
  </div>`;
  $("#rback").onclick = () => { stopSpeech(); R.playing = null; S.reading = null; renderTexts(el); window.scrollTo(0, 0); };
  const playLabels = () => el.querySelectorAll("[data-pl]").forEach((b) => {
    const on = R.playing === +b.dataset.pl;
    b.textContent = on ? "■ " + t("stop") : t("listen");
    b.setAttribute("aria-pressed", String(on));
  });
  $("#rall").onclick = () => { R.all = !R.all; R.open.clear(); renderReader(el, x); };
  el.onclick = (e) => {
    const w = e.target.closest("[data-w]");
    if (w) return openSheet(w.dataset.w);
    const pl = e.target.closest("[data-pl]");
    if (pl) {
      const i = +pl.dataset.pl;
      if (R.playing === i) { stopSpeech(); R.playing = null; return playLabels(); }
      R.playing = i;
      playLabels();
      say(plain(x.paragraphs[i].gr), () => { if (R.playing === i) { R.playing = null; playLabels(); } });
      return;
    }
    const pt = e.target.closest("[data-pt]");
    if (pt) {
      const i = +pt.dataset.pt;
      if (R.all) { R.all = false; x.paragraphs.forEach((_, k) => R.open.add(k)); R.open.delete(i); }
      else if (R.open.has(i)) R.open.delete(i); else R.open.add(i);
      renderReader(el, x);
    }
  };
}

function openSheet(id) {
  const w = S.byId.get(id);
  if (!w) return;
  const root = $("#sheet-root");
  const note = pick(w.note);
  root.innerHTML = `<div class="sheet-bg" id="sbg"></div><div class="sheet" role="dialog" aria-label="${esc(w.gr)}"><div class="wrap stack">
    <div class="sheethead"><span class="hw" lang="el">${esc(w.gr)}</span>${sayBtn(speakForm(w))}${starBtn(w.id)}</div>
    <span class="fr">${esc(meaning(w))}</span>
    ${w.forms ? `<span class="muted small" lang="el">${esc(w.forms)}</span>` : ""}
    ${note ? `<span class="muted small">${esc(note)}</span>` : ""}
    <button class="btn ghost" id="sclose">${esc(t("close"))}</button></div></div>`;
  const close = () => (root.innerHTML = "");
  $("#sbg").onclick = close;
  $("#sclose").onclick = close;
}

// ───────────────────────────────── progrès et réglages
export function renderProgress(el) {
  const n = S.words.length || 1;
  const c = { new: 0, weak: 0, mid: 0, ok: 0 };
  S.words.forEach((w) => c[level(w.id)]++);
  const d30 = Array.from({ length: 30 }, (_, i) => S.activity.get(addDays(today(), -i))).filter(Boolean);
  const ans = d30.reduce((a, d) => a + (d.n || 0), 0), ok = d30.reduce((a, d) => a + (d.ok || 0), 0);
  const used = THEME_IDS.filter((id) => S.words.some((w) => w.th === id));
  const myGroups = S.groups.filter((g) => S.memberOf?.has(g.id));
  el.innerHTML = `
    <div><span class="eyebrow">${esc(t("n_in_notebook", { n: S.words.length }))} · ${streakCount()} ${esc(t("streak"))}</span><h2>${esc(t("progress_title"))}</h2></div>
    <div class="card stack">
      <div class="levels" role="img">${LEVELS.map((l) => `<i style="width:${(c[l.k] / n) * 100}%;background:${l.c}"></i>`).join("")}</div>
      <div class="legend">${LEVELS.map((l) => `<span><i style="background:${l.c}"></i>${esc(t(l.key))}<b>${c[l.k]}</b></span>`).join("")}</div>
      <p class="muted small">${esc(t("acquired_help"))}</p>
    </div>
    <div class="card stack"><span class="eyebrow">${esc(t("last30"))}</span>
      <div class="nums">
        <div class="num"><b>${d30.length}</b><span>${esc(t("active_days"))}</span></div>
        <div class="num"><b>${ans}</b><span>${esc(t("answers"))}</span></div>
        <div class="num"><b>${ans ? Math.round((ok / ans) * 100) : 0} %</b><span>${esc(t("success"))}</span></div>
      </div></div>
    ${used.length ? `<div class="card"><span class="eyebrow">${esc(t("by_theme"))}</span>
      ${used.map((id) => { const ws = S.words.filter((w) => w.th === id); const k = { new: 0, weak: 0, mid: 0, ok: 0 }; ws.forEach((w) => k[level(w.id)]++);
        return `<div class="trow"><span>${esc(themeName(id))}</span><div class="levels bar">${LEVELS.map((l) => `<i style="width:${(k[l.k] / ws.length) * 100}%;background:${l.c}"></i>`).join("")}</div><b>${k.ok}/${ws.length}</b></div>`; }).join("")}</div>` : ""}

    <h2 class="sect">${esc(t("settings"))}</h2>
    <div class="card stack">
      <div class="setting"><label for="sl">${esc(t("native_language"))}</label>
        <select id="sl">${LANGS.map((l) => `<option value="${l}" ${l === getLang() ? "selected" : ""}>${LANG_LABELS[l]}</option>`).join("")}</select></div>
      <div class="setting"><label for="sn">${esc(t("name_label"))}</label>
        <span class="inline"><input id="sn" maxlength="60" autocomplete="name" autocapitalize="words" value="${esc(S.profile?.display_name || "")}"><button class="btn small ghost" id="snsave">${esc(t("save"))}</button></span></div>
      <div class="setting"><span>${esc(t("questions_per_session"))}</span><div class="seg" id="segsize">${[10, 15, 20].map((v) => `<button data-v="${v}" aria-pressed="${(S.settings.size || 15) === v}">${v}</button>`).join("")}</div></div>
      <div class="setting"><span>${esc(t("audio_auto"))}</span><div class="seg" id="segaudio"><button data-v="1" aria-pressed="${!!S.settings.audioAuto}">${esc(t("yes"))}</button><button data-v="0" aria-pressed="${!S.settings.audioAuto}">${esc(t("no"))}</button></div></div>
      ${TTS.ok ? "" : `<p class="muted small">${esc(t("tts_unavailable"))}</p>`}
      <div class="setting"><span>${esc(t("writing_ex"))}<br><button class="link small" type="button" id="kbhelp">${esc(t("kb_howto"))}</button></span><div class="seg" id="segtype"><button data-v="1" aria-pressed="${!S.settings.noTyping}">${esc(t("yes"))}</button><button data-v="0" aria-pressed="${!!S.settings.noTyping}">${esc(t("no"))}</button></div></div>
      <label class="setting switch"><span><b>${esc(t("share_progress"))}</b><br><span class="muted small">${esc(t("share_help"))}</span></span>
        <input type="checkbox" id="share" ${S.profile?.share_progress ? "checked" : ""}></label>
      <p class="muted small">${esc(t("reminders_soon"))}</p>
    </div>
    <div class="card stack"><span class="eyebrow">${esc(t("my_classes"))}</span>
      ${myGroups.map((g) => `<div class="setting"><span>${esc(g.name)}${g.level ? ` · ${esc(g.level)}` : ""}</span><button class="btn small ghost" data-leave="${esc(g.id)}">${esc(t("leave"))}</button></div>`).join("") || `<p class="muted small">${esc(t("no_class"))}</p>`}
      <form id="jf" class="inline" novalidate><label class="sr" for="jc">${esc(t("class_code"))}</label>
        <input id="jc" class="code" autocapitalize="characters" maxlength="12" placeholder="${esc(t("class_code"))}">
        <button class="btn small" type="submit">${esc(t("join"))}</button></form>
    </div>
    ${installSettingsCard()}
    <div class="card stack"><span class="eyebrow">${esc(t("about"))}</span><p class="small">${esc(t("about_text"))}</p>
      <p class="small"><a href="privacy.html">${esc(t("privacy_link"))}</a></p>
      ${creditHtml("credit left")}
      <div class="btnrow"><button class="btn ghost" id="so">${esc(t("sign_out"))}</button><button class="btn ghost dangertext" id="del">${esc(t("delete_account"))}</button></div>
    </div>`;

  $("#sl").onchange = async (e) => {
    setLang(e.target.value);
    try { localStorage.setItem("lx_lang", e.target.value); } catch { /* */ }
    window.dispatchEvent(new Event("lx:lang")); // la coque (onglets) se redessine dans la nouvelle langue
    await saveProfile({ native_lang: e.target.value });
    toast(t("saved"));
  };
  $("#snsave").onclick = async () => { const v = nameCase($("#sn").value); $("#sn").value = v; await saveProfile({ display_name: v || null }); toast(t("saved")); };
  $("#segsize").onclick = async (e) => { const b = e.target.closest("[data-v]"); if (!b) return; await saveProfile({ settings: { ...S.settings, size: +b.dataset.v } }); renderProgress(el); };
  $("#segaudio").onclick = async (e) => { const b = e.target.closest("[data-v]"); if (!b) return; await saveProfile({ settings: { ...S.settings, audioAuto: b.dataset.v === "1" } }); renderProgress(el); };
  $("#segtype").onclick = async (e) => { const b = e.target.closest("[data-v]"); if (!b) return; await saveProfile({ settings: { ...S.settings, noTyping: b.dataset.v === "0" } }); renderProgress(el); };
  $("#kbhelp").onclick = () => showKbHelp();
  bindInstallSettings(el);
  $("#share").onchange = async (e) => { await saveProfile({ share_progress: e.target.checked }); toast(t("saved")); };
  el.querySelectorAll("[data-leave]").forEach((b) => b.onclick = async () => {
    if (!(await confirmBox(t("leave_confirm"), t("leave"), t("cancel")))) return;
    const { error } = await sb.from("group_members").delete().eq("group_id", b.dataset.leave).eq("user_id", S.user.id);
    if (error) return toast(t("error_generic"));
    await Promise.all([loadGroups(), loadWords(), loadLists()]);
    if (!S.memberOf?.size && !isStaff()) return location.reload(); // plus aucune classe : écran du code
    renderProgress(el);
  });
  bindJoin(el);
  $("#so").onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $("#del").onclick = async () => {
    if (!(await confirmBox(t("delete_confirm"), t("delete"), t("cancel")))) return;
    const { error } = await sb.rpc("delete_my_account");
    if (error) return toast(t("error_generic"));
    await sb.auth.signOut();
    location.reload();
  };
}
