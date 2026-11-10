// État de l'appli, chargement des données et enregistrement de la progression
import { sb } from "./supabase.js";
import { today, addDays } from "./util.js";

export const S = {
  user: null,
  profile: null,
  words: [],          // mots prêts (données aplaties)
  lessons: [],        // leçons de l'élève avec leurs mots prêts (my_lessons)
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
  session: null,
  teacher: { groupId: null },
  textsPaused: false, // pause générale des textes automatiques (admin)
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

// Phrase d'exemple : chaque mot peut en avoir deux, une pour les débutants (classes A1, A2) et une pour les
// avancés (B1 à C2). Un élève qui est dans au moins une classe avancée voit les phrases avancées, sinon les
// phrases débutantes ; sans classe (professeur, admin) : avancées. Même règle que private.user_tier() en base.
// Le mot garde sa phrase d'origine (palier data.exTier, « adv » si absent) ; l'autre est dans data.alt.
// Si la phrase du palier voulu n'existe pas (encore), on montre l'autre.
const tierOfLevel = (level) => (level === "A1" || level === "A2" ? "beg" : "adv");
export function exampleTier() {
  const mine = S.groups.filter((g) => S.memberOf?.has(g.id));
  if (!mine.length) return "adv";
  return mine.some((g) => tierOfLevel(g.level) === "adv") ? "adv" : "beg";
}
function withTier(raw, tier) {
  const alt = raw.alt;
  if (!alt?.ex || alt.tier !== tier || (raw.exTier || "adv") === tier) return raw;
  return Object.assign({}, raw, { ex: alt.ex, exTr: alt.exTr || {}, cl: alt.cl, cd: alt.cd || [], dr: alt.dr || [] });
}
let rawWords = [];
function buildWords() {
  const tier = exampleTier();
  S.words = rawWords.map((w) => withTier(w, tier));
  S.byId = new Map(S.words.map((w) => [w.id, w]));
  // leçons qui ont au moins un mot prêt, avec leurs mots prêts
  S.lessons = rawLessons.map((l) => ({ ...l, ids: l.ids.filter((id) => S.byId.has(id)) })).filter((l) => l.ids.length);
}
let rawLessons = [];

export async function loadWords() {
  const [{ data, error }, les] = await Promise.all([sb.rpc("my_words"), sb.rpc("my_lessons")]);
  if (error) throw error;
  // leçons de l'élève (my_lessons, 09/11/2026) ; en cas d'échec, l'appli retombe sur les dates d'ajout des mots
  rawLessons = les.error ? [] : (les.data || []).map((l) => ({
    id: l.id, groupId: l.group_id, groupName: l.group_name, level: l.group_level, teacher: l.teacher_name,
    title: l.title, date: l.lesson_date, personal: l.personal, ids: l.lexeme_ids || [],
  }));
  const ready = [];
  let pending = 0;
  for (const r of data || []) {
    if (r.status === "ready" && r.data) ready.push(Object.assign({}, r.data, { id: r.id, added: r.added, personal: r.personal }));
    else if (r.status === "pending") pending++;
  }
  rawWords = ready;
  S.pending = pending;
  buildWords();
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

// Textes à lire côté élève : ceux des classes dont on est membre. Les profs et l'admin voient aussi,
// par la base, les textes des autres classes (pour l'espace professeur) : on ne les montre pas ici.
// Sans aucune classe, un prof voit les textes des classes qu'il enseigne.
export function readableTexts() {
  if (S.memberOf?.size) return S.texts.filter((x) => S.memberOf.has(x.group_id));
  const mine = new Set(S.groups.filter((g) => g.teacher_id === S.user?.id).map((g) => g.id));
  return S.texts.filter((x) => mine.has(x.group_id));
}

export async function loadGroups() {
  const { data, error } = await sb.from("groups").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  S.groups = data || [];
  const { data: mem } = await sb.from("group_members").select("group_id").eq("user_id", S.user.id);
  S.memberOf = new Set((mem || []).map((m) => m.group_id));
  buildWords(); // le palier des phrases d'exemple dépend des classes
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

export function dueInfo(words = S.words) {
  const t = today();
  let due = 0, fresh = 0;
  for (const w of words) {
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

// Date du dernier cours : la leçon la plus récente (my_lessons), sinon la date d'ajout la plus récente des mots
export const latestAdded = () => S.lessons?.length ? S.lessons.reduce((m, l) => (l.date > m ? l.date : m), "")
  : S.words.reduce((m, w) => (w.added > m ? w.added : m), "");
// Mots du dernier cours : tous les mots des leçons de cette date, y compris ceux déjà vus dans un cours précédent
export const latestWords = () => {
  const d = latestAdded();
  if (!d) return [];
  if (!S.lessons?.length) return S.words.filter((w) => w.added === d);
  const ids = new Set(S.lessons.filter((l) => l.date === d).flatMap((l) => l.ids));
  return S.words.filter((w) => ids.has(w.id));
};
// Interrupteur « Dernière leçon » de la session du jour : valable le jour où il a été activé, puis retour à « Toutes les leçons »
export const lastOnlyToday = () => S.settings.lastOnlyDay === today();
// « Choisir les leçons… » (09/11/2026) : valable le jour même (lessonsDay). La sélection reste dans le profil :
// lessonsOff = leçons décochées (une leçon arrivée ensuite est donc cochée), lessonsSeen = leçons connues lors du
// dernier choix (les autres portent l'étiquette « nouveau »).
export const customToday = () => S.settings.lessonsDay === today() && S.lessons?.length > 0;
export const lessonOn = (id) => !(S.settings.lessonsOff || []).includes(id);
export const isNewLesson = (l) => Array.isArray(S.settings.lessonsSeen) && !S.settings.lessonsSeen.includes(l.id);
export const wordsOfLessons = (ls) => { const ids = new Set(ls.flatMap((l) => l.ids)); return S.words.filter((w) => ids.has(w.id)); };
// mots sur lesquels porte la session du jour : leçons choisies, dernière leçon ou toutes
export function scopeWords() {
  if (customToday()) return wordsOfLessons(S.lessons.filter((l) => lessonOn(l.id)));
  if (lastOnlyToday()) { const n = latestWords(); if (n.length) return n; }
  return S.words;
}
