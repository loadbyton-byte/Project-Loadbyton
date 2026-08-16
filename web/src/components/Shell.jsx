import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth, roleHome } from '../lib/auth.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { api } from '../lib/api.js';
import {
  IconMenu, IconClose, IconBell, IconLogOut, IconUser, IconMoon, IconSun,
  IconHome, IconHistory, IconFile, IconGavel, IconCheckCircle, IconWallet,
  IconTrendUp, IconSettings,
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
function navByRole(t) {
  return {
    SHIPPER: [
      { to: '/dashboard', label: t('nav.dashboard', 'Dashboard'), icon: <IconHome size={20} /> },
      { to: '/templates', label: t('nav.templates', 'Templates'), icon: <IconHistory size={20} /> },
      { to: '/contracts', label: t('nav.contracts', 'Contract lanes'), icon: <IconFile size={20} /> },
      { to: '/analytics', label: t('nav.analytics', 'Analytics'), icon: <IconTrendUp size={20} /> },
    ],
    CARRIER: [
      { to: '/open-loads', label: t('nav.openLoads', 'Open loads'), icon: <IconHome size={20} /> },
      { to: '/my-bids', label: t('nav.myBids', 'My bids'), icon: <IconGavel size={20} /> },
      { to: '/won-jobs', label: t('nav.wonJobs', 'Won jobs'), icon: <IconCheckCircle size={20} /> },
      { to: '/earnings', label: t('nav.earnings', 'Earnings'), icon: <IconWallet size={20} /> },
      { to: '/analytics', label: t('nav.analytics', 'Analytics'), icon: <IconTrendUp size={20} /> },
    ],
    ADMIN: [
      { to: '/admin', label: t('nav.admin', 'Admin console'), icon: <IconSettings size={20} /> },
    ],
  };
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
  const navItems = user ? navByRole(t)[user.role] || [] : [];
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
    <div className="flex min-h-screen flex-col bg-canvas">
      {user?.impersonating && (
        <div className="flex items-center justify-center gap-3 px-4 py-2 text-center text-xs font-medium text-white" style={{ background: 'var(--status-danger)' }}>
          <span>Impersonating {user.profile?.company_name || user.email} — logged to the audit trail.</span>
          <button onClick={handleEndImpersonation} disabled={endingImpersonation} className="shrink-0 rounded-full border border-white/40 px-2.5 py-1 text-xs font-semibold hover:bg-white/10">
            {endingImpersonation ? 'Returning…' : 'Return to admin'}
          </button>
        </div>
      )}

      {user && !user.email_verified && !user.impersonating && (
        <div className="flex flex-wrap items-center justify-center gap-3 px-4 py-2 text-center text-xs" style={{ background: 'var(--status-warning-bg)', color: 'var(--status-warning)' }}>
          <span>Verify your email to keep full access to your account.</span>
          <button onClick={handleResendVerification} disabled={resendingVerification} className="font-semibold underline underline-offset-2 disabled:opacity-60">
            {resendingVerification ? 'Sending…' : 'Resend verification email'}
          </button>
        </div>
      )}

      {/* TopAppBar — mobile only (md:hidden). Desktop replaces this with a
          persistent sidebar + slim top bar below, per the enterprise-layout
          restructure; this stays the nav for narrow widths since it already
          works well there. */}
      <header
        className="sticky top-0 z-40 border-b backdrop-blur-md md:hidden"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)' }}
      >
        <div className="flex h-14 items-center justify-between px-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-container"
            aria-label="Open menu"
          >
            <IconMenu size={22} />
          </button>

          <Logo to={user ? roleHome(user.role) : '/'} />

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
          <div className="animate-drawer-in relative flex h-full w-[84%] max-w-xs flex-col overflow-y-auto bg-surface p-5" style={{ boxShadow: 'var(--lb-shadow-lg)' }}>
            <div className="flex items-center justify-between">
              <Logo />
              <button onClick={closeDrawer} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-container" aria-label="Close menu">
                <IconClose size={18} />
              </button>
            </div>

            <nav className="mt-6 flex flex-col gap-1">
              {(user ? navItems : guestLinks).map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={closeDrawer}
                  className={({ isActive }) => cx('rounded-lg px-3 py-2.5 text-sm font-semibold', isActive ? 'bg-surface-container text-ink' : 'text-ink-secondary hover:bg-surface-container')}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="my-4 border-t" style={{ borderColor: 'var(--border-subtle)' }} />

            <div className="flex flex-col gap-1">
              <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-ink-secondary hover:bg-surface-container">
                {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
              <button onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} className="rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-ink-secondary hover:bg-surface-container">
                {locale === 'ar' ? 'English' : 'العربية'}
              </button>
            </div>

            <div className="mt-auto pt-4">
              {user ? (
                <>
                  <div className="mb-3 rounded-lg px-3 py-2.5" style={{ background: 'var(--surface-container)' }}>
                    <p className="truncate text-sm font-semibold text-ink">{actingAs ? actingAs.displayName || actingAs.email : user.email}</p>
                    <p className="text-xs text-ink-muted">{actingAs ? `Seat · ${actingAs.seatRole}` : `${user.role} · ${user.tier}`}</p>
                  </div>
                  <Link to="/profile" onClick={closeDrawer} className="mb-1 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-ink-secondary hover:bg-surface-container">
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
            className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r"
            style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}
          >
            <div className="flex h-14 items-center border-b px-5" style={{ borderColor: 'var(--border-subtle)' }}>
              <Logo />
            </div>

            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => cx('flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors', isActive ? 'bg-surface-container text-ink' : 'text-ink-secondary hover:bg-surface-container')}
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="border-t p-3" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="mb-2 rounded-md px-3 py-2.5" style={{ background: 'var(--surface-container)' }}>
                <p className="truncate text-sm font-semibold text-ink">{actingAs ? actingAs.displayName || actingAs.email : user.email}</p>
                <p className="text-xs text-ink-muted">{actingAs ? `Seat · ${actingAs.seatRole}` : `${user.role} · ${user.tier}`}</p>
              </div>
              <Link to="/profile" className="mb-1 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-container">
                <IconUser size={16} /> Profile &amp; settings
              </Link>
              <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-semibold text-ink-secondary hover:bg-surface-container">
                {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
              <button onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm font-semibold text-ink-secondary hover:bg-surface-container">
                {locale === 'ar' ? 'English' : 'العربية'}
              </button>
              <button onClick={handleLogout} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-semibold hover:bg-surface-container" style={{ color: 'var(--status-danger)' }}>
                <IconLogOut size={16} /> Log out
              </button>
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
                </div>
                <p className="text-xs text-ink-muted" dir="ltr">© {new Date().getFullYear()} Loadbyton. Demo system — payouts are simulated, not real transfers.</p>
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
      <div className="w-full max-w-md rounded-lg border bg-surface p-8 shadow-2xl" style={{ borderColor: 'var(--border-default)' }}>
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
