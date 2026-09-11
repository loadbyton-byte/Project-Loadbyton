// Thin fetch wrapper: credentials included (session cookie), JSON in/out,
// throws ApiError with the backend's { error } message on any non-2xx.
//
// API base: relative /api by default (same-origin dev, or a proxy like the
// Vercel rewrite). Set VITE_API_URL (e.g. https://api.loadbyton.ae)
// to call the backend cross-origin directly — requires the origin to be
// allowed by the server's FRONTEND_URL/ADDITIONAL_ORIGINS CORS list.
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// Branded documents (settlement statement, load confirmation, POD
// certificate, dispute notice) are server-rendered HTML, not JSON — callers
// used to link straight to the API URL with a plain <a href>, so any
// non-2xx response (e.g. "No payout on file for this job yet") rendered as
// raw JSON in the browser instead of a handled error. This mirrors
// request()'s error-message extraction (same two envelope shapes) but opens
// the HTML in a new tab on success instead of parsing JSON.
export async function openDocument(path) {
  const res = await fetch(`${API_BASE_URL}/api${path}`, { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message =
      typeof data?.error === 'string' ? data.error
      : data?.message || data?.error?.message || data?._legacy?.error
      || `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data?.code || (typeof data?.error === 'object' ? data.error.code : undefined));
  }
  const html = await res.text();
  const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(blobUrl, '_blank', 'noopener');
}

// CSRF defense (server/app.js) — every mutating request carrying the
// session cookie must send this, or the server refuses it with
// CSRF_HEADER_MISSING. A plain cross-site <form> POST or "simple"
// cross-origin fetch can't attach a custom header without triggering a
// CORS preflight, which the server's own origin allowlist blocks for any
// origin other than this app's real frontend(s).
export const CSRF_HEADER = 'x-loadbyton-client';

async function request(method, path, body, extraHeaders) {
  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    method,
    credentials: 'include',
    headers: { [CSRF_HEADER]: '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    // Two error envelopes exist server-side: lib/http.js's sendError sends
    // `error` as a plain string; lib/apiResponse.js's error() sends `error`
    // as an object ({code, message, ...}) but always also includes a
    // plain-string `message` field alongside it. Without this, an
    // apiResponse-shaped response fed straight into `new Error(object)`
    // silently became the literal string "[object Object]" everywhere
    // (toasts, the admin MFA-code prompt's message-matching, etc).
    const message =
      typeof data?.error === 'string' ? data.error
      : data?.message || data?.error?.message || data?._legacy?.error
      || `Request failed (${res.status})`;
    const code = data?.code || (typeof data?.error === 'object' ? data.error.code : undefined);
    throw new ApiError(message, res.status, code);
  }
  return data;
}

const get = (path) => request('GET', path);
const post = (path, body, extraHeaders) => request('POST', path, body ?? {}, extraHeaders);
const patch = (path, body) => request('PATCH', path, body ?? {});
const del = (path) => request('DELETE', path);

// Pass the same key back on a retry of the same submit attempt (e.g. after
// a network error) so the backend's idempotency middleware
// (server/lib/idempotency.js) can replay the first response instead of
// creating a duplicate row — a fresh key means a genuinely new submission.
const idempotencyHeaders = (key) => (key ? { 'Idempotency-Key': key } : undefined);

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
  mfaSetup: (body) => post('/auth/mfa/setup', body),
  mfaDisable: (body) => post('/auth/mfa/disable', body),
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
  createJob: (body, idempotencyKey) => post('/jobs', body, idempotencyHeaders(idempotencyKey)),
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
  awardJob: (id, bidId, opts) => post(`/jobs/${id}/award`, { bidId, ...opts }),
  getBidNegotiation: (bidId) => get(`/bids/${bidId}/negotiation`),
  postBidNegotiation: (bidId, message) => post(`/bids/${bidId}/negotiation`, { message }),
  getAncillaryCharges: (bidId) => get(`/bids/${bidId}/ancillary-charges`),
  proposeAncillaryCharge: (bidId, chargeType, amountAed, notes) => post(`/bids/${bidId}/ancillary-charges`, { chargeType, amountAed, notes }),
  agreeAncillaryCharge: (bidId, chargeId) => post(`/bids/${bidId}/ancillary-charges/${chargeId}/agree`, {}),
  confirmBidTerms: (bidId) => post(`/bids/${bidId}/confirm-terms`, {}),
  setHaulierCode: (jobId, haulierCode) => post(`/jobs/${jobId}/haulier-code`, { haulierCode }),
  setHaulierToken: (jobId, haulierToken) => post(`/jobs/${jobId}/haulier-token`, { haulierToken }),
  paymentCheckout: (id) => post(`/jobs/${id}/payment-checkout`, {}),
  setStatus: (id, status) => patch(`/jobs/${id}/status`, { status }),
  updateDriver: (id, body) => patch(`/jobs/${id}/driver`, body),
  submitPod: (id, body) => post(`/jobs/${id}/pod`, body),
  track: (id) => get(`/jobs/${id}/track`),
  disputeJob: (id, reason, disputeType) => post(`/jobs/${id}/dispute`, { reason, disputeType }),
  getDispute: (id) => get(`/jobs/${id}/dispute`),
  backloadMatches: (id) => get(`/jobs/${id}/backload-matches`),
  addDocument: (id, body) => post(`/jobs/${id}/documents`, body),
  getJobDocumentUploadUrl: (id, mimeType) => post(`/jobs/${id}/documents/upload-url`, { mimeType }),
  rateJob: (id, body) => post(`/jobs/${id}/rating`, body),
  getMessages: (id) => get(`/jobs/${id}/messages`),
  getThreads: (id) => get(`/jobs/${id}/threads`),
  sendMessage: (id, content, withRole) => post(`/jobs/${id}/messages`, withRole ? { content, withRole } : { content }),
  messageThreads: () => get('/messages/threads'),
  markThreadRead: (threadId) => post(`/messages/threads/${threadId}/read`),

  // fleet / driver roster
  listDrivers: () => get('/fleet/drivers'),
  createDriver: (body) => post('/fleet/drivers', body),
  updateDriverProfile: (id, body) => patch(`/fleet/drivers/${id}`, body),
  deleteDriver: (id) => del(`/fleet/drivers/${id}`),
  uploadDriverDocument: (id, body) => post(`/fleet/drivers/${id}/documents`, body),
  getDriverDocumentUploadUrl: (id, mimeType) => post(`/fleet/drivers/${id}/documents/upload-url`, { mimeType }),
  addDriverSeat: (id, password) => post(`/fleet/drivers/${id}/seat`, password ? { password } : {}),
  getFleetCapacity: () => get('/fleet/capacity'),
  externalEngageUnits: (units, note) => post('/fleet/capacity/external-engage', { units, note }),
  releaseExternalUnits: (units) => post('/fleet/capacity/release', { units }),
  // Driver-associate wallet (server/routes/fleet.routes.js). Was previously
  // called from Drivers.jsx as api.get(...)/api.post(...) directly — get/
  // post/patch/del are module-local helpers in this file, never attached to
  // the exported `api` object, so those calls threw "api.get is not a
  // function" and crashed the whole page for every carrier account (no
  // try/catch around it in React's render path). Named wrapper methods,
  // matching every other endpoint in this file, fix it at the actual cause.
  listDriverAssociateWallet: () => get('/fleet/driver-associates/wallet'),
  markWalletEntryPaid: (entryId) => post(`/fleet/driver-associates/wallet/${entryId}/mark-paid`, {}),

  // driver seat's own view
  driverJob: () => get('/driver/job'),
  driverWallet: () => get('/driver/wallet'),
  driverTripOffer: () => get('/driver/trip-offer'),
  respondToTripOffer: (id, accepted) => post(`/driver/trip-offer/${id}/respond`, { accepted }),

  // company (profile-level) documents
  getProfileDocumentUploadUrl: (docType, mimeType) => post('/profile/documents/upload-url', { docType, mimeType }),
  uploadProfileDocument: (body) => post('/profile/documents', body),
  myDocumentedJobs: () => get('/documents/my-jobs'),

  // admin document visibility
  adminDocumentCompanies: () => get('/admin/documents'),
  adminDocumentCompany: (userId) => get(`/admin/documents/${userId}`),

  // retention
  listTemplates: () => get('/templates'),
  createTemplate: (body) => post('/templates', body),
  rerunTemplate: (id) => post(`/templates/${id}/rerun`),
  listContracts: () => get('/contracts'),
  createContract: (body) => post('/contracts', body),
  analytics: () => get('/analytics/mine'),
  getLaneQuote: (terminal, area) => {
    const qs = new URLSearchParams(Object.entries({ terminal, area }).filter(([, v]) => v !== undefined && v !== ''));
    return get(`/lanes/quote?${qs}`);
  },
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
  // Two-person approval inbox (admin-approvals.routes.js) — was API-only
  // with no frontend caller at all until the Approvals tab.
  adminActionApprovals: (status) => get(`/admin/action-approvals${status ? `?status=${status}` : ''}`),
  adminConfirmApproval: (id) => post(`/admin/action-approvals/${id}/confirm`, {}),
  adminRejectApproval: (id, reason) => post(`/admin/action-approvals/${id}/reject`, { reason }),
  adminApprovals: () => get('/admin/approvals'),
  adminApprove: (id, action) => post(`/admin/approve/${id}`, { action }),
  adminGetSettings: () => get('/admin/settings'),
  adminUpdateSettings: (body) => patch('/admin/settings', body),
  adminUsers: () => get('/admin/users'),
  adminReferrals: () => get('/admin/referrals'),
  adminImpersonate: (userId) => post(`/admin/impersonate/${userId}`),
  endImpersonation: () => post('/admin/impersonate/end'),
  runAutoRelease: () => post('/system/auto-release'),
  adminCredit: () => get('/admin/credit'),
  adminApproveCredit: (userId, limitAed, termsDays) => post(`/admin/credit/${userId}/approve`, { limitAed, termsDays }),
  adminSettleCredit: (jobId) => post(`/admin/credit/jobs/${jobId}/settle`),
};
// ——— enterprise additions (Phase 2-5) ———
Object.assign(api, {
  // Stripe escrow
  payJob: (id) => post(`/jobs/${id}/pay`, {}),
  mockConfirmPay: (ref) => post('/webhooks/stripe/mock-confirm', { processorPaymentRef: ref }),
  releasePayout: (id, sigs) => fetch(`${API_BASE_URL}/api/jobs/${id}/release-payout`, { method:'POST', credentials:'include', headers: { 'Content-Type':'application/json', 'x-hsm-sigs': (sigs||[]).join(','), [CSRF_HEADER]: '1' } }).then(r=>r.json()),
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
  postEir: (id, photos, { stage = 'pickup', sealNumber } = {}) => post(`/jobs/${id}/eir?stage=${stage}`, { photos, sealNumber }),
  getDetention: (id) => get(`/jobs/${id}/detention`),
  requestFuelAdvance: (id, type) => post(`/jobs/${id}/fuel-advance`, { type }),
  getFuelAdvances: (id) => get(`/jobs/${id}/fuel-advances`),
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
  // Insurance — quote has no job id in its path (it's pure rate-card math,
  // not job-scoped); only bind/cancel are.
  getInsuranceQuote: (body) => post('/insurance/quote', body),
  bindInsurance: (id, body) => post(`/jobs/${id}/insurance/bind`, body),
  cancelInsurance: (id) => post(`/jobs/${id}/insurance/cancel`, {}),
  getPolicy: (id) => get(`/jobs/${id}/insurance`),
  // Direct assign / Broker / Forwarder
  directAssign: (id, body) => post(`/jobs/${id}/direct-assign`, body),
  listBrokerCarriers: () => get('/broker/carriers'),
  addBrokerCarrier: (body) => post('/broker/carriers', body),
  listForwarderClients: () => get('/forwarder/clients'),
  addForwarderClient: (body) => post('/forwarder/clients', body),
  // Trip offers
  createTripOffer: (id, body) => post(`/jobs/${id}/trip-offer`, body),
  listTripOffers: (id) => get(`/jobs/${id}/trip-offers`),
  // Stops
  listStops: (id) => get(`/jobs/${id}/stops`),
  createStop: (id, body) => post(`/jobs/${id}/stops`, body),
  completeStop: (id, stopId) => post(`/jobs/${id}/stops/${stopId}/complete`, {}),
  deleteStop: (id, stopId) => del(`/jobs/${id}/stops/${stopId}`),
  // Two-person action-approval flow (server/routes/admin-approvals.routes.js)
  // — distinct from adminApprovals()/adminApprove() above, which are the
  // pending-account-registration queue, a different feature entirely that
  // happened to collide on this exact GET path before the server-side rename.
  // adminRequestApproval is for the generic reason-only request (MANUAL_
  // ESCROW_RELEASE/MANUAL_REFUND, requested from the Approvals tab itself);
  // DISPUTE_RESOLVE/MARK_TRANSFERRED requests are instead created directly
  // by DisputesTab.jsx/PayoutsSlaTab.jsx's own existing actions (via
  // adminResolveDispute/adminMarkTransferred), since those carry a much
  // richer payload than {reason} — see admin.routes.js's
  // two_person_approval_required branches.
  adminRequestApproval: (body) => post('/admin/action-approvals/request', body),
  // Admin reconciliation / platform fees / ledger
  adminReconciliation: () => get('/admin/reconciliation'),
  adminPlatformFees: () => get('/admin/platform-fees'),
  adminLedgerVerify: () => get('/admin/ledger/verify-chain'),
  // Account deletion / GDPR
  deleteAccount: () => del('/me'),
  exportAccount: () => get('/me/export'),
  // Bid ancillary charge delete
  deleteBidAncillaryCharge: (bidId, chargeId) => del(`/bids/${bidId}/ancillary-charges/${chargeId}`),
  // Job status patch (admin)
  patchJobStatus: (id, status) => patch(`/jobs/${id}/status`, { status }),
  // Stripe Connect
  stripeConnectOnboard: () => post('/stripe/connect/onboard', {}),
  stripeConnectStatus: () => get('/stripe/connect/status'),
  // EDI (continued)
  getConsignment: (id) => get(`/edi/consignments/${id}`),
  transitionConsignment: (id, body) => post(`/edi/consignments/${id}/transition`, body),
  // GCC
  getGccCountries: () => get('/gcc/countries'),
  getGccCorridors: () => get('/gcc/corridors'),
  // Billing / Lanes
  getBillingFees: () => get('/billing/fees'),
  getLanesQuote: (params) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
    const suffix = qs.toString() ? `?${qs}` : '';
    return get(`/lanes/quote${suffix}`);
  },
  // Audit / Ledger
  getAuditChain: () => get('/audit/chain'),
  verifyAuditChain: () => get('/audit/chain/verify'),
  // Job instruments
  getInstruments: (id) => get(`/jobs/${id}/instruments`),
});
