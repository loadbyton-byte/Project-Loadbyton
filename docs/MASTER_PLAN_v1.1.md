# LOADBYTON — Six domains, one connected business: Master Plan v1.1

Revision of Version 1.0 (18 October 2026). v1.0 remains the baseline; this document lists every decision the owner has since taken and the sections of v1.0 that they supersede. Anything not mentioned here is unchanged from v1.0.

Date of revision: 18 October 2026. Decisions recorded from the owner's instructions in the build session.

## Change log

| # | v1.0 section | v1.0 position | v1.1 position | Status |
|---|---|---|---|---|
| 1 | §1 Evidence, §13 | The Store's billing entity and decision register assumed a separate (India-facing) seller; the legal entity was unresolved. | One UAE legal entity operates both loadbyton.com and loadbyton.store. The Store's seller identity is UAE (legal name, trade licence, TRN). Razorpay is not used; Stripe and Telr (AED) are the payment partners. | Built. Entity name, licence and TRN still have to be entered through configuration. |
| 2 | §3, §13 | Premium .com price and activation date unresolved. | Premium is AED 199 per month or AED 1,990 per year, excluding 5% UAE VAT. Versioned plan, published tax treatment, cancellation and benefit terms. Hosted checkout through Stripe or Telr. | Built; checkout opens only when `PREMIUM_CHECKOUT_ENABLED=true` and a live provider is configured. |
| 3 | §3, §13 | 14-day payment grace was a recommended default. | 14-day grace is approved. | Built (`ECOSYSTEM_GRACE_DAYS`). |
| 4 | §1, §10 brand | The BY colour variant was unreconciled: red in the Store kit, white/navy in some .com applications. Approval pending. | **Red BY is canonical** on every domain. The brand v2 wordmark and the ecosystem interface are on by default. | Built; recorded in both brand kits. Trademark clearance is still not assessed. |
| 5 | §4, §13 | The 18 sectors are at pilot baseline; initial accepted sectors unresolved. | All 18 sectors are released. The release is declared by the operator (`SECTOR_RELEASE=all`) and is shown as such. It does not create independent acceptance evidence. | Built. Specialist warnings for customs, cold chain, aviation and dangerous cargo stay. |
| 6 | §13 | Legal terms not part of the package. | Terms were written in the repositories (Store terms, included plans, services, acceptable use, privacy, data processing, subprocessors; .com Premium, Business OS activation, data sharing). | Drafts. Pages show a draft notice until `LEGAL_REVIEWED` / `VITE_LEGAL_REVIEWED` is set after review by a qualified UAE lawyer. The iubenda connector could not be used because it is not authorised. |

## Superseded text

* §3 "Premium .com pricing remains a new commercial decision" is replaced by change 2.
* §13 "Still unresolved commercial inputs": the premium price and activation mechanism, the legal entity jurisdiction, the payment partner choice, the initial accepted sectors and the source-master/branch naming (red BY) are now decided. Still unresolved: the registered entity name, trade licence number, TRN and registered address; live Stripe (UAE) or Telr credentials; support commitments; trademark clearance.
* §4 "all with pilot baseline status": the Store now reports the sectors as live by operator declaration.

## What the commercial gate still requires

The v1.0 commercial gate is unchanged: monthly net membership revenue plus allocated freight gross profit must exceed Store compute, storage, support and provider subsidies, payment cost and expected loss. Pilot with 10 companies and measure cost per active workspace before promoting Premium widely. At AED 199 per month the price is deliberately affordable, so the pilot must show that the included limits do not make it loss-making; if they do, raise the price or add paid overages transparently rather than promise uncosted capacity.

## Open items (owner / external)

1. Enter the entity's legal name, trade licence, licence authority, TRN and address (`SELLER_*` on the Store; the .com legal pages and receipts).
2. Open the entity's Stripe UAE account (or Telr) and set the live keys, webhook secret and `PREMIUM_CHECKOUT_ENABLED=true`.
3. Have a qualified UAE lawyer review every document in the change log row 6, then set the reviewed flags.
4. Authorise the iubenda connector in the claude.ai connector settings if hosted policies are wanted instead of the written drafts.
5. Replace the default contact phone on the Store (`CONTACT_PHONE`); the shipped default is an Indian number.
6. Trademark clearance for LOAD|BY|TON in the UAE; Arabic native review; domain registrant proof.
7. The 15 stale file hashes in the Store's `public/brand/checksums.json` (binary exports) predate this work and should be regenerated with `scripts/package-brand.py`.
