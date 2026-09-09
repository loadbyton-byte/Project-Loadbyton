// @ts-check
/**
 * @typedef {import('../types/domain').Money} Money
 * @typedef {import('../types/domain').Job} Job
 * @typedef {import('../types/domain').Payout} Payout
 * @typedef {import('../types/domain').UserRole} UserRole
 */

/**
 * @param {Job} _job
 * @param {Payout} _payout
 * @param {Money} _money
 * @returns {void}
 */
function _strictTypeRefs(_job, _payout, _money) {}

/** @type {any} */
const path = require('node:path');
/** @type {any} */
const fs = require('node:fs');
/** @type {any} */
const crypto = require('node:crypto');
/** @type {any} */
const db = require('../db');
/** @type {any} */
const cryptoMod = require('./crypto');
const encryptField = /** @type {any} */ (cryptoMod).encryptField;
const decryptField = /** @type {any} */ (cryptoMod).decryptField;
/** @type {any} */
const httpMod = require('./http');
const randomToken = /** @type {any} */ (httpMod).randomToken;
/** @type {any} */
const constantsMod = require('./constants');
const MIN_PASSWORD_LENGTH = /** @type {any} */ (constantsMod).MIN_PASSWORD_LENGTH;
/** @type {any} */
const configMod = require('./config');
const FRONTEND_URL = /** @type {any} */ (configMod).FRONTEND_URL;
const ADDITIONAL_ORIGINS = /** @type {any} */ (configMod).ADDITIONAL_ORIGINS;
const isAllowedOrigin = /** @type {any} */ (configMod).isAllowedOrigin;

// Storage abstraction — S3 when S3_BUCKET is set, local disk otherwise.
// Delegated to lib/storage.js so this module stays focused on domain
// helpers. Re-exported here so existing imports keep working.
let _storage;
function getStorage() {
  if (!_storage) _storage = /** @type {any} */ (require('./storage'));
  return _storage;
}
const UPLOADS_DIR = /** @type {any} */ (getStorage().UPLOADS_DIR);
const ALLOWED_UPLOAD_MIME_TYPES = /** @type {any} */ (getStorage().ALLOWED_UPLOAD_MIME_TYPES);
const MAX_UPLOAD_BYTES = /** @type {any} */ (getStorage().MAX_UPLOAD_BYTES);
/**
 * @param {number} jobId
 * @param {string} mimeType
 * @param {string} base64
 * @returns {Promise<any>}
 */
async function saveUploadedFile(jobId, mimeType, base64) {
  return getStorage().saveUploadedFile(jobId, mimeType, base64);
}
/**
 * @param {string} prefix
 * @param {string} mimeType
 * @returns {Promise<any>}
 */
async function getPresignedUploadUrl(prefix, mimeType) {
  return getStorage().getPresignedUploadUrl(prefix, mimeType);
}
/**
 * One call for either upload path a client might use: storageKey when it
 * already PUT the file directly to R2 via a presigned URL (verified to
 * actually exist — a client can't just claim an arbitrary key), or
 * fileBase64 for the inline path (local disk, or S3 configured but the
 * client hasn't been updated to presign yet). Every one of the four upload
 * call sites (job documents, driver documents, POD, enterprise) had this
 * exact branch duplicated inline; centralized here instead.
 * @param {string} prefix
 * @param {{mimeType: string, fileBase64?: string, storageKey?: string}} body
 * @returns {Promise<any>}
 */
async function resolveUploadedFile(prefix, { mimeType, fileBase64, storageKey }) {
  if (storageKey) {
    if (!storageKey.startsWith(`${prefix}/`)) {
      throw { status: 400, message: 'storageKey does not match this upload context' };
    }
    const exists = await getStorage().fileExists(storageKey);
    if (!exists) throw { status: 400, message: 'storageKey not found — upload may have failed or the presigned URL expired' };
    return { storagePath: storageKey, mimeType, s3: getStorage().isS3Enabled() };
  }
  return saveUploadedFile(prefix, mimeType, fileBase64);
}

const UAE_MOBILE_RE = /^(\+?971|0)?5\d{8}$/;
/**
 * @param {any} raw
 * @returns {string | null}
 */
function normalizeUaeMobile(raw) {
  const digits = String(raw || '').replace(/[\s-]/g, '');
  return UAE_MOBILE_RE.test(digits) ? digits : null;
}

const UAE_TRN_RE = /^\d{15}$/;
/**
 * @param {any} raw
 * @returns {boolean}
 */
function isValidUaeTrn(raw) {
  return UAE_TRN_RE.test(String(raw || '').trim());
}

const UAE_LICENCE_RE = /^(?=.*\d)[A-Z0-9-]{5,15}$/;
/**
 * @param {any} raw
 * @returns {boolean}
 */
function isValidUaeTradeLicence(raw) {
  return UAE_LICENCE_RE.test(String(raw || '').toUpperCase());
}

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {boolean}
 */
function isValidUaeLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 22 && lat <= 27 && lng >= 51 && lng <= 57;
}

// A stored timestamp is SQLite-style ("YYYY-MM-DD HH:MM:SS", no timezone)
// on local dev or Postgres-style (already full ISO 8601 with a trailing Z)
// in production — blindly doing `.replace(' ', 'T') + 'Z'` (as several
// call sites did) is only correct for the SQLite shape; on Postgres it
// appends a second Z to an already-complete ISO string, producing an
// unparseable date (silently wrong in a `<` comparison, or a thrown
// RangeError from a later .toISOString() call). Detect which shape it
// already is instead of assuming one.
function parseDbDate(raw) {
  if (raw == null) return null;
  const s = String(raw);
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number}
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * @param {any} password
 * @returns {boolean}
 */
function isPasswordValid(password) {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH;
}

/**
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * @param {any} token
 * @returns {string}
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function getSettings() {
  const rows = /** @type {any} */ ((await db.prepare('SELECT key, value FROM settings').all()));
  const map = Object.fromEntries(rows.map((/** @type {any} */ r) => [r.key, r.value]));
  return {
    commission_rate_bps: Number(/** @type {any} */ (map).commission_rate_bps ?? 600),
    auto_release_hours: Number(/** @type {any} */ (map).auto_release_hours ?? 24),
    // Cancellation-fee schedule (planning register Change 24F) — a real
    // business-policy decision this codebase can't make unilaterally.
    // Default here is a placeholder (10%) so the mechanism is real and
    // testable rather than unbuilt; change it via
    // POST /api/admin/settings, not by editing this default, once a real
    // policy is set. Applies only to an already-AWARDED job being
    // cancelled (escrow HELD/FUNDED) — a job cancelled before award is
    // already free, since nothing was ever deducted.
    cancellation_fee_bps_after_award: Number(/** @type {any} */ (map).cancellation_fee_bps_after_award ?? 1000),
  };
}

/**
 * @param {any} row
 * @returns {Promise<any>}
 */
async function toPublicUser(row) {
  if (!row) return null;
  const profile =
    row.profile !== undefined ? row.profile : /** @type {any} */ (await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(row.id));
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    is_verified: !!row.is_verified,
    email_verified: !!row.email_verified_at,
    mfa_enabled: !!row.mfa_enabled,
    tier: row.tier,
    referral_code: row.referral_code,
    referred_by: row.referred_by,
    created_at: row.created_at,
    account_approval_status: row.account_approval_status || 'APPROVED',
    account_approved_at: row.account_approved_at || null,
    profile: profile
      ? {
          company_name: profile.company_name,
          trn_number: decryptField(profile.trn_number),
          trade_license_number: profile.trade_license_number,
          phone: profile.phone,
          iban: decryptField(profile.iban),
          coverage_zones: profile.coverage_zones,
          fleet_size: profile.fleet_size,
          owned_chassis: profile.owned_chassis,
          insurance_uploaded: !!profile.insurance_uploaded,
          trade_license_doc_storage_path: profile.trade_license_doc_storage_path,
          insurance_doc_storage_path: profile.insurance_doc_storage_path,
          rating_avg: profile.rating_avg,
          completed_jobs: profile.completed_jobs,
          verified_at: profile.verified_at,
          credit_limit_aed: profile.credit_limit_aed || 0,
          credit_balance_aed: profile.credit_balance_aed || 0,
          credit_terms_days: profile.credit_terms_days || 30,
          credit_approved_at: profile.credit_approved_at || null,
          telr_split_id: profile.telr_split_id || null,
        }
      : null,
  };
}

/**
 * @param {any} req
 * @param {{ userId?: any, action: string, details?: any, entityType?: any, entityId?: any, beforeState?: any, afterState?: any }} opts
 * @returns {Promise<void>}
 */
async function writeAudit(req, { userId = null, action, details = null, entityType = null, entityId = null, beforeState = null, afterState = null }) {
  // Collusion-detection groundwork (planning register Change 24) — capture
  // going forward only, nothing can be reconstructed retroactively. Same
  // "prefer Cloudflare-resolved header" preference as server/lib/rateLimit.js's
  // byIp, inlined here rather than imported to avoid a require cycle risk
  // between the two lib modules.
  const ipAddress = req ? (req.headers?.['cf-connecting-ip'] || req.ip || null) : null;
  const userAgent = req ? (req.headers?.['user-agent'] || null) : null;
  // Change 21's tamper-evident hash chain — schema had prev_hash/hash
  // columns from the start, but this insert never populated them (a real
  // gap found in review: the audit trail wasn't actually tamper-evident
  // despite having the schema for it, only ledger_transactions was).
  // routes/audit.routes.js's GET /api/admin/audit/verify already defines
  // and checks a specific formula (sha256(prev|action|entityType|entityId|
  // createdAt)) — matching it exactly here, not inventing a second one,
  // otherwise that endpoint would report every new row as a tamper break.
  // created_at is generated explicitly (not the column's own DB-time
  // DEFAULT) so its exact value is known before the row exists — audit_log
  // is append-only (triggers block UPDATE/DELETE — see schema.js), so
  // unlike lib/ledger.js's createTransaction (insert, then backfill the
  // hash via UPDATE) this hash must be computed before the one and only
  // INSERT this row ever gets.
  //
  // Deliberately NOT wrapped in db.transaction(): writeAudit() is called
  // from many places already inside their own transaction (award, cancel,
  // dispute-resolve, refund) — nesting a second BEGIN there is a hard
  // SQLite error ("cannot start a transaction within a transaction"),
  // which silently dropped the audit row for exactly those money-critical
  // actions until this was caught. db.query() runs standalone (joining
  // whatever transaction, if any, is already open on this connection),
  // matching how audit_log inserts have always behaved — the trade-off is
  // no FOR UPDATE lock on the chain tip, so two truly concurrent writers
  // could theoretically fork the chain; verifyChain() already treats a
  // fork as a reported break rather than a crash, the same "best effort
  // under concurrency" already accepted for the ledger's own chain.
  // db.prepare(sql).run()/.all() — NOT db.query(sql, params) — is what
  // translates SQLite-style `?` placeholders to Postgres's `$1,$2,...`
  // (db.js's toPg(), applied inside prepare() but NOT inside the top-level
  // query() passthrough). A prior version of this function called
  // db.query() directly with `?` placeholders, which is valid SQLite but a
  // raw Postgres syntax error ("syntax error at or near ','", 42601) —
  // every writeAudit() call, including the one on every successful login
  // (auth.routes.js's POST /api/auth/login), 500'd in production the
  // instant it ran against Postgres, invisible in this repo's SQLite-only
  // test suite. Neither db.query() nor db.prepare() joins an
  // already-open Postgres transaction either way (both grab a fresh
  // connection from the pool) — this change only fixes the placeholder
  // translation, it doesn't reopen the nested-transaction issue the
  // db.query() switch was originally made to fix.
  let prevHash = 'GENESIS';
  try {
    const prevRows = await db.prepare(`SELECT hash FROM audit_log WHERE hash IS NOT NULL ORDER BY id DESC LIMIT 1`).all();
    prevHash = prevRows[0]?.hash || 'GENESIS';
  } catch (e) {
    console.error('[audit] hash-chain tip lookup failed, chaining from GENESIS:', e.message);
  }
  const createdAt = new Date().toISOString();
  const hash = crypto.createHash('sha256').update(`${prevHash}|${action}|${entityType || ''}|${entityId || ''}|${createdAt}`).digest('hex');
  await db.prepare(
    `INSERT INTO audit_log (user_id, action, details, entity_type, entity_id, before_state, after_state, request_id, ip_address, user_agent, prev_hash, hash, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(userId, action, details, entityType, entityId, beforeState, afterState, req ? req.requestId : null, ipAddress, userAgent, prevHash, hash, createdAt);
}

/**
 * @param {any} userId
 * @returns {Promise<any>}
 */
async function unreadNotificationCount(userId) {
  return /** @type {any} */ ((await db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND is_read=0').get(userId))).c;
}

/**
 * @param {any} userId
 * @param {string} title
 * @param {string} body
 * @param {any} jobId
 * @param {string} type
 * @returns {Promise<void>}
 */
async function notify(userId, title, body, jobId = null, type = 'system') {
  if (!userId) return;
  if (type !== 'system') {
    const user = /** @type {any} */ (await db.prepare('SELECT notification_prefs_disabled FROM users WHERE id=?').get(userId));
    const disabled = user ? String(user.notification_prefs_disabled).split(',').filter(Boolean) : [];
    if (disabled.includes(type)) return;
  }
  await db.prepare('INSERT INTO notifications (user_id, title, body, job_id, type) VALUES (?,?,?,?,?)').run(userId, title, body, jobId, type);
}

/**
 * @param {string} title
 * @param {string} body
 * @param {any} jobId
 * @param {string} type
 * @returns {Promise<void>}
 */
async function notifyAdmins(title, body, jobId = null, type = 'dispute') {
  const admins = /** @type {any} */ (await db.prepare(`SELECT id FROM users WHERE role='ADMIN'`).all());
  for (const a of admins) await notify(a.id, title, body, jobId, type);
}

/**
 * A DRIVER seat's req.user is always the carrier owner's row (see
 * middleware/auth.js's session model), so `user.id === job.carrier_id`
 * would otherwise grant it every one of that carrier's jobs. This resolves
 * the one job (if any) a DRIVER seat is actually scoped to, via the
 * drivers.seat_user_id link set by POST /api/fleet/drivers/:id/seat.
 * @param {any} job
 * @returns {Promise<number|null>}
 */
async function getAssignedDriverSeatId(job) {
  if (!job.assigned_driver_id) return null;
  const driver = /** @type {any} */ (await db.prepare('SELECT seat_user_id FROM drivers WHERE id=?').get(job.assigned_driver_id));
  return driver ? driver.seat_user_id : null;
}

/**
 * The role a request is actually acting as — a DRIVER seat inherits its
 * owner's `role` (e.g. CARRIER) on `user.role`, but for messaging/thread
 * purposes it must be treated as its own party, not the carrier.
 * @param {any} user
 * @returns {string}
 */
function effectiveRole(user) {
  return user.actingSeatRole === 'DRIVER' ? 'DRIVER' : user.role;
}

/**
 * @param {any} job
 * @param {any} user
 * @returns {Promise<boolean>}
 */
async function isParticipantOrBidder(job, user) {
  if (user.role === 'ADMIN') return true;
  if (user.actingSeatRole === 'DRIVER') {
    const seatId = await getAssignedDriverSeatId(job);
    return seatId != null && seatId === user.actingSeatId;
  }
  if (user.id === job.shipper_id) return true;
  if (user.id === job.carrier_id) return true;
  if (user.role === 'CARRIER') {
    const hasBid = /** @type {any} */ (await db.prepare('SELECT 1 FROM bids WHERE job_id=? AND carrier_id=?').get(job.id, user.id));
    if (hasBid) return true;
  }
  return false;
}

/**
 * @param {any} job
 * @param {any} user
 * @returns {Promise<boolean>}
 */
async function isPartyOnJob(job, user) {
  if (user.role === 'ADMIN') return true;
  if (user.actingSeatRole === 'DRIVER') {
    const seatId = await getAssignedDriverSeatId(job);
    return seatId != null && seatId === user.actingSeatId;
  }
  if (user.id === job.shipper_id) return true;
  if (user.id === job.carrier_id) return true;
  return false;
}

/**
 * @param {any} job
 * @param {any} user
 * @returns {Promise<boolean>}
 */
async function canViewJob(job, user) {
  if (await isParticipantOrBidder(job, user)) return true;
  if (user.role === 'CARRIER' && user.actingSeatRole !== 'DRIVER' && job.status === 'OPEN') return true;
  return false;
}

/**
 * @param {any} req
 * @returns {string}
 */
function sessionCookieAttributes(req) {
  const secure = req.protocol === 'https' ? '; Secure' : '';
  const sameSite = isAllowedOrigin(req.headers.origin) && secure ? 'None' : 'Lax';
  const partitioned = sameSite === 'None' ? '; Partitioned' : '';
  return `${secure}; SameSite=${sameSite}${partitioned}`;
}

/**
 * @param {any} req
 * @param {any} res
 * @param {any} userId
 * @param {{ impersonatingAdminId?: any, actingSeatId?: any, maxAgeSeconds?: number }} opts
 * @returns {Promise<void>}
 */
async function createSession(req, res, userId, { impersonatingAdminId = null, actingSeatId = null, maxAgeSeconds = 7 * 24 * 60 * 60 } = {}) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000).toISOString();
  const ipAddress = req ? (req.headers?.['cf-connecting-ip'] || req.ip || null) : null;
  await db.prepare('INSERT INTO sessions (session_token, user_id, expires_at, impersonating_admin_id, acting_seat_id, ip_address) VALUES (?,?,?,?,?,?)').run(
    token,
    userId,
    expiresAt,
    impersonatingAdminId,
    actingSeatId,
    ipAddress
  );
  res.setHeader('Set-Cookie', `lb_session=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}${sessionCookieAttributes(req)}`);
}

/**
 * @param {any} req
 * @param {any} res
 * @returns {void}
 */
function clearSessionCookie(req, res) {
  res.setHeader('Set-Cookie', `lb_session=; HttpOnly; Path=/; Max-Age=0${sessionCookieAttributes(req)}`);
}

/**
 * @param {any} job
 * @param {any} doc
 * @param {any} user
 * @returns {boolean}
 */
function canSeeDocument(job, doc, user) {
  if (user.role === 'ADMIN') return true;
  if (doc.uploader_id === user.id) return true;
  if (job.status === 'OPEN') return false;
  return user.id === job.shipper_id || user.id === job.carrier_id;
}

/**
 * Resolves a session's acting seat (if any) to that seat's own seat_role —
 * shared by middleware/auth.js (HTTP requests) and lib/socket.js (socket
 * handshakes), the two places a session gets turned into a request-scoped
 * user.
 * @param {any} session
 * @returns {Promise<{actingSeatId: number|null, actingSeatRole: string|null}>}
 */
async function resolveActingSeat(session) {
  if (!session || !session.acting_seat_id) return { actingSeatId: null, actingSeatRole: null };
  const seat = /** @type {any} */ (await db.prepare('SELECT seat_role FROM users WHERE id=?').get(session.acting_seat_id));
  return { actingSeatId: session.acting_seat_id, actingSeatRole: seat ? seat.seat_role : null };
}

module.exports = {
  saveUploadedFile, getPresignedUploadUrl, resolveUploadedFile, UPLOADS_DIR, ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES,
  getAssignedDriverSeatId, effectiveRole, resolveActingSeat,
  normalizeUaeMobile, isValidUaeTrn, isValidUaeTradeLicence, isValidUaeLatLng, haversineKm, parseDbDate,
  isPasswordValid, timingSafeEqualStr, hashToken,
  getSettings, toPublicUser, writeAudit, unreadNotificationCount, notify, notifyAdmins,
  isParticipantOrBidder, isPartyOnJob, canViewJob, canSeeDocument,
  sessionCookieAttributes, createSession, clearSessionCookie,
};
