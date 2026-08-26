# Loadbyton Roadmap

## Shipped
- Marketplace: post → bid → award → track → POD → payout
- Escrow: PENDING → HELD → FUNDED → RELEASED, disputes freeze, 24h auto-release
- Trust: carrier verification (TRN/licence/insurance/IBAN), contact gating, TOTP MFA, audit log
- Retention: templates, contract lanes, loyalty tiers, referrals, notifications
- Admin: verification queue, disputes, revenue, audit log, system health
- Payments: Stripe Connect (live) + mock fallback, ledger hashing, HSM multi-sig
- Infra: Postgres + SQLite dual mode, Docker Compose, Redis rate limiting

## Next
- WhatsApp Business API provider approval
- Full Arabic coverage beyond Shell/Landing
- iOS responsive web app
- GCC corridor expansion (SA, OM)

## Known limits
- SQLite for dev, Postgres for production
- Payouts need Stripe keys or manual admin in mock mode
