import fs from 'node:fs';
import assert from 'node:assert/strict';
const meta = JSON.parse(fs.readFileSync('../seo-meta.json', 'utf8'));
const sitemap = fs.readFileSync('dist/sitemap.xml', 'utf8');
for (const [route, page] of Object.entries(meta)) {
  const html = fs.readFileSync(`dist/${route === '/' ? '' : route.slice(1) + '/'}index.html`, 'utf8');
  assert.ok(html.includes(`<title>${page.title}</title>`), route + ': title');
  assert.ok(html.includes(`rel="canonical" href="https://loadbyton.com${route}"`), route + ': canonical');
  assert.ok(html.includes(`property="og:url" content="https://loadbyton.com${route}"`), route + ': social URL');
  const schema = JSON.parse(html.match(/<script id="page-schema" type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(schema.url, `https://loadbyton.com${route}`);
  assert.ok(html.includes('<h1'), route + ': rendered content');
  assert.ok(!html.includes('<div id="root"></div>'), route + ': empty shell');
  assert.ok(sitemap.includes(`<loc>https://loadbyton.com${route}</loc>`));
}
assert.ok(!sitemap.includes('/dashboard'));
assert.ok(fs.readFileSync('dist/services/index.html', 'utf8').includes('How much does container transport cost?'));
console.log(`SEO checks passed for ${Object.keys(meta).length} public routes.`);
