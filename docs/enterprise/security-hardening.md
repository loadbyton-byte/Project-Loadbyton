# Security Headers & Pen-Test Readiness
Headers: server/lib/http.js — CSP includes Mapbox/Stripe/Sentry, HSTS behind TLS, frame-ancestors none.
Encryption at rest: enc:v1: AES-256-GCM server/lib/crypto.js — IBAN/TRN + processor_account_id, dp_world_e_token optionally encrypted.
In transit: TLS required (req.secure gates Secure cookie + HSTS), Cloudflare WAF OWASP ruleset.
Audit: server/lib/auditChain.js SHA-256 chain prev_hash|action|entity|ts + Postgres trigger audit_log_no_update/delete.
HSM: server/lib/hsm.js 2-of-3 HMAC — swap with pkcs11js to CloudHSM in prod (HSM_SECRET=hexkey1,hexkey2,hexkey3).
Pen-test: npm audit, gitleaks, nikto on /api/health, ASVS matrix in loadbyton-reports/03-security/01-security-assessment.md.
