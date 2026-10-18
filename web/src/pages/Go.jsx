// Cross-domain interstitial: names the destination before the person leaves
// (master plan §2). Only branches that serve someone can be opened, and only
// relative paths are carried across — there is no open redirect here.
import React from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { usePageTitle } from '../lib/seo.jsx';
import { SitePage, SubHero, SubSection, PHOTOS } from '../components/marketing/SubKit.jsx';
import { branchByKey, externalUrl, isLinkable, STATUS_LABEL } from '../brand/ecosystem.js';

export default function Go() {
  const { key } = useParams();
  const [params] = useSearchParams();
  const branch = branchByKey(key);
  usePageTitle(branch ? `Going to ${branch.domain}` : 'Loadbyton network');
  if (!branch || branch.key === 'freight') return <Navigate to="/" replace />;
  const target = externalUrl(branch, params.get('to') || '');

  return (
    <SitePage>
      <SubHero
        photo={PHOTOS.port}
        kicker={`${branch.descriptor} · ${branch.domain}`}
        title={isLinkable(branch) ? `You are going to ${branch.domain}` : `${branch.domain} is not open yet`}
        lede={isLinkable(branch)
          ? `${branch.name}: ${branch.purpose} It is a separate Loadbyton site with its own sign-in session. You can use your Loadbyton account there.`
          : `${branch.name}: ${branch.purpose} It is ${STATUS_LABEL[branch.status].toLowerCase()}.`}
        actions={isLinkable(branch)
          ? <><a className="btn btn-red shimmer" href={target} rel="noopener">Continue to {branch.domain} &#8594;</a><Link className="btn btn-glass" to="/">Stay on loadbyton.com</Link></>
          : <Link className="btn btn-glass" to="/">Back to loadbyton.com</Link>}
      />
      <SubSection tone="paper" no="Good to know" title="One account, separate sites.">
        <p className="sub-lead mkt-reveal">Each Loadbyton site keeps its own session. We share only what a site needs to recognise your company and your plan, and nothing about your freight jobs leaves loadbyton.com.</p>
      </SubSection>
    </SitePage>
  );
}
