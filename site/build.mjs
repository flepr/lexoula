// Construit la vitrine statique de lexoula.gr : une page par langue, sans dépendance.
// node site/build.mjs --out dist-site [--app https://app.lexoula.gr/] [--privacy https://app.lexoula.gr/privacy.html] [--cname lexoula.gr] [--site https://lexoula.gr/]
// Les adresses relatives (aperçu sous flepr.github.io/lexoula/site/) sont corrigées pour les pages de langue.
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_LANGS as LANGS, LANG_NAMES, T } from "./content.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("out", join(here, "..", "dist-site"));
const APP = arg("app", "https://app.lexoula.gr/");
const PRIVACY = arg("privacy", "https://app.lexoula.gr/privacy.html");
const CNAME = arg("cname", "");
// adresse absolue de la vitrine (aperçus de lien, canonical, sitemap) ; l'aperçu GitHub passe la sienne
const SITE = arg("site", "https://lexoula.gr/");
const GITHUB = "https://github.com/flepr/lexoula";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const abs = (u) => /^[a-z]+:/i.test(u);
const pathOf = (l) => (l === "en" ? "" : `${l}/`);
const ig = (h) => `<a href="https://www.instagram.com/${h}/" rel="noopener">@${h}</a>`;

// ─────────────────────────────────────────── démo (téléphone animé, non interactif)
function phone(t) {
  const d = t.dm;
  const tabs = (cur) => `<nav class="p-tabs">${[["Σήμερα", 0], ["Λέξεις", 1], ["Κείμενα", 2], ["Πρόοδος", 3]]
    .map(([g, i]) => `<span class="${i === cur ? "on" : ""}"><b lang="el">${g}</b>${esc(d.tabs[i])}</span>`).join("")}</nav>`;
  const shead = (pct, n) => `<div class="p-shead"><span class="p-x">×</span><span class="p-pbar"><i style="width:${pct}%"></i></span><span class="p-count">${n}/15</span></div>`;
  const say = `<span class="p-say"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>`;
  const star = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="currentColor"/></svg>`;
  const days = Array.from({ length: 14 }, (_, i) => `<i class="${i === 13 ? "today" : i > 1 && i !== 6 ? "on" : ""}"></i>`).join("");
  const vocab = [
    ["ο εθισμός", d.vocab[0], "", "ok"], ["εθιστικός, -ή, -ό", d.vocab[1], "", "weak"],
    ["σκρολάρω", d.vocab[2], "αόρ. σκρόλαρα", "mid"], ["μου αποσπάει την προσοχή", d.vocab[3], "", "mid"],
    ["η συσκευή", d.vocab[4], "πληθ. οι συσκευές", "ok"],
  ];
  return `<div class="phone" aria-hidden="true"><div class="p-screen">
  <div class="p-status"><span>9:41</span><span class="p-island"></span><span class="p-batt"></span></div>

  <div class="p-scene" data-s="0">
    <div class="p-top"><span class="p-brand" lang="el">Λεξούλα</span><span class="p-streak"><b>12</b> ${esc(d.streak)}</span></div>
    <div class="p-body">
      <span class="p-eyebrow" data-date></span>
      <p class="p-hello" lang="el">Καλημέρα!</p>
      <div class="p-card">
        <span class="p-eyebrow">${esc(d.session)} · ${esc(d.nq)}</span>
        <div class="p-nums"><div><b>9</b><span>${esc(d.to_review)}</span></div><div><b>6</b><span>${esc(d.fresh)}</span></div><div><b>0</b><span>${esc(d.answers)}</span></div></div>
        <span class="p-btn" data-tap>${esc(d.start)}</span>
        <div class="p-days">${days}</div>
      </div>
      <div class="p-card"><span class="p-eyebrow">${esc(d.latest)} · 19/10 · 21</span>
        <div class="p-chips" lang="el"><span>τολμώ</span><span>διστάζω</span><span>μετανιώνω</span><span>η απώλεια</span><span>εκρήγνυμαι</span></div></div>
    </div>
    ${tabs(0)}
  </div>

  <div class="p-scene p-session" data-s="1">
    ${shead(27, 4)}
    <div class="p-body">
      <span class="p-qlabel">${esc(d.q_meaning)}</span>
      <div class="p-prompt"><span class="p-big" lang="el">η εμπιστοσύνη</span>${say}</div>
      <div class="p-opts">${d.meanings.map((m, i) => `<span class="p-opt" ${i === 0 ? "data-tap data-right" : ""}>${esc(m)}</span>`).join("")}</div>
    </div>
    <div class="p-verdict"><b lang="el">Σωστά!</b><span lang="el">Έχω απόλυτη εμπιστοσύνη στη φίλη μου.</span></div>
  </div>

  <div class="p-scene p-session" data-s="2">
    ${shead(40, 6)}
    <div class="p-body">
      <span class="p-qlabel">${esc(d.q_cloze)}</span>
      <p class="p-sentence" lang="el">Ο Νίκος δεν <span class="p-blank" data-fill="τόλμησε">&nbsp;</span> να ζητήσει αύξηση από τον διευθυντή του.</p>
      <span class="p-hint">${esc(d.cloze_hint)}</span>
      <div class="p-opts gr" lang="el"><span class="p-opt">φρέναρε</span><span class="p-opt" data-tap data-right>τόλμησε</span><span class="p-opt">σκρόλαρε</span><span class="p-opt">κατανάλωσε</span></div>
    </div>
    <div class="p-verdict"><b lang="el">Σωστά!</b><span lang="el">τολμώ · αόρ. τόλμησα</span></div>
  </div>

  <div class="p-scene" data-s="3">
    <div class="p-top"><span class="p-brand" lang="el">Λεξούλα</span><span class="p-streak"><b>12</b> ${esc(d.streak)}</span></div>
    <div class="p-body">
      <div class="p-ghead"><b>${esc(d.theme)}</b><span lang="el">Τεχνολογία & μέσα</span></div>
      ${vocab.map(([g, m, f, lv], i) => `<div class="p-row"><i class="p-dot lv-${lv}"></i><div><span class="p-hw" lang="el">${esc(g)}</span><span class="p-fr">${esc(m)}</span>${f ? `<span class="p-forms" lang="el">${esc(f)}</span>` : ""}</div><span class="p-star" ${i === 1 ? "data-tap" : ""}>${star}</span></div>`).join("")}
    </div>
    ${tabs(1)}
  </div>

  <div class="p-scene" data-s="4">
    <div class="p-top"><span class="p-brand" lang="el">Λεξούλα</span><span class="p-streak"><b>12</b> ${esc(d.streak)}</span></div>
    <div class="p-body">
      <span class="p-meta"><span class="p-badge">${esc(d.short_text)}</span>${esc(d.lesson_words)}</span>
      <p class="p-rtitle" lang="el">Πέντε λεπτά ακόμα</p>
      <span class="p-rtr">${esc(d.text_tr)}</span>
      <p class="p-para" lang="el">Κάθε βράδυ λέω «πέντε λεπτά ακόμα» και αρχίζω να <u>σκρολάρω</u>. Ξέρω ότι το κινητό είναι <u data-tap>εθιστικό</u>, αλλά <u>μου αποσπάει την προσοχή</u> από την κούραση της μέρας. Το πρωί είμαι <u>εξουθενωμένος</u> και <u>μετανιώνω</u>.</p>
    </div>
    <div class="p-sheet"><div class="p-sheethead"><span class="p-hw" lang="el">εθιστικός, -ή, -ό</span>${say}</div><span class="p-fr">${esc(d.vocab[1])}</span>
      <span class="p-ex" lang="el">Το σκρολάρισμα είναι πολύ εθιστικό.</span></div>
    ${tabs(2)}
  </div>

  <div class="p-scene" data-s="5">
    <div class="p-top"><span class="p-brand" lang="el">Λεξούλα</span><span class="p-streak"><b>12</b> ${esc(d.streak)}</span></div>
    <div class="p-body">
      <div class="p-card"><span class="p-eyebrow">${esc(d.tabs[1])} · 235</span>
        <div class="p-levels"><i class="lv-new" style="--w:22%"></i><i class="lv-weak" style="--w:12%"></i><i class="lv-mid" style="--w:27%"></i><i class="lv-ok" style="--w:39%"></i></div>
        <div class="p-legend">${d.levels.map((l, i) => `<span><i class="lv-${["new", "weak", "mid", "ok"][i]}"></i>${esc(l)}<b>${[52, 28, 63, 92][i]}</b></span>`).join("")}</div>
      </div>
      <div class="p-card"><span class="p-eyebrow"><b class="p-big-n">12</b> ${esc(d.streak)}</span><div class="p-days">${days}</div></div>
    </div>
    ${tabs(3)}
  </div>

  <span class="p-finger"></span>
</div></div>`;
}

// ─────────────────────────────────────────── schéma de l'architecture (horizontal / vertical)
function diagram(t) {
  const d = t.d;
  const box = (x, y, w, title, sub, cls = "") =>
    `<g class="dg-box ${cls}"><rect x="${x}" y="${y}" width="${w}" height="58" rx="12"/><text x="${x + w / 2}" y="${y + (sub ? 25 : 34)}" class="dg-t">${esc(title)}</text>${sub ? `<text x="${x + w / 2}" y="${y + 43}" class="dg-s">${esc(sub)}</text>` : ""}</g>`;
  const arrow = (x1, y1, x2, y2, label, lx, ly, anchor = "middle") =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="dg-l" marker-end="url(#ah)"/>${label ? `<text x="${lx}" y="${ly}" class="dg-a" text-anchor="${anchor}">${esc(label)}</text>` : ""}`;
  const defs = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="dg-ah"/></marker></defs>`;
  const wide = `<svg class="dg dg-wide" viewBox="0 0 860 250" role="img" aria-labelledby="dgw-t"><title id="dgw-t">${esc(`${d.teacher} → ${d.db} → ${d.worker} ⇄ Claude → ${d.app} → ${d.student}`)}</title>${defs}
    ${box(10, 20, 130, d.teacher, "")}
    ${arrow(140, 49, 238, 49, d.list, 189, 39)}
    ${box(240, 20, 170, d.db, "Supabase · Postgres", "hl")}
    ${arrow(410, 49, 508, 49, d.cron, 459, 39)}
    ${box(510, 20, 160, d.worker, d.worker_sub)}
    ${arrow(670, 41, 718, 41, "", 0, 0)}${arrow(718, 57, 670, 57, "", 0, 0)}
    ${box(720, 20, 130, "Claude", d.ai_sub, "hl2")}
    ${arrow(325, 78, 325, 170, d.out, 337, 128, "start")}
    ${box(240, 172, 170, d.app, "GitHub Pages")}
    ${arrow(410, 201, 508, 201, "", 0, 0)}
    ${box(510, 172, 160, d.student, "")}
  </svg>`;
  const tall = `<svg class="dg dg-tall" viewBox="0 0 340 600" role="img" aria-labelledby="dgt-t"><title id="dgt-t">${esc(`${d.teacher} → ${d.db} → ${d.worker} ⇄ Claude → ${d.app} → ${d.student}`)}</title>${defs}
    ${box(20, 10, 180, d.teacher, "")}
    ${arrow(110, 68, 110, 120, d.list, 122, 98, "start")}
    ${box(20, 122, 180, d.db, "Supabase · Postgres", "hl")}
    ${arrow(110, 180, 110, 232, d.cron, 122, 210, "start")}
    ${box(20, 234, 180, d.worker, d.worker_sub)}
    ${arrow(200, 255, 228, 255, "", 0, 0)}${arrow(228, 271, 200, 271, "", 0, 0)}
    ${box(230, 234, 100, "Claude", "Anthropic", "hl2")}
    ${arrow(110, 292, 110, 404, d.out, 122, 352, "start")}
    ${box(20, 406, 180, d.app, "GitHub Pages")}
    ${arrow(110, 464, 110, 516, "", 0, 0)}
    ${box(20, 518, 180, d.student, "")}
  </svg>`;
  return wide + tall;
}

// ─────────────────────────────────────────── page
function page(l) {
  const t = T[l];
  const base = l === "en" ? "" : "../";
  const app = abs(APP) ? APP : base + APP;
  const privacy = abs(PRIVACY) ? PRIVACY : base + PRIVACY;
  const alt = LANGS.map((x) => `<link rel="alternate" hreflang="${x}" href="${SITE}${pathOf(x)}">`).join("\n  ");
  const langMenu = `<details class="lang"><summary aria-label="${esc(t.lang_label)}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span>${l.toUpperCase()}</span></summary>
      <ul>${LANGS.map((x) => `<li><a href="${base}${pathOf(x) || "./"}" hreflang="${x}" lang="${x}" data-lang="${x}"${x === l ? ' aria-current="true"' : ""}>${LANG_NAMES[x]}</a></li>`).join("")}</ul></details>`;
  const credit = (who) => who === "s"
    ? `${esc(t.credit_lessons)} <span lang="el">Στέφανος Βασιλείου</span> (Stefanos Vasileiou) · ${ig("learngreekwithstefanos")}`
    : `${esc(t.credit_app)} <span lang="el">Φοίβος Λεπέρ</span> (Fabien Lepère) · ${ig("flepr")}`;
  const greekNum = ["α΄", "β΄", "γ΄"];

  return `<!doctype html>
<html lang="${l}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(t.meta_title)}</title>
  <meta name="description" content="${esc(t.meta_desc)}">
  <meta name="author" content="Φοίβος Λεπέρ (Fabien Lepère)">
  <meta name="theme-color" content="#EDF0EA" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#111512" media="(prefers-color-scheme: dark)">
  <link rel="canonical" href="${SITE}${pathOf(l)}">
  ${alt}
  <link rel="alternate" hreflang="x-default" href="${SITE}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Λεξούλα">
  <meta property="og:title" content="${esc(t.meta_title)}">
  <meta property="og:description" content="${esc(t.meta_desc)}">
  <meta property="og:url" content="${SITE}${pathOf(l)}">
  <meta property="og:image" content="${SITE}og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="${l}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="${base}favicon-64.png" type="image/png">
  <link rel="apple-touch-icon" href="${base}apple-touch-icon.png">
  <link rel="preload" href="${base}fonts/gfs-didot-greek-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${base}site.css">
  ${l === "en" ? `<script>
  // première visite sur la page anglaise : proposer directement la langue du navigateur
  (function () {
    try {
      if (location.search.indexOf("lang=") >= 0 || localStorage.getItem("lx_site_lang")) return;
      var L = ${JSON.stringify(LANGS)}, n = navigator.languages || [navigator.language || ""];
      for (var i = 0; i < n.length; i++) { var c = String(n[i]).slice(0, 2).toLowerCase(); if (c === "en") return; if (L.indexOf(c) > 0) { location.replace(c + "/"); return; } }
    } catch (e) {}
  })();
  </script>` : ""}
</head>
<body>
<a class="skip" href="#main">${esc(t.skip)}</a>
<header class="bar">
  <div class="in">
    <a class="mark" href="${base || "./"}" lang="el">Λεξούλα</a>
    <div class="bar-end">
      ${langMenu}
      <a class="btn btn-s" href="${app}">${esc(t.open_app)}</a>
    </div>
  </div>
</header>

<main id="main">
  <section class="hero">
    <div class="in hero-in">
      <div class="entry">
        <h1 class="word" lang="el">Λεξούλα</h1>
        <p class="pron"><span lang="el">[λε-ξού-λα]</span> /lɛˈksu.la/ <i>${esc(t.pos)}</i></p>
        <ol class="senses">
          <li>${esc(t.etym)}</li>
          <li class="main-sense">${esc(t.sense)}</li>
        </ol>
        <div class="ctas">
          <a class="btn btn-l" href="${app}">${esc(t.open_app)}</a>
          <a class="btn btn-l ghost" href="#how">${esc(t.cta_how)}</a>
        </div>
        <p class="note">${esc(t.hero_note)}</p>
      </div>
      <figure class="demo" data-demo data-lang="${t.demo_lang || l}">
        ${phone(t)}
        <figcaption>
          <p class="cap" data-cap>${esc(t.scenes[0])}</p>
          <div class="ctrl">
            <button type="button" class="play" data-toggle aria-label="${esc(t.pause)}" data-l-pause="${esc(t.pause)}" data-l-play="${esc(t.play)}">
              <svg class="i-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>
              <svg class="i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>
            </button>
            <div class="dots">${t.scenes.map((_, i) => `<button type="button" data-go="${i}" aria-label="${esc(t.scene.replace("{n}", i + 1).replace("{m}", t.scenes.length))}"></button>`).join("")}</div>
          </div>
          <ol class="sr">${t.scenes.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
        </figcaption>
        <script type="application/json" data-caps>${JSON.stringify(t.scenes)}</script>
      </figure>
    </div>
  </section>

  <section class="sect" id="how" aria-labelledby="how-h">
    <div class="in">
      <h2 id="how-h">${esc(t.how_title)}</h2>
      <ol class="steps">${t.steps.map(([a, b], i) => `<li><span class="num" lang="el">${greekNum[i]}</span><h3>${esc(a)}</h3><p>${esc(b)}</p></li>`).join("")}</ol>
    </div>
  </section>

  <section class="sect" aria-labelledby="feat-h">
    <div class="in">
      <h2 id="feat-h">${esc(t.feat_title)}</h2>
      <dl class="gloss">${t.features.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join("")}</dl>
    </div>
  </section>

  <section class="sect teach" aria-labelledby="teach-h">
    <div class="in teach-in">
      <div>
        <h2 id="teach-h">${esc(t.teach_title)}</h2>
        <p class="lead">${esc(t.teach_lead)}</p>
        <ul class="ticks">${t.teach_items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      </div>
      <div class="codecard" aria-hidden="true">
        <span>${esc(t.teach_code)}</span>
        <b>K7MWP3TQ</b>
        <svg class="qr" viewBox="0 0 21 21">${qr()}</svg>
      </div>
    </div>
  </section>

  <section class="sect who" aria-labelledby="who-h">
    <div class="in">
      <h2 id="who-h">${esc(t.who_title)}</h2>
      <div class="people">
        <article><p class="credit">${credit("s")}</p><h3 lang="el">Στέφανος</h3><p>${esc(t.stef_desc)}</p></article>
        <article><p class="credit">${credit("f")}</p><h3 lang="el">Φοίβος</h3><p>${esc(t.fab_desc)}</p></article>
      </div>
    </div>
  </section>

  <section class="sect bts" aria-labelledby="bts-h">
    <div class="in">
      <h2 id="bts-h">${esc(t.bts_title)}</h2>
      <p class="lead">${esc(t.bts_lead)}</p>
      <div class="dg-wrap">${diagram(t)}</div>
      <p class="facts">${esc(t.facts)}</p>
      <ul class="ticks two">${t.bts_points.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <div class="stack">
        <h3>${esc(t.stack_title)}</h3>
        <ul class="tags"><li>Vite</li><li>JavaScript</li><li>Supabase</li><li>PostgreSQL</li><li>Deno</li><li>Claude API</li><li>GitHub Actions</li><li>GitHub Pages</li><li>Google &amp; Microsoft sign-in</li><li>Web Speech</li></ul>
      </div>
      <p class="gh"><a class="btn btn-l ghost" href="${GITHUB}" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.7s.8-.3 2.8 1a9.6 9.6 0 0 1 5 0c2-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/></svg>${esc(t.github)}</a></p>
      <p class="claude">${esc(t.claude_note)}</p>
    </div>
  </section>

  <section class="final" aria-labelledby="final-h">
    <div class="in">
      <h2 id="final-h">${esc(t.final_title)}</h2>
      <p>${esc(t.final_text)}</p>
      <a class="btn btn-l" href="${app}">${esc(t.open_app)}</a>
    </div>
  </section>
</main>

<footer class="foot">
  <div class="in">
    <p class="credit">${credit("s")}<br>${credit("f")}</p>
    <p class="links"><a href="${privacy}">${esc(t.privacy)}</a><a href="mailto:contact@lexoula.gr">${esc(t.contact)} · contact@lexoula.gr</a></p>
    <p class="langs">${LANGS.map((x) => `<a href="${base}${pathOf(x) || "./"}" lang="${x}" hreflang="${x}" data-lang="${x}"${x === l ? ' aria-current="true"' : ""}>${LANG_NAMES[x]}</a>`).join("")}</p>
    <p class="rights">${esc(t.rights)}</p>
  </div>
</footer>
<script src="${base}site.js" defer></script>
</body>
</html>
`;
}

// petit motif « QR » décoratif, déterministe (pas un vrai code)
function qr() {
  let seed = 7, out = "";
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const finder = (x, y) => `<path d="M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5zM${x + 2} ${y + 2}h3v3h-3z" fill-rule="evenodd"/>`;
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
    const inFinder = (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
    if (!inFinder && rnd() > 0.52) out += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }
  return finder(0, 0) + finder(14, 0) + finder(0, 14) + out;
}

// ─────────────────────────────────────────── écriture
mkdirSync(OUT, { recursive: true });
for (const l of LANGS) {
  const dir = l === "en" ? OUT : join(OUT, l);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), page(l));
}
// une seule feuille de style : polices auto-hébergées puis styles de la page
writeFileSync(join(OUT, "site.css"), readFileSync(join(here, "fonts.css"), "utf8") + "\n" + readFileSync(join(here, "site.css"), "utf8"));
mkdirSync(join(OUT, "fonts"), { recursive: true });
for (const f of readdirSync(join(here, "fonts"))) copyFileSync(join(here, "fonts", f), join(OUT, "fonts", f));
copyFileSync(join(here, "site.js"), join(OUT, "site.js"));
for (const f of ["favicon-64.png", "apple-touch-icon.png"]) copyFileSync(join(here, "..", "public", f), join(OUT, f));
try { copyFileSync(join(here, "og.png"), join(OUT, "og.png")); } catch { /* image de partage pas encore générée */ }
if (CNAME) writeFileSync(join(OUT, "CNAME"), CNAME + "\n");
writeFileSync(join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
writeFileSync(join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${LANGS.map((l) => `  <url><loc>${SITE}${pathOf(l)}</loc>${LANGS.map((x) => `<xhtml:link rel="alternate" hreflang="${x}" href="${SITE}${pathOf(x)}"/>`).join("")}</url>`).join("\n")}\n</urlset>\n`);
console.log(`Vitrine : ${LANGS.length} langues → ${OUT}`);
