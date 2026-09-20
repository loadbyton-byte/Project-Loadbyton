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
import BrandWordmark from './BrandWordmark.jsx';

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
      <BrandWordmark dark={isDarkSurface} className="h-8 w-auto" />
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
  const location = useLocation();

  // The approved homepage is a complete, self-contained composition. It
  // owns its navigation, footer, spacing and responsive behaviour, so the
  // application shell must not add a second header/footer around it.
  if (location.pathname === '/') return children;

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
  const routeSurface = (() => {
    const path = location.pathname;
    if (['/features', '/pricing', '/about', '/blog', '/security', '/compliance', '/terms', '/privacy', '/industries', '/trust', '/for-transporters', '/for-shippers'].includes(path)) return 'public';
    if (['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'].includes(path)) return 'auth';
    if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
    if (path === '/driver' || path.startsWith('/driver/')) return 'driver';
    if (path.startsWith('/jobs/') || path.startsWith('/rfps/') || path.startsWith('/edi/')) return 'record';
    return 'workspace';
  })();

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
    swipeRef.current = { active: false, axis: null, startX: 0, startY: 0 };
  }

  async function handleResendVerification() {
    setResendingVerification(true);
    try {
      await api.resendVerification();
      addToast({ type: 'system_message', title: 'Verification email sent', body: 'Check your inbox for the link.' });
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not send verification email', body: err.message });
    } finally {
      setResendingVerification(false);
    }
  }

  async function handleLogout() {
    closeDrawer();
    await logout();
    navigate('/');
    addToast({ type: 'system_message', title: 'Session ended', body: 'You have been logged out.' });
  }

  async function handleEndImpersonation() {
    setEndingImpersonation(true);
    try {
      await endImpersonation();
      navigate('/admin');
    } finally {
      setEndingImpersonation(false);
    }
  }

  const guestLinks = [
    { to: '/features', label: t('nav.features', 'Features') },
    { to: '/pricing', label: t('nav.pricing', 'Pricing') },
    { to: '/about', label: t('nav.about', 'About') },
    { to: '/blog', label: 'Blog' },
    // Security.jsx/Compliance.jsx (App.jsx routes) existed with no link to
    // them anywhere in the public nav — reachable only by typing the URL.
    { to: '/security', label: 'Security' },
    { to: '/compliance', label: 'Compliance' },
  ];

  return (
    <div className={cx('lb-shell flex min-h-dvh flex-col bg-canvas', user ? 'lb-app-shell' : 'lb-public-shell')}>
      {user && <CommandPalette navItems={navItems} />}
      {user?.impersonating && (
        <div className="flex flex-wrap items-center justify-center gap-3 px-4 py-2 text-center text-xs font-medium text-white" style={{ background: 'var(--status-danger)' }}>
          <span>Impersonating {user.profile?.company_name || user.email} — logged to the audit trail.</span>
          <button onClick={handleEndImpersonation} disabled={endingImpersonation} className="shrink-0 rounded-full border border-white/40 px-3 py-2 text-xs font-semibold hover:bg-white/10">
            {endingImpersonation ? 'Returning…' : 'Return to admin'}
          </button>
        </div>
      )}

      {user && !user.email_verified && !user.impersonating && (
        <div className="flex flex-wrap items-center justify-center gap-3 px-4 py-2 text-center text-xs" style={{ background: 'var(--status-warning-bg)', color: 'var(--status-warning)' }}>
          <span>Verify your email to keep full access to your account.</span>
          <button onClick={handleResendVerification} disabled={resendingVerification} className="rounded-md px-2 py-2 font-semibold underline underline-offset-2 disabled:opacity-60">
            {resendingVerification ? 'Sending…' : 'Resend verification email'}
          </button>
        </div>
      )}

      {user && user.account_approval_status && user.account_approval_status !== 'APPROVED' && !user.impersonating && (
        <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium" style={{ background: 'var(--status-warning-bg)', color: 'var(--status-warning)' }}>
          <span>
            {user.account_approval_status === 'REJECTED'
              ? 'Your account was not approved — contact support if you believe this is a mistake.'
              : 'Your account is pending admin approval — you can browse, but posting, bidding, and other actions are disabled until an admin approves it.'}
          </span>
        </div>
      )}

      {/* TopAppBar — mobile only (md:hidden). Floating glass bar with the
          route-line accent; logo acts as role-aware home gesture. */}
      <header
        className="lb-chrome-veil sticky top-0 z-topbar border-b md:hidden"
        style={{
          borderColor: 'var(--border-subtle)',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <div className="lb-top-route-line" aria-hidden="true" />
        <div className="flex h-14 items-center justify-between px-3" style={{ paddingLeft: 'max(0.75rem, env(safe-area-inset-left))', paddingRight: 'max(0.75rem, env(safe-area-inset-right))' }}>
          <button
            onClick={() => setDrawerOpen(true)}
            className="lb-icon-btn"
            aria-label="Open menu"
          >
            <IconMenu size={22} />
          </button>

          <Logo to={user ? homePath(user, actingAs) : '/'} />

          {user ? (
            <div className="flex items-center">
              <TrnQuickLink />
              <NotificationBell />
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <Link to="/login" className="whitespace-nowrap rounded-full px-2.5 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-container">
                {t('nav.login', 'Log in')}
              </Link>
              {/* Desktop's slim header already had both Log in and Get
                  started (below) — mobile's compact TopAppBar had only
                  Log in, no primary conversion action at all. */}
              <Link to="/register" className="btn-accent btn-shine px-3 py-1.5 text-sm">{t('nav.register', 'Get started')}</Link>
            </div>
          )}
        </div>
      </header>

      {/* Drawer — mobile nav (only reachable via the hamburger above, which
          is itself md:hidden). Full ops-drawer: numbered wayfinding, role
          entry points, persistent conversion. Swipe-to-dismiss preserved. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-overlay flex" role="dialog" aria-modal="true" aria-label="Menu">
          <button aria-label="Close menu" className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={closeDrawer} />
          <div
            ref={drawerPanelRef}
            className="lb-drawer-panel animate-drawer-in relative flex h-full w-[86%] max-w-xs flex-col"
            style={{ boxShadow: 'var(--lb-shadow-lg)' }}
            onTouchStart={handleDrawerTouchStart}
            onTouchMove={handleDrawerTouchMove}
            onTouchEnd={handleDrawerTouchEnd}
          >
            {/* Sticky header — a short phone's drawer content (5 nav items +
                toggles + account block + logout) can exceed the visible
                viewport height; pinning this keeps the close button reachable
                without scrolling back to the top. */}
            <div className="sticky top-0 z-raised flex items-center justify-between px-5 pb-3 pt-5">
              <Link to={user ? homePath(user, actingAs) : '/'} aria-label="Loadbyton home" onClick={closeDrawer}>
                <img src="/brand/logo-full-on-dark-transparent.svg" alt="Loadbyton" className="h-6 w-auto" />
              </Link>
              <button onClick={closeDrawer} className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white" aria-label="Close menu">
                <IconClose size={18} />
              </button>
            </div>
            <div className="px-5 pb-2">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">UAE road freight · one shared load record</p>
              <div className="lb-top-route-line mt-2 opacity-70" aria-hidden="true" />
            </div>

            <div className="relative flex-1 overflow-y-auto px-5 pb-5">
            <nav className="flex flex-col gap-1.5">
              {user ? (
                groupNavItems(navItems).map(({ group, items }) => (
                  <div key={group}>
                    <p className="lb-sidebar-group">{group}</p>
                    {items.map((item, idx) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        onClick={closeDrawer}
                        className={({ isActive }) => cx('lb-sidebar-link flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all', isActive ? 'bg-white/10 text-white shadow-inner' : 'text-white/70 hover:bg-white/5 hover:text-white')}
                      >
                        <span className="lb-drawer-waypoint">{String(idx + 1).padStart(2, '0')}</span>
                        {item.icon}
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                ))
              ) : (
                <>
                  <p className="lb-sidebar-group">Explore</p>
                  {guestLinks.map((item, idx) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={closeDrawer}
                      className={({ isActive }) => cx('lb-sidebar-link flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all', isActive ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white')}
                    >
                      <span className="lb-drawer-waypoint">{String(idx + 1).padStart(2, '0')}</span>
                      {item.label}
                    </NavLink>
                  ))}
                  {/* Industries/Trust — the cinematic homepage's own mobile
                      drawer already links both; kept out of guestLinks
                      itself (also the source for the desktop pill nav,
                      which matches Home's desktop nav exactly and
                      shouldn't grow past it) so only this drawer gains them. */}
                  <NavLink to="/industries" onClick={closeDrawer} className={({ isActive }) => cx('lb-sidebar-link flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all', isActive ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white')}>
                    <span className="lb-drawer-waypoint">{String(guestLinks.length + 1).padStart(2, '0')}</span> Industries
                  </NavLink>
                  <NavLink to="/trust" onClick={closeDrawer} className={({ isActive }) => cx('lb-sidebar-link flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all', isActive ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white')}>
                    <span className="lb-drawer-waypoint">{String(guestLinks.length + 2).padStart(2, '0')}</span> Trust &amp; safety
                  </NavLink>
                  <p className="lb-sidebar-group">By role</p>
                  <NavLink to="/for-shippers" onClick={closeDrawer} className="lb-sidebar-link flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/5 hover:text-white">
                    <span className="lb-drawer-waypoint">{String(guestLinks.length + 3).padStart(2, '0')}</span> For shippers <IconArrowRight size={14} />
                  </NavLink>
                  <NavLink to="/for-transporters" onClick={closeDrawer} className="lb-sidebar-link flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/5 hover:text-white">
                    <span className="lb-drawer-waypoint">{String(guestLinks.length + 4).padStart(2, '0')}</span> For transporters <IconArrowRight size={14} />
                  </NavLink>
                </>
              )}
            </nav>

            <div className="my-4 border-t border-white/10" />

            <div className="flex flex-col gap-1.5">
              <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-white/70 hover:bg-white/5 hover:text-white">
                {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
              <button onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} className="rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-white/70 hover:bg-white/5 hover:text-white">
                {locale === 'ar' ? 'English' : 'العربية'}
              </button>
            </div>

            <div className="mt-4 pt-4">
              {user ? (
                <>
                  <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                    <span className="lb-status-dot" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{actingAs ? actingAs.displayName || actingAs.email : user.email}</p>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-white/55">{actingAs ? `Seat · ${actingAs.seatRole}` : `${user.role} · ${user.tier}`}</p>
                    </div>
                  </div>
                  <Link to="/profile" onClick={closeDrawer} className="mb-1.5 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/5 hover:text-white">
                    <IconUser size={16} /> Profile &amp; settings
                  </Link>
                  <button onClick={handleLogout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-white/5" style={{ color: 'var(--lb-red-200)' }}>
                    <IconLogOut size={16} /> Log out
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <Link to="/register" onClick={closeDrawer} className="btn-accent btn-shine w-full justify-center">Start with one load <IconArrowRight size={16} /></Link>
                  <Link to="/login" onClick={closeDrawer} className="flex w-full items-center justify-center rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-bold text-white hover:bg-white/10">Log in</Link>
                  <p className="mt-1 text-center font-mono text-[10px] uppercase tracking-widest text-white/40">Verified TRN · Secured payout · POD release</p>
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
      )}

      {/* WALKTHROUGH_STEPS' copy ("Post your first requirement", "Review
          carrier bids") is written specifically for the shipper posting
          flow — showing it to a carrier, admin, or any other role describes
          a workflow that isn't theirs. */}
      {user && user.role === 'SHIPPER' && !walkthroughFinished && (
        <WalkthroughModal step={walkthroughStep} onStep={setWalkthroughStep} onFinish={completeWalkthrough} />
      )}

      <div className="flex flex-1 md:flex-row">
        {/* Sidebar — persistent, desktop only (md:flex). Dark terminal rail
            with route grid, grouped wayfinding and live session footer. */}
        {user && (
          <aside
            className="lb-sidebar app-sidebar hidden md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col"
            style={{ background: 'var(--sidebar-bg)' }}
          >
            <div className="relative flex h-16 items-center justify-between px-5">
              {/* Sidebar chrome is always dark (--sidebar-bg) but shifts
                  shade between light/dark app theme (--lb-ink-900 vs
                  --lb-ink-800) — the transparent-background wordmark lets
                  whichever shade show through, unlike Logo's own on-dark
                  asset which bakes in a fixed navy rect and would leave a
                  visible mismatched box in dark theme. */}
              <Link to={homePath(user, actingAs)} aria-label="Loadbyton home">
                <img src="/brand/logo-full-on-dark-transparent.svg" alt="Loadbyton" className="h-6 w-auto" />
              </Link>
              <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-widest text-white/60">
                <span className="lb-status-dot" style={{ width: 6, height: 6 }} aria-hidden="true" /> Live
              </span>
            </div>

            <nav className="relative flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
              {groupNavItems(navItems).map(({ group, items }) => (
                <div key={group}>
                  {/* var(--lb-slate-400), not the fixed --text-muted token — the
                      sidebar is always dark-chrome in both themes (--sidebar-bg),
                      so it needs a color chosen for that fixed dark background,
                      not whichever the current theme's muted-text token resolves
                      to. Was a hardcoded #5E7A8C (3.23:1 against --sidebar-bg's
                      #0F2B3D, below WCAG AA's 4.5:1) — a real violation found
                      wiring axe-core into e2e/accessibility.spec.js; this
                      already-defined primitive measures 5.71:1 against the same
                      background. */}
                  <p className="lb-sidebar-group">
                    {group}
                  </p>
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        cx(
                          'lb-sidebar-link relative flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-[13.5px] font-medium transition-all',
                          isActive ? 'text-white' : 'hover:text-white'
                        )
                      }
                      style={({ isActive }) => ({
                        color: isActive ? 'var(--text-inverse)' : 'var(--lb-slate-300)',
                        background: isActive ? 'rgba(255,255,255,.09)' : 'transparent',
                        boxShadow: isActive ? 'inset 0 1px 0 rgba(255,255,255,0.1), 0 8px 20px -12px rgba(0,0,0,0.6)' : 'none',
                        border: isActive ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent',
                      })}
                    >
                      {({ isActive }) => (
                        <>
                          {/* Left accent bar — same motif as the Dashboard's
                              KPI tiles (BentoStat's accentBar), so the active
                              nav state and the stat cards read as one visual
                              system rather than two unrelated treatments. */}
                          {isActive && (
                            <span className="absolute inset-y-1.5 -left-0.5 w-[3px] rounded-full" style={{ background: 'var(--brand-accent)', boxShadow: '0 0 12px var(--brand-accent)' }} />
                          )}
                          <span style={{ color: isActive ? 'var(--brand-accent)' : 'inherit', opacity: isActive ? 1 : 0.85 }}>{item.icon}</span>
                          {item.label}
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              ))}
            </nav>

            <div className="relative flex items-center gap-2.5 px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,.08)', background: 'rgba(0,0,0,0.18)' }}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--brand-secondary)' }}>
                {(actingAs ? actingAs.displayName || actingAs.email : user.email)?.[0]?.toUpperCase() || '?'}
              </span>
              <div className="min-w-0 flex-1 text-xs">
                <p className="truncate font-semibold text-white">{actingAs ? actingAs.displayName || actingAs.email : user.email}</p>
                <p className="truncate font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--lb-slate-400)' }}>{actingAs ? `Seat · ${actingAs.seatRole}` : `${user.role} · ${user.tier}`}</p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="flex h-7 w-7 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
                  {theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
                </button>
                <button onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} className="flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-bold text-white/70 hover:bg-white/10 hover:text-white" aria-label={locale === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}>
                  {locale === 'ar' ? 'EN' : 'ع'}
                </button>
                <Link to="/profile" className="flex h-7 w-7 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white" aria-label="Profile & settings">
                  <IconUser size={14} />
                </Link>
                <button onClick={handleLogout} className="flex h-7 w-7 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white" aria-label="Log out">
                  <IconLogOut size={14} />
                </button>
              </div>
            </div>
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Desktop header: floating ops bar. Guests get the pill marketing
              nav; signed-in users get command search + TRN + bell, since role
              nav already lives in the sidebar. */}
          <header
            className="lb-chrome-veil app-topbar sticky top-0 z-header hidden border-b md:block"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <div className="lb-top-route-line" aria-hidden="true" />
            {user ? (
              <div className="flex h-16 items-center justify-between gap-4 px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="lb-section-label">Ops console</span>
                  <span className="hidden font-mono text-[11px] text-ink-muted xl:inline">post → discover → award → move → close</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CommandPaletteHint pill />
                  <TrnQuickLink />
                  <NotificationBell />
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-5 py-3 sm:px-6 lg:px-8">
                <Logo />
                <nav className="lb-guest-pill lb-chrome-veil hidden items-center gap-0.5 px-1.5 py-1 lg:flex" aria-label="Primary">
                  {guestLinks.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) => cx('rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all', isActive ? 'lb-nav-pill-active' : 'text-ink-secondary hover:bg-raised hover:text-ink')}
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </nav>
                <div className="flex items-center gap-2">
                  <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="lb-icon-btn" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
                    {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
                  </button>
                  <Link to="/login" className="hidden rounded-full px-3.5 py-2 text-sm font-semibold text-ink transition-colors hover:bg-raised sm:block">
                    {t('nav.login', 'Log in')}
                  </Link>
                  <Link to="/register" className="btn-accent btn-shine px-4 py-2 text-sm">{t('nav.register', 'Get started')}</Link>
                </div>
              </div>
            )}
          </header>

          <main className={`app-main lb-route-surface lb-route-${routeSurface} flex-1`} data-route-surface={routeSurface}>{children}</main>

          {!user && (
            <footer className="lb-footer" dir="ltr">
              <div className="mx-auto w-full max-w-content px-5 pb-8 pt-16 sm:px-6 lg:px-8 lg:pt-24">
                <div className="grid gap-12 pb-16 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:gap-16">
                  <div className="lb-footer-brand">
                    <img src="/brand/logo-full-on-dark-transparent.svg" alt="Loadbyton" className="h-7 w-auto" />
                    <p className="mt-7 max-w-xs text-sm leading-7 text-white/55">
                      A connected freight workspace for the operational work behind the load.
                    </p>
                    <p className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/55">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_6px_rgba(52,211,153,.12)]" aria-hidden="true" /> Operating in the UAE
                    </p>
                  </div>
                  <div className="lb-footer-col">
                    <h3>Platform</h3>
                    <div className="flex flex-col gap-4 text-sm text-white/60">
                      <Link to="/features">Features</Link>
                      <Link to="/industries">Industries</Link>
                      <Link to="/pricing">Pricing</Link>
                      <Link to="/trust">Trust &amp; safety</Link>
                    </div>
                  </div>
                  <div className="lb-footer-col">
                    <h3>Product</h3>
                    <div className="flex flex-col gap-4 text-sm text-white/60">
                      <Link to="/for-shippers">For shippers</Link>
                      <Link to="/for-transporters">For transporters</Link>
                      <Link to="/gcc/corridors">GCC corridors</Link>
                      <Link to="/login">Operations login</Link>
                    </div>
                  </div>
                  <div className="lb-footer-col">
                    <h3>Company</h3>
                    <div className="flex flex-col gap-4 text-sm text-white/60">
                      <Link to="/about">About</Link>
                      <Link to="/blog">Blog</Link>
                      <a href="mailto:hello@loadbyton.com">Contact</a>
                      <Link to="/register">Get started</Link>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-5 border-t border-white/10 pt-8 text-xs text-white/45 lg:flex-row lg:items-center lg:justify-between">
                  <p>© {new Date().getFullYear()} Loadbyton. All rights reserved.</p>
                  <div className="flex flex-wrap gap-x-7 gap-y-3">
                    <Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/security">Security</Link><Link to="/compliance">Compliance</Link>
                  </div>
                  <p className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.16em]"><span className="h-5 w-5 rounded bg-emerald-500" /> UAE · Freight technology</p>
                </div>
              </div>
            </footer>
          )}
        </div>
      </div>
    </div>
  );
}

const WALKTHROUGH_STEPS = [
  { title: 'Post your first requirement', body: 'Create a job post that verified transporters can bid on.', cta: "Let's start" },
  { title: 'Review transporter bids', body: 'Compare price, ETA, and ratings from competing transporters.', cta: 'Next' },
  { title: 'Award and track', body: 'Accept a bid, mark status updates, and release payouts.', cta: 'Got it' },
];

function WalkthroughModal({ step, onStep, onFinish }) {
  const current = WALKTHROUGH_STEPS[Math.min(step, WALKTHROUGH_STEPS.length - 1)];
  const isLast = step >= WALKTHROUGH_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-overlay flex items-center justify-center bg-black/60 px-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Welcome walkthrough">
      <div className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-[20px] border bg-surface shadow-2xl" style={{ borderColor: 'var(--border-default)' }}>
        <div className="lb-top-route-line" aria-hidden="true" />
        <div className="p-5 sm:p-8">
          <p className="lb-section-label">Welcome aboard</p>
          <h2 className="mt-2 font-display text-xl font-bold text-ink">Welcome to Loadbyton</h2>
          <p className="mt-1 mb-6 text-sm text-ink-muted">Step {step + 1} of {WALKTHROUGH_STEPS.length}</p>

          <div className="mb-1 flex gap-1.5">
            {WALKTHROUGH_STEPS.map((_, i) => (
              <span key={i} className="h-1 flex-1 rounded-full transition-all" style={{ background: i <= step ? 'var(--brand-accent)' : 'var(--border-default)' }} />
            ))}
          </div>

          <div className="mt-6">
            <h3 className="font-semibold text-ink">{current.title}</h3>
            <p className="mt-1 text-sm text-ink-muted">{current.body}</p>
            <button onClick={() => (isLast ? onFinish() : onStep(step + 1))} className="btn-accent btn-shine mt-4 w-full">
              {current.cta}
            </button>
          </div>

          <div className="mt-6 border-t pt-4 text-center" style={{ borderColor: 'var(--border-subtle)' }}>
            <button onClick={onFinish} className="text-xs font-medium text-ink-muted hover:text-ink">
              Skip — don't show this again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
