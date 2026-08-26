const express = require('express');
const router = express.Router();

const spec = {
  openapi: '3.1.0',
  info: { title: 'Loadbyton API', version: '1.0.0', description: 'UAE drayage marketplace — see docs/API.md. All routes under /api, auth via lb_session HttpOnly cookie.' },
  servers: [{ url: '/api', description: 'Same-origin (Vercel proxy) or direct Render' }],
  tags: [
    { name: 'system', description: 'Health, auto-release, webhooks' },
    { name: 'auth', description: 'Register, login, MFA, org seats' },
    { name: 'public', description: 'Lanes, carriers, market — no auth, Cache-Control public' },
    { name: 'jobs', description: 'Job CRUD, bidding, lifecycle, documents' },
    { name: 'bids', description: 'Carrier bid inbox' },
    { name: 'retention', description: 'Templates, contracts, analytics, invoices, notifications' },
    { name: 'admin', description: 'Verification, approvals, disputes, revenue, SLO' },
  ],
  paths: {
    '/health': { get: { tags:['system'], summary:'GET /api/health', responses:{'200':{description:'ok'}} } },
    '/system/auto-release': { post: { tags:['system'], summary:'POST /api/system/auto-release — x-internal-key or admin session', responses:{'200':{description:'released count'}} } },
    '/system/setup-admin': { post: { tags:['system'], summary:'POST /api/system/setup-admin — first admin only, X-Setup-Key', responses:{'201':{description:'admin created'}} } },
    '/webhooks/payments': { post: { tags:['system'], summary:'POST /api/webhooks/payments — x-payments-signature', responses:{'200':{description:'ack'}} } },
    '/auth/register': { post: { tags:['auth'], summary:'POST /api/auth/register', responses:{'201':{description:'user'}} } },
    '/auth/login': { post: { tags:['auth'], summary:'POST /api/auth/login — sets lb_session', responses:{'200':{description:'user + actingAs'}} } },
    '/auth/me': { get: { tags:['auth'], summary:'GET /api/auth/me', responses:{'200':{description:'user'}} } },
    '/auth/logout': { post: { tags:['auth'], summary:'POST /api/auth/logout', responses:{'200':{description:'ok'}} } },
    '/jobs': {
      get: { tags:['jobs'], summary:'GET /api/jobs — filter status, equipmentType, escrowStatus, shipmentType, q, sort, limit/offset', responses:{'200':{description:'jobs + total'}} },
      post: { tags:['jobs'], summary:'POST /api/jobs — shipper creates job (shipment legs, container, weight, pins)', responses:{'201':{description:'job'}} }
    },
    '/jobs/{id}/bids': { post: { tags:['jobs'], summary:'POST /api/jobs/:id/bids — carrier bid (Idempotency-Key supported)', parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}], responses:{'201':{description:'bid'}} } },
    '/jobs/{id}/award': { post: { tags:['jobs'], summary:'POST /api/jobs/:id/award — shipper awards bid (transactional)', parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}], responses:{'200':{description:'job AWARDED'}} } },
    '/jobs/{id}/status': { patch: { tags:['jobs'], summary:'PATCH /api/jobs/:id/status — SHIPPER/CARRIER/ADMIN state machine', responses:{'200':{description:'job'}} } },
    '/bids/mine': { get: { tags:['bids'], summary:'GET /api/bids/mine — carrier inbox', responses:{'200':{description:'bids'}} } },
    '/admin/health': { get: { tags:['admin'], summary:'GET /api/admin/health — lane health, escrow held', responses:{'200':{description:'health'}} } },
  },
  components: { securitySchemes: { cookieAuth: { type:'apiKey', in:'cookie', name:'lb_session' } } },
};

router.get('/api/docs', (req, res) => res.json(spec));
router.get('/api/docs.json', (req, res) => res.json(spec));

module.exports = router;
