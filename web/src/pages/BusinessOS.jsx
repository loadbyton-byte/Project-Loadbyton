// Public explainer for the Business OS benefit (loadbyton.store). Prerendered
// like every public marketing page, so it must stay a plain eager import with
// no data fetching at render time.
//
// Every number below is the Store's published plan ceiling (a pricing
// hypothesis, not a guarantee of provider-funded usage) and is mirrored from
// server/lib/ecosystem/constants.js. Premium membership is not on sale yet, so
// this page says what is included today and never quotes a premium price.
import React from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { MktIcon } from '../components/marketing/MktIcon.jsx';
import { STORE_SECTORS } from '../brand/storeSectors.js';
import { SitePage, SubHero, SubSection, SubCard, SubCta, PHOTOS, PAGE } from '../components/marketing/SubKit.jsx';

const INCLUDED = [
  { name: 'Starter Included', who: 'Every verified company that activates Business OS.', limits: ['3 users, 1 branch, 1 sector, 1 legal entity', '150 jobs and trips a month', '2 GB document storage', '100 messages and 50 assistant drafts a month'] },
  { name: 'Enterprise Included', who: 'While your company holds an active premium membership (not open for purchase yet).', limits: ['100 users, 20 branches, up to 18 sectors, 5 legal entities', '20,000 jobs and trips a month', '200 GB document storage', '10,000 messages and 2,000 assistant drafts a month'] },
];

export default function BusinessOS() {
  usePageTitle('Business OS');
  useMeta('Operating software for UAE logistics companies — included with a verified Loadbyton company account. 18 logistics sectors, one workspace, your data stays yours.');
  return (
    <SitePage>
      <SubHero
        photo={PHOTOS.crossDock}
        kicker="BUSINESS OS"
        title="Run the company behind the load."
        lede="Loadbyton Business OS is operating software for UAE logistics companies: enquiries, jobs, dispatch, warehouse, documents and invoices in one workspace. A verified company on loadbyton.com can activate it without a separate subscription."
        actions={<>
          <Link className="btn btn-red shimmer" to="/account/benefits">Activate for your company &#8594;</Link>
          <Link className="btn btn-glass" to={PAGE.trust}>How we verify companies</Link>
        </>}
      />

      <SubSection tone="cloud" no="01 / What is included" title="Two included plans. No double billing." copy="Included plans carry no software subscription and no standard set-up fee. Limits are plan ceilings, not guaranteed provider-funded usage.">
        <div className="sub-grid">
          {INCLUDED.map((p, i) => (
            <SubCard key={p.name} i={i} code={'PLAN-0' + (i + 1)} icon="Layers" title={p.name} body={p.who}>
              <ul className="pcard-list">{p.limits.map((l) => <li key={l}><MktIcon name="Check" size={14} />{l}</li>)}</ul>
            </SubCard>
          ))}
        </div>
        <p className="sub-lead mkt-reveal" style={{ marginTop: 18 }}>
          Quoted separately, never bundled: external usage and provider fees (SMS, e-invoicing providers, map and tracking services), implementation work, and managed services such as websites, marketing and social management under a signed scope.
        </p>
      </SubSection>

      <SubSection tone="paper" no="02 / How it starts" title="Verified first. Activated by your administrator.">
        <div className="sub-grid sub-grid--4">
          {[
            { n: '01', icon: 'Shield', title: 'Verify your company', body: 'Trade licence and TRN review on loadbyton.com.' },
            { n: '02', icon: 'File', title: 'Accept the terms', body: 'Your company administrator accepts the Business OS terms and picks a sector.' },
            { n: '03', icon: 'Layers', title: 'Workspace created', body: 'Created on first sign-in. Nothing is migrated silently.' },
            { n: '04', icon: 'Check', title: 'Your data stays yours', body: 'If a plan changes, records stay readable and exportable. Nothing is deleted.' },
          ].map((s, i) => (
            <SubCard key={s.n} i={i} code={s.n} icon={s.icon} title={s.title} body={s.body} />
          ))}
        </div>
      </SubSection>

      <SubSection tone="white" no="03 / Sectors" title="Eighteen logistics sectors, one workspace." copy="Sector workflows are released one at a time. Each sector's availability is shown on loadbyton.store; today they run as pilots with the scope stated there.">
        <ul className="eco-sector-list">
          {STORE_SECTORS.map(([slug, name]) => <li key={slug}>{name}</li>)}
        </ul>
      </SubSection>

      <SubCta kicker="Start with the account you already have" title="Check your company's eligibility." body="Sign in to see whether your company is verified and activate Business OS from your benefits page." primary={['See my benefits', '/account/benefits']} secondary={['Create an account', PAGE.register]} />
    </SitePage>
  );
}
