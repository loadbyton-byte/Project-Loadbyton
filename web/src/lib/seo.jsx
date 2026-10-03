import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import metadata from '../../../seo-meta.json';

// One route owner prevents individual page effects from restoring stale metadata.
export function usePageTitle() {}
export function useMeta() {}

export function RouteSeo() {
  const { pathname } = useLocation();
  useEffect(() => {
    const route = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
    const meta = metadata[route];
    document.title = meta?.title || 'Loadbyton Account';
    const set = (selector, attribute, value) => {
      let tag = document.querySelector(selector);
      if (tag) tag.setAttribute(attribute, value);
    };
    set('meta[name="description"]', 'content', meta?.description || 'Your Loadbyton freight workspace.');
    for (const key of ['title', 'description']) {
      set(`meta[property="og:${key}"]`, 'content', meta?.[key] || 'Loadbyton');
      set(`meta[name="twitter:${key}"]`, 'content', meta?.[key] || 'Loadbyton');
    }
    const url = `https://loadbyton.com${route}`;
    set('link[rel="canonical"]', 'href', url);
    set('meta[property="og:url"]', 'content', url);
    set('meta[name="robots"]', 'content', meta ? 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1' : 'noindex,follow');
    const schema = document.getElementById('page-schema');
    if (schema) schema.textContent = JSON.stringify(meta ? {
      '@context': 'https://schema.org', '@type': 'WebPage', '@id': `${url}#webpage`,
      url, name: meta.title, description: meta.description, inLanguage: 'en',
      isPartOf: { '@id': 'https://loadbyton.com/#website' },
      about: { '@id': 'https://loadbyton.com/#organization' },
    } : {});
  }, [pathname]);
  return null;
}
