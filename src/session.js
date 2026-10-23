// Session de révision : choix des mots, types d'exercices, correction
import { S, grade, isStar, dueInfo, saveProfile } from "./store.js";
import { t, pick } from "./i18n.js";
import { $, esc, today, shuffle, pickOne, norm, stripAcc, capFirst, lowFirst, toast } from "./util.js";
import { TTS, say, stopSpeech, ICON_SAY } from "./tts.js";
import { showKbHelp, looksLatin } from "./keyboard.js";
import { headword, meaning, speakForm, sayBtn, starBtn } from "./ui.js";

let onEnd = () => {};
export const setSessionEnd = (fn) => (onEnd = fn);

const isProper = (w) => /^[Α-ΩΆΈΉΊΌΎΏ]/.test((w.ans && w.ans[0]) || "");
const canType = (w) => w.ans && w.ans[0] && w.ans[0].split(" ").length <= 3;
const hasCloze = (w) => w.cl && w.ex && w.ex.includes(w.cl);

function blankAtStart(ex, cl) {
  const i = ex.indexOf(cl);
  if (i < 0) return false;
  const before = ex.slice(0, i);
  return /^[\s«"“(–—-]*$/.test(before) || /[.!?;…]\s*[«"“]?\s*$/.test(before);
}

function distractors(w, field, n = 3) {
  const val = (x) => (field === "tr" ? meaning(x) : field === "gr" ? headword(x) : x.cl);
  const seen = new Set([norm(val(w))]);
  const base = S.words.filter((x) => x.id !== w.id && val(x) && (field === "tr" || isProper(x) === isProper(w)));
  const pools = [base.filter((x) => x.pos === w.pos && x.th === w.th), base.filter((x) => x.pos === w.pos), base];
  const exLow = String(w.ex || "").toLocaleLowerCase("el");
  const out = [];
  for (const pool of pools) for (const x of shuffle(pool)) {
    if (out.length >= n) break;
    if (field === "cl" && exLow.includes(String(x.cl).toLocaleLowerCase("el"))) continue;
    const v = norm(val(x));
    if (!seen.has(v)) { seen.add(v); out.push(val(x)); }
  }
  return out;
}

// ───────────────────────────────── construction
function buildSession(opts = {}) {
  const t0 = today(), size = S.settings.size || 15;
  const isDue = (w) => { const p = S.progress.get(w.id); return p && !p.known && p.due <= t0; };
  let chosen;
  if (opts.star) {
    chosen = shuffle(S.words.filter((w) => isStar(w.id))).slice(0, size).map((w) => ({ w, extra: !isDue(w) }));
    return finishBuild(chosen);
  }
  const prog = (w) => S.progress.get(w.id);
  const due = S.words.filter(isDue).sort((a, b) =>
    (prog(b).star ? 1 : 0) - (prog(a).star ? 1 : 0) || prog(a).box - prog(b).box || (prog(a).due < prog(b).due ? -1 : 1));
  const fresh = shuffle(S.words.filter((w) => !S.progress.has(w.id)))
    .sort((a, b) => (a.added < b.added ? 1 : a.added > b.added ? -1 : 0));
  const starX = S.words.filter((w) => isStar(w.id) && !isDue(w))
    .sort((a, b) => ((prog(a).last || "") < (prog(b).last || "") ? -1 : 1)).slice(0, 3);
  const room = size - starX.length;
  const newQuota = Math.min(fresh.length, due.length >= room ? 3 : Math.min(6, room - due.length));
  chosen = [
    ...due.slice(0, Math.max(0, room - newQuota)).map((w) => ({ w })),
    ...starX.map((w) => ({ w, extra: true })),
    ...fresh.slice(0, newQuota).map((w) => ({ w, isNew: true })),
  ];
  if (chosen.length < size) {
    const used = new Set(chosen.map((c) => c.w.id));
    const extra = S.words.filter((w) => S.progress.has(w.id) && !used.has(w.id) && !prog(w).known)
      .sort((a, b) => prog(a).box - prog(b).box || ((prog(a).last || "") < (prog(b).last || "") ? -1 : 1));
    chosen.push(...extra.slice(0, size - chosen.length).map((w) => ({ w, extra: true })));
  }
  return finishBuild(chosen);
}

function finishBuild(chosen) {
  chosen = shuffle(chosen);
  const listenOK = TTS.ok && !!TTS.voice;
  const typeQuota = S.settings.noTyping ? 0 : Math.round(chosen.length * 0.2);
  const typeCands = shuffle(chosen.filter((c) => !c.isNew && (canType(c.w) || c.w.dr?.length || c.w.aor?.length || c.w.fem)));
  const typed = new Set(typeCands.slice(0, typeQuota));
  for (const c of chosen) {
    const w = c.w, box = S.progress.get(w.id)?.box || 0;
    const mc = ["tr"];
    if (typed.has(c)) {
      const opts = [];
      if (w.dr?.length) opts.push("drill", "drill");
      if (w.aor?.length) opts.push("aor");
      if (w.fem) opts.push("adj");
      if (canType(w)) opts.push("type");
      c.type = pickOne(opts);
    } else {
      const pool = ["gr2tr", "gr2tr"];
      if (hasCloze(w)) pool.push("cloze");
      if (listenOK) pool.push("listen");
      if (!(c.isNew || box === 0)) { pool.push("tr2gr", "tr2gr"); if (hasCloze(w)) pool.push("cloze"); }
      c.type = pickOne(pool);
      void mc;
    }
  }
  const mcq = chosen.filter((c) => ["gr2tr", "tr2gr"].includes(c.type) && headword(c.w).length < 34);
  let items = chosen;
  if (mcq.length >= 5) {
    const grp = mcq.slice(0, 4), set = new Set(grp);
    items = chosen.filter((c) => !set.has(c));
    items.splice(Math.min(3, items.length), 0, { type: "match", group: grp.map((g) => g.w) });
  }
  return items;
}

// ───────────────────────────────── déroulement
export function startSession(opts = {}) {
  const items = buildSession(opts);
  if (!items.length) { toast(opts.star ? t("no_starred_words") : t("nothing_to_review")); return; }
  S.session = { items, i: 0, results: [], wrong: new Set(), retried: new Set(), answered: false };
  document.body.style.overflow = "hidden";
  drawQ();
}

function endSession() {
  stopSpeech();
  S.session = null;
  document.body.style.overflow = "";
  $("#session-root").innerHTML = "";
  onEnd();
}

function shell(body, foot) {
  const s = S.session, n = s.items.length, cur = s.items[s.i];
  $("#session-root").innerHTML = `<div class="session" role="dialog" aria-label="${esc(t("session_card"))}">
    <div class="shead"><div class="wrap"><button class="close" id="sx" aria-label="${esc(t("quit"))}">×</button>
      <div class="pbar"><i style="width:${(Math.min(s.i, n) / n) * 100}%"></i></div>
      <span class="scount">${Math.min(s.i + 1, n)}/${n}</span>${cur && cur.w ? starBtn(cur.w.id) : ""}</div></div>
    <div class="sbody"><div class="wrap" id="sq">${body}</div></div>
    <div class="sfoot"><div class="wrap" id="sf">${foot || ""}</div></div></div>`;
  $("#sx").onclick = endSession;
}

function verdict(kind, w, label) {
  return `<div class="verdict ${kind}">
    <span class="v">${esc(label)}</span>
    <div class="w"><span class="gr" lang="el">${esc(w.gr)}</span>${sayBtn(speakForm(w))}</div>
    <span class="vm">${esc(meaning(w))}</span>
    ${w.ex ? `<span class="x" lang="el">${esc(w.ex)}</span><span class="xf">${esc(pick(w.exTr))}</span>` : ""}
  </div>`;
}

function nextQ() {
  const s = S.session;
  s.i++;
  if (s.i >= s.items.length) return drawSummary();
  drawQ();
}

function finishItem(item, correct, label, kind) {
  const s = S.session;
  s.answered = true;
  const w = item.w;
  if (!item.retry) {
    grade(w, correct, item.extra);
    s.results.push({ w, correct });
    if (!correct) {
      s.wrong.add(w.id);
      if (!s.retried.has(w.id)) {
        s.retried.add(w.id);
        const types = ["gr2tr", "tr2gr"];
        if (hasCloze(w)) types.push("cloze");
        s.items.splice(Math.min(s.items.length, s.i + 4), 0, { w, type: pickOne(types), retry: true });
      }
    }
  }
  $("#sf").innerHTML = verdict(kind || (correct ? "ok" : "ko"), w, label || (correct ? t("correct") : t("wrong"))) +
    `<button class="btn" id="snext">${esc(t("continue_btn"))}</button>`;
  const b = $("#snext");
  b.onclick = nextQ;
  b.focus();
}

function drawQ() {
  const s = S.session, item = s.items[s.i];
  s.answered = false;
  const fns = { gr2tr: qGr2Tr, tr2gr: qTr2Gr, cloze: qCloze, listen: qListen, match: qMatch, type: qType, drill: qDrill, aor: qAor, adj: qAdj };
  (fns[item.type] || qGr2Tr)(item);
}

function mcqView(item, label, promptHTML, correct, wrongs, greekOpts) {
  const opts = shuffle([correct, ...wrongs]);
  shell(`<span class="qlabel">${esc(label)}${item.retry ? " · " + esc(t("second_chance")) : ""}</span>${promptHTML}
    <div class="opts">${opts.map((o, i) => `<button class="opt${greekOpts ? " gr" : ""}" data-i="${i}" ${greekOpts ? 'lang="el"' : ""}>${esc(o)}</button>`).join("")}</div>`, "");
  $("#sq .opts").onclick = (e) => {
    const b = e.target.closest(".opt");
    if (!b || S.session.answered) return;
    const ok = opts[+b.dataset.i] === correct;
    document.querySelectorAll(".opt").forEach((x, i) => { x.disabled = true; if (opts[i] === correct) x.classList.add("right"); });
    if (!ok) b.classList.add("wrong");
    finishItem(item, ok);
  };
}

function qGr2Tr(item) {
  const w = item.w, hw = headword(w);
  mcqView(item, t("q_meaning"), `<div class="prompt"><span class="big" lang="el">${esc(String(w.gr).split(" · ")[0])}</span>${sayBtn(speakForm(w))}</div>`, meaning(w), distractors(w, "tr"));
  if (S.settings.audioAuto) say(hw);
}
function qTr2Gr(item) {
  const w = item.w;
  mcqView(item, t("q_say"), `<div class="prompt"><span class="bigfr">${esc(meaning(w))}</span></div>`, headword(w), distractors(w, "gr"), true);
}
function qCloze(item) {
  const w = item.w;
  const sent = esc(w.ex).replace(esc(w.cl), '<span class="blank">?</span>');
  const start = blankAtStart(w.ex, w.cl);
  const fix = (s) => (isProper(w) ? s : start ? capFirst(s) : lowFirst(s));
  const prepared = Array.isArray(w.cd) ? shuffle(w.cd.filter((x) => norm(x) !== norm(w.cl))).slice(0, 3) : [];
  const wrongs = prepared.length >= 3 ? prepared : distractors(w, "cl");
  mcqView(item, t("q_cloze"), `<div class="sentence" lang="el">${sent}</div>`, fix(w.cl), wrongs.map(fix), true);
}
function qListen(item) {
  const w = item.w, hw = headword(w);
  mcqView(item, t("q_listen"), `<button class="listen" id="lis" aria-label="${esc(t("listen"))}">${ICON_SAY}</button>`, meaning(w), distractors(w, "tr"));
  $("#lis").onclick = () => say(hw);
  say(hw);
}

function typingView(item, label, promptHTML, answers, hint) {
  shell(`<span class="qlabel">${esc(label)}</span>${promptHTML}${hint ? `<span class="hint">${esc(hint)}</span>` : ""}
    <form id="tf" autocomplete="off"><label class="sr" for="ta">${esc(label)}</label>
    <input id="ta" class="answer" lang="el" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="${esc(t("answer_ph"))}"></form>
    <span class="hint">${esc(t("accents_count"))}</span>
    <button class="link small" type="button" id="nokb">${esc(t("no_greek_kb"))}</button>`,
  `<button class="btn" form="tf" type="submit">${esc(t("check"))}</button><button class="btn ghost" id="tskip" type="button">${esc(t("dont_know"))}</button>`);
  const inp = $("#ta");
  setTimeout(() => inp.focus(), 50);
  const done = (val, skipped) => {
    if (S.session.answered) return;
    const a = norm(val);
    const ok = !skipped && answers.some((x) => norm(x) === a);
    const accent = !ok && !skipped && a && answers.some((x) => stripAcc(norm(x)) === stripAcc(a));
    inp.disabled = true;
    inp.classList.add(ok ? "right" : "wrong");
    const sol = answers[0];
    finishItem(item, ok, ok ? t("correct") : accent ? t("almost_accent", { x: sol }) : t("answer_is", { x: sol }), ok ? "ok" : accent ? "warn" : "ko");
  };
  const help = (message) => showKbHelp({ message, onSkip: skipTyping, onDone: () => inp.focus() });
  $("#nokb").onclick = () => help();
  $("#tf").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!inp.value.trim()) return inp.focus();
    if (looksLatin(inp.value)) return help(t("latin_typed")); // pas de clavier grec : on aide au lieu de compter faux
    done(inp.value);
  });
  $("#tskip").onclick = () => done("", true);
}
// plus d'exercices d'écriture : réglage mémorisé, et ceux de la session en cours deviennent des QCM
const TYPED = new Set(["type", "drill", "aor", "adj"]);
function skipTyping() {
  const s = S.session;
  saveProfile({ settings: { ...S.settings, noTyping: true } }).catch(() => {});
  if (!s) return;
  for (let k = s.i; k < s.items.length; k++) {
    const it = s.items[k];
    if (TYPED.has(it.type)) it.type = hasCloze(it.w) ? pickOne(["tr2gr", "cloze"]) : "tr2gr";
  }
  drawQ();
}

function qType(item) {
  const w = item.w;
  typingView(item, t("q_type"), `<div class="prompt"><span class="bigfr">${esc(meaning(w))}</span></div>`, w.ans, w.pos === "n" ? t("article_ok") : "");
}
function qDrill(item) {
  const d = pickOne(item.w.dr);
  const sent = esc(d[0]).replace("___", '<span class="blank">…</span>');
  typingView(item, t("q_form"), `<div class="sentence" lang="el">${sent}</div>`, d[1], pick(d[2]));
}
function qAor(item) {
  const w = item.w, lemma = w.aorOf || w.ans[0];
  typingView(item, t("q_aor"), `<div class="prompt"><span class="big" lang="el">${esc(lemma)}</span></div>`, w.aor, t("meaning_is", { x: meaning(w) }));
}
function qAdj(item) {
  const w = item.w, fem = Math.random() < 0.65;
  typingView(item, fem ? t("q_fem") : t("q_neu"), `<div class="prompt"><span class="big" lang="el">${esc(w.ans[0])}</span></div>`, [fem ? w.fem : w.neu], t("meaning_is", { x: meaning(w) }));
}

function qMatch(item) {
  const ws = item.group, left = shuffle(ws), right = shuffle(ws);
  const bad = new Set();
  let sel = null, done = 0;
  shell(`<span class="qlabel">${esc(t("q_match"))}</span>
    <div class="match"><div class="col">${left.map((w) => `<button class="mitem gr" lang="el" data-l="${w.id}">${esc(headword(w))}</button>`).join("")}</div>
    <div class="col">${right.map((w) => `<button class="mitem" data-r="${w.id}">${esc(meaning(w))}</button>`).join("")}</div></div>`,
  `<span class="hint">${esc(t("match_help"))}</span>`);
  $("#sq .match").onclick = (e) => {
    const l = e.target.closest("[data-l]"), r = e.target.closest("[data-r]");
    if (l && !l.classList.contains("done")) {
      document.querySelectorAll("[data-l]").forEach((x) => x.classList.remove("sel"));
      l.classList.add("sel");
      sel = l.dataset.l;
      say(headword(S.byId.get(sel)));
      return;
    }
    if (r && sel && !r.classList.contains("done")) {
      const L = document.querySelector(`[data-l="${sel}"]`);
      if (r.dataset.r === sel) {
        L.classList.remove("sel"); L.classList.add("done"); r.classList.add("done");
        L.disabled = r.disabled = true; sel = null; done++;
        if (done === ws.length) {
          S.session.answered = true;
          ws.forEach((w) => { const ok = !bad.has(w.id); grade(w, ok, false); S.session.results.push({ w, correct: ok }); if (!ok) S.session.wrong.add(w.id); });
          const nb = ws.length - bad.size;
          $("#sf").innerHTML = `<div class="verdict ${bad.size ? "warn" : "ok"}"><span class="v">${esc(bad.size ? t("first_try", { a: nb, b: ws.length }) : t("all_right"))}</span>
            ${[...bad].map((id) => { const w = S.byId.get(id); return `<div class="w"><span style="flex:1;min-width:0"><span lang="el" class="gr">${esc(headword(w))}</span> = ${esc(meaning(w))}</span>${starBtn(id)}</div>`; }).join("")}</div>
            <button class="btn" id="snext">${esc(t("continue_btn"))}</button>`;
          $("#snext").onclick = nextQ;
          $("#snext").focus();
        }
      } else {
        bad.add(sel);
        r.classList.add("bad"); L.classList.add("bad");
        setTimeout(() => { r.classList.remove("bad"); L.classList.remove("bad"); }, 600);
      }
    }
  };
}

function drawSummary() {
  const s = S.session, n = s.results.length, ok = s.results.filter((r) => r.correct).length;
  const wrong = [...s.wrong].map((id) => S.byId.get(id)).filter(Boolean);
  const { due } = dueInfo();
  shell(`<div class="summary">
    <span class="eyebrow">${esc(t("finished"))}</span>
    <span class="score">${ok}<span class="muted"> / ${n}</span></span>
    <p>${esc(ok === n ? t("no_errors") : t("to_rework", { n: n - ok }))} ${due ? esc(t("left_today", { n: due })) : ""}</p>
    ${wrong.length ? `<p class="muted small">${esc(t("star_hint"))}</p><div class="card list">${wrong.map((w) => `<div class="row compact"><div class="main"><div class="hw" lang="el">${esc(w.gr)}</div><div class="fr">${esc(meaning(w))}</div></div><div class="ra">${sayBtn(speakForm(w))}${starBtn(w.id)}</div></div>`).join("")}</div>` : ""}
  </div>`, `<button class="btn" id="sdone">${esc(t("done"))}</button>${due ? `<button class="btn ghost" id="smore">${esc(t("continue_more", { n: Math.min(due, S.settings.size || 15) }))}</button>` : ""}`);
  document.querySelector(".pbar i").style.width = "100%";
  document.querySelector(".scount").textContent = `${n}/${n}`;
  $("#sdone").onclick = endSession;
  const m = $("#smore");
  if (m) m.onclick = () => { S.session = null; startSession(); };
}
