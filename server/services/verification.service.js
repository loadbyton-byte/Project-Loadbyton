const db = require('../db');
const { encryptField } = require('../lib/crypto');
const { writeAudit, toPublicUser, notify } = require('../lib/helpers');

const cache = new Map();

async function verifyTrnExternal(trn) {
  const cached = cache.get(trn);
  if (cached && cached.cached) return cached;

  const valid = /^\d{15}$/.test(String(trn).trim());
  const result = { valid, trn: String(trn).trim(), checkedAt: new Date().toISOString(), cached: false };
  cache.set(trn, result);
  return result;
}

async function approveAccount(req, userId, action) {
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }
  if (user.account_approval_status !== 'PENDING') { const e = new Error('Account is not pending approval'); e.status = 409; throw e; }

  if (action === 'approve') {
    await db.prepare(`UPDATE users SET account_approval_status='APPROVED', account_approved_at=datetime('now'), is_active=1 WHERE id=?`).run(userId);
  } else if (action === 'reject') {
    await db.prepare(`UPDATE users SET account_approval_status='REJECTED', is_active=0 WHERE id=?`).run(userId);
  } else {
    const e = new Error('action must be approve or reject'); e.status = 400; throw e;
  }

  await writeAudit(req, {
    userId: req.actorId,
    action: 'ACCOUNT_APPROVE',
    details: `${user.email} ${action}d`,
    entityType: 'user',
    entityId: userId,
    beforeState: 'PENDING',
    afterState: action === 'approve' ? 'APPROVED' : 'REJECTED',
  });

  if (action === 'approve') {
    await notify(userId, 'Account approved', 'Your account has been approved. You can now use the platform.', null, 'verification');
  }

  return await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
}

async function verifyCarrier(req, userId, action, iban) {
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }
  if (user.role !== 'CARRIER') { const e = new Error('User is not a carrier'); e.status = 400; throw e; }

  if (action === 'approve') {
    // Insurance was a self-reported checklist item with nothing behind it
    // ("Insurance" in DocumentCompliance.jsx's checklist, "Insurance:
    // Uploaded/Missing" in the admin verification queue) — an admin could
    // approve a carrier with none on file, same class of bug as the
    // credit_limit_aed/priority_placement_fee_aed columns this codebase
    // has found and fixed elsewhere (a field that LOOKS enforced but
    // isn't wired up). Fleet/cargo insurance is the one document every
    // transporter and fleet owner genuinely needs on file before hauling
    // freight for shippers on this platform — hard-blocked here, not just
    // displayed, same as the IBAN check below.
    // Checked via insurance_uploaded, not insurance_doc_storage_path
    // directly — DocumentCompliance.jsx's checklist and the admin
    // verification queue (VerificationTab.jsx) both already read
    // insurance_uploaded as "is insurance on file", and documents.routes.js
    // keeps it in sync with the real uploaded file going forward; matching
    // that same field here is what makes this an enforcement of the
    // existing claim rather than a second, stricter, inconsistent check.
    const profileForInsurance = await db.prepare('SELECT insurance_uploaded FROM profiles WHERE user_id=?').get(userId);
    if (!profileForInsurance?.insurance_uploaded) {
      const e = new Error('This carrier has no insurance document on file — they must upload one (Document compliance page) before verification can be approved.');
      e.status = 400;
      throw e;
    }
    await db.prepare(`UPDATE users SET is_verified=1 WHERE id=?`).run(userId);
    if (iban) {
      await db.prepare(`UPDATE profiles SET iban=?, verified_at=datetime('now') WHERE user_id=?`).run(encryptField(iban), userId);
    } else {
      await db.prepare(`UPDATE profiles SET verified_at=datetime('now') WHERE user_id=?`).run(userId);
    }
  } else if (action === 'reject') {
    await db.prepare(`UPDATE users SET is_verified=0 WHERE id=?`).run(userId);
  } else {
    const e = new Error('action must be approve or reject'); e.status = 400; throw e;
  }

  await writeAudit(req, {
    userId: req.actorId,
    action: 'CARRIER_VERIFY',
    details: `${user.email} ${action}d${iban ? ' with IBAN' : ''}`,
    entityType: 'user',
    entityId: userId,
    beforeState: user.is_verified ? 'verified' : 'unverified',
    afterState: action === 'approve' ? 'verified' : 'unverified',
  });

  if (action === 'approve') {
    await notify(userId, 'Carrier verified', 'Your carrier account has been verified. You can now bid on jobs.', null, 'verification');
  }

  return await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
}

module.exports = { verifyTrnExternal, cache, approveAccount, verifyCarrier };
