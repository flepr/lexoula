// Vitrine lexoula.gr : démo animée du téléphone (non interactive) et mémoire du choix de langue.
(function () {
  "use strict";

  // langue choisie à la main : ne plus rediriger d'office depuis la page anglaise
  document.querySelectorAll("a[data-lang]").forEach(function (a) {
    a.addEventListener("click", function () { try { localStorage.setItem("lx_site_lang", a.dataset.lang); } catch (e) {} });
  });
  // menu des langues : se ferme en cliquant ailleurs ou avec Échap
  var menu = document.querySelector(".lang");
  if (menu) {
    document.addEventListener("click", function (e) { if (menu.open && !menu.contains(e.target)) menu.open = false; });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && menu.open) { menu.open = false; menu.querySelector("summary").focus(); } });
  }

  var demo = document.querySelector("[data-demo]");
  if (!demo) return;
  var screen = demo.querySelector(".p-screen");
  var scenes = Array.prototype.slice.call(demo.querySelectorAll(".p-scene"));
  var finger = demo.querySelector(".p-finger");
  var cap = demo.querySelector("[data-cap]");
  var dots = Array.prototype.slice.call(demo.querySelectorAll("[data-go]"));
  var toggle = demo.querySelector("[data-toggle]");
  var caps = JSON.parse(demo.querySelector("[data-caps]").textContent);
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // date du jour dans la langue de la page, comme dans l'appli
  var dateEl = demo.querySelector("[data-date]");
  if (dateEl) {
    try { dateEl.textContent = new Date().toLocaleDateString(demo.dataset.lang, { weekday: "long", day: "numeric", month: "long" }); } catch (e) {}
  }

  // chaque scène : durée, puis gestes (instant en ms, effet)
  function tapAt(el) {
    if (!el || reduce) return;
    var s = screen.getBoundingClientRect(), r = el.getBoundingClientRect();
    finger.style.left = (r.left - s.left + r.width / 2) + "px";
    finger.style.top = (r.top - s.top + r.height / 2) + "px";
    finger.classList.remove("tap"); void finger.offsetWidth; finger.classList.add("tap");
  }
  var q = function (sc, sel) { return sc.querySelector(sel); };
  var PLAN = [
    { d: 5200, steps: [[2600, function (sc) { var b = q(sc, "[data-tap]"); tapAt(b); b.classList.add("pressed"); }], [2900, function (sc) { q(sc, "[data-tap]").classList.remove("pressed"); }]] },
    { d: 5600, steps: [[1900, function (sc) { var o = q(sc, "[data-right]"); tapAt(o); o.classList.add("right"); }], [2350, function (sc) { sc.classList.add("reveal"); }]] },
    { d: 6200, steps: [[2300, function (sc) { var o = q(sc, "[data-right]"); tapAt(o); o.classList.add("right"); var b = q(sc, "[data-fill]"); b.textContent = b.dataset.fill; }], [2750, function (sc) { sc.classList.add("reveal"); }]] },
    { d: 5400, steps: [[2400, function (sc) { var s = q(sc, "[data-tap]"); tapAt(s); s.classList.add("on"); }]] },
    { d: 6400, steps: [[2100, function (sc) { var u = q(sc, "[data-tap]"); tapAt(u); u.classList.add("lit"); }], [2450, function (sc) { sc.classList.add("reveal"); }]] },
    { d: 5200, steps: [[350, function (sc) { sc.classList.add("reveal"); }]] },
  ];

  function reset(sc) {
    sc.classList.remove("reveal");
    sc.querySelectorAll("[data-tap],[data-right]").forEach(function (el) { el.classList.remove("right", "on", "lit", "pressed"); });
    var b = q(sc, "[data-fill]"); if (b) b.innerHTML = "&nbsp;";
  }

  var cur = -1, timers = [], playing = !reduce, visible = true;
  function clear() { timers.forEach(clearTimeout); timers = []; }
  function show(i, animate) {
    clear();
    cur = (i + scenes.length) % scenes.length;
    var sc = scenes[cur];
    scenes.forEach(function (s, k) { if (k !== cur) { s.classList.remove("on"); } });
    reset(sc);
    sc.classList.add("on");
    cap.textContent = caps[cur];
    dots.forEach(function (d, k) { d.setAttribute("aria-current", k === cur ? "true" : "false"); });
    var plan = PLAN[cur];
    if (!animate) { plan.steps.forEach(function (st) { st[1](sc); }); return; }
    plan.steps.forEach(function (st) { timers.push(setTimeout(function () { st[1](sc); }, st[0])); });
    timers.push(setTimeout(function () { if (playing && visible) show(cur + 1, true); }, plan.d));
  }
  function setPlaying(p) {
    playing = p;
    demo.classList.toggle("paused", !p);
    toggle.setAttribute("aria-label", p ? toggle.dataset.lPause : toggle.dataset.lPlay);
    if (p && visible) show(cur + 1 > 0 ? cur : 0, true); else clear();
  }
  toggle.addEventListener("click", function () { setPlaying(!playing); });
  dots.forEach(function (d) { d.addEventListener("click", function () { show(+d.dataset.go, playing && visible); }); });

  // ne tourner que lorsque la démo est visible
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) {
      var v = es[0].isIntersecting;
      if (v === visible) return;
      visible = v;
      if (visible && playing) show(cur, true); else clear();
    }, { threshold: 0.25 }).observe(demo);
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) clear(); else if (playing && visible) show(cur, true);
  });

  show(0, playing);
  if (!playing) { demo.classList.add("paused"); toggle.setAttribute("aria-label", toggle.dataset.lPlay); }
})();
