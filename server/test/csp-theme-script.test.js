// The saved-theme inline script in web/index.html must be allowed by the CSP
// (by hash), or dark-mode users see a light flash on every page load.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { DIST_INDEX } = require('../lib/config');
const { securityHeaders } = require('../lib/http');

test('CSP allows the theme-init inline script by hash, and nothing else inline', { skip: !fs.existsSync(DIST_INDEX) && 'web/dist not built' }, () => {
  const html = fs.readFileSync(DIST_INDEX, 'utf8');
  const theme = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find((m) => m[1].includes('loadbyton-theme'));
  assert.ok(theme, 'built index.html should contain the theme script');
  const hash = crypto.createHash('sha256').update(theme[1], 'utf8').digest('base64');

  const headers = {};
  securityHeaders({ path: '/', secure: false }, { setHeader: (k, v) => { headers[k] = v; } }, () => {});
  const scriptSrc = headers['Content-Security-Policy'].match(/script-src ([^;]*)/)[1];
  assert.ok(scriptSrc.includes(`'sha256-${hash}'`), 'theme script hash must be in script-src');
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), "no blanket 'unsafe-inline'");
  assert.equal((scriptSrc.match(/sha256-/g) || []).length, 1, 'only the theme script is allowed by hash');
});
