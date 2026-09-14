// Coverage for GET /api/transporters (server/routes/directory.routes.js) —
// a logged-in shipper previously had no page to browse verified
// transporters at all, only the anonymous public preview strip
// (GET /api/public/carriers) or a broker's own private roster.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeClient } = require('./harness');

let server;
let shipper;
let carrier;

test.before(async () => {
  server = await startServer();
  shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
});

test.after(async () => {
  await server.stop();
});

test('an authenticated shipper can browse verified transporters, unauthenticated cannot', async () => {
  const anon = makeClient(server.baseUrl);
  const blocked = await anon.get('/api/transporters');
  assert.equal(blocked.status, 401, blocked.raw);

  const list = await shipper.get('/api/transporters');
  assert.equal(list.status, 200, list.raw);
  assert.ok(Array.isArray(list.body.transporters));
  assert.ok(list.body.transporters.length > 0, 'the seeded demo roster must include at least one verified transporter');
  for (const t of list.body.transporters) {
    assert.ok(t.name, 'each entry must have a company name');
    assert.equal(typeof t.rating, 'number');
  }
});

test('a carrier account can also browse the directory (not shipper-only)', async () => {
  const list = await carrier.get('/api/transporters');
  assert.equal(list.status, 200, list.raw);
});

test('search filters by company name', async () => {
  const all = await shipper.get('/api/transporters');
  const someName = all.body.transporters[0].name.slice(0, 4);
  const filtered = await shipper.get(`/api/transporters?q=${encodeURIComponent(someName)}`);
  assert.equal(filtered.status, 200, filtered.raw);
  assert.ok(filtered.body.transporters.every((t) => t.name.toLowerCase().includes(someName.toLowerCase())));
});

test('pagination fields are present and respected', async () => {
  const page1 = await shipper.get('/api/transporters?limit=1&offset=0');
  assert.equal(page1.status, 200, page1.raw);
  assert.equal(page1.body.transporters.length, 1);
  assert.equal(page1.body.limit, 1);
  assert.ok(page1.body.total >= 1);
});
