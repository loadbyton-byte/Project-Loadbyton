// Regression coverage for "posting a job errors out" — each case below is a
// real failure found by driving POST /api/jobs the way the web form and the
// CSV importer do:
//   * blank/null optional fields (a cleared number input sends "") used to be
//     coerced to 0 and rejected with "Too small: expected number to be >=22";
//   * a bad cargoValueAed / insuranceOptIn returned 400 AFTER the job row was
//     already inserted, leaving a live ghost job behind;
//   * readyAt/deadline are TEXT columns, so "tomorrow" or a deadline before
//     the ready time was stored as-is;
//   * job_code has only 9,000 values a month behind a UNIQUE constraint with
//     no retry, so posting failed at random and then always once exhausted.

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { startServer, makeClient, sqliteOnly } = require('./harness');

let server;
let shipper;

test.before(async () => {
  server = await startServer();
  shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
});

test.after(async () => {
  await server.stop();
});

const hours = (n) => new Date(Date.now() + n * 3600000).toISOString();
const validJob = (over = {}) => ({
  shipmentType: 'IMPORT',
  containerSize: '20FT',
  containerType: 'DRY',
  pickupTerminal: 'Jebel Ali Port (DP World)',
  deliveryArea: 'Dubai Industrial City',
  readyAt: hours(5),
  deadline: hours(53),
  ...over,
});
const jobCount = () => {
  const direct = new DatabaseSync(server.dbPath);
  try { return direct.prepare('SELECT COUNT(*) c FROM jobs').get().c; } finally { direct.close(); }
};

test('blank / null optional fields post fine (a cleared form input is "not provided", not 0)', async () => {
  const res = await shipper.post('/api/jobs', validJob({
    targetPriceAed: '', cargoWeightTons: '', notes: null,
    pickupLat: null, pickupLng: '', deliveryLat: null, deliveryLng: null, truckLengthM: '', equipmentBodyType: '',
  }));
  assert.equal(res.status, 201, res.raw);
  assert.equal(res.body.job.status, 'OPEN');
  assert.equal(res.body.job.pickup_lat, null);
  assert.equal(res.body.job.max_budget_aed, null);
});

test('a map pin outside the UAE is dropped instead of blocking the post', async () => {
  const res = await shipper.post('/api/jobs', validJob({ pickupLat: 51.5, pickupLng: -0.12, deliveryLat: 25.2, deliveryLng: 55.3 }));
  assert.equal(res.status, 201, res.raw);
  assert.equal(res.body.job.pickup_lat, null, 'an out-of-range pin must not be stored');
  assert.equal(res.body.job.delivery_lat, 25.2, 'a valid pin is kept');
});

test('validation errors name the field in plain language, not "Too small: expected number to be >0"', async () => {
  const zero = await shipper.post('/api/jobs', validJob({ targetPriceAed: 0 }));
  assert.equal(zero.status, 400);
  assert.match(zero.body.message, /Target price must be greater than 0/);

  const heavy = await shipper.post('/api/jobs', validJob({ cargoWeightTons: 5000 }));
  assert.equal(heavy.status, 400);
  assert.match(heavy.body.message, /Cargo weight must be at most 1,000/);
});

test('a rejected cargo value / insurance opt-in leaves NO ghost job behind', { skip: sqliteOnly }, async () => {
  const before = jobCount();
  const noValue = await shipper.post('/api/jobs', validJob({ insuranceOptIn: true }));
  assert.equal(noValue.status, 400);
  assert.match(noValue.body.message, /cargoValueAed is required/);
  const badValue = await shipper.post('/api/jobs', validJob({ cargoValueAed: -5 }));
  assert.equal(badValue.status, 400);
  assert.equal(jobCount(), before, 'a 400 must not have inserted a job row');
});

test('declared cargo value + insurance opt-in are stored on the job in the same insert', async () => {
  const res = await shipper.post('/api/jobs', validJob({ cargoValueAed: 50000, insuranceOptIn: true }));
  assert.equal(res.status, 201, res.raw);
  assert.equal(res.body.job.cargo_value_aed, 50000);
  assert.equal(res.body.job.insurance_opt_in, 1);
});

test('unparseable or inverted dates are rejected instead of stored', { skip: sqliteOnly }, async () => {
  const before = jobCount();
  const garbage = await shipper.post('/api/jobs', validJob({ readyAt: 'tomorrow' }));
  assert.equal(garbage.status, 400);
  assert.match(garbage.body.message, /readyAt must be a valid date/);

  const inverted = await shipper.post('/api/jobs', validJob({ readyAt: hours(48), deadline: hours(24) }));
  assert.equal(inverted.status, 400);
  assert.match(inverted.body.message, /deadline must be after readyAt/);

  const past = await shipper.post('/api/jobs', validJob({ readyAt: hours(-72), deadline: hours(-24) }));
  assert.equal(past.status, 400);
  assert.match(past.body.message, /already in the past/);
  assert.equal(jobCount(), before);
});

test('ready/deadline are stored as normalised ISO-8601 so sorting and date maths stay consistent', async () => {
  const res = await shipper.post('/api/jobs', validJob({ readyAt: '2099-01-05 10:00', deadline: '2099-01-07 10:00' }));
  assert.equal(res.status, 201, res.raw);
  assert.match(res.body.job.ready_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(res.body.job.deadline, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('an unparseable scheduledPostAt is rejected', async () => {
  const res = await shipper.post('/api/jobs', validJob({ scheduledPostAt: 'next week' }));
  assert.equal(res.status, 400);
  assert.match(res.body.message, /scheduledPostAt must be a valid date/);
});

test('posting still succeeds when the whole month\'s 4-digit job-code space is already taken', { skip: sqliteOnly }, async () => {
  // 9,000 four-digit codes exist per month and job_code is UNIQUE. Fill every
  // one of them, so the first attempts at a fresh code are certain to collide
  // and the post only succeeds if the retry (with a wider code) works.
  const direct = new DatabaseSync(server.dbPath);
  const now = new Date();
  const prefix = `LBT-DXB-${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}-`;
  try {
    const shipperId = direct.prepare(`SELECT id FROM users WHERE email='shipper@jebelalilogistics.ae'`).get().id;
    direct.exec('BEGIN');
    const ins = direct.prepare(
      `INSERT OR IGNORE INTO jobs (job_code, shipper_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, status)
       VALUES (?,?,?,?,?,?,?,?,?, 'CANCELLED')`
    );
    for (let n = 1000; n <= 9999; n++) ins.run(`${prefix}${n}`, shipperId, '20FT', 'DRY', 'x', 'y', 'z', hours(1), hours(49));
    direct.exec('COMMIT');
  } finally { direct.close(); }

  const res = await shipper.post('/api/jobs', validJob());
  assert.equal(res.status, 201, res.raw);
  assert.match(res.body.job.job_code, new RegExp(`^${prefix}\\d{6}$`), 'falls through to a 6-digit code once 4-digit codes are exhausted');
});

test('editing a job: dates are validated and stored as UTC ISO, and deadline must stay after ready time', async () => {
  const created = await shipper.post('/api/jobs', validJob());
  assert.equal(created.status, 201, created.raw);
  const id = created.body.job.id;

  // A zone-less datetime-local value used to be stored verbatim, so the browser
  // (reads it as local) and the server (reads it as UTC) disagreed by the UAE's +4h.
  const ready = new Date(Date.now() + 30 * 3600000).toISOString();
  const deadline = new Date(Date.now() + 80 * 3600000).toISOString();
  const ok = await shipper.patch(`/api/jobs/${id}`, { readyAt: ready, deadline });
  assert.equal(ok.status, 200, ok.raw);
  assert.equal(ok.body.job.ready_at, ready);
  assert.equal(ok.body.job.deadline, deadline);

  const bad = await shipper.patch(`/api/jobs/${id}`, { readyAt: 'tomorrow' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message || bad.body.error, /readyAt must be a valid date/);

  const inverted = await shipper.patch(`/api/jobs/${id}`, { deadline: new Date(Date.now() + 1 * 3600000).toISOString() });
  assert.equal(inverted.status, 400, 'a deadline before the (unchanged) ready time must be refused');
  assert.match(inverted.body.message || inverted.body.error, /deadline must be after readyAt/);

  const price = await shipper.patch(`/api/jobs/${id}`, { targetPriceAed: 0 });
  assert.equal(price.status, 400);
  assert.match(price.body.message || price.body.error, /Target price must be greater than 0/);

  // blank optional field is "not provided", not an error
  const blank = await shipper.patch(`/api/jobs/${id}`, { notes: 'updated', cargoWeightTons: '' });
  assert.equal(blank.status, 200, blank.raw);
});
