import React, { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, homePath } from '../lib/auth.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { api } from '../lib/api.js';
import { formatDateTime } from '../lib/constants.js';
import { getSocket } from '../lib/socket.js';
import {
  IconMenu, IconClose, IconBell, IconLogOut, IconUser, IconMoon, IconSun,
  IconHome, IconHistory, IconFile, IconGavel, IconCheckCircle, IconWallet,
  IconTrendUp, IconSettings, IconTruck, IconMessage, IconReceipt,
  IconCompass, IconShield, IconSearch, IconArrowRight,
} from './icons.jsx';
import { useToasts } from './Toast.jsx';
import CommandPalette from './CommandPalette.jsx';

function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

// `to` defaults to "/" — the sidebar/drawer/footer/guest-top-bar call sites
// have always gone to the marketing landing page, even pre-rebrand. The
// mobile TopAppBar overrides it with a role-aware destination, since that
// spot's logo behaves as a "go home" gesture, not a "go to marketing site"
// link, matching its pre-logo-fix behavior.
export function Logo({ dark = false, className = '', to = '/' }) {
  const { theme } = useAuth();
  // The light-surface wordmark is navy-on-transparent — on the app's dark
  // theme, --bg-surface resolves to the same navy, so it must swap to the
  // white-on-navy variant rather than going invisible.
  const isDarkSurface = dark || theme === 'dark';
  return (
    <Link to={to} className={`flex shrink-0 items-center ${className}`} aria-label="Loadbyton home">
      <img src={isDarkSurface ? '/brand/logo-full-on-dark.svg' : '/brand/logo-full.svg'} alt="Loadbyton" className="h-8 w-auto" />
    </Link>
  );
}

// The bell used to just be a <Link to="/notifications"> — no in-place
// preview, so seeing what happened meant leaving whatever page you were on.
// This gives it an actual popup: latest few notifications, mark-all-read,
// and a link through to the full page. Shared by both the mobile TopAppBar
// and the desktop header (one definition, no duplicated dropdown logic).
function NotificationBell() {
  const { user, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [itemsError, setItemsError] = useState('');
  const [marking, setMarking] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onEscape(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  // Bumps the unread badge live instead of only after the next click —
  // Toast.jsx already connects this same shared socket once signed in;
  // this just adds another listener to it, not a second connection. If
  // the dropdown happens to be open when one arrives, prepend it to the
  // already-fetched preview list too, so it doesn't only appear after
  // closing and reopening.
  useEffect(() => {
    const socket = getSocket();
    function onNotification(n) {
      refresh().catch(() => {});
      setItems((prev) => (prev ? [n, ...prev].slice(0, 6) : prev));
    }
    socket.on('notification:new', onNotification);
    return () => socket.off('notification:new', onNotification);
  }, [refresh]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setItemsError('');
      api.notifications().then((d) => setItems(d.notifications.slice(0, 6))).catch((err) => { setItems([]); setItemsError(err.message); });
    }
  }

  async function markRead() {
    setMarking(true);
    try {
      await api.markNotificationsRead();
      setItems((prev) => (prev || []).map((n) => ({ ...n, is_read: 1 })));
      refresh().catch(() => {});
    } finally {
      setMarking(false);
    }
  }

  if (!user) return null;
  const hasUnread = user.unreadNotifications > 0;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        className="lb-icon-btn"
        aria-label="Notifications"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <IconBell size={20} />
        {hasUnread && (
          <span data-testid="notification-unread-dot" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full" style={{ background: 'var(--brand-accent)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--brand-accent) 25%, transparent)' }} />
        )}
      </button>
      {open && (
        <div
          className="animate-panel-in card absolute right-0 top-12 z-overlay w-80 max-w-[calc(100vw-2rem)] overflow-hidden p-0"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="text-sm font-semibold text-ink">Notifications</p>
            {items && items.some((n) => !n.is_read) && (
              <button type="button" onClick={markRead} disabled={marking} className="text-xs font-semibold" style={{ color: 'var(--brand-accent)' }}>
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items === null ? (
              <p className="px-4 py-6 text-center text-sm text-ink-muted">Loading…</p>
            ) : itemsError ? (
              <p className="px-4 py-6 text-center text-sm text-ink-muted">Couldn't load notifications.</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-muted">No notifications yet.</p>
            ) : (
              items.map((n) => {
                const row = (
                  <div className="border-b px-4 py-3 transition-colors hover:bg-surface-container" style={{ borderColor: 'var(--border-subtle)', background: n.is_read ? undefined : 'var(--surface-container-low)' }}>
                    <p className="text-sm font-medium text-ink">{n.title}</p>
                    {n.body && <p className="mt-0.5 text-xs text-ink-muted">{n.body}</p>}
                    <p className="mt-1 font-mono text-[11px] text-ink-muted">{formatDateTime(n.created_at)}</p>
                  </div>
                );
                return n.job_id ? (
                  <Link key={n.id} to={`/jobs/${n.job_id}`} className="block" onClick={() => setOpen(false)}>{row}</Link>
                ) : (
                  <div key={n.id}>{row}</div>
                );
              })
            )}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-center text-sm font-semibold" style={{ color: 'var(--brand-accent)' }}>
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}

// TRN Verification used to be a per-role sidebar entry — moved here (a
// small always-present icon button next to the bell, for every logged-in
// role) since it's a standalone counterparty-lookup tool nobody uses
// often enough to earn permanent nav real estate, but it still needs to
// be reachable from somewhere other than typing the URL directly.
function TrnQuickLink() {
  return (
    <Link
      to="/verify/trn"
      className="lb-icon-btn"
      aria-label="TRN Verification"
      title="TRN Verification"
    >
      <IconShield size={20} />
    </Link>
  );
}

// Visible entry point for CommandPalette.jsx — the Cmd/Ctrl+K shortcut
// alone has no discoverability and doesn't exist on a touch device.
function CommandPaletteHint({ pill = false }) {
  if (pill) {
    return (
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('command-palette:open'))}
        className="hidden items-center gap-2.5 rounded-full border py-2 pl-3.5 pr-2 text-sm text-ink-muted transition-all hover:border-[var(--brand-accent)] hover:text-ink hover:shadow-md lg:flex"
        style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-raised)', minWidth: 220 }}
        aria-label="Search"
        title="Search (Ctrl/Cmd+K)"
      >
        <IconSearch size={15} />
        <span className="flex-1 text-left text-[13px]">Search loads, jobs…</span>
        <span className="lb-cmd-kbd">⌘K</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('command-palette:open'))}
      className="lb-icon-btn"
      aria-label="Search"
      title="Search (Ctrl/Cmd+K)"
    >
      <IconSearch size={18} />
    </button>
  );
}

// Role-based nav — drives both the desktop sidebar and the mobile drawer,
// so there is exactly one source of truth for "what links does this role
// see" (see CLAUDE.md's navigation note for why that matters).
//
// `group` (Change 1b — dashboard/app-shell redesign) buckets each role's
// flat link list into labeled sections, matching the mockup's
// Workspace/Finance/Account pattern — purely a rendering grouping, no new
// routes or permission logic; SidebarNav below groups by this field, and a
// role whose group set differs from another's (e.g. ADMIN has no Finance
// items) just renders fewer section headers, nothing else changes.
function navByRole(t) {
  return {
    SHIPPER: [
      { to: '/dashboard', label: t('nav.dashboard', 'Dashboard'), icon: <IconHome size={20} />, group: 'Workspace' },
      { to: '/templates', label: t('nav.templates', 'Templates'), icon: <IconHistory size={20} />, group: 'Workspace' },
      { to: '/contracts', label: t('nav.contracts', 'Contract lanes'), icon: <IconFile size={20} />, group: 'Workspace' },
      { to: '/transporters', label: t('nav.transporters', 'Transporters'), icon: <IconTruck size={20} />, group: 'Workspace' },
      { to: '/messages', label: t('nav.messages', 'Messages'), icon: <IconMessage size={20} />, group: 'Communication' },
      { to: '/documents', label: t('nav.documents', 'Documents'), icon: <IconFile size={20} />, group: 'Communication' },
      { to: '/history', label: t('nav.history', 'Job History'), icon: <IconHistory size={20} />, group: 'Insights' },
      { to: '/analytics', label: t('nav.analytics', 'Analytics'), icon: <IconTrendUp size={20} />, group: 'Insights' },
      { to: '/gcc/corridors', label: t('nav.gccCorridors', 'Trade corridors'), icon: <IconCompass size={20} />, group: 'Insights' },
    ],
    CARRIER: [
      { to: '/open-loads', label: t('nav.openLoads', 'Open loads'), icon: <IconHome size={20} />, group: 'Workspace' },
      { to: '/my-bids', label: t('nav.myBids', 'My bids'), icon: <IconGavel size={20} />, group: 'Workspace' },
      { to: '/won-jobs', label: t('nav.wonJobs', 'Won jobs'), icon: <IconCheckCircle size={20} />, group: 'Workspace' },
      { to: '/drivers', label: t('nav.drivers', 'My drivers'), icon: <IconTruck size={20} />, group: 'Workspace' },
      { to: '/messages', label: t('nav.messages', 'Messages'), icon: <IconMessage size={20} />, group: 'Communication' },
      { to: '/documents', label: t('nav.documents', 'Documents'), icon: <IconFile size={20} />, group: 'Communication' },
      { to: '/earnings', label: t('nav.earnings', 'Earnings'), icon: <IconWallet size={20} />, group: 'Finance' },
      { to: '/invoices', label: t('nav.invoices', 'Invoices'), icon: <IconReceipt size={20} />, group: 'Finance' },
      { to: '/analytics', label: t('nav.analytics', 'Analytics'), icon: <IconTrendUp size={20} />, group: 'Insights' },
      { to: '/gcc/corridors', label: t('nav.gccCorridors', 'Trade corridors'), icon: <IconCompass size={20} />, group: 'Insights' },
    ],
    FORWARDER: [
      { to: '/dashboard', label: t('nav.dashboard', 'Dashboard'), icon: <IconHome size={20} />, group: 'Workspace' },
      { to: '/forwarder/clients', label: t('nav.forwarderClients', 'Client roster'), icon: <IconUser size={20} />, group: 'Workspace' },
      { to: '/transporters', label: t('nav.transporters', 'Transporters'), icon: <IconTruck size={20} />, group: 'Workspace' },
      { to: '/messages', label: t('nav.messages', 'Messages'), icon: <IconMessage size={20} />, group: 'Communication' },
      { to: '/documents', label: t('nav.documents', 'Documents'), icon: <IconFile size={20} />, group: 'Communication' },
      { to: '/history', label: t('nav.history', 'Job History'), icon: <IconHistory size={20} />, group: 'Insights' },
      { to: '/analytics', label: t('nav.analytics', 'Analytics'), icon: <IconTrendUp size={20} />, group: 'Insights' },
      { to: '/gcc/corridors', label: t('nav.gccCorridors', 'Trade corridors'), icon: <IconCompass size={20} />, group: 'Insights' },
    ],
    BROKER: [
      { to: '/dashboard', label: t('nav.dashboard', 'Dashboard'), icon: <IconHome size={20} />, group: 'Workspace' },
      { to: '/broker/carriers', label: t('nav.brokerCarriers', 'Transporter roster'), icon: <IconTruck size={20} />, group: 'Workspace' },
      { to: '/messages', label: t('nav.messages', 'Messages'), icon: <IconMessage size={20} />, group: 'Communication' },
      { to: '/documents', label: t('nav.documents', 'Documents'), icon: <IconFile size={20} />, group: 'Communication' },
      { to: '/history', label: t('nav.history', 'Job History'), icon: <IconHistory size={20} />, group: 'Insights' },
      { to: '/analytics', label: t('nav.analytics', 'Analytics'), icon: <IconTrendUp size={20} />, group: 'Insights' },
      { to: '/gcc/corridors', label: t('nav.gccCorridors', 'Trade corridors'), icon: <IconCompass size={20} />, group: 'Insights' },
    ],
    OWNER_OPERATOR: [
      { to: '/open-loads', label: t('nav.openLoads', 'Open loads'), icon: <IconHome size={20} />, group: 'Workspace' },
      { to: '/my-bids', label: t('nav.myBids', 'My bids'), icon: <IconGavel size={20} />, group: 'Workspace' },
      { to: '/won-jobs', label: t('nav.wonJobs', 'Won jobs'), icon: <IconCheckCircle size={20} />, group: 'Workspace' },
      { to: '/drivers', label: t('nav.drivers', 'My drivers'), icon: <IconTruck size={20} />, group: 'Workspace' },
      { to: '/messages', label: t('nav.messages', 'Messages'), icon: <IconMessage size={20} />, group: 'Communication' },
      { to: '/documents', label: t('nav.documents', 'Documents'), icon: <IconFile size={20} />, group: 'Communication' },
      { to: '/earnings', label: t('nav.earnings', 'Earnings'), icon: <IconWallet size={20} />, group: 'Finance' },
      { to: '/invoices', label: t('nav.invoices', 'Invoices'), icon: <IconReceipt size={20} />, group: 'Finance' },
      { to: '/analytics', label: t('nav.analytics', 'Analytics'), icon: <IconTrendUp size={20} />, group: 'Insights' },
      { to: '/gcc/corridors', label: t('nav.gccCorridors', 'Trade corridors'), icon: <IconCompass size={20} />, group: 'Insights' },
    ],
    ADMIN: [
      { to: '/admin', label: t('nav.admin', 'Admin console'), icon: <IconSettings size={20} />, group: 'Workspace' },
      { to: '/messages', label: t('nav.messages', 'Messages'), icon: <IconMessage size={20} />, group: 'Communication' },
      { to: '/gcc/corridors', label: t('nav.gccCorridors', 'Trade corridors'), icon: <IconCompass size={20} />, group: 'Insights' },
    ],
  };
}

// Groups a flat nav-item list into [{ group, items }] in first-seen order —
// used by both the desktop sidebar and (for visual consistency) the mobile
// drawer, so a role's group order only needs to be right once, in the data
// above.
function groupNavItems(items) {
  const order = [];
  const byGroup = new Map();
  for (const item of items) {
    const g = item.group || 'Workspace';
    if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
    byGroup.get(g).push(item);
  }
  return order.map((g) => ({ group: g, items: byGroup.get(g) }));
}

const FOOTER_TICKER = [
  'JEBEL ALI → MUSSAFAH',
  'KHOR FAKKAN → JEBEL ALI',
  'FUJAIRAH PORT → DIP',
  'SHARJAH → ABU DHABI',
  'JEBEL ALI → RUWAIS',
  'DIP → KHALIFA PORT',
];

export function Shell({ children }) {
  return <ShellInner>{children}</ShellInner>;
}

function ShellInner({ children }) {
  const { user, logout, theme, setTheme, walkthroughFinished, walkthroughStep, completeWalkthrough, setWalkthroughStep, endImpersonation, actingAs } = useAuth();
  const { locale, setLocale, t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [endingImpersonation, setEndingImpersonation] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const drawerPanelRef = useRef(null);
  const swipeRef = useRef({ active: false, axis: null, startX: 0, startY: 0 });
  // A DRIVER seat's user.role is still its owner's role (CARRIER — see
  // auth.jsx's session model), so it would otherwise get the full carrier
  // nav despite RequireAuth (App.jsx) redirecting every one of those routes
  // straight back to /driver. Its whole app is that one page — no sidebar.
  const navItems = (actingAs?.seatRole === 'DRIVER' || actingAs?.seatRole === 'DRIVER_ASSOCIATE') ? [] : (user ? navByRole(t)[user.role] || [] : []);
  const { addToast } = useToasts();

  function closeDrawer() {
    setDrawerOpen(false);
  }

  // Swipe-to-dismiss — the "closing" direction mirrors .animate-drawer-in's
  // own RTL awareness (index.css): LTR's drawer slides in from the left, so
  // dragging it back left closes it; RTL's slides in from the right (see
  // drawer-in-rtl), so dragging right closes it. Reads document.dir at
  // gesture start rather than trusting a prop, since that's the same
  // source of truth the CSS itself keys off.
  //
  // Axis is decided once, after a small dead zone, by whichever direction
  // moved further first — committing to "horizontal drag" only if the
  // gesture actually reads as horizontal, so scrolling the nav list
  // vertically (or just tapping a link, which never clears the dead zone)
  // is never hijacked as a swipe.
  function handleDrawerTouchStart(e) {
    const panel = drawerPanelRef.current;
    // .animate-drawer-in is a CSS animation with fill-mode: both, which
    // keeps its own computed transform in force even after it finishes —
    // that wins over any inline style.transform written from JS for as
    // long as the animation is still attached to the element. Detaching
    // it up front (idempotent; harmless if the entrance animation has
    // already finished, which by the time a user can touch the drawer,
    // it always has) is what lets the drag transforms below actually
    // take visual effect instead of being silently overridden.
    if (panel) panel.style.animation = 'none';
    const t0 = e.touches[0];
    swipeRef.current = { active: false, axis: null, startX: t0.clientX, startY: t0.clientY };
  }
  function handleDrawerTouchMove(e) {
    const panel = drawerPanelRef.current;
    if (!panel) return;
    const t0 = e.touches[0];
    const dx = t0.clientX - swipeRef.current.startX;
    const dy = t0.clientY - swipeRef.current.startY;
    const state = swipeRef.current;

    if (!state.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      state.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (state.axis !== 'x') return;

    const isRtl = document.documentElement.dir === 'rtl';
    const closingDelta = isRtl ? dx : -dx;
    if (closingDelta <= 0) {
      // Dragging the "wrong" way (back toward fully open) — snap to open
      // rather than allowing an over-drag past the resting position.
      panel.style.transition = 'none';
      panel.style.transform = 'translateX(0)';
      state.active = false;
      return;
    }
    state.active = true;
    panel.style.transition = 'none';
    panel.style.transform = `translateX(${isRtl ? closingDelta : -closingDelta}px)`;
  }
  function handleDrawerTouchEnd() {
    const panel = drawerPanelRef.current;
    const state = swipeRef.current;
    if (!panel || !state.active) {
      swipeRef.current = { active: false, axis: null, startX: 0, startY: 0 };
      return;
    }
    const isRtl = document.documentElement.dir === 'rtl';
    const dx = Math.abs(parseFloat(panel.style.transform.replace(/[^-\d.]/g, '')) || 0);
    const closeThreshold = panel.offsetWidth * 0.35;
    // animation is already 'none' (set at touchstart); this needs its own
    // explicit transition now — with the CSS animation detached, there is
    // no other rule left that would animate a transform change on this
    // element. Same duration/easing as .animate-drawer-in itself, so a
    // released swipe reads as the same motion as the drawer's own
    // entrance/exit, not a separate, differently-timed effect.
    panel.style.transition = 'transform var(--motion-emphasis) var(--motion-ease)';
    if (dx > closeThreshold) {
      panel.style.transform = `translateX(${isRtl ? '100%' : '-100%'})`;
      // closeDrawer() unmounts the panel once the swipe's own transition
      // has had time to visually finish, not before.
      window.setTimeout(closeDrawer, 220);
    } else {
      panel.style.transform = 'translateX(0)';
    }
