const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const db = require('../db');
const { encryptField, decryptField } = require('./crypto');
const { randomToken } = require('./http');
const { MIN_PASSWORD_LENGTH } = require('./constants');
const { FRONTEND_URL, ADDITIONAL_ORIGINS, isAllowedOrigin } = require('./config');

const UPLOADS_DIR = path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, 'data', 'loadbyton.db')), 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const ALLOWED_UPLOAD_MIME_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

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

const UAE_MOBILE_RE = /^(\+?971|0)?5\d{8}$/;
function normalizeUaeMobile(raw) {
  const digits = String(raw || '').replace(/[\s-]/g, '');
  return UAE_MOBILE_RE.test(digits) ? digits : null;
}

const UAE_TRN_RE = /^\d{15}$/;
function isValidUaeTrn(raw) {
  return UAE_TRN_RE.test(String(raw || '').trim());
}

const UAE_LICENCE_RE = /^(?=.*\d)[A-Z0-9-]{5,15}$/;
function isValidUaeTradeLicence(raw) {
  return UAE_LICENCE_RE.test(String(raw || '').toUpperCase());
}

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

function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function getSettings() {
  const rows = (await db.prepare('SELECT key, value FROM settings').all());
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    commission_rate_bps: Number(map.commission_rate_bps ?? 600),
    auto_release_hours: Number(map.auto_release_hours ?? 24),
  };
}

async function toPublicUser(row) {
  if (!row) return null;
  const profile =
    row.profile !== undefined ? row.profile : await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(row.id);
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

async function writeAudit(req, { userId = null, action, details = null, entityType = null, entityId = null, beforeState = null, afterState = null }) {
  await db.prepare(
    `INSERT INTO audit_log (user_id, action, details, entity_type, entity_id, before_state, after_state, request_id)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(userId, action, details, entityType, entityId, beforeState, afterState, req ? req.requestId : null);
}

async function unreadNotificationCount(userId) {
  return (await db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND is_read=0').get(userId)).c;
}

async function notify(userId, title, body, jobId = null, type = 'system') {
  if (!userId) return;
  if (type !== 'system') {
    const user = await db.prepare('SELECT notification_prefs_disabled FROM users WHERE id=?').get(userId);
    const disabled = user ? user.notification_prefs_disabled.split(',').filter(Boolean) : [];
    if (disabled.includes(type)) return;
  }
  await db.prepare('INSERT INTO notifications (user_id, title, body, job_id, type) VALUES (?,?,?,?,?)').run(userId, title, body, jobId, type);
}

async function notifyAdmins(title, body, jobId = null, type = 'dispute') {
  const admins = await db.prepare(`SELECT id FROM users WHERE role='ADMIN'`).all();
  for (const a of admins) await notify(a.id, title, body, jobId, type);
}

async function isParticipantOrBidder(job, user) {
  if (user.role === 'ADMIN') return true;
  if (user.id === job.shipper_id) return true;
  if (user.id === job.carrier_id) return true;
  if (user.role === 'CARRIER') {
    const hasBid = await db.prepare('SELECT 1 FROM bids WHERE job_id=? AND carrier_id=?').get(job.id, user.id);
    if (hasBid) return true;
  }
  return false;
}

function isPartyOnJob(job, user) {
  if (user.role === 'ADMIN') return true;
  if (user.id === job.shipper_id) return true;
  if (user.id === job.carrier_id) return true;
  return false;
}

async function canViewJob(job, user) {
  if (await isParticipantOrBidder(job, user)) return true;
  if (user.role === 'CARRIER' && job.status === 'OPEN') return true;
  return false;
}

function sessionCookieAttributes(req) {
  const secure = req.protocol === 'https' ? '; Secure' : '';
  const sameSite = isAllowedOrigin(req.headers.origin) && secure ? 'None' : 'Lax';
  const partitioned = sameSite === 'None' ? '; Partitioned' : '';
  return `${secure}; SameSite=${sameSite}${partitioned}`;
}

async function createSession(req, res, userId, { impersonatingAdminId = null, actingSeatId = null, maxAgeSeconds = 7 * 24 * 60 * 60 } = {}) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000).toISOString();
  await db.prepare('INSERT INTO sessions (session_token, user_id, expires_at, impersonating_admin_id, acting_seat_id) VALUES (?,?,?,?,?)').run(
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
