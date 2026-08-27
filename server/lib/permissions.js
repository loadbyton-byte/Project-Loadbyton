// RBAC + permission policies — replaces hard-coded role checks with
// fine-grained permissions. ADMIN has all. Each route declares the
// permission it requires; role mapping is centralized here.
const PERMISSIONS = {
  JOB_READ: 'job.read',
  JOB_CREATE: 'job.create',
  JOB_AWARD: 'job.award',
  JOB_CANCEL: 'job.cancel',
  BID_CREATE: 'bid.create',
  BID_WITHDRAW: 'bid.withdraw',
  PAYOUT_READ: 'payout.read',
  PAYOUT_RELEASE: 'payout.release',
  PAYOUT_APPROVE: 'payout.approve',
  VERIFICATION_APPROVE: 'verification.approve',
  DISPUTE_RESOLVE: 'dispute.resolve',
  DISPUTE_OPEN: 'dispute.open',
  ADMIN_USERS_MANAGE: 'admin.users.manage',
  ADMIN_SETTINGS_MANAGE: 'admin.settings.manage',
  DOCUMENT_READ: 'document.read',
  DOCUMENT_WRITE: 'document.write',
  PROFILE_UPDATE: 'profile.update',
  PROFILE_SENSITIVE_UPDATE: 'profile.sensitive_update', // IBAN, payout account
  ANALYTICS_READ: 'analytics.read',
};

const ROLE_PERMISSIONS = {
  SHIPPER: [
    PERMISSIONS.JOB_READ,
    PERMISSIONS.JOB_CREATE,
    PERMISSIONS.JOB_AWARD,
    PERMISSIONS.JOB_CANCEL,
    PERMISSIONS.PAYOUT_READ,
    PERMISSIONS.DISPUTE_OPEN,
    PERMISSIONS.DOCUMENT_READ,
    PERMISSIONS.DOCUMENT_WRITE,
    PERMISSIONS.PROFILE_UPDATE,
    PERMISSIONS.PROFILE_SENSITIVE_UPDATE,
    PERMISSIONS.ANALYTICS_READ,
  ],
  CARRIER: [
    PERMISSIONS.JOB_READ,
    PERMISSIONS.BID_CREATE,
    PERMISSIONS.BID_WITHDRAW,
    PERMISSIONS.PAYOUT_READ,
    PERMISSIONS.DISPUTE_OPEN,
    PERMISSIONS.DOCUMENT_READ,
    PERMISSIONS.DOCUMENT_WRITE,
    PERMISSIONS.PROFILE_UPDATE,
    PERMISSIONS.PROFILE_SENSITIVE_UPDATE,
  ],
  ADMIN: Object.values(PERMISSIONS), // all
};

function hasPermission(user, permission) {
  if (!user || !permission) return false;
  if (user.role === 'ADMIN') return true;
  const perms = ROLE_PERMISSIONS[user.role] || [];
  return perms.includes(permission);
}

function getPermissionsForRole(role) {
  if (role === 'ADMIN') return Object.values(PERMISSIONS);
  return ROLE_PERMISSIONS[role] || [];
}

module.exports = { PERMISSIONS, ROLE_PERMISSIONS, hasPermission, getPermissionsForRole };
