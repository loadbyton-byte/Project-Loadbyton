# Loadbyton Roadmap

## Shipped (through Phase 8, Sep 2026)
- Marketplace: post → bid → award → track → POD → payout
- Escrow: PENDING → HELD → FUNDED → RELEASED, disputes freeze, 24h auto-release
- Payment tiers: SPOT_ESCROW / PAY_ON_DELIVERY / CONTRACT_CREDIT / OFF_PLATFORM + money-before-move gate
- Negotiation: pre-award discussion, ancillary charges, confirm-terms gate, document exchange
- Trust: equipment capacity (line-item-aware), reliability scores, chargebacks, 7-bucket disputes with real SPLIT
- Onboarding: RTA permit + haulage insurance docs
- WhatsApp: two-way delivery bot, DRIVER_ASSOCIATE trip-offers + wallet + live-location sharing
- Job form: restructured posting, multi-container line items, iOS fixes, Dashboard/JobDetail/DriverHome RTL
- Insurance: GIT quote/bind/cancel (internal/mock live, broker dark until env vars)
- Accounts: FORWARDER / OWNER_OPERATOR / BROKER roles, rosters, direct-assign, one-hop rule
- Financial integrity: ledger hash-chain + verify endpoint, two-person admin approvals
- Monetization core: platform_fees + chargeFee() (cancellation, priority placement live; rest scaffolded)
- Expansion: GCC countries/corridors wired, multi-stop itinerary, lane-rate quote
- UI modernization: mockup awaiting sign-off (docs/UI_MODERNIZATION_MOCKUP.md) — code waits on approval

## Next (blocked on non-code gates)
- Change 23 EDI depth — blocked on real enterprise customer demand, not built
- WhatsApp Business API provider approval (Meta)
- GCC market entry per country (registration, licensing)
- Insurance broker signing (underwriter/API partner)
- iOS real-device verification pass

## Known limits
- SQLite for dev, Postgres for production (mirrored migrations)
- Payouts need Stripe keys or manual admin in mock mode
- Premium settlement rides existing rails until Change 30 billing follow-ups
- Multi-currency settlement: AED-only in v1
