import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth, homePath } from '../lib/auth.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { api } from '../lib/api.js';
import {
  IconMenu, IconClose, IconBell, IconLogOut, IconUser, IconMoon, IconSun,
  IconHome, IconHistory, IconFile, IconGavel, IconCheckCircle, IconWallet,
  IconTrendUp, IconSettings, IconTruck, IconMessage, IconReceipt, IconShield,
} from './icons.jsx';
import { useToasts } from './Toast.jsx';

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
      { to: '/messages', label: t('nav.messages', 'Messages'), icon: <IconMessage size={20} />, group: 'Communication' },
      { to: '/documents', label: t('nav.documents', 'Documents'), icon: <IconFile size={20} />, group: 'Communication' },
      { to: '/history', label: t('nav.history', 'Job History'), icon: <IconHistory size={20} />, group: 'Insights' },
      { to: '/analytics', label: t('nav.analytics', 'Analytics'), icon: <IconTrendUp size={20} />, group: 'Insights' },
      { to: '/verify/trn', label: t('nav.verifyTrn', 'TRN Verification'), icon: <IconShield size={20} />, group: 'Insights' },
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
      { to: '/verify/trn', label: t('nav.verifyTrn', 'TRN Verification'), icon: <IconShield size={20} />, group: 'Insights' },
    ],
    FORWARDER: [
      { to: '/dashboard', label: t('nav.dashboard', 'Dashboard'), icon: <IconHome size={20} />, group: 'Workspace' },
      { to: '/forwarder/clients', label: t('nav.forwarderClients', 'Client roster'), icon: <IconUser size={20} />, group: 'Workspace' },
      { to: '/messages', label: t('nav.messages', 'Messages'), icon: <IconMessage size={20} />, group: 'Communication' },
      { to: '/documents', label: t('nav.documents', 'Documents'), icon: <IconFile size={20} />, group: 'Communication' },
      { to: '/history', label: t('nav.history', 'Job History'), icon: <IconHistory size={20} />, group: 'Insights' },
      { to: '/analytics', label: t('nav.analytics', 'Analytics'), icon: <IconTrendUp size={20} />, group: 'Insights' },
      { to: '/verify/trn', label: t('nav.verifyTrn', 'TRN Verification'), icon: <IconShield size={20} />, group: 'Insights' },
    ],
    BROKER: [
      { to: '/dashboard', label: t('nav.dashboard', 'Dashboard'), icon: <IconHome size={20} />, group: 'Workspace' },
      { to: '/broker/carriers', label: t('nav.brokerCarriers', 'Carrier roster'), icon: <IconTruck size={20} />, group: 'Workspace' },
      { to: '/messages', label: t('nav.messages', 'Messages'), icon: <IconMessage size={20} />, group: 'Communication' },
      { to: '/documents', label: t('nav.documents', 'Documents'), icon: <IconFile size={20} />, group: 'Communication' },
      { to: '/history', label: t('nav.history', 'Job History'), icon: <IconHistory size={20} />, group: 'Insights' },
      { to: '/analytics', label: t('nav.analytics', 'Analytics'), icon: <IconTrendUp size={20} />, group: 'Insights' },
      { to: '/verify/trn', label: t('nav.verifyTrn', 'TRN Verification'), icon: <IconShield size={20} />, group: 'Insights' },
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
      { to: '/verify/trn', label: t('nav.verifyTrn', 'TRN Verification'), icon: <IconShield size={20} />, group: 'Insights' },
    ],
    ADMIN: [
      { to: '/admin', label: t('nav.admin', 'Admin console'), icon: <IconSettings size={20} />, group: 'Workspace' },
      { to: '/messages', label: t('nav.messages', 'Messages'), icon: <IconMessage size={20} />, group: 'Communication' },
      { to: '/verify/trn', label: t('nav.verifyTrn', 'TRN Verification'), icon: <IconShield size={20} />, group: 'Insights' },
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

export function Shell({ children }) {
  return <ShellInner>{children}</ShellInner>;
}

function ShellInner({ children }) {
  const { user, logout, theme, setTheme, walkthroughFinished, walkthroughStep, completeWalkthrough, setWalkthroughStep, endImpersonation, actingAs } = useAuth();
  const { locale, setLocale, t } = useLocale();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [endingImpersonation, setEndingImpersonation] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  // A DRIVER seat's user.role is still its owner's role (CARRIER — see
  // auth.jsx's session model), so it would otherwise get the full carrier
  // nav despite RequireAuth (App.jsx) redirecting every one of those routes
  // straight back to /driver. Its whole app is that one page — no sidebar.
  const navItems = (actingAs?.seatRole === 'DRIVER' || actingAs?.seatRole === 'DRIVER_ASSOCIATE') ? [] : (user ? navByRole(t)[user.role] || [] : []);
  const { addToast } = useToasts();

  function closeDrawer() {
    setDrawerOpen(false);
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
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
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

      {/* TopAppBar — mobile only (md:hidden). Desktop replaces this with a
          persistent sidebar + slim top bar below, per the enterprise-layout
          restructure; this stays the nav for narrow widths since it already
          works well there. */}
      <header
        className="sticky top-0 z-40 border-b backdrop-blur-md md:hidden"
        style={{
          borderColor: 'var(--border-subtle)',
          backgroundColor: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <div className="flex h-14 items-center justify-between px-3" style={{ paddingLeft: 'max(0.75rem, env(safe-area-inset-left))', paddingRight: 'max(0.75rem, env(safe-area-inset-right))' }}>
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-container"
            aria-label="Open menu"
          >
            <IconMenu size={22} />
          </button>

          <Logo to={user ? homePath(user, actingAs) : '/'} />

          {user ? (
            <Link to="/notifications" className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-container" aria-label="Notifications">
              <IconBell size={20} />
              {user.unreadNotifications > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full" style={{ background: 'var(--brand-accent)' }} />
              )}
            </Link>
          ) : (
            <Link to="/login" className="rounded-full px-3.5 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-container">
              {t('nav.login', 'Log in')}
            </Link>
          )}
        </div>
      </header>

      {/* Drawer — mobile nav (only reachable via the hamburger above, which
          is itself md:hidden). Carries the full role nav, account actions,
          and the theme/locale toggles. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Menu">
          <button aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={closeDrawer} />
          <div className="animate-drawer-in relative flex h-full w-[84%] max-w-xs flex-col bg-surface" style={{ boxShadow: 'var(--lb-shadow-lg)' }}>
            {/* Sticky header — a short phone's drawer content (5 nav items +
                toggles + account block + logout) can exceed the visible
                viewport height; pinning this keeps the close button reachable
                without scrolling back to the top. */}
            <div className="sticky top-0 z-10 flex items-center justify-between bg-surface px-5 pb-3 pt-5">
              <Logo />
              <button onClick={closeDrawer} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-container" aria-label="Close menu">
                <IconClose size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-5">
            <nav className="flex flex-col gap-1.5">
              {user ? (
                groupNavItems(navItems).map(({ group, items }) => (
                  <div key={group}>
                    <p className="px-3 pb-1 pt-3 font-mono text-[10px] font-bold uppercase tracking-widest text-ink-muted first:pt-0">{group}</p>
                    {items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        onClick={closeDrawer}
                        className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold', isActive ? 'bg-surface-container text-ink' : 'text-ink-secondary hover:bg-surface-container')}
                      >
                        {item.icon}
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                ))
              ) : (
                guestLinks.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={closeDrawer}
                    className={({ isActive }) => cx('rounded-lg px-3 py-2.5 text-sm font-semibold', isActive ? 'bg-surface-container text-ink' : 'text-ink-secondary hover:bg-surface-container')}
                  >
                    {item.label}
                  </NavLink>
                ))
              )}
            </nav>

            <div className="my-4 border-t" style={{ borderColor: 'var(--border-subtle)' }} />

            <div className="flex flex-col gap-1.5">
              <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-ink-secondary hover:bg-surface-container">
                {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
              <button onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} className="rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-ink-secondary hover:bg-surface-container">
                {locale === 'ar' ? 'English' : 'العربية'}
              </button>
            </div>

            <div className="mt-4 pt-4">
              {user ? (
                <>
                  <div className="mb-3 rounded-lg px-3 py-2.5" style={{ background: 'var(--surface-container)' }}>
                    <p className="truncate text-sm font-semibold text-ink">{actingAs ? actingAs.displayName || actingAs.email : user.email}</p>
                    <p className="text-xs text-ink-muted">{actingAs ? `Seat · ${actingAs.seatRole}` : `${user.role} · ${user.tier}`}</p>
                  </div>
                  <Link to="/profile" onClick={closeDrawer} className="mb-1.5 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-ink-secondary hover:bg-surface-container">
                    <IconUser size={16} /> Profile &amp; settings
                  </Link>
                  <button onClick={handleLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold hover:bg-surface-container" style={{ color: 'var(--status-danger)' }}>
                    <IconLogOut size={16} /> Log out
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <Link to="/register" onClick={closeDrawer} className="btn-accent w-full justify-center">{t('nav.register', 'Get started')}</Link>
                  <Link to="/login" onClick={closeDrawer} className="btn-secondary w-full justify-center">{t('nav.login', 'Log in')}</Link>
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
      )}

      {user && !walkthroughFinished && (
        <WalkthroughModal step={walkthroughStep} onStep={setWalkthroughStep} onFinish={completeWalkthrough} />
      )}

      <div className="flex flex-1 md:flex-row">
        {/* Sidebar — persistent, desktop only (md:flex). Replaces the
            drawer as the primary nav surface at wide widths; reuses
            navByRole's per-role link data, no new routing logic. */}
        {user && (
          <aside
            className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col"
            style={{ background: 'var(--sidebar-bg)' }}
          >
            <div className="flex h-14 items-center px-5">
              {/* Sidebar chrome is always dark (--sidebar-bg) but shifts
                  shade between light/dark app theme (--lb-ink-900 vs
                  --lb-ink-800) — the transparent-background wordmark lets
                  whichever shade show through, unlike Logo's own on-dark
                  asset which bakes in a fixed navy rect and would leave a
                  visible mismatched box in dark theme. */}
              <Link to={homePath(user, actingAs)} aria-label="Loadbyton home">
                <img src="/brand/logo-full-on-dark-transparent.svg" alt="Loadbyton" className="h-6 w-auto" />
              </Link>
            </div>

            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
              {groupNavItems(navItems).map(({ group, items }) => (
                <div key={group}>
                  <p className="px-2.5 pb-1.5 pt-4 font-mono text-[10px] font-bold uppercase tracking-widest first:pt-1" style={{ color: '#5E7A8C' }}>
                    {group}
                  </p>
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        cx(
                          'relative flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-[13.5px] font-medium transition-colors',
                          isActive ? 'text-white' : 'hover:text-white'
                        )
                      }
                      style={({ isActive }) => ({
                        color: isActive ? '#fff' : '#C7D6DD',
                        background: isActive ? 'rgba(255,255,255,.08)' : 'transparent',
                      })}
                    >
                      {({ isActive }) => (
                        <>
                          {/* Left accent bar — same motif as the Dashboard's
                              KPI tiles (BentoStat's accentBar), so the active
                              nav state and the stat cards read as one visual
                              system rather than two unrelated treatments. */}
                          {isActive && (
                            <span className="absolute inset-y-1 -left-0.5 w-[3px] rounded-full" style={{ background: 'var(--brand-accent)' }} />
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

            <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,.08)' }}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--brand-secondary)' }}>
                {(actingAs ? actingAs.displayName || actingAs.email : user.email)?.[0]?.toUpperCase() || '?'}
              </span>
              <div className="min-w-0 flex-1 text-xs">
                <p className="truncate font-semibold text-white">{actingAs ? actingAs.displayName || actingAs.email : user.email}</p>
                <p className="truncate" style={{ color: '#8FA6B3' }}>{actingAs ? `Seat · ${actingAs.seatRole}` : `${user.role} · ${user.tier}`}</p>
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
          {/* Desktop slim top bar (md:flex, hidden on mobile — the
              TopAppBar above covers mobile). Guests get a traditional
              horizontal marketing nav here; signed-in users get just the
              notifications bell, since role nav already lives in the
              sidebar. */}
          <header
            className="sticky top-0 z-30 hidden h-14 items-center justify-between border-b px-6 backdrop-blur-md md:flex"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)' }}
          >
            {user ? (
              <div />
            ) : (
              <div className="flex items-center gap-6">
                <Logo />
                <nav className="flex items-center gap-1">
                  {guestLinks.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) => cx('rounded-md px-3 py-1.5 text-sm font-semibold transition-colors', isActive ? 'bg-surface-container text-ink' : 'text-ink-secondary hover:bg-surface-container')}
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </nav>
              </div>
            )}

            {user ? (
              <Link to="/notifications" className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-container" aria-label="Notifications">
                <IconBell size={20} />
                {user.unreadNotifications > 0 && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full" style={{ background: 'var(--brand-accent)' }} />
                )}
              </Link>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="flex h-10 w-10 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-container" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
                  {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
                </button>
                <Link to="/login" className="rounded-md px-3.5 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-container">
                  {t('nav.login', 'Log in')}
                </Link>
                <Link to="/register" className="btn-accent px-4 py-1.5 text-sm">{t('nav.register', 'Get started')}</Link>
              </div>
            )}
          </header>

          <main className="flex-1">{children}</main>

          {!user && (
            <footer className="border-t" style={{ borderColor: 'var(--border-default)' }}>
              <div className="container-page flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
                <Logo />
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-muted">
                  <Link to="/features" className="hover:text-ink">Features</Link>
                  <Link to="/pricing" className="hover:text-ink">Pricing</Link>
                  <Link to="/about" className="hover:text-ink">About</Link>
                  <Link to="/blog" className="hover:text-ink">Blog</Link>
                  <Link to="/security" className="hover:text-ink">Security</Link>
                  <Link to="/compliance" className="hover:text-ink">Compliance</Link>
                  <Link to="/terms" className="hover:text-ink">Terms</Link>
                  <Link to="/privacy" className="hover:text-ink">Privacy</Link>
                </div>
                <div className="text-xs leading-relaxed text-ink-muted" dir="ltr">
                  <p>© {new Date().getFullYear()} Loadbyton Freight Technologies FZ-LLC. All rights reserved.</p>
                  <p className="mt-1">Road freight marketplace software for the UAE — Dubai, Abu Dhabi, Sharjah &amp; Fujairah.</p>
                  <p className="mt-1">Registered in Dubai, United Arab Emirates · <a href="mailto:support@loadbyton.ae" className="hover:text-ink">support@loadbyton.ae</a></p>
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
  { title: 'Post your first requirement', body: 'Create a job post that verified carriers can bid on.', cta: "Let's start" },
  { title: 'Review carrier bids', body: 'Compare price, ETA, and ratings from competing carriers.', cta: 'Next' },
  { title: 'Award and track', body: 'Accept a bid, mark status updates, and release payouts.', cta: 'Got it' },
];

function WalkthroughModal({ step, onStep, onFinish }) {
  const current = WALKTHROUGH_STEPS[Math.min(step, WALKTHROUGH_STEPS.length - 1)];
  const isLast = step >= WALKTHROUGH_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true" aria-label="Welcome walkthrough">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border bg-surface p-5 shadow-2xl sm:p-8" style={{ borderColor: 'var(--border-default)' }}>
        <h2 className="font-display text-xl font-bold text-ink">Welcome to Loadbyton</h2>
        <p className="mt-1 mb-6 text-sm text-ink-muted">Step {step + 1} of {WALKTHROUGH_STEPS.length}</p>

        <div className="mb-1 flex gap-1.5">
          {WALKTHROUGH_STEPS.map((_, i) => (
            <span key={i} className="h-1 flex-1 rounded-full" style={{ background: i <= step ? 'var(--brand-accent)' : 'var(--border-default)' }} />
          ))}
        </div>

        <div className="mt-6">
          <h3 className="font-semibold text-ink">{current.title}</h3>
          <p className="mt-1 text-sm text-ink-muted">{current.body}</p>
          <button onClick={() => (isLast ? onFinish() : onStep(step + 1))} className="btn-accent mt-4 w-full">
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
  );
}
