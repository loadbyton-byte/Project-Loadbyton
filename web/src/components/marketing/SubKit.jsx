// Reusable subpage building blocks — ported from the design-tool export's
// site/SubKit.jsx. All nine marketing subpages (pages/Marketing.jsx below)
// compose from these. Converted from `Object.assign(window, {...})` to real
// ES module exports (see SiteChrome.jsx's header for why), `PHOTOS` mapped
// onto the campaign photography the real app already ships at
// web/public/cinematic-assets/campaign-2026/ (lib/campaignImages.js) rather
// than importing the zip's own re-compressed duplicate binaries, and `PAGE`
// mapped onto real react-router paths instead of `.html` filenames.
import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CAMPAIGN_IMAGES } from '../../lib/campaignImages.js';
import { initSiteRuntime } from '../../lib/siteRuntime.js';
import { MktIcon } from './MktIcon.jsx';
import { SiteProgress, SiteNav, SiteMobileNav, SiteFooter } from './SiteChrome.jsx';

export const PHOTOS = {
  crossDock: CAMPAIGN_IMAGES.crossDock,
  roadFreight: CAMPAIGN_IMAGES.roadFreight,
  fleet: CAMPAIGN_IMAGES.fleet,
  customs: CAMPAIGN_IMAGES.customs,
  smartGate: CAMPAIGN_IMAGES.smartGate,
  containerChassis: CAMPAIGN_IMAGES.containerChassis,
  materials: CAMPAIGN_IMAGES.materials,
  flatbed: CAMPAIGN_IMAGES.flatbed,
  boxTruck: CAMPAIGN_IMAGES.boxTruck,
  reefer: CAMPAIGN_IMAGES.reefer,
  port: CAMPAIGN_IMAGES.port,
  industrialCargo: CAMPAIGN_IMAGES.industrialCargo,
  yard: CAMPAIGN_IMAGES.pickup,
  lowbed: CAMPAIGN_IMAGES.lowbed,
};

export const PAGE = {
  home: '/', features: '/features', pricing: '/pricing', about: '/about', blog: '/blog', security: '/security',
  compliance: '/compliance', industries: '/industries', shippers: '/for-shippers', transporters: '/for-transporters',
  trust: '/trust', login: '/login', register: '/register',
};

export const pad2 = (n) => String(n).padStart(2, '0');
export const delay = (ms) => ({ transitionDelay: ms + 'ms' });

export function SubHero({ kicker, title, lede, photo, actions }) {
  return (
    <section className={'sub-hero' + (photo ? '' : ' sub-hero--plain')}>
      <div className="sub-hero-media" aria-hidden="true">
        {photo && <img src={photo} alt="" />}
        {photo && <div className="hero-vignette" />}
      </div>
      <div className="sub-hero-grid" aria-hidden="true" />
      <div className="container sub-hero-inner">
        <div className="sub-hero-copy">
          <div className="hero-kicker mkt-reveal"><i />{kicker}</div>
          <h1 className="mkt-reveal" style={delay(60)}>{title}</h1>
          {lede && <p className="lede mkt-reveal" style={delay(120)}>{lede}</p>}
          {actions && <div className="hero-actions mkt-reveal" style={delay(180)}>{actions}</div>}
        </div>
      </div>
    </section>
  );
}

function SubHead({ no, title, copy }) {
  return (
    <div className={'sub-head' + (copy ? '' : ' sub-head--solo')}>
      <div><div className="eyebrow mkt-reveal">{no}</div><h2 className="display mkt-reveal" style={delay(60)}>{title}</h2></div>
      {copy && <p className="copy mkt-reveal" style={delay(120)}>{copy}</p>}
    </div>
  );
}

export function SubSection({ tone = 'white', no, title, copy, children }) {
  return (
    <section className={'sub-sec ' + tone}>
      <div className="container">
        {title && <SubHead no={no} title={title} copy={copy} />}
        {children}
      </div>
    </section>
  );
}

export function SubCard({ code, icon, title, body, flag, children, i = 0, ok }) {
  return (
    <article className="pcard" style={{ transitionDelay: (i % 3) * 70 + 'ms' }}>
      <div className="pcard-top">
        <span className="pcard-num">{code}</span>
        {flag ? <span className="pcard-flag">{flag}</span> : icon && <span className="pcard-ico"><MktIcon name={icon} size={18} /></span>}
      </div>
      <h3>{title}{ok && <span className="ok"><MktIcon name="Check" size={14} /></span>}</h3>
      {body && <p>{body}</p>}
      {children}
    </article>
  );
}

export function SubCards({ prefix, items, cols }) {
  return (
    <div className={'sub-grid' + (cols === 4 ? ' sub-grid--4' : '')}>
      {items.map((it, i) => <SubCard key={it.title} i={i} code={prefix + '-' + pad2(i + 1)} {...it} />)}
    </div>
  );
}

export function SubSteps({ steps }) {
  return (
    <div className="sub-grid sub-grid--4">
      {steps.map((s, i) => (
        <article className="pcard" key={s.n} style={{ transitionDelay: i * 70 + 'ms' }}>
          <div className="pcard-top"><span className="pcard-num">{s.n}</span><span className="pcard-ico"><MktIcon name={s.icon} size={18} /></span></div>
          <h3>{s.title}</h3>
          <p>{s.body}</p>
          <div className="pcard-vis"><div className="pcard-bar"><i style={{ '--w': (i + 1) * 25 + '%' }} /></div></div>
        </article>
      ))}
    </div>
  );
}

export function SubCta({ kicker, title, body, primary, secondary }) {
  return (
    <section className="cta-wrap">
      <div className="container">
        <div className="cta cta--sub mkt-reveal">
          <div className="border-beam" aria-hidden="true" />
          <div className="cta-in">
            <div className="eyebrow">{kicker}</div>
            <h2>{title}</h2>
            {body && <p>{body}</p>}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link className="btn btn-red shimmer" to={primary[1]}>{primary[0]} &#8594;</Link>
              {secondary && <Link className="btn btn-glass" to={secondary[1]}>{secondary[0]}</Link>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// Every marketing/auth page renders exactly one of these as its outermost
// element — `.mkt-scope` is what scopes the entire ported CSS
// (styles/marketing.css) to just these pages; see that file's header.
export function SitePage({ children }) {
  useEffect(() => {
    const destroy = initSiteRuntime();
    return destroy;
  }, []);
  return (
    <div className="mkt-scope">
      <SiteProgress /><SiteNav /><SiteMobileNav />
      <main id="top">{children}</main>
      <SiteFooter />
    </div>
  );
}
