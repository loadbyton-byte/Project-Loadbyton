// Ported from the design-tool export's home/home-runtime.js — the Home
// page's imperative behaviour (scroll reveal, mobile menu, hero slideshow,
// the "problem" scene theater, notification/WhatsApp simulations, the
// stories carousel, the FAQ accordion, and the local-only demo marketplace:
// post-a-load / bid overlays / job drawer / command palette / toasts — all
// client-side fake state, no server calls).
//
// Converted from a `window.initLoadbytonHome = function () {...}` global
// (set by a non-module script tag) into a real ES module export, called
// from a `useEffect` in pages/Home.jsx — same shape the export's own
// SitePage wrapper used (`useEffect(() => window.initLoadbytonSite(), [])`),
// just a real import instead of a window global. Never touches
// window/document outside this function, so importing this module is safe
// even though the module graph it sits in is also reachable during SSR
// (the function itself is only ever called client-side, after mount).
//
// Every `setInterval` is tracked and cleared, and every listener attached
// to `window`/`document` (as opposed to an element inside the page, which
// React unmounts along with its listeners) is removed, by the cleanup
// function this returns — called from the effect's own cleanup so a second
// mount (route away and back) never doubles up timers/listeners.
export function initHomeRuntime() {
  const timers = [];
  const teardowns = [];
  const setIntervalTracked = (fn, ms) => {
    const id = setInterval(fn, ms);
    timers.push(id);
    return id;
  };
  const onGlobal = (target, ev, fn, opts) => {
    target.addEventListener(ev, fn, opts);
    teardowns.push(() => target.removeEventListener(ev, fn, opts));
  };

  const lbScrollTo = (el) => {
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72, behavior: 'smooth' });
  };

  (() => {
    'use strict';

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const on = (el, ev, fn, opts) => {
      if (!el) return;
      el.addEventListener(ev, fn, opts);
      teardowns.push(() => el.removeEventListener(ev, fn, opts));
    };

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
    ));

    const fmtDate = (d) => {
      if (!d) return '—';
      try { return new Date(d + 'T12:00:00').toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' }); }
      catch { return d; }
    };

    const money = (n) => 'AED ' + Number(n || 0).toLocaleString('en-US');

    const toast = (title, msg = '') => {
      const root = $('#toasts'); if (!root) return;
      const el = document.createElement('div');
      el.className = 'toast';
      el.innerHTML = `<b>${esc(title)}</b><span>${esc(msg)}</span>`;
      root.appendChild(el);
      setTimeout(() => el.remove(), 3200);
    };

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const syncLock = () => {
      const anyOpen = document.querySelector(
        '#mobileNav.open, .overlay.open, #drawerWrap.open, #commandOverlay.open'
      );
      document.body.classList.toggle('lock', !!anyOpen);
    };

    const closeMobileNav = () => {
      const mn = $('#mobileNav'); if (!mn) return;
      if (mn.classList.contains('open')) {
        mn.classList.remove('open');
        const m = $('#menu');
        if (m) { m.textContent = '☰'; m.setAttribute('aria-expanded', 'false'); }
      }
    };

    const nav = $('#nav');
    const progress = $('#progress');
    let ticking = false;

    const syncScroll = () => {
      if (nav) nav.classList.toggle('scrolled', window.scrollY > 35);
      if (progress) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
      }
    };

    onGlobal(window, 'scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { syncScroll(); ticking = false; });
    }, { passive: true });
    syncScroll();

    on($('#menu'), 'click', () => {
      const mn = $('#mobileNav'); if (!mn) return;
      const open = mn.classList.toggle('open');
      const m = $('#menu');
      if (m) { m.textContent = open ? '×' : '☰'; m.setAttribute('aria-expanded', String(open)); }
      syncLock();
    });
    $$('#mobileNav a').forEach((a) => on(a, 'click', () => { closeMobileNav(); syncLock(); }));

    const revealIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('show'); revealIO.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    $$('.mkt-reveal').forEach((el) => revealIO.observe(el));
    teardowns.push(() => revealIO.disconnect());

    /* Hero slideshow */
    (() => {
      const slides = $$('.hero-slide');
      const dots = $$('.hero-dot');
      if (!slides.length || !dots.length) return;
      let index = 0;
      let timer = null;
      const INTERVAL = 6500;

      const set = (i) => {
        index = i;
        slides.forEach((s, j) => s.classList.toggle('active', j === i));
        dots.forEach((d, j) => {
          const active = j === i;
          d.classList.toggle('active', active);
          d.setAttribute('aria-selected', String(active));
        });
        if (timer) clearInterval(timer);
        if (!prefersReduced) { timer = setIntervalTracked(() => set((index + 1) % slides.length), INTERVAL); }
      };

      dots.forEach((d, i) => on(d, 'click', () => set(i)));
      set(0);

      onGlobal(document, 'visibilitychange', () => {
        if (document.hidden && timer) { clearInterval(timer); timer = null; }
        else if (!document.hidden && !prefersReduced) set(index);
      });
    })();

    /* Problem theater */
    (() => {
      const steps = $$('.pstep');
      const scenes = $$('.problem-scene');
      if (!steps.length || !scenes.length) return;

      const obs = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const i = Number(e.target.dataset.pscene);
          steps.forEach((s, j) => s.classList.toggle('active', i === j));
          scenes.forEach((s, j) => s.classList.toggle('active', i === j));
        });
      }, { rootMargin: '-35% 0px -45% 0px' });

      steps.forEach((s) => obs.observe(s));
      teardowns.push(() => obs.disconnect());
    })();

    /* Notification storm */
    (() => {
      const list = $('#notifList');
      const counter = $('#unreadCount');
      if (!list || !counter) return;

      const data = [
        { icon: 'W', cls: 'wa', title: 'Transporter Ops', text: 'Driver changed. New number sent.', time: 'now' },
        { icon: '☎', cls: 'call', title: 'Missed call', text: 'Driver 127 · 2 missed calls', time: '1m' },
        { icon: '✉', cls: 'mail', title: 'Shipper Ops', text: 'RE: Gate appointment changed', time: '2m' },
        { icon: 'W', cls: 'wa', title: 'Warehouse', text: 'Slot moved to 15:00.', time: '2m' },
        { icon: 'X', cls: 'sheet', title: 'Rate sheet', text: 'Rate_sheet_FINAL_v7 updated', time: '3m' },
        { icon: 'P', cls: 'doc', title: 'POD request', text: 'Need signed POD before 17:30', time: '4m' },
      ];

      let i = 0, unread = 12;
      const paint = () => { counter.textContent = unread > 99 ? '99+' : String(unread); };

      const build = (n) => {
        const el = document.createElement('div');
        el.className = 'notif';
        el.innerHTML =
          `<div class="icon ${n.cls}">${n.icon}</div>` +
          `<div><b>${esc(n.title)}</b><p>${esc(n.text)}</p></div>` +
          `<time>${esc(n.time)}</time>`;
        return el;
      };

      data.slice(0, 4).forEach((n) => list.appendChild(build(n)));

      setIntervalTracked(() => {
        if (document.hidden) return;
        list.prepend(build(data[i++ % data.length]));
        while (list.children.length > 6) list.lastElementChild.remove();
        unread++; paint();
      }, 2000);
    })();

    /* WhatsApp flow */
    (() => {
      const body = $('#waBody');
      if (!body) return;
      const flow = [
        ['Can you confirm new driver plate?', 'me'],
        ['Truck is now inside gate 4.', ''],
        ['Rate in email is different from sheet.', ''],
        ['Please use the latest one. Which file?', 'me'],
        ['POD will be shared after unloading.', ''],
        ['Warehouse says slot moved again.', ''],
      ];
      let i = 0;
      setIntervalTracked(() => {
        if (document.hidden) return;
        const [text, me] = flow[i++ % flow.length];
        const el = document.createElement('div');
        el.className = 'msg' + (me ? ' me' : '');
        el.innerHTML = `${esc(text)}<time>now</time>`;
        body.appendChild(el);
        while (body.children.length > 6) body.firstElementChild.remove();
      }, 2800);
    })();

    /* Process cards reveal (staggered top border + bar) */
    (() => {
      const cards = $$('.pcard');
      if (!cards.length) return;
      const obs = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            obs.unobserve(e.target);
          }
        });
      }, { threshold: 0.2 });
      cards.forEach((c) => obs.observe(c));
      teardowns.push(() => obs.disconnect());
    })();

    /* Trust band */
    (() => {
      $$('.lb-trust-card').forEach((c, i) => {
        setTimeout(() => c.classList.add('on'), 120 + i * 110);
      });

      const track = $('#lbTickerTrack');
      if (!track) return;
      const events = [
        ['Bid received', 'Load LBT-1042 · AED 1,450 · Falcon Road Cargo'],
        ['Driver assigned', 'Job LBT-1038 · Dubai → Sharjah'],
        ['POD uploaded', 'Job LBT-1027 · Jebel Ali → Abu Dhabi'],
        ['Gate slot confirmed', 'Load LBT-1042 · 15:00 · Jebel Ali'],
        ['Status updated', 'Job LBT-1038 · In transit'],
        ['Document added', 'Load LBT-1043 · Container details'],
        ['Response accepted', 'Load LBT-1042 · Falcon Road Cargo'],
        ['Delivery confirmed', 'Job LBT-1027 · 17:32'],
      ];
      const html = events.map((e) => `<span><i></i><b>${esc(e[0])}</b> · ${esc(e[1])}</span>`).join('');
      track.innerHTML = html + html;
    })();

    /* Device tabs */
    $$('.device-tabs').forEach((group) => {
      $$('button', group).forEach((btn) => {
        on(btn, 'click', () => {
          $$('button', group).forEach((b) => b.classList.toggle('active', b === btn));
        });
      });
    });

    /* Stories carousel */
    on($('#storyNext'), 'click', () => {
      const t = $('#cardTrack'); if (!t) return;
      t.scrollBy({ left: 430, behavior: 'smooth' });
    });
    on($('#storyPrev'), 'click', () => {
      const t = $('#cardTrack'); if (!t) return;
      t.scrollBy({ left: -430, behavior: 'smooth' });
    });

    /* FAQ */
    $$('.faq-q').forEach((q) => {
      on(q, 'click', () => {
        const item = q.closest('.faq-item');
        const panel = item && item.querySelector('.faq-a');
        if (!item || !panel) return;
        const open = item.classList.toggle('open');
        q.setAttribute('aria-expanded', String(open));
        panel.style.maxHeight = open ? panel.scrollHeight + 'px' : '0px';
      });
    });

    /* Demo data */
    const KEY = 'loadbyton_corporate_demo_v2';

    const seed = [
      { id: 'LB-1042', pickup: 'Jebel Ali', delivery: 'Dubai South', equipment: '40ft HC', date: '2026-09-18', status: 'OPEN', responses: 3, cargo: 'Containerized cargo', notes: 'Gate appointment required',
        messages: [
          { mine: false, text: 'Gate slot confirmed for 14:00.', time: '09:31' },
          { mine: true, text: 'Received. Driver details added.', time: '09:36' },
        ],
        documents: ['Packing_List_LB1042.pdf', 'Container_Details.pdf'],
        events: ['Load posted', 'First transporter response received', 'Documents added'],
        bids: [
          { name: 'Transporter A', amount: 1450, availability: 'Available today' },
          { name: 'Transporter B', amount: 1520, availability: 'Available today' },
          { name: 'Transporter C', amount: 1590, availability: 'Available tomorrow' },
        ] },
      { id: 'LB-1043', pickup: 'Khalifa Port', delivery: 'Mussafah', equipment: '20ft', date: '2026-09-19', status: 'OPEN', responses: 2, cargo: 'Containerized cargo', notes: '',
        messages: [], documents: [], events: ['Load posted', 'Two transporter responses received'], bids: [] },
      { id: 'LB-1038', pickup: 'Dubai Industrial City', delivery: 'Sharjah', equipment: 'FTL', date: '2026-09-18', status: 'IN PROGRESS', responses: 4, cargo: 'General cargo', notes: '',
        messages: [], documents: ['Delivery_Note.pdf'], events: ['Load posted', 'Transporter selected', 'Pickup confirmed', 'In transit'], bids: [] },
      { id: 'LB-1027', pickup: 'Jebel Ali', delivery: 'Abu Dhabi', equipment: 'Reefer', date: '2026-09-15', status: 'COMPLETED', responses: 5, cargo: 'Temperature controlled', notes: '',
        messages: [], documents: ['POD_LB1027.pdf'], events: ['Load posted', 'Transporter selected', 'Pickup confirmed', 'Delivered', 'POD added'], bids: [] },
      { id: 'LB-1044', pickup: 'Al Quoz', delivery: 'Ras Al Khaimah', equipment: 'LTL', date: '2026-09-21', status: 'DRAFT', responses: 0, cargo: 'Palletised cargo', notes: '',
        messages: [], documents: [], events: ['Draft created'], bids: [] },
    ];

    let loads;
    try { loads = JSON.parse(localStorage.getItem(KEY)) || null; } catch { loads = null; }
    if (!Array.isArray(loads) || !loads.length) loads = seed.map((x) => JSON.parse(JSON.stringify(x)));
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(loads)); } catch { /* ignore */ } };

    let role = 'shipper';
    let view = 'loads';
    let current = null;

    const grid = $('#grid');
    const searchInput = $('#search');
    const statusFilter = $('#statusFilter');
    const equipmentFilter = $('#equipmentFilter');
    const filtersBar = $('#filters');
    const demoTitle = $('#demoTitle');
    const demoSub = $('#demoSub');

    const statusClass = (s) =>
      s === 'OPEN' ? 'st-open' :
      s === 'IN PROGRESS' ? 'st-progress' :
      s === 'COMPLETED' ? 'st-complete' : 'st-draft';

    const filtered = () => {
      const q = (searchInput.value || '').toLowerCase().trim();
      const s = statusFilter.value;
      const e = equipmentFilter.value;
      return loads.filter((l) =>
        (!q || [l.id, l.pickup, l.delivery, l.equipment].join(' ').toLowerCase().includes(q)) &&
        (!s || l.status === s) &&
        (!e || l.equipment === e)
      );
    };

    const renderGrid = () => {
      if (!grid) return;

      let arr = filtered();
      if (view === 'jobs') arr = loads.filter((l) => l.status === 'IN PROGRESS');
      if (view === 'history') arr = loads.filter((l) => l.status === 'COMPLETED');

      if (view === 'messages') {
        grid.innerHTML = '<div class="empty"><strong>Messages stay with each job.</strong>Open a load to view or send operational messages.</div>';
        return;
      }

      if (view === 'documents') {
        const docs = loads.flatMap((l) => (l.documents || []).map((f) => ({
          load: l.id, file: f, route: `${l.pickup} → ${l.delivery}`,
        })));
        grid.innerHTML = docs.length
          ? `<table><thead><tr><th>Document</th><th>Load</th><th>Route</th><th></th></tr></thead><tbody>${
            docs.map((d) => `<tr><td><b>${esc(d.file)}</b></td><td>${esc(d.load)}</td><td>${esc(d.route)}</td><td><button class="action" data-open="${esc(d.load)}" type="button">Open job</button></td></tr>`).join('')
          }</tbody></table>`
          : '<div class="empty"><strong>No demo documents yet.</strong>Add files from a load detail.</div>';
        bindGridActions();
        return;
      }

      if (!arr.length) {
        grid.innerHTML = '<div class="empty"><strong>No loads match.</strong>Change filters or create a load.</div>';
        return;
      }

      grid.innerHTML = `<table><thead><tr>
      <th>Reference</th><th>Route</th><th>Equipment</th><th>Date</th><th>Status</th>
      <th>${role === 'shipper' ? 'Responses' : 'Opportunity'}</th><th></th>
    </tr></thead><tbody>${
        arr.map((l) => `<tr>
        <td><b>${esc(l.id)}</b></td>
        <td class="route-cell"><b>${esc(l.pickup)} → ${esc(l.delivery)}</b><small>${esc(l.cargo)}</small></td>
        <td>${esc(l.equipment)}</td>
        <td>${fmtDate(l.date)}</td>
        <td><span class="status ${statusClass(l.status)}">${esc(l.status)}</span></td>
        <td>${role === 'shipper'
          ? `${l.responses || 0} response${l.responses === 1 ? '' : 's'}`
          : (l.status === 'OPEN' ? '<b style="color:#23a16f">Available</b>' : '—')}</td>
        <td>${role === 'transporter' && l.status === 'OPEN'
          ? `<button class="action" data-bid="${esc(l.id)}" type="button">Respond</button>`
          : `<button class="action" data-open="${esc(l.id)}" type="button">Open</button>`}</td>
      </tr>`).join('')
      }</tbody></table>`;
      bindGridActions();
    };

    const bindGridActions = () => {
      $$('[data-open]').forEach((b) => on(b, 'click', () => openDrawer(b.dataset.open)));
      $$('[data-bid]').forEach((b) => on(b, 'click', () => openBid(b.dataset.bid)));
    };

    [searchInput, statusFilter, equipmentFilter].forEach((el) => on(el, 'input', renderGrid));
    on($('#clearFilters'), 'click', () => {
      if (searchInput) searchInput.value = '';
      if (statusFilter) statusFilter.value = '';
      if (equipmentFilter) equipmentFilter.value = '';
      renderGrid();
    });

    $$('#roleSwitch button').forEach((b) => on(b, 'click', () => {
      role = b.dataset.role;
      $$('#roleSwitch button').forEach((x) => {
        const active = x === b;
        x.classList.toggle('active', active);
        x.setAttribute('aria-selected', String(active));
      });
      if (demoTitle) demoTitle.textContent = role === 'shipper' ? 'Open Loads' : 'Freight Opportunities';
      if (demoSub) demoSub.textContent = role === 'shipper'
        ? 'Freight requirements in the local interactive workspace.'
        : 'Open freight viewed from the transporter perspective.';
      renderGrid();
      toast(role === 'shipper' ? 'Shipper view' : 'Transporter view', 'Workspace switched.');
    }));

    $$('#demoSide button').forEach((b) => on(b, 'click', () => {
      view = b.dataset.view;
      $$('#demoSide button').forEach((x) => x.classList.toggle('active', x === b));
      const names = {
        loads: role === 'shipper' ? 'Open Loads' : 'Freight Opportunities',
        jobs: 'My Jobs',
        messages: 'Messages',
        documents: 'Documents',
        history: 'Job History',
      };
      if (demoTitle) demoTitle.textContent = names[view];
      if (filtersBar) filtersBar.classList.toggle('hidden', !['loads', 'jobs', 'history'].includes(view));
      renderGrid();
    }));

    renderGrid();

    /* Overlays */
    const openOverlay = (o) => { if (!o) return; closeMobileNav(); o.classList.add('open'); syncLock(); };
    const closeOverlay = (o) => { if (!o) return; o.classList.remove('open'); syncLock(); };

    $$('[data-close]').forEach((b) => on(b, 'click', () => closeOverlay(b.closest('.overlay'))));
    $$('.overlay').forEach((o) => on(o, 'mousedown', (e) => { if (e.target === o) closeOverlay(o); }));

    /* Post a load */
    (() => {
      const overlay = $('#postOverlay');
      const form = $('#postForm');
      const back = $('#back');
      const next = $('#nextStep');
      const summary = $('#summary');
      if (!overlay || !form || !back || !next) return;

      let step = 0;
      const TOTAL = 3;

      const syncStep = () => {
        $$('.form-step', form).forEach((s, i) => s.classList.toggle('hidden', i !== step));
        $$('.step-dot', overlay).forEach((d, i) => d.classList.toggle('active', i <= step));
        back.disabled = step === 0;
        next.textContent = step === TOTAL ? 'Create demo load' : 'Continue →';

        if (step === TOTAL && summary) {
          const f = new FormData(form);
          const rows = [
            ['Route', `${f.get('pickup') || '—'} → ${f.get('delivery') || '—'}`],
            ['Equipment', f.get('equipment') || '—'],
            ['Pickup', fmtDate(f.get('date'))],
            ['Cargo', f.get('cargo') || 'Not specified'],
          ];
          summary.innerHTML = rows
            .map((r) => `<div class="sum-row"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`)
            .join('');
        }
      };

      const validate = () => {
        const required = $$('.form-step[data-step="' + step + '"] [required]', form);
        for (const el of required) {
          if (!el.value) { el.focus(); toast('Complete required fields'); return false; }
        }
        return true;
      };

      const createLoad = () => {
        const f = new FormData(form);
        const maxN = loads.reduce((m, l) => Math.max(m, Number(String(l.id || '').split('-')[1]) || 0), 0);
        const load = {
          id: 'LB-' + (maxN + 1),
          pickup: f.get('pickup') || '',
          delivery: f.get('delivery') || '',
          equipment: f.get('equipment') || '',
          date: f.get('date') || '',
          status: 'OPEN',
          responses: 0,
          cargo: f.get('cargo') || 'Freight',
          notes: f.get('notes') || '',
          messages: [],
          documents: [],
          events: ['Load created in demo workspace'],
          bids: [],
        };
        loads.unshift(load);
        save();

        view = 'loads';
        $$('#demoSide button').forEach((x) => x.classList.toggle('active', x.dataset.view === 'loads'));
        if (demoTitle) demoTitle.textContent = role === 'transporter' ? 'Freight Opportunities' : 'Open Loads';
        if (filtersBar) filtersBar.classList.remove('hidden');
        renderGrid();

        form.reset();
        closeOverlay(overlay);
        toast('Load created', `${load.id} added to the demo.`);
        const demo = $('#demo'); if (demo) lbScrollTo(demo);
      };

      const advance = () => {
        if (step < TOTAL) {
          if (!validate()) return;
          step++; syncStep();
          return;
        }
        createLoad();
      };

      $$('[data-post]').forEach((b) => on(b, 'click', (e) => {
        e.preventDefault();
        step = 0; syncStep(); openOverlay(overlay);
      }));

      on(next, 'click', advance);
      on(back, 'click', () => { if (step > 0) { step--; syncStep(); } });
      on(form, 'submit', (e) => { e.preventDefault(); advance(); });
    })();

    /* Bid submit */
    (() => {
      const overlay = $('#bidOverlay');
      const form = $('#bidForm');
      const submit = $('#submitBid');
      if (!overlay || !form || !submit) return;

      const submitBid = () => {
        const f = new FormData(form);
        const l = loads.find((x) => x.id === f.get('loadId'));
        const amt = Number(f.get('amount'));
        if (!l || !amt) { toast('Enter an offer amount'); return; }

        l.bids = l.bids || [];
        l.bids.push({
          name: 'Your transporter',
          amount: amt,
          availability: f.get('availability'),
        });
        l.responses = (l.responses || 0) + 1;
        l.events = l.events || [];
        l.events.push('New transporter response submitted');
        save(); renderGrid(); closeOverlay(overlay); form.reset();
        toast('Response submitted', `${money(amt)} added to ${l.id}.`);
      };

      on(submit, 'click', submitBid);
      on(form, 'submit', (e) => { e.preventDefault(); submitBid(); });
    })();

    const openBid = (id) => {
      const overlay = $('#bidOverlay');
      const form = $('#bidForm');
      const label = $('#bidLabel');
      const l = loads.find((x) => x.id === id);
      if (!overlay || !form || !l) return;
      const hidden = form.querySelector('input[name="loadId"]');
      if (hidden) hidden.value = id;
      if (label) label.textContent = `${id} · ${l.pickup} → ${l.delivery}`;
      openOverlay(overlay);
    };

    /* Drawer */
    const drawer = $('#drawerWrap');
    const closeDrawer = () => { if (drawer) { drawer.classList.remove('open'); syncLock(); } };

    const renderFiles = () => {
      if (!current) return;
      const list = $('#fileList'); if (!list) return;
      list.innerHTML = (current.documents || []).length
        ? current.documents.map((f) => `<div class="file-row"><b>${esc(f)}</b><span>Attached</span></div>`).join('')
        : '<div class="empty" style="padding:22px 10px"><strong>No documents yet.</strong></div>';
    };

    const renderDrawer = () => {
      const l = current; if (!l) return;

      const ov = $('#overviewPanel');
      if (ov) ov.innerHTML = `<div class="summary">
      <div class="sum-row"><span>Route</span><b>${esc(l.pickup)} → ${esc(l.delivery)}</b></div>
      <div class="sum-row"><span>Equipment</span><b>${esc(l.equipment)}</b></div>
      <div class="sum-row"><span>Pickup</span><b>${fmtDate(l.date)}</b></div>
      <div class="sum-row"><span>Status</span><b>${esc(l.status)}</b></div>
      <div class="sum-row"><span>Responses</span><b>${l.responses || 0}</b></div>
    </div>`;

      const rp = $('#responsesPanel');
      if (rp) rp.innerHTML = (l.bids || []).length
        ? l.bids.map((b) => `<div style="display:flex;justify-content:space-between;gap:14px;padding:13px;border:1px solid var(--line);border-radius:10px;margin:7px 0;font-size:9px">
          <div><b>${esc(b.name)}</b><br><small style="color:#84939b">${esc(b.availability)}</small></div>
          <b class="mono">${money(b.amount)}</b>
        </div>`).join('')
        : '<div class="empty"><strong>No responses yet.</strong></div>';

      const ml = $('#messageList');
      if (ml) ml.innerHTML = (l.messages || []).length
        ? l.messages.map((m) => `<div class="message ${m.mine ? 'mine' : ''}">${esc(m.text)}<small>${esc(m.time || 'Now')}</small></div>`).join('')
        : '<div class="empty" style="padding:24px 10px"><strong>No messages yet.</strong></div>';

      renderFiles();

      const el = $('#eventList');
      if (el) el.innerHTML = (l.events || []).map((e, i) =>
        `<div class="event-item"><b>${esc(e)}</b><small>Demo event ${String(i + 1).padStart(2, '0')}</small></div>`
      ).join('');
    };

    const openDrawer = (id) => {
      current = loads.find((x) => x.id === id);
      if (!current || !drawer) return;

      const t = $('#drawerTitle'); if (t) t.textContent = current.id;
      const s = $('#drawerSub'); if (s) s.textContent = `${current.pickup} → ${current.delivery} · ${current.equipment}`;

      $$('.tab').forEach((x, i) => {
        const active = i === 0;
        x.classList.toggle('active', active);
        x.setAttribute('aria-selected', String(active));
      });
      $$('.drawer-panel').forEach((p, i) => p.classList.toggle('active', i === 0));

      renderDrawer();
      drawer.classList.add('open');
      syncLock();
    };

    on($('#drawerClose'), 'click', closeDrawer);
    on(drawer, 'mousedown', (e) => { if (e.target === drawer) closeDrawer(); });

    $$('.tab').forEach((t) => on(t, 'click', () => {
      $$('.tab').forEach((x) => {
        const active = x === t;
        x.classList.toggle('active', active);
        x.setAttribute('aria-selected', String(active));
      });
      $$('.drawer-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === t.dataset.tab));
    }));

    on($('#sendMessage'), 'click', () => {
      const inp = $('#messageInput');
      if (!inp || !current) return;
      const text = inp.value.trim();
      if (!text) return;
      current.messages = current.messages || [];
      current.messages.push({
        mine: true, text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      current.events = current.events || [];
      current.events.push('Operational message added');
      save();
      inp.value = '';
      renderDrawer();
      toast('Message added');
    });

    on($('#messageInput'), 'keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('#sendMessage')?.click(); }
    });

    /* Doc drop */
    (() => {
      const drop = $('#drop');
      const input = $('#fileInput');
      if (!drop || !input) return;

      const addFiles = (files) => {
        if (!current || !files.length) return;
        current.documents = current.documents || [];
        files.forEach((f) => current.documents.push(f.name));
        current.events = current.events || [];
        current.events.push(`${files.length} document${files.length > 1 ? 's' : ''} added`);
        save(); renderFiles(); renderGrid();
        toast('Documents added');
      };

      on(drop, 'click', () => input.click());
      on(drop, 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
      ['dragenter', 'dragover'].forEach((ev) => on(drop, ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach((ev) => on(drop, ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
      on(drop, 'drop', (e) => addFiles(Array.from(e.dataTransfer.files)));
      on(input, 'change', () => addFiles(Array.from(input.files)));
    })();

    /* Command palette */
    const cmd = $('#commandOverlay');
    const cmdSearch = $('#commandSearch');
    const cmdList = $('#commandList');

    const commands = [
      { label: 'Post a Load', key: 'P', run: () => { closeCmd(); $$('[data-post]')[0]?.click(); } },
      { label: 'See problem animation', key: '1', run: () => { closeCmd(); lbScrollTo($('#problem')); } },
      { label: 'Open solution', key: '2', run: () => { closeCmd(); lbScrollTo($('#solution')); } },
      { label: 'Open process', key: '3', run: () => { closeCmd(); lbScrollTo($('#process')); } },
      { label: 'Open devices', key: '4', run: () => { closeCmd(); lbScrollTo($('#devices')); } },
      { label: 'Open demo', key: 'D', run: () => { closeCmd(); lbScrollTo($('#demo')); } },
      { label: 'Switch to shipper', key: 'S', run: () => { closeCmd(); $('[data-role="shipper"]')?.click(); } },
      { label: 'Switch to transporter', key: 'T', run: () => { closeCmd(); $('[data-role="transporter"]')?.click(); } },
    ];

    const commandItems = () => {
      const q = (cmdSearch?.value || '').toLowerCase().trim();
      const lc = loads.map((l) => ({
        label: `Open ${l.id} · ${l.pickup} → ${l.delivery}`,
        key: '↵',
        run: () => { closeCmd(); openDrawer(l.id); },
      }));
      return [...commands, ...lc].filter((x) => !q || x.label.toLowerCase().includes(q));
    };

    const renderCmd = () => {
      if (!cmdList) return;
      const items = commandItems();
      cmdList.innerHTML = items.length
        ? items.map((c, i) => `<button class="command-item" data-i="${i}" type="button"><span>${esc(c.label)}</span><kbd>${esc(c.key)}</kbd></button>`).join('')
        : '<div class="empty" style="padding:24px"><strong>No matches.</strong></div>';
      $$('#commandList .command-item').forEach((b, i) => on(b, 'click', () => items[i].run()));
    };

    const openCmd = () => {
      if (!cmd) return;
      closeMobileNav();
      cmd.classList.add('open');
      syncLock();
      if (cmdSearch) cmdSearch.value = '';
      renderCmd();
      setTimeout(() => cmdSearch?.focus(), 40);
    };

    const closeCmd = () => { if (cmd) { cmd.classList.remove('open'); syncLock(); } };

    $$('[data-command]').forEach((b) => on(b, 'click', openCmd));
    on(cmdSearch, 'input', renderCmd);
    on(cmd, 'mousedown', (e) => { if (e.target === cmd) closeCmd(); });

    onGlobal(document, 'keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        cmd?.classList.contains('open') ? closeCmd() : openCmd();
        return;
      }
      if (e.key === 'Escape') {
        closeCmd();
        $$('.overlay.open').forEach(closeOverlay);
        if (drawer?.classList.contains('open')) closeDrawer();
        closeMobileNav();
        syncLock();
        return;
      }
      if (cmd?.classList.contains('open') && e.key === 'Enter') {
        const first = $('#commandList .command-item');
        if (first) first.click();
      }
    });
  })();

  return function destroyHomeRuntime() {
    timers.forEach((id) => clearInterval(id));
    teardowns.forEach((fn) => fn());
    document.body.classList.remove('lock');
  };
}
