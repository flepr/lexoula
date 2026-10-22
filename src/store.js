// État de l'appli, chargement des données et enregistrement de la progression
import { sb } from "./supabase.js";
import { today, addDays } from "./util.js";

export const S = {
  user: null,
  profile: null,
  words: [],          // mots prêts (données aplaties)
  pending: 0,         // mots en préparation par l'IA
  byId: new Map(),
  progress: new Map(),
  activity: new Map(),
  texts: [],
  groups: [],
  lists: [],
  ready: false,
  settings: { size: 15, audioAuto: true },
  view: "today",
  lex: { q: "", filter: "all", examples: false, open: null },
  reading: null,
  rd: { id: null, all: false, open: new Set() },
  session: null,
  teacher: { groupId: null },
};

export const INTERVALS = [0, 1, 3, 7, 14, 30, 60];
export const isStaff = () => ["teacher", "admin"].includes(S.profile?.role);
export const isAdmin = () => S.profile?.role === "admin";

// ───────────────────────────────── chargement
export async function loadProfile() {
  const { data, error } = await sb.from("profiles").select("*").eq("id", S.user.id).maybeSingle();
  if (error) throw error;
  S.profile = data;
  S.settings = Object.assign({ size: 15, audioAuto: true }, data?.settings || {});
  return data;
}

export async function loadWords() {
  const { data, error } = await sb.rpc("my_words");
  if (error) throw error;
  const ready = [];
  let pending = 0;
  for (const r of data || []) {
    if (r.status === "ready" && r.data) ready.push(Object.assign({}, r.data, { id: r.id, added: r.added, personal: r.personal }));
    else if (r.status === "pending") pending++;
  }
  S.words = ready;
  S.pending = pending;
  S.byId = new Map(ready.map((w) => [w.id, w]));
}

export async function loadProgress() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("progress").select("*").eq("user_id", S.user.id).range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  if (!S.session) S.progress = new Map(all.map((p) => [p.lexeme_id, p]));
  const { data: act } = await sb.from("activity").select("*").eq("user_id", S.user.id)
    .gte("day", addDays(today(), -400));
  if (!S.session) S.activity = new Map((act || []).map((a) => [a.day, a]));
}

export async function loadTexts() {
  const { data, error } = await sb.from("texts").select("id, group_id, kind, title, title_tr, paragraphs, word_ids, status, created_at")
    .order("created_at", { ascending: false }).limit(60);
  if (error) throw error;
  S.texts = data || [];
}

export async function loadGroups() {
  const { data, error } = await sb.from("groups").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  S.groups = data || [];
  const { data: mem } = await sb.from("group_members").select("group_id").eq("user_id", S.user.id);
  S.memberOf = new Set((mem || []).map((m) => m.group_id));
}

export async function loadLists() {
  const { data, error } = await sb.rpc("my_lists");
  if (error) throw error;
  S.lists = data || [];
}

export async function loadAll() {
  await loadProfile();
  await Promise.all([loadWords(), loadProgress(), loadTexts(), loadGroups(), loadLists()]);
  S.ready = true;
}

// ───────────────────────────────── écriture (une à la fois, dans l'ordre)
let chain = Promise.resolve();
let onError = () => {};
export const setWriteErrorHandler = (fn) => (onError = fn);
function enqueue(fn) {
  chain = chain.then(fn).catch((e) => { console.warn(e); onError(e); });
  return chain;
}

export function saveProgress(p) {
  const row = {
    user_id: S.user.id, lexeme_id: p.lexeme_id, box: p.box, due: p.due, seen: p.seen, ok: p.ok, ko: p.ko,
    last: p.last ?? null, known: !!p.known, star: !!p.star, updated_at: new Date().toISOString(),
  };
  return enqueue(async () => {
    const { error } = await sb.from("progress").upsert(row, { onConflict: "user_id,lexeme_id" });
    if (error) throw error;
  });
}

export function saveActivity(day, a) {
  return enqueue(async () => {
    const { error } = await sb.from("activity").upsert({ user_id: S.user.id, day, n: a.n, ok: a.ok }, { onConflict: "user_id,day" });
    if (error) throw error;
  });
}

export async function saveProfile(patch) {
  const { error } = await sb.from("profiles").update(patch).eq("id", S.user.id);
  if (error) throw error;
  Object.assign(S.profile, patch);
  if (patch.settings) S.settings = Object.assign({ size: 15, audioAuto: true }, patch.settings);
}

// ───────────────────────────────── répétition espacée
export function level(id) {
  const p = S.progress.get(id);
  if (!p) return "new";
  if (p.known || p.box >= 5) return "ok";
  if (p.box >= 3) return "mid";
  return "weak";
}
export const isStar = (id) => !!S.progress.get(id)?.star;

export function dueInfo() {
  const t = today();
  let due = 0, fresh = 0;
  for (const w of S.words) {
    const p = S.progress.get(w.id);
    if (!p) fresh++;
    else if (!p.known && p.due <= t) due++;
  }
  return { due, fresh };
}

const blank = (id) => ({ lexeme_id: id, box: 0, due: today(), seen: 0, ok: 0, ko: 0, last: null, known: false, star: false });

export function grade(w, correct, isExtra) {
  const t = today();
  const p = Object.assign(blank(w.id), S.progress.get(w.id) || {});
  p.seen++;
  p.last = t;
  if (correct) {
    p.ok++;
    if (!isExtra || p.box === 0) { p.box = Math.min(6, p.box + 1); p.due = addDays(t, INTERVALS[p.box]); }
  } else {
    p.ko++; p.box = 1; p.due = addDays(t, 1);
  }
  if (p.star) { // mot à renforcer : jamais plus de 2 jours sans le revoir
    if (p.box > 3) p.box = 3;
    const cap = addDays(t, 2);
    if (!p.due || p.due > cap) p.due = cap;
  }
  p.known = false;
  S.progress.set(w.id, p);
  saveProgress(p);
  const d = Object.assign({ n: 0, ok: 0 }, S.activity.get(t) || {});
  d.n++;
  if (correct) d.ok++;
  S.activity.set(t, d);
  saveActivity(t, d);
}

export function toggleStar(id) {
  const on = !isStar(id), t = today();
  const p = Object.assign(blank(id), S.progress.get(id) || {});
  if (on) {
    p.star = true; p.known = false;
    if (p.box > 2) p.box = 2;
    const soon = p.seen ? addDays(t, 1) : t;
    if (!p.due || p.due > soon) p.due = soon;
  } else p.star = false;
  S.progress.set(id, p);
  saveProgress(p);
  return on;
}

export function markKnown(id, known) {
  const p = Object.assign(blank(id), S.progress.get(id) || {});
  p.known = known;
  p.box = known ? 6 : Math.min(p.box, 2);
  p.due = known ? addDays(today(), 60) : today();
  if (known) p.star = false;
  S.progress.set(id, p);
  saveProgress(p);
}

export function streakCount() {
  let d = today(), n = 0;
  if (!(S.activity.get(d)?.n > 0)) d = addDays(d, -1);
  while (S.activity.get(d)?.n > 0) { n++; d = addDays(d, -1); }
  return n;
}

export const latestAdded = () => S.words.reduce((m, w) => (w.added > m ? w.added : m), "");
