# WhatsApp driver messaging — setup (TODO-4)

`docs/STRATEGY.md` names WhatsApp as launch-critical: driver messaging order
is **WhatsApp → SMS → in-app**, in that order, because that's the channel
UAE drivers actually use. The send path (`server/lib/whatsapp.js`) is
code-complete against the Meta WhatsApp Cloud API. What's missing is not
code — it's an external approval process this document exists to start
early, because its lead time is the actual critical path, not the build.

## Why this can't be "just finished" in a sitting

1. **Business verification** — Meta verifies the business behind the WhatsApp
   Business Account (WABA). Requires a registered legal entity, a domain, and
   can take days to weeks depending on document review queues.
2. **Message template approval** — WhatsApp only allows free-form replies
   inside a 24h customer-service window. Anything outside that (the pickup
   notification this ships with) must go through an approved **template**,
   reviewed by Meta, typically 1–2 business days per template but with no
   SLA guarantee.
3. **Phone number registration** — the sending number needs to be verified
   and can't be a number already active on personal WhatsApp.

None of that is blocked by anything in this repo — start it in parallel
with everything else, per TODO-4's own framing.

## Steps

1. Create a Meta Business account at business.facebook.com if one doesn't
   exist for the company yet.
2. Go to developers.facebook.com → My Apps → Create App → "Business" type →
   add the **WhatsApp** product.
3. Under WhatsApp → API Setup, note the **Phone Number ID** and generate a
   permanent **System User access token** (not the 24h test token) once the
   app passes Business Verification.
4. Under WhatsApp → Message Templates, submit the three templates this code
   sends. All three are plain `sendWhatsAppMessage({ to, template, params })`
   calls in `server/lib/whatsapp.js` and its callers — the `params` array
   fills the template's `{{N}}` placeholders in order.

   **`job_awarded_pickup_details`** — sent the moment a driver is bound to a
   job (`services/driver-assignment.service.js`'s `bindDriverToJob()`, used
   by both the web dashboard's driver-assignment field and the WhatsApp
   trip-offer "Accept" reply below).
   **Category:** Utility
   **Body:** `Hi {{1}}, you're assigned to pickup {{2}} at {{3}}. Reply here for gate pass details.`
   (`{{1}}` = driver name, `{{2}}` = job code, `{{3}}` = pickup terminal.)

   **`delivery_confirmation_prompt`** — the fallback for the delivery-check
   bot flow (see the interactive-buttons section below) when the driver's
   24h session window is closed, so a template is the only thing Meta will
   let through. Sent from `sendDeliveryConfirmationPrompt()` in
   `server/lib/whatsapp.js`.
   **Category:** Utility
   **Body:** `{{1}}: have you delivered this load? Reply Delivered, Delayed, or Issue.`
   (`{{1}}` = job code. Mirrors the interactive-buttons prompt's wording —
   Meta templates can't carry actual tappable buttons, so the body spells
   out the three expected replies as free text instead.)

   **`trip_offer_blocked`** — sent when a `DRIVER_ASSOCIATE` accepts a trip
   offer over WhatsApp but the compliance engine (`server/lib/compliance.js`)
   rejects the assignment (expired docs, private plates, etc. — the same
   gate every other dispatch decision goes through). Sent from
   `handleTripOfferResponse()` in `server/routes/whatsapp.routes.js`; the
   carrier also gets an in-app notification with the specific blocker(s), so
   this template intentionally stays generic.
   **Category:** Utility
   **Body:** `{{1}}: this trip couldn't be assigned to you — a compliance check failed. Your dispatcher has the details.`
   (`{{1}}` = job code.)

   **`trip_offer_new`** — the fallback for the trip-offer bot flow (see
   below) when the driver's 24h session is closed. Sent from
   `sendTripOfferPrompt()` in `server/lib/whatsapp.js`.
   **Category:** Utility
   **Body:** `New trip: {{1}}, {{2}} → {{3}}. Reply Accept or Decline.`
   (`{{1}}` = job code, `{{2}}` = pickup terminal, `{{3}}` = delivery area.)

5. Once approved, set on the server:

   | Env var | Value |
   |---|---|
   | `WHATSAPP_ACCESS_TOKEN` | the permanent System User token from step 3 |
   | `WHATSAPP_PHONE_NUMBER_ID` | the Phone Number ID from step 3 |

   `server/lib/whatsapp.js` checks for both and only ever calls the real API
   once they're set — until then every call safely logs an intent and
   returns `{ sent: false, reason: 'not_configured' }`, and the existing
   in-app notification still fires regardless (see `notify()` in
   `server/lib/helpers.js`).

## Two-way bot flows (interactive buttons, not templates)

Two flows send Meta **interactive button** messages instead of templates —
these need no separate Meta template review (any approved WABA can send
them), but they only work within a contact's 24h customer-service session
(opened by *their* last inbound message, tracked in the `whatsapp_sessions`
table and updated on every webhook delivery) — outside that window Meta
rejects them outright. `isSessionOpen()`/`recordInboundSession()` in
`server/lib/whatsapp.js` key that table on the same last-9-digits
comparison every phone match in this codebase uses (stored numbers exist
in a mix of local/E.164/plus-prefixed formats; Meta's webhook always
delivers bare E.164 digits) — a previous version keyed them on whatever
raw format the caller happened to pass in, so a session could never
actually be found "open" for a real driver phone and this flow silently
always fell back to the template.

- **Delivery check** (`sendDeliveryConfirmationPrompt()`) — buttons
  `Delivered` / `Delayed` / `Issue`. If the session is open, sends the
  interactive prompt; if not, falls back to the `delivery_confirmation_prompt`
  template above instead of silently failing. Inbound replies are handled in
  `server/routes/whatsapp.routes.js`'s button-reply branch:
  - `DELIVERED` calls the same `confirmDelivery()` path as the web
    dashboard's POD upload.
  - `ISSUE` calls the same `fileDispute()` path as the web dispute form —
    escrow freezes and admins are notified, same as any other dispute.
  - `DELAYED` records a `DELAY_REPORTED` shipment event and notifies the
    shipper immediately; there's no distinct "delayed" job status to
    transition to, so this is a notification, not a state change.
- **Trip offer** (`sendTripOfferPrompt()`, called from
  `POST /api/jobs/:id/trip-offer` in `server/routes/job-lifecycle.routes.js`)
  — buttons `Accept` / `Decline`, sent when a carrier pushes a job to a
  `DRIVER_ASSOCIATE` pool driver. Same open/closed-session fallback as the
  delivery check: if the session is open, sends the interactive prompt; if
  not, falls back to the `trip_offer_new` template above. (This used to go
  straight to the interactive send with no fallback at all — if the pool
  driver's session was closed, the common case for a driver not currently
  mid-conversation, Meta silently rejected it and the driver never saw the
  offer.)

## Which job a reply lands on

An inbound message doesn't carry a job ID — only a phone number. Matching
that phone to the right job (`resolveSender()` in
`server/routes/whatsapp.routes.js`) prefers, in order: (1) the job whose
trip offer is still `PENDING` for that driver, (2) whichever job the phone
is *currently* bound to via `assigned_driver_phone`/`assigned_driver_id`
and still `AWARDED`/`PICKED_UP`/`IN_TRANSIT`, (3) the shipper/carrier
profile's most recently updated job.

Case (2) can match more than one active job at once — a driver reassigned
to a second load while the first is still awaiting a reply. A driver phone
can be bound to two AWARDED/IN_TRANSIT jobs simultaneously; picking
"whichever was updated most recently" would misroute a reply if the second
job's assignment happens after the first sent its delivery-confirmation
prompt, even though the reply is clearly answering the first. So (2) is
pinned instead to whichever job's *interactive-button* prompt — delivery
check or trip offer, the only two sends that actually invite a reply — last
went out to that phone (`whatsapp_sessions.last_outbound_job_id`, set by
`recordOutboundJobContext()` in `server/lib/whatsapp.js`). A purely
informational send (e.g. the pickup-details template on plain assignment)
never moves this pin, so assigning a driver to a second job doesn't hijack
an in-progress delivery-confirmation exchange on the first.

## Extending beyond what's shipped here

Add more send points the same way the award handler does it — call
`notifyDriverAsync({ to, template, params })` from `server/lib/whatsapp.js`
at the next moment that matters (POD reminder, demurrage alert), and submit
that template through the same Meta review process above. The SMS fallback
tier (per STRATEGY.md's WhatsApp → SMS → in-app order) is not built —
that's the next piece once WhatsApp is live and its failure rate is known.
