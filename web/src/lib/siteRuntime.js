// Ported from the design-tool export's site/site.js — the shared subpage
// runtime (scroll-synced nav chrome, mobile menu, scroll-reveal). Converted
// from a `window.initLoadbytonSite = function () {...}` global into a real
// ES module export, called from a `useEffect` in the SitePage wrapper
// (components/marketing/SubKit.jsx) — same call site the export itself
// used, just importing a real function instead of reading one off `window`.
//
// Two things from the original were intentionally dropped rather than
// ported:
//  - The "current page" nav-link highlighting that manually compared
//    `location.pathname` against each link's raw `href` — react-router's
//    <NavLink> (used throughout components/marketing/SiteChrome.jsx)
//    already does this natively and correctly, including on client-side
//    navigation, so a second parallel mechanism would be redundant.
//  - The full-page-navigation click interceptor (add `html.lb-leaving`,
//    fade out, then `location.href = href`) — it only ever mattered
//    between static `.html` documents; every link in the ported app is a
//    real react-router <Link>, which already transitions client-side with
//    no full reload, so there is nothing left for it to intercept.
//
// Home (pages/Home.jsx) uses lib/homeRuntime.js instead, which owns its own
// copy of this same nav/menu/reveal wiring (see that file) — matching the
// original export's own `if (window.initLoadbytonHome) return` guard, this
// function is simply never called on the Home page.
export function initSiteRuntime() {
  const teardowns = [];
  const onGlobal = (target, ev, fn, opts) => {
    target.addEventListener(ev, fn, opts);
    teardowns.push(() => target.removeEventListener(ev, fn, opts));
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const nav = $('#nav'), progress = $('#progress');
  const sync = () => {
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 35);
    if (progress) { const max = document.documentElement.scrollHeight - innerHeight; progress.style.width = (max > 0 ? scrollY / max * 100 : 0) + '%'; }
  };
  let ticking = false;
  onGlobal(window, 'scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { sync(); ticking = false; }); }, { passive: true });
  sync();

  const menu = $('#menu'), mn = $('#mobileNav');
  const setMenu = (open) => {
    if (!mn || !menu) return;
    mn.classList.toggle('open', open);
    menu.textContent = open ? '×' : '☰';
    menu.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('lock', open);
  };
  const onMenuClick = () => setMenu(!mn.classList.contains('open'));
  if (menu) menu.addEventListener('click', onMenuClick);
  teardowns.push(() => menu && menu.removeEventListener('click', onMenuClick));
  $$('#mobileNav a').forEach((a) => a.addEventListener('click', () => setMenu(false)));

  onGlobal(document, 'keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('show', 'in'); io.unobserve(en.target); } }), { threshold: 0.12 });
  $$('.mkt-reveal, .pcard').forEach((el) => io.observe(el));
  teardowns.push(() => io.disconnect());

  return function destroySiteRuntime() {
    teardowns.forEach((fn) => fn());
    document.body.classList.remove('lock');
  };
}
