// The six Loadbyton domains, in one place (master plan §2). Navigation, the
// footer directory, the ecosystem menu and the cross-domain interstitial all
// read this list — change a domain's status here and every surface follows.
//
// status:
//   live     serving real users today
//   pilot    serving pilot customers; scope is stated on its own site
//   planned  not launched — shown as "Coming soon", never linked
//
// Only freight (this site) and the Business OS are grounded in repositories.
// The other four are proposed roles; domain ownership is stated by the owner,
// not independently verified.

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const BRANCHES = [
  {
    key: 'freight',
    domain: 'loadbyton.com',
    descriptor: 'FREIGHT',
    name: 'Freight marketplace',
    purpose: 'Post loads, bid, execute and earn on UAE road freight and container drayage.',
    status: 'live',
    url: 'https://loadbyton.com',
    accent: 'var(--branch-freight)',
  },
  {
    key: 'store',
    domain: 'loadbyton.store',
    descriptor: 'STORE',
    name: 'Business OS & Services',
    purpose: 'Operating software across 18 logistics sectors, plus websites and growth services.',
    status: 'pilot',
    url: env.VITE_STORE_URL || 'https://loadbyton.store',
    accent: 'var(--branch-store)',
  },
  {
    key: 'shop',
    domain: 'loadbyton.shop',
    descriptor: 'SHOP',
    name: 'Procurement exchange',
    purpose: 'Pool comparable buying needs, compare landed cost, award and fulfil purchases.',
    status: 'planned',
    url: null,
    accent: 'var(--branch-shop)',
  },
  {
    key: 'net',
    domain: 'loadbyton.net',
    descriptor: 'NETWORK',
    name: 'UAE trade community',
    purpose: 'Relevant updates, practical guides, offers and events for UAE logistics and trade.',
    status: 'planned',
    url: null,
    accent: 'var(--branch-network)',
  },
  {
    key: 'me',
    domain: 'loadbyton.me',
    descriptor: 'PEOPLE',
    name: 'Professional profiles',
    purpose: 'Verified role profiles, portfolios and opportunities for logistics professionals.',
    status: 'planned',
    url: null,
    accent: 'var(--branch-people)',
  },
  {
    key: 'xyz',
    domain: 'loadbyton.xyz',
    descriptor: 'DEVELOPERS',
    name: 'Developer platform',
    purpose: 'API documentation, a sandbox with synthetic data, and integrations.',
    status: 'planned',
    url: null,
    accent: 'var(--branch-developers)',
  },
];

export const STATUS_LABEL = { live: 'Live', pilot: 'Pilot', planned: 'Coming soon' };

export const branchByKey = (key) => BRANCHES.find((b) => b.key === key) || null;

// A branch can be linked only once it serves someone.
export const isLinkable = (branch) => !!branch && branch.status !== 'planned' && !!branch.url;

// Cross-domain links go through /go/:key so the destination is always named
// before the person leaves (master plan §2). `path` must be a relative path.
export function goPath(key, path = '') {
  const safe = typeof path === 'string' && /^\/[A-Za-z0-9\-._~/%]*$/.test(path) && !path.startsWith('//') ? path : '';
  return `/go/${key}${safe ? `?to=${encodeURIComponent(safe)}` : ''}`;
}

export function externalUrl(branch, path = '') {
  if (!isLinkable(branch)) return null;
  const safe = typeof path === 'string' && /^\/[A-Za-z0-9\-._~/%]*$/.test(path) && !path.startsWith('//') ? path : '';
  return `${branch.url.replace(/\/$/, '')}${safe}`;
}
