// The EDI consignments list page crashed (uncaught TypeError) because it read
// `consignment_id`, a field the API never returned; the key is `id`. It also
// showed "—" for every Linked Job because the list never carried job_code.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeClient } = require('./harness');

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server.stop(); });

for (const [label, email] of [['shipper', 'shipper@jebelalilogistics.ae'], ['admin', 'admin@loadbyton.ae']]) {
  test(`GET /api/edi/consignments as ${label} returns rows keyed by id, with the linked job's code`, async () => {
    const client = makeClient(server.baseUrl);
    await client.login(email, 'demo1234');
    const res = await client.get('/api/edi/consignments');
    assert.equal(res.status, 200, res.raw);
    const demo = res.body.consignments.find((c) => c.id === 'EDI304-DEMO-001');
    assert.ok(demo, 'the seeded demo consignment should be listed');
    assert.equal(demo.consignment_id, undefined, 'there is no consignment_id field — the UI must use id');
    assert.ok(demo.job_code, 'a linked consignment carries its job_code');
  });
}
