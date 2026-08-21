const db = require('../db');
const { encryptField, decryptField } = require('../lib/crypto');
const { writeAudit, toPublicUser, notify } = require('../lib/helpers');

function approveAccount(req, userId, action) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) throw { status: 404, message: 'User not found' };
  if (!['approve', 'reject'].includes(action)) throw { status: 400, message: 'action must be approve or reject' };
  if (user.role === 'ADMIN') throw { status: 400, message: 'Admin accounts are not approval-gated' };
  if (action === 'approve') {
    db.prepare(`UPDATE users SET account_approval_status='APPROVED', account_approved_at=datetime('now') WHERE id=?`).run(user.id);
    writeAudit(req, { userId: req.actorId, action: 'ACCOUNT_APPROVE', details: `Approved ${user.role} account ${user.email}`, entityType: 'user', entityId: user.id, afterState: 'APPROVED' });
    notify(user.id, 'Account approved', 'Your account is approved — you can now post jobs, bid, and use the full workflow.', null, 'verification');
  } else {
    db.prepare(`UPDATE users SET account_approval_status='REJECTED', account_approved_at=NULL WHERE id=?`).run(user.id);
    writeAudit(req, { userId: req.actorId, action: 'ACCOUNT_REJECT', details: `Rejected ${user.role} account ${user.email}`, entityType: 'user', entityId: user.id, afterState: 'REJECTED' });
    notify(user.id, 'Account not approved', 'Your account was not approved. Contact support for details.', null, 'verification');
  }
  return toPublicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
}

// Shared by the single-carrier route and the bulk route below. Throws
// { status, message } on failure (bulk catches per-row; single re-throws
// as a normal sendError) rather than writing to res directly.
function verifyCarrier(req, carrierId, action, iban) {
  const carrier = db.prepare('SELECT * FROM users WHERE id=?').get(carrierId);
  if (!carrier) throw { status: 404, message: 'Carrier not found' };
  if (!['approve', 'reject'].includes(action)) throw { status: 400, message: 'action must be approve or reject' };

  if (action === 'approve') {
    const existingIban = db.prepare('SELECT iban FROM profiles WHERE user_id=?').get(carrier.id).iban;
    if (!iban && !existingIban) throw { status: 400, message: 'IBAN is required to approve verification' };
    db.prepare('UPDATE users SET is_verified=1 WHERE id=?').run(carrier.id);
    db.prepare(`UPDATE profiles SET verified_at=datetime('now'), iban=COALESCE(?, iban) WHERE user_id=?`).run(iban ? encryptField(iban) : null, carrier.id);
    writeAudit(req, { userId: req.actorId, action: 'VERIFY', details: `Approved carrier #${carrier.id}`, entityType: 'user', entityId: carrier.id, afterState: 'VERIFIED' });
    notify(carrier.id, 'Verification approved', 'You can now bid on open loads.', null, 'verification');
  } else {
    writeAudit(req, { userId: req.actorId, action: 'VERIFY', details: `Rejected carrier #${carrier.id}`, entityType: 'user', entityId: carrier.id, afterState: 'REJECTED' });
    notify(carrier.id, 'Verification rejected', 'Your verification could not be approved. Contact support.', null, 'verification');
  }
  return toPublicUser(db.prepare('SELECT * FROM users WHERE id=?').get(carrier.id));
}

module.exports = { approveAccount, verifyCarrier };
