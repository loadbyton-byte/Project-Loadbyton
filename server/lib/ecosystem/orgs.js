// Organisation model on top of the legacy owner/seat user tree.
//
// Until now a "company" was a root user row (users.org_owner_id IS NULL) with
// seat users pointing at it. This module gives that tree a stable identity
// (organisations.subject_id) and explicit memberships without changing any
// existing route: org_owner_id and seat_role stay authoritative until cutover
// (master plan §9 "dual-read"). Everything here is idempotent and lazy — an
// organisation is created the first time anything asks for it, and
// backfillOrganisations() runs the same code for all existing users at boot.

'use strict';

const crypto = require('node:crypto');
const db = require('../../db');

// Account types that own a company. ADMIN is platform staff, not a company.
const COMPANY_ROLES = ['SHIPPER', 'CARRIER', 'FORWARDER', 'OWNER_OPERATOR', 'BROKER'];

async function ensureSubjectId(userId) {
  const row = await db.prepare('SELECT subject_id FROM users WHERE id=?').get(userId);
  if (!row) return null;
  if (row.subject_id) return row.subject_id;
  const subject = crypto.randomUUID();
  // Guarded so two concurrent callers cannot both win: the loser re-reads.
  await db.prepare('UPDATE users SET subject_id=? WHERE id=? AND subject_id IS NULL').run(subject, userId);
  return (await db.prepare('SELECT subject_id FROM users WHERE id=?').get(userId)).subject_id;
}

function isVerifiedUser(user) {
  return !!user.is_verified && user.is_active !== 0 && (user.account_approval_status || 'APPROVED') === 'APPROVED';
}

// Maps legacy seat roles to organisation roles. The root user is the only
// 'owner'; everything else is a member with a role label.
function orgRoleFor(user) {
  if (!user.org_owner_id) return 'owner';
  return String(user.seat_role || 'member').toLowerCase();
}

async function rootUserFor(userId) {
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) return null;
  if (user.org_owner_id) return db.prepare('SELECT * FROM users WHERE id=?').get(user.org_owner_id);
  return user;
}

async function ensureOrganisationForRoot(root) {
  let org = await db.prepare('SELECT * FROM organisations WHERE owner_user_id=?').get(root.id);
  if (!org) {
    await ensureSubjectId(root.id);
    const profile = await db.prepare('SELECT company_name FROM profiles WHERE user_id=?').get(root.id);
    const name = (profile && profile.company_name) || root.display_name || root.email;
    // owner_user_id is UNIQUE: a concurrent creator makes this insert fail,
    // and the re-read below returns the winner's row.
    try {
      await db.prepare('INSERT INTO organisations (subject_id, owner_user_id, name) VALUES (?,?,?)')
        .run(crypto.randomUUID(), root.id, name);
    } catch (e) {
      if (!/unique|constraint|duplicate/i.test(String(e.message))) throw e;
    }
    org = await db.prepare('SELECT * FROM organisations WHERE owner_user_id=?').get(root.id);
  }
  return org;
}

async function ensureMembership(org, user) {
  const role = orgRoleFor(user);
  try {
    await db.prepare('INSERT INTO org_memberships (organisation_id, user_id, org_role, is_active) VALUES (?,?,?,?)')
      .run(org.id, user.id, role, user.is_active === 0 ? 0 : 1);
  } catch (e) {
    if (!/unique|constraint|duplicate/i.test(String(e.message))) throw e;
    await db.prepare('UPDATE org_memberships SET org_role=?, is_active=? WHERE organisation_id=? AND user_id=?')
      .run(role, user.is_active === 0 ? 0 : 1, org.id, user.id);
  }
}

// Returns { org, user, membership role } for any company user or seat, or null
// for accounts that belong to no company (ADMIN, deleted).
async function getOrganisationForUser(userId) {
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) return null;
  const root = user.org_owner_id ? await db.prepare('SELECT * FROM users WHERE id=?').get(user.org_owner_id) : user;
  if (!root || !COMPANY_ROLES.includes(root.role)) return null;
  const org = await ensureOrganisationForRoot(root);
  await ensureSubjectId(user.id);
  await ensureMembership(org, user);
  return { org, user, root, orgRole: orgRoleFor(user) };
}

// Re-derives the stored verification snapshot from the root user (the legacy
// source of truth: TRN/trade-licence review sets users.is_verified).
async function syncVerification(org, root) {
  const verified = isVerifiedUser(root);
  const next = verified ? 'VERIFIED' : 'UNVERIFIED';
  if (org.verification_status !== next) {
    await db.prepare('UPDATE organisations SET verification_status=?, verified_at=? WHERE id=?')
      .run(next, verified ? new Date().toISOString() : null, org.id);
    return { ...org, verification_status: next };
  }
  return org;
}

async function backfillOrganisations() {
  const users = await db.prepare("SELECT id FROM users WHERE role IN ('SHIPPER','CARRIER','FORWARDER','OWNER_OPERATOR','BROKER') AND is_active=1").all();
  let touched = 0;
  for (const u of users) {
    const ctx = await getOrganisationForUser(u.id);
    if (ctx) { await syncVerification(ctx.org, ctx.root); touched += 1; }
  }
  return touched;
}

module.exports = {
  COMPANY_ROLES, ensureSubjectId, getOrganisationForUser, syncVerification, backfillOrganisations,
  isVerifiedUser, rootUserFor, orgRoleFor,
};
