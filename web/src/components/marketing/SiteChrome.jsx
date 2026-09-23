// Shared header/mobile-menu/footer for every marketing + auth page — ported
// from the design-tool export's site/SiteChrome.jsx. Converted from
// `Object.assign(window, {...})` (which would crash `renderToStaticMarkup`
// during build-time prerendering — there is no `window` in Node) into real
// ES module exports, and every `href="Some%20Page.html"` link into a real
// react-router `<Link>`/`<NavLink>` — there are no static .html documents
// in the actual app.
import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../lib/auth.jsx';
import BrandWordmark from '../BrandWordmark.jsx';
import { IconMoon, IconSun } from '../icons.jsx';

const navLinkClass = ({ isActive }) => (isActive ? 'current' : undefined);

export function SiteProgress() {
  return <div id="progress" aria-hidden="true" />;
}

export function SiteNav() {
  const { theme, setTheme } = useAuth();
  return (
    <header className="nav" id="nav">
      <div className="container navbar">
        <Link className="logo" to="/" aria-label="Loadbyton home">
          <BrandWordmark className="h-auto w-[150px]" />
        </Link>
        <nav className="links" aria-label="Primary">
          <NavLink to="/features" className={navLinkClass}>Features</NavLink>
          <NavLink to="/pricing" className={navLinkClass}>Pricing</NavLink>
          <NavLink to="/about" className={navLinkClass}>About</NavLink>
          <NavLink to="/blog" className={navLinkClass}>Blog</NavLink>
          <NavLink to="/security" className={navLinkClass}>Security</NavLink>
          <NavLink to="/compliance" className={navLinkClass}>Compliance</NavLink>
        </nav>
        <div className="nav-right">
          <button
            className="theme-pill"
            type="button"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <IconSun size={19} /> : <IconMoon size={19} />}
          </button>
          <NavLink className={navLinkClass} to="/login" style={{ padding: '10px 12px', fontSize: 12, fontWeight: 750 }}>
            Log in
          </NavLink>
          <Link className="btn btn-red shimmer" to="/register">Get started</Link>
          <button className="menu" id="menu" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="mobileNav">
            &#9776;
          </button>
        </div>
      </div>
    </header>
  );
}

export function SiteMobileNav() {
  return (
    <div className="mobile-nav" id="mobileNav">
      <NavLink to="/features" className={navLinkClass}>Features</NavLink>
      <NavLink to="/industries" className={navLinkClass}>Industries</NavLink>
      <NavLink to="/pricing" className={navLinkClass}>Pricing</NavLink>
      <NavLink to="/for-shippers" className={navLinkClass}>For shippers</NavLink>
      <NavLink to="/for-transporters" className={navLinkClass}>For transporters</NavLink>
      <NavLink to="/about" className={navLinkClass}>About</NavLink>
      <NavLink to="/blog" className={navLinkClass}>Blog</NavLink>
      <NavLink to="/security" className={navLinkClass}>Security</NavLink>
      <NavLink to="/compliance" className={navLinkClass}>Compliance</NavLink>
      <NavLink to="/trust" className={navLinkClass}>Trust &amp; safety</NavLink>
      <NavLink to="/login" className={navLinkClass}>Log in</NavLink>
      <Link className="btn btn-red" to="/register">Get started &#8594;</Link>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link className="logo" to="/" aria-label="Loadbyton">
              <BrandWordmark dark className="h-auto w-[180px]" />
            </Link>
            <p>A connected freight workspace for the operational work behind the load.</p>
            <span className="footer-note"><i />OPERATING IN THE UAE</span>
          </div>
          <div className="fcol">
            <h4>Platform</h4>
            <ul>
              <li><Link to="/features">Features</Link></li>
              <li><Link to="/industries">Industries</Link></li>
              <li><Link to="/pricing">Pricing</Link></li>
              <li><Link to="/trust">Trust &amp; safety</Link></li>
            </ul>
          </div>
          <div className="fcol">
            <h4>Product</h4>
            <ul>
              <li><Link to="/for-shippers">For shippers</Link></li>
              <li><Link to="/for-transporters">For transporters</Link></li>
              <li><Link to="/gcc/corridors">GCC corridors</Link></li>
              <li><Link to="/login">Operations login</Link></li>
            </ul>
          </div>
          <div className="fcol">
            <h4>Company</h4>
            <ul>
              <li><Link to="/about">About</Link></li>
              <li><Link to="/blog">Blog</Link></li>
              <li><a href="mailto:hello@loadbyton.com">Contact</a></li>
              <li><Link to="/register">Get started</Link></li>
            </ul>
          </div>
        </div>
        <div className="foot-bottom">
          <span>&copy; {new Date().getFullYear()} Loadbyton. All rights reserved.</span>
          <div className="legal">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/security">Security</Link>
            <Link to="/compliance">Compliance</Link>
          </div>
          <span className="region"><i />UAE &middot; FREIGHT TECHNOLOGY</span>
        </div>
      </div>
    </footer>
  );
}
