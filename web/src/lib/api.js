// Thin fetch wrapper: credentials included (session cookie), JSON in/out,
// throws ApiError with the backend's { error } message on any non-2xx.
//
// API base: relative /api by default (same-origin dev, or a proxy like the
// Vercel rewrite). Set VITE_API_URL (e.g. https://api.loadbyton.ae)
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
const del = (path) => request('DELETE', path);

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

  // fleet / driver roster
  listDrivers: () => get('/fleet/drivers'),
  createDriver: (body) => post('/fleet/drivers', body),
  updateDriverProfile: (id, body) => patch(`/fleet/drivers/${id}`, body),
  deleteDriver: (id) => del(`/fleet/drivers/${id}`),
  uploadDriverDocument: (id, body) => post(`/fleet/drivers/${id}/documents`, body),

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
  adminLive: () => get('/admin/live'),
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
// ——— enterprise additions (Phase 2-5) ———
Object.assign(api, {
  // Stripe escrow
  payJob: (id) => post(`/jobs/${id}/pay`, {}),
  mockConfirmPay: (ref) => post('/webhooks/stripe/mock-confirm', { processorPaymentRef: ref }),
  releasePayout: (id, sigs) => fetch(`${API_BASE_URL}/api/jobs/${id}/release-payout`, { method:'POST', credentials:'include', headers: { 'Content-Type':'application/json', 'x-hsm-sigs': (sigs||[]).join(',') } }).then(r=>r.json()),
  // verification
  verifyTrn: (trn) => get(`/verify/trn/${encodeURIComponent(trn)}`),
  verifyCheck: (body) => post('/verify/check', body),
  verifyGate: () => get('/verify/gate'),
  // location / telematics
  postLocation: (id, body) => post(`/jobs/${id}/location`, body),
  getLocations: (id) => get(`/jobs/${id}/locations`),
  ingestTelematics: (body) => post('/telematics/ingest', body),
  // currency / tax
  currencyRates: () => get('/currency/rates'),
  setJobCurrency: (id, body) => post(`/jobs/${id}/currency`, body),
  // enterprise
  setEToken: (id, token) => post(`/jobs/${id}/etoken`, { token }),
  postEir: (id, photos) => post(`/jobs/${id}/eir`, { photos }),
  getDetention: (id) => get(`/jobs/${id}/detention`),
  requestFuelAdvance: (id, type) => post(`/jobs/${id}/fuel-advance`, { type }),
  getFleet: () => get('/carrier/fleet'),
  // RFPs
  listRfps: () => get('/rfps'),
  createRfp: (body) => post('/rfps', body),
  getRfp: (id) => get(`/rfps/${id}`),
  bidRfp: (id, body) => post(`/rfps/${id}/bids`, body),
  awardRfp: (id, bidId) => post(`/rfps/${id}/award`, { bidId }),
  // EDI / compliance / ledger / ML
  ingestEdi: (body) => post('/edi/ingest', body),
  listConsignments: () => get('/edi/consignments'),
  createCompliance: (id, body) => post(`/jobs/${id}/compliance`, body),
  tokenizeBL: (id, body) => post(`/jobs/${id}/tokenize`, body),
  predictEta: (body) => post('/ml/predict-eta', body),
  auditChain: () => get('/audit/chain'),
  auditVerify: () => get('/audit/chain/verify'),
});
