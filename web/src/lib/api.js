// Thin fetch wrapper: credentials included (session cookie), JSON in/out,
// throws ApiError with the backend's { error } message on any non-2xx.
//
// API base: relative /api by default (same-origin dev, or a proxy like the
// Vercel rewrite). Set VITE_API_URL (e.g. https://claudeloadbyton.onrender.com)
// to call the backend cross-origin directly — requires the origin to be
// allowed by the server's FRONTEND_URL/ADDITIONAL_ORIGINS CORS list.
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(method, path, body) {
  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  }
  return data;
}

const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body ?? {});
const patch = (path, body) => request('PATCH', path, body ?? {});

export const api = {
  // auth
  register: (body) => post('/auth/register', body),
  login: (body) => post('/auth/login', body),
  me: () => get('/auth/me'),
  logout: () => post('/auth/logout'),
  verifyEmail: (token) => get(`/auth/verify-email?token=${encodeURIComponent(token)}`),
  resendVerification: () => post('/auth/resend-verification'),
  forgotPassword: (email) => post('/auth/forgot-password', { email }),
  resetPassword: (body) => post('/auth/reset-password', body),
  mfaSetup: () => post('/auth/mfa/setup'),
  mfaDisable: () => post('/auth/mfa/disable'),
  updateProfile: (body) => patch('/profile', body),
  orgMembers: () => get('/org/members'),
  addOrgMember: (body) => post('/org/members', body),
  updateOrgMember: (id, body) => patch(`/org/members/${id}`, body),

  // public
  publicLanes: () => get('/public/lanes'),
  publicCarriers: () => get('/public/carriers'),
  publicMarket: () => get('/public/market'),

  // jobs
  listJobs: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
    const suffix = qs.toString() ? `?${qs}` : '';
    return get(`/jobs${suffix}`);
  },
  createJob: (body) => post('/jobs', body),
  importJobs: (jobs) => post('/jobs/import', { jobs }),
  editJob: (id, body) => patch(`/jobs/${id}`, body),
  myBids: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
    const suffix = qs.toString() ? `?${qs}` : '';
    return get(`/bids/mine${suffix}`);
  },
  withdrawBid: (id) => post(`/bids/${id}/withdraw`),
  getJob: (id) => get(`/jobs/${id}`),
  placeBid: (id, body) => post(`/jobs/${id}/bids`, body),
  awardJob: (id, bidId) => post(`/jobs/${id}/award`, { bidId }),
  paymentCheckout: (id) => post(`/jobs/${id}/payment-checkout`, {}),
  setStatus: (id, status) => patch(`/jobs/${id}/status`, { status }),
  updateDriver: (id, body) => patch(`/jobs/${id}/driver`, body),
  submitPod: (id, body) => post(`/jobs/${id}/pod`, body),
  track: (id) => get(`/jobs/${id}/track`),
  disputeJob: (id, reason) => post(`/jobs/${id}/dispute`, { reason }),
  getDispute: (id) => get(`/jobs/${id}/dispute`),
  backloadMatches: (id) => get(`/jobs/${id}/backload-matches`),
  addDocument: (id, body) => post(`/jobs/${id}/documents`, body),
  rateJob: (id, body) => post(`/jobs/${id}/rating`, body),
  getMessages: (id) => get(`/jobs/${id}/messages`),
  sendMessage: (id, content) => post(`/jobs/${id}/messages`, { content }),

  // retention
  listTemplates: () => get('/templates'),
  createTemplate: (body) => post('/templates', body),
  rerunTemplate: (id) => post(`/templates/${id}/rerun`),
  listContracts: () => get('/contracts'),
  createContract: (body) => post('/contracts', body),
  analytics: () => get('/analytics/mine'),
  earnings: () => get('/earnings'),
  invoices: () => get('/invoices'),
  notifications: () => get('/notifications'),
  markNotificationsRead: () => post('/notifications/read'),
  notificationPreferences: () => get('/notifications/preferences'),
  updateNotificationPreferences: (disabled) => patch('/notifications/preferences', { disabled }),

  // admin
  adminHealth: () => get('/admin/health'),
  adminVerificationQueue: () => get('/admin/verification'),
  adminVerify: (id, body) => post(`/admin/verify/${id}`, body),
  adminVerifyBulk: (ids, action) => post('/admin/verify-bulk', { ids, action }),
  adminConfirmReceipt: (jobId) => post('/admin/confirm-receipt', { jobId }),
  adminAudit: () => get('/admin/audit'),
  adminDisputes: () => get('/admin/disputes'),
  adminOpenDispute: (body) => post('/admin/disputes', body),
  adminResolveDispute: (id, body) => post(`/admin/disputes/${id}/resolve`, body),
  adminEvidence: (jobId) => get(`/admin/evidence/${jobId}`),
  adminRevenue: () => get('/admin/revenue'),
  adminPayoutsSla: () => get('/admin/payouts-sla'),
  adminMarkTransferred: (payoutId, reference) => post(`/admin/payouts/${payoutId}/mark-transferred`, { reference }),
  adminApprovals: () => get('/admin/approvals'),
  adminApprove: (id, action) => post(`/admin/approve/${id}`, { action }),
  adminGetSettings: () => get('/admin/settings'),
  adminUpdateSettings: (body) => patch('/admin/settings', body),
  adminUsers: () => get('/admin/users'),
  adminReferrals: () => get('/admin/referrals'),
  adminImpersonate: (userId) => post(`/admin/impersonate/${userId}`),
  endImpersonation: () => post('/admin/impersonate/end'),
  runAutoRelease: () => post('/system/auto-release'),
};
