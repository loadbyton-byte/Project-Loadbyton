const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const totp = require('../lib/totp');
const { FRONTEND_URL, DUMMY_PASSWORD_HASH } = require('../lib/config');
const { sendError, asyncHandler, randomToken, referralCode } = require('../lib/http');
const { encryptField } = require('../lib/crypto');
const { sendEmailAsync } = require('../lib/email');
const {
  isPasswordValid, hashToken, timingSafeEqualStr, normalizeUaeMobile, isValidUaeTrn,
  isValidUaeTradeLicence, writeAudit, toPublicUser, unreadNotificationCount,
  createSession, clearSessionCookie,
} = require('../lib/helpers');
const { auth, requireSeatRole, isThrottled, recordFailure, clearThrottle } = require('../middleware/auth');
const { rateLimiter, byIp } = require('../lib/rateLimit');

const router = require('express').Router();
const authIpLimiter = rateLimiter({ windowMs: 60 * 1000, max: 20, keyFn: byIp, message: 'Too many auth requests. Please slow down.' });

router.post(
  '/api/auth/register',
  authIpLimiter,
  asyncHandler(async (req, res) => {
    const { email, password, role, companyName, phone, trnNumber, tradeLicenseNumber, referralCode: incomingReferral } = req.body || {};
    if (!email || !password || !companyName) return sendError(res, 400, 'email, password and companyName are required');
    if (!isPasswordValid(password)) return sendError(res, 400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    if (!['SHIPPER', 'CARRIER'].includes(role)) return sendError(res, 422, 'role must be SHIPPER or CARRIER');
    const existing = await db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (existing) return sendError(res, 400, 'An account with that email already exists');

    // UAE-format business identifiers — the signup gate that makes a random
    // string unusable for creating an account (see the regexes above).
    if (!normalizeUaeMobile(phone)) return sendError(res, 400, 'phone must be a valid UAE mobile number (05XXXXXXXX or +9715XXXXXXXX)');
    if (!isValidUaeTrn(trnNumber)) return sendError(res, 400, 'trnNumber must be a valid UAE TRN — exactly 15 digits');
    if (!isValidUaeTradeLicence(tradeLicenseNumber)) {
      return sendError(res, 400, 'tradeLicenseNumber must be a valid UAE trade licence number (5-15 uppercase letters/digits/dashes, at least one digit)');
    }

    let referredBy = null;
    if (incomingReferral) {
      const referrer = await db.prepare('SELECT referral_code FROM users WHERE referral_code=?').get(incomingReferral);
      if (referrer) referredBy = referrer.referral_code;
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const prefix = role === 'SHIPPER' ? 'SHP' : 'CAR';
    let code = referralCode(prefix, companyName);
    while (await db.prepare('SELECT 1 FROM users WHERE referral_code=?').get(code)) {
      code = `${code}${crypto.randomInt(10, 100)}`;
    }

    // identity squatting (registering an email you don't own) is at least
    // detectable and the link can't be guessed. See server/lib/email.js for
    // why this is safe to fire even with no provider configured.
    const verifyToken = randomToken(32);
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const userResult = await db
      .prepare(
        `INSERT INTO users (email, password_hash, role, tier, referral_code, referred_by, email_verify_token_hash, email_verify_expires, account_approval_status)
         VALUES (?,?,?,?,?,?,?,?, 'PENDING')`
      )
      .run(email, passwordHash, role, 'BRONZE', code, referredBy, hashToken(verifyToken), verifyExpires);
    const userId = Number(userResult.lastInsertRowid);
    await db.prepare(
      'INSERT INTO profiles (user_id, company_name, trn_number, trade_license_number, phone) VALUES (?,?,?,?,?)'
    ).run(userId, companyName, encryptField(trnNumber.trim()), tradeLicenseNumber.toUpperCase(), normalizeUaeMobile(phone));

    await writeAudit(req, { userId, action: 'REGISTER', details: `${role} registered: ${email}`, entityType: 'user', entityId: userId });
    sendEmailAsync({
      to: email,
      subject: 'Verify your Loadbyton account',
      html: `<p>Confirm this email address to finish setting up Loadbyton:</p><p><a href="${FRONTEND_URL}/verify-email?token=${verifyToken}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
    });
    await createSession(req, res, userId);
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    res.status(201).json({ user: await toPublicUser(user) });
  })
);

router.get(
  '/api/auth/verify-email',
  asyncHandler(async (req, res) => {
    const token = req.query.token;
    if (!token || typeof token !== 'string') return sendError(res, 400, 'token is required');
    const user = await db
      .prepare('SELECT id, email_verify_expires FROM users WHERE email_verify_token_hash=?')
      .get(hashToken(token));
    if (!user || !user.email_verify_expires || new Date(user.email_verify_expires) < new Date()) {
      return sendError(res, 400, 'This verification link is invalid or has expired');
    }
    await db.prepare(
      `UPDATE users SET email_verified_at=datetime('now'), email_verify_token_hash=NULL, email_verify_expires=NULL WHERE id=?`
    ).run(user.id);
    await writeAudit(req, { userId: user.id, action: 'EMAIL_VERIFY', entityType: 'user', entityId: user.id });
    res.json({ ok: true });
  })
);

router.post('/api/auth/resend-verification', auth(), async (req, res) => {
  if (req.user.email_verified_at) return sendError(res, 400, 'Email is already verified');
  const verifyToken = randomToken(32);
  const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.prepare('UPDATE users SET email_verify_token_hash=?, email_verify_expires=? WHERE id=?').run(hashToken(verifyToken), verifyExpires, req.user.id);
  sendEmailAsync({
    to: req.user.email,
    subject: 'Verify your Loadbyton account',
    html: `<p>Confirm this email address to finish setting up Loadbyton:</p><p><a href="${FRONTEND_URL}/verify-email?token=${verifyToken}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
  });
  res.json({ ok: true });
});

router.post(
  '/api/auth/forgot-password',
  asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    if (!email) return sendError(res, 400, 'email is required');
    const user = await db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (user) {
      const resetToken = randomToken(32);
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await db.prepare('UPDATE users SET password_reset_token_hash=?, password_reset_expires=? WHERE id=?').run(hashToken(resetToken), resetExpires, user.id);
      await writeAudit(req, { userId: user.id, action: 'PASSWORD_RESET_REQUEST', entityType: 'user', entityId: user.id });
      sendEmailAsync({
        to: email,
        subject: 'Reset your Loadbyton password',
        html: `<p>Reset your password:</p><p><a href="${FRONTEND_URL}/reset-password?token=${resetToken}">Reset password</a></p><p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
      });
    }
    res.json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
  })
);

router.post(
  '/api/auth/reset-password',
  asyncHandler(async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || typeof token !== 'string') return sendError(res, 400, 'token is required');
    if (!isPasswordValid(password)) return sendError(res, 400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    const user = await db
      .prepare('SELECT id FROM users WHERE password_reset_token_hash=? AND password_reset_expires > datetime(\'now\')')
      .get(hashToken(token));
    if (!user) return sendError(res, 400, 'This reset link is invalid or has expired');

    const passwordHash = bcrypt.hashSync(password, 10);
    await db.prepare('UPDATE users SET password_hash=?, password_reset_token_hash=NULL, password_reset_expires=NULL WHERE id=?').run(passwordHash, user.id);
    // A password reset is exactly the moment every existing session (on
    // every device, including whoever the attacker was if this reset was
    // defensive) should be invalidated.
    await db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    await writeAudit(req, { userId: user.id, action: 'PASSWORD_RESET', entityType: 'user', entityId: user.id });
    res.json({ ok: true });
  })
);

router.post(
  '/api/auth/login',
  authIpLimiter,
  asyncHandler(async (req, res) => {
    const { email, password, totpCode } = req.body || {};
    if (!email || !password) return sendError(res, 400, 'email and password are required');
    if (isThrottled(email)) return sendError(res, 429, 'Too many failed attempts. Try again in a few minutes.');

    const user = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
    // past the bcrypt call entirely when the email doesn't exist, so a
    // nonexistent-email response returns measurably faster than a
    // wrong-password one — a timing oracle for enumerating registered
    // emails. Always pay the bcrypt cost against *some* hash.
    const passwordOk = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
    if (!user || !passwordOk) {
      recordFailure(email);
      return sendError(res, 403, 'Invalid email or password');
    }
    if (!user.is_active) {
      recordFailure(email);
      return sendError(res, 403, 'This account has been deactivated');
    }
    if (user.role === 'ADMIN' && !user.mfa_enabled && process.env.ADMIN_MFA_ENFORCE === '1') {
      return sendError(res, 403, 'Admin MFA is required — set up TOTP via POST /api/auth/mfa/setup after logging in with ADMIN_MFA_ENFORCE=0, then re-enable enforcement.');
    }
    if (user.mfa_enabled) {
      if (!totp.verifyCode(user.mfa_secret, totpCode)) {
        recordFailure(email);
        return sendError(res, 403, 'Invalid or missing authentication code');
      }
    }
    clearThrottle(email);

    // A seat's own row (org_owner_id set) authenticates here, but the
    // session — and everything downstream — runs as the org root. See the
    // comment on auth() above.
    const isSeat = !!user.org_owner_id;
    const rootId = user.org_owner_id || user.id;
    const rootUser = isSeat ? await db.prepare('SELECT * FROM users WHERE id=?').get(rootId) : user;
    await createSession(req, res, rootId, { actingSeatId: isSeat ? user.id : null });
    await writeAudit(req, { userId: user.id, action: 'LOGIN', details: `${user.email} logged in`, entityType: 'user', entityId: user.id });
    const publicUser = await toPublicUser(rootUser);
    const unreadCount = await unreadNotificationCount(rootUser.id);
    res.json({
      user: { ...publicUser, unreadNotifications: unreadCount },
      actingAs: isSeat ? { id: user.id, email: user.email, displayName: user.display_name, seatRole: user.seat_role } : null,
    });
  })
);

router.get('/api/auth/me', authIpLimiter, auth(), async (req, res) => {
  const impersonatingAdminId = req.session.impersonating_admin_id;
  const impersonatedBy = impersonatingAdminId
    ? await db.prepare('SELECT id, email FROM users WHERE id=?').get(impersonatingAdminId)
    : null;
  const actingSeatId = req.session.acting_seat_id;
  const actingSeat = actingSeatId ? await db.prepare('SELECT id, email, display_name, seat_role FROM users WHERE id=?').get(actingSeatId) : null;
  const publicUser = await toPublicUser(req.user);
  const unreadCount = await unreadNotificationCount(req.user.id);
  res.json({
    user: { ...publicUser, impersonating: !!impersonatedBy, impersonatedBy, unreadNotifications: unreadCount },
    actingAs: actingSeat ? { id: actingSeat.id, email: actingSeat.email, displayName: actingSeat.display_name, seatRole: actingSeat.seat_role } : null,
  });
});

router.post('/api/auth/logout', auth(), async (req, res) => {
  const token = req.cookies.lb_session;
  if (token) await db.prepare('DELETE FROM sessions WHERE session_token=?').run(token);
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

router.post('/api/auth/mfa/setup', auth(), async (req, res) => {
  const secret = totp.randomBase32Secret();
  await db.prepare('UPDATE users SET mfa_secret=?, mfa_enabled=1 WHERE id=?').run(secret, req.actorId);
  await writeAudit(req, { userId: req.actorId, action: 'MFA_ENABLE', entityType: 'user', entityId: req.actorId });
  res.json({ ok: true, secret, otpauthUrl: totp.provisioningUrl(secret, req.actorLabel) });
});

router.post('/api/auth/mfa/disable', auth(), async (req, res) => {
  await db.prepare('UPDATE users SET mfa_secret=NULL, mfa_enabled=0 WHERE id=?').run(req.actorId);
  await writeAudit(req, { userId: req.actorId, action: 'MFA_DISABLE', entityType: 'user', entityId: req.actorId });
  res.json({ ok: true });
});

router.patch('/api/profile', auth(), requireSeatRole(['OPS']), async (req, res) => {
  const b = req.body || {};
  const fields = {
    company_name: b.companyName,
    trn_number: b.trnNumber === undefined ? undefined : encryptField(b.trnNumber),
    trade_license_number: b.tradeLicenseNumber,
    phone: b.phone,
    iban: b.iban === undefined ? undefined : encryptField(b.iban),
    coverage_zones: b.coverageZones,
    fleet_size: b.fleetSize,
    owned_chassis: b.ownedChassis,
    insurance_uploaded: b.insuranceUploaded === undefined ? undefined : b.insuranceUploaded ? 1 : 0,
  };
  const sets = [];
  const params = [];
  for (const [col, val] of Object.entries(fields)) {
    if (val !== undefined) {
      sets.push(`${col}=?`);
      params.push(val);
    }
  }
  if (sets.length) {
    params.push(req.user.id);
    await db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE user_id=?`).run(...params);
  }
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: await toPublicUser(user) });
});


router.get('/api/me/export', auth(), async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const profile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(req.user.id);
  const jobs = await db.prepare('SELECT * FROM jobs WHERE shipper_id=? OR carrier_id=?').all(req.user.id, req.user.id);
  const bids = await db.prepare('SELECT * FROM bids WHERE carrier_id=?').all(req.user.id);
  const payouts = await db.prepare('SELECT * FROM payouts WHERE carrier_id=?').all(req.user.id);
  const notifications = await db.prepare('SELECT * FROM notifications WHERE user_id=?').all(req.user.id);
  const audit = await db.prepare('SELECT * FROM audit_log WHERE user_id=?').all(req.user.id);
  res.json({ user: { ...user, profile: profile ? { ...profile, trn_number: require('../lib/crypto').decryptField(profile.trn_number), iban: require('../lib/crypto').decryptField(profile.iban) } : null }, jobs, bids, payouts, notifications, audit });
});

router.delete('/api/me', auth(), async (req, res) => {
  const userId = req.user.id;
  const token = req.cookies.lb_session;
  if (token) await db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
  // Anonymize rather than hard-delete to preserve FK integrity for jobs/bids
  await db.prepare("UPDATE users SET email=?, password_hash='deleted', is_active=0, is_verified=0 WHERE id=?").run(`deleted-${userId}@loadbyton.invalid`, userId);
  await db.prepare('UPDATE profiles SET company_name=?, trn_number=NULL, trade_license_number=NULL, phone=NULL, iban=NULL WHERE user_id=?').run(`Deleted User ${userId}`, userId);
  await require('../lib/helpers').writeAudit(req, { userId, action: 'ACCOUNT_DELETE', details: `User ${userId} self-deleted (PDPL)`, entityType: 'user', entityId: userId });
  try { require('../lib/helpers').clearSessionCookie(req, res); } catch {}
  res.json({ ok: true, message: 'Account deleted and anonymized. Jobs/bids retained for audit with anonymized identity.' });
});

module.exports = router;
