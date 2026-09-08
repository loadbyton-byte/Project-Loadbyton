// Isolated test-DB harness.
//
// Spawns the real server (`node index.js`) as a child process against a
// fresh temp SQLite file, so tests exercise the actual boot path, the
// actual seed, and the actual HTTP layer — not a mocked subset of it. The
// temp DB is deleted on teardown, so runs never leak state into each other
// or into server/data/loadbyton.db.
//
// Uses only built-in modules (node:test, node:assert, global fetch) — all
// built into Node 22.

const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// A PID-modulo scheme here (`4100 + process.pid % 400`) reliably collided
// once the suite grew past a single serial file: `node --test` runs test
// FILES concurrently by default, and CI's tighter PID range made two
// spawned child processes land on the exact same port often enough to fail
// real CI runs (harness.js's login() got a "fetch failed" against a port
// already bound by a different file's server) — reproduced directly in
// CI run 34174619234's local-transport.test.js failures. Asking the OS for
// an actual free ephemeral port (bind to :0, read back what it picked,
// release it) is the standard fix and has no such collision class — the
// brief window between releasing it here and the child binding it is the
// same one every "let the OS pick, then hand it to a child process" pattern
// accepts, and is far narrower than the modulo scheme's guaranteed-collision
// window under real concurrency.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // server not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

async function startServer(extraEnv = {}) {
  const dbPath = path.join(os.tmpdir(), `loadbyton-test-${process.pid}-${Symbol().description || 'db'}-${Math.random().toString(36).slice(2)}.db`);
  // An explicit PORT in extraEnv (a handful of tests that need a second,
  // predictable server alongside the first) wins over freePort() — this
  // was silently ignored before (baseUrl/waitForHealth always used the
  // freePort() value even when extraEnv.PORT told the *child* to listen
  // elsewhere), which happened to go unnoticed only because the old
  // PID-modulo freePort() returned the exact same value on every call
  // within one test file/process, so a second server's health check
  // coincidentally passed by polling the FIRST server instead — exactly
  // the "silently tests the wrong server" failure mode a comment in
  // insurance.test.js already flagged and worked around downstream. Now
  // that freePort() asks the OS for a real, different port each call, that
  // coincidence no longer holds, which is what surfaced this as a real bug
  // rather than a latent one.
  const port = extraEnv.PORT ? Number(extraEnv.PORT) : await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DB_PATH: dbPath,
      PORT: String(port),
      FRONTEND_URL: 'http://127.0.0.1:1', // dev-CORS branch stays a no-op in tests
      INTERNAL_KEY: 'test-internal-key',
      NODE_ENV: 'test',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  const exitedEarly = new Promise((_, reject) => {
    child.once('exit', (code) => {
      if (code !== null && code !== 0) reject(new Error(`Server exited with code ${code}\n${stderr}`));
    });
  });

  await Promise.race([waitForHealth(baseUrl), exitedEarly]);

  async function stop() {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(dbPath + suffix, { force: true });
    }
  }

  return { baseUrl, dbPath, stop };
}

// Minimal per-actor cookie jar — fetch doesn't persist Set-Cookie across
// calls the way a browser does, and the app is session-cookie-only by
// design (see docs/ARCHITECTURE.md §2), so tests need this to act as more
// than one logged-in role at a time.
function makeClient(baseUrl) {
  let cookie = null;
  async function call(method, urlPath, body, extraHeaders) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    let json = null;
    const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON response */ }
    return { status: res.status, ok: res.ok, body: json, raw: text };
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b, extraHeaders) => call('POST', p, b, extraHeaders),
    patch: (p, b) => call('PATCH', p, b),
    delete: (p) => call('DELETE', p),
    async login(email, password) {
      const r = await call('POST', '/api/auth/login', { email, password });
      if (!r.ok) throw new Error(`login failed for ${email}: ${r.status} ${r.raw}`);
      return r;
    },
  };
}

module.exports = { startServer, makeClient };
