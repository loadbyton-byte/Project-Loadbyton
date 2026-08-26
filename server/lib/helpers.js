const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const db = require('../db');
const { encryptField, decryptField } = require('./crypto');
const { randomToken } = require('./http');
const { MIN_PASSWORD_LENGTH } = require('./constants');
const { FRONTEND_URL, ADDITIONAL_ORIGINS, isAllowedOrigin } = require('./config');

// Real file upload for job documents/POD photos. Sent as base64 in the JSON
// body (not multipart) so this needs no new dependency — express.json()
// already parses it. Stored under UPLOADS_DIR, which sits next to the
// sqlite file so both live on the same Render persistent disk (DB_PATH's
// directory is /data in production, server/data locally).
const UPLOADS_DIR = path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, 'data', 'loadbyton.db')), 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const ALLOWED_UPLOAD_MIME_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Decodes+validates a base64 upload and writes it under UPLOADS_DIR/<jobId>/.
// Throws { status, message } (caught by the route) on any validation failure
// so every call site gets the same 400s without duplicating the checks.
function saveUploadedFile(jobId, mimeType, base64) {
  const ext = ALLOWED_UPLOAD_MIME_TYPES[mimeType];
  if (!ext) throw { status: 400, message: `mimeType must be one of: ${Object.keys(ALLOWED_UPLOAD_MIME_TYPES).join(', ')}` };
  if (typeof base64 !== 'string' || !base64) throw { status: 400, message: 'fileBase64 is required' };
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw { status: 400, message: 'fileBase64 is not valid base64' };
  }
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
    throw { status: 400, message: `File must be between 1 byte and ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB` };
  }
  const jobDir = path.join(UPLOADS_DIR, String(jobId));
  fs.mkdirSync(jobDir, { recursive: true });
  const filename = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(jobDir, filename), buffer);
  return { storagePath: `${jobId}/${filename}`, mimeType };
}

// UAE mobile: 05XXXXXXXX, +9715XXXXXXXX, or 9715XXXXXXXX — loose on purpose,
// this only guards against an obviously-wrong value at the API boundary.
const UAE_MOBILE_RE = /^(\+?971|0)?5\d{8}$/;
function normalizeUaeMobile(raw) {
  const digits = String(raw || '').replace(/[\s-]/g, '');
  return UAE_MOBILE_RE.test(digits) ? digits : null;
}

// UAE Tax Registration Number: exactly 15 digits (FTA format, e.g.
// 100123456700003). Rejects anything shorter/longer or non-numeric — the
// signup gate that makes a random string unusable for creating an account.
const UAE_TRN_RE = /^\d{15}$/;
function isValidUaeTrn(raw) {
  return UAE_TRN_RE.test(String(raw || '').trim());
}

// UAE trade licence: 5-15 chars of uppercase letters, digits and dashes,
// with at least one digit. Covers the real formats in circulation — Dubai
// DED 7-digit, Abu Dhabi 10-digit, Sharjah "NNNNNN.NN", freezone prefixes
// (JAFZA/IFZA/DMCC-XXXXXX) — while rejecting gibberish and pure prose.
const UAE_LICENCE_RE = /^(?=.*\d)[A-Z0-9-]{5,15}$/;
function isValidUaeTradeLicence(raw) {
  return UAE_LICENCE_RE.test(String(raw || '').toUpperCase());
}

// Loose UAE-region bounding box (with margin) for the optional map pin —
// just enough to reject an obviously wrong value (e.g. lat/lng swapped),
// not a precise border check.
function isValidUaeLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 22 && lat <= 27 && lng >= 51 && lng <= 57;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isPasswordValid(password) {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH;
}

// SHA-256 both sides first — fixes the comparison to a constant 32 bytes so
// timingSafeEqual can't throw on a length mismatch, which is the usual
// reason people avoid it for user-supplied input.
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Verification/reset tokens: the raw token goes to the user (via email);
// only its hash is stored, so a leaked DB row can't be replayed as a token.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    commission_rate_bps: Number(map.commission_rate_bps ?? 600),
    auto_release_hours: Number(map.auto_release_hours ?? 24),
  };
}

function toPublicUser(row) {
  if (!row) return null;
  const profile =
    row.profile !== undefined ? row.profile : db.prepare('SELECT * FROM profiles WHERE user_id=?').get(row.id);
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
          rating_avg: profile.rating_avg,
          completed_jobs: profile.completed_jobs,
          verified_at: profile.verified_at,
        }
      : null,
  };
}

function writeAudit(req, { userId = null, action, details = null, entityType = null, entityId = null, beforeState = null, afterState = null }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, action, details, entity_type, entity_id, before_state, after_state, request_id)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(userId, action, details, entityType, entityId, beforeState, afterState, req ? req.requestId : null);
}

// Backs Shell.jsx's notification-bell red dot — that indicator reads
// user.unreadNotifications, which no route ever populated before this, so
// it could never render regardless of actual unread count.
function unreadNotificationCount(userId) {
  return db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND is_read=0').get(userId).c;
}

function notify(userId, title, body, jobId = null, type = 'system') {
  if (!userId) return;
  if (type !== 'system') {
    const user = db.prepare('SELECT notification_prefs_disabled FROM users WHERE id=?').get(userId);
    const disabled = user ? user.notification_prefs_disabled.split(',').filter(Boolean) : [];
    if (disabled.includes(type)) return;
  }
  db.prepare('INSERT INTO notifications (user_id, title, body, job_id, type) VALUES (?,?,?,?,?)').run(userId, title, body, jobId, type);
}

// Self-serve dispute filing needs *someone* on the admin side to actually
// see it — there's no "notify all admins" primitive elsewhere in this file
// because every prior dispute was admin-opened (the admin already knew).
function notifyAdmins(title, body, jobId = null, type = 'dispute') {
  const admins = db.prepare(`SELECT id FROM users WHERE role='ADMIN'`).all();
  for (const a of admins) notify(a.id, title, body, jobId, type);
}

function isParticipantOrBidder(job, user) {
  if (user.role === 'ADMIN') return true;
  if (user.id === job.shipper_id) return true;
  if (user.id === job.carrier_id) return true;
  if (user.role === 'CARRIER') {
    const hasBid = db.prepare('SELECT 1 FROM bids WHERE job_id=? AND carrier_id=?').get(job.id, user.id);
    if (hasBid) return true;
  }
  return false;
}

// Stricter than isParticipantOrBidder — no bidder fallback. Used for the
// messages thread once a job is DISPUTED, since that thread doubles as the
// dispute correspondence (see GET /api/jobs/:id/dispute); a losing bidder
// should never read the shipper/carrier/admin dispute conversation just
// because they placed a bid before losing the award.
function isPartyOnJob(job, user) {
  if (user.role === 'ADMIN') return true;
  if (user.id === job.shipper_id) return true;
  if (user.id === job.carrier_id) return true;
  return false;
}

function canViewJob(job, user) {
  if (isParticipantOrBidder(job, user)) return true;
  if (user.role === 'CARRIER' && job.status === 'OPEN') return true;
  return false;
}

// Session cookie flags: SameSite=Lax is right for the normal same-origin
// (or same-site proxy) setup. When the request comes from an explicitly
// allowed cross-origin browser origin (ADDITIONAL_ORIGINS, e.g. the Vercel
// frontend calling Render directly), the cookie must be SameSite=None or
// the browser drops it on the cross-site XHR — None additionally requires
// Secure, which req.protocol already reflects behind `trust proxy`.
function sessionCookieAttributes(req) {
  const secure = req.protocol === 'https' ? '; Secure' : '';
  const sameSite = isAllowedOrigin(req.headers.origin) && secure ? 'None' : 'Lax';
  const partitioned = sameSite === 'None' ? '; Partitioned' : '';
  return `${secure}; SameSite=${sameSite}${partitioned}`;
}

function createSession(req, res, userId, { impersonatingAdminId = null, actingSeatId = null, maxAgeSeconds = 7 * 24 * 60 * 60 } = {}) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000).toISOString();
  db.prepare('INSERT INTO sessions (session_token, user_id, expires_at, impersonating_admin_id, acting_seat_id) VALUES (?,?,?,?,?)').run(
    token,
    userId,
    expiresAt,
    impersonatingAdminId,
    actingSeatId
  );
  res.setHeader('Set-Cookie', `lb_session=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}${sessionCookieAttributes(req)}`);
}

function clearSessionCookie(req, res) {
  res.setHeader('Set-Cookie', `lb_session=; HttpOnly; Path=/; Max-Age=0${sessionCookieAttributes(req)}`);
}

// Job-document visibility: a document is only readable by its uploader and
// admins until the job is awarded (bid confirmed). From award on, the
// counterparty sees it too — the shipper's requirements to the carrier, and
// the carrier's compliance docs to the shipper ("after the carrier confirms
// the bid, the shipper shares his required documents, and vice versa").
// Bidders who didn't win never see either side's documents.
function canSeeDocument(job, doc, user) {
  if (user.role === 'ADMIN') return true;
  if (doc.uploader_id === user.id) return true;
  if (job.status === 'OPEN') return false;
  return user.id === job.shipper_id || user.id === job.carrier_id;
}

module.exports = {
  saveUploadedFile, UPLOADS_DIR, ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES,
  normalizeUaeMobile, isValidUaeTrn, isValidUaeTradeLicence, isValidUaeLatLng, haversineKm,
  isPasswordValid, timingSafeEqualStr, hashToken,
  getSettings, toPublicUser, writeAudit, unreadNotificationCount, notify, notifyAdmins,
  isParticipantOrBidder, isPartyOnJob, canViewJob, canSeeDocument,
  sessionCookieAttributes, createSession, clearSessionCookie,
};
