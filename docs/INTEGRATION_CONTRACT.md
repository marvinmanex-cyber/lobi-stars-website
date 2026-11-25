# Shared contract: club site ↔ ticketing engine (Partner API)

The source of truth for the API, signatures and callbacks between this site and
"the ticketing engine". The matching repository holds an identical copy. Any change is
made in both. Names used here: `TICKETING_API_BASE_URL`, `TICKETING_API_KEY`,
`TICKETING_API_SECRET`, `TICKETING_CALLBACK_SECRET` (environment variables, Cloudflare
secrets, never in the code).

## C1. Conventions
- JSON over HTTPS only. UTF-8. Timestamps in ISO 8601 UTC (`2026-12-05T14:30:00Z`).
- Money is always an **integer in kobo** with `"currency":"NGN"`.
- IDs are opaque strings. Phone numbers are normalised to `+234XXXXXXXXXX`.
- Errors: HTTP status plus `{"error":{"code":"snake_case_code","message":"short neutral text"}}`. Messages never reveal internals.
- All POST requests need an `Idempotency-Key` header (UUID). Repeating the same key returns the original result, never a duplicate.

## C2. Authentication (requests in both directions)
Headers on every request:
- `X-Partner-Key`: public key id of the caller.
- `X-Timestamp`: unix seconds.
- `X-Nonce`: random string, at least 16 characters.
- `X-Signature`: lowercase hex of `HMAC-SHA256(secret, timestamp + "." + nonce + "." + METHOD + "." + path_with_query + "." + sha256_hex(raw_body))`. For an empty body use the sha256 of the empty string.

Receiver rules: reject if the timestamp differs from server time by more than 300 seconds, reject a nonce seen in the last 10 minutes, compare signatures in constant time, return `401` with code `invalid_signature` on failure. Two active secrets are accepted at once to allow key rotation. There are two separate secrets: one for calls to the ticketing engine, one for callbacks to the club site.

**Clarifications used by this site** (to be confirmed in the matching repository):
- `METHOD` is upper case (`GET`, `POST`).
- `path_with_query` is the request path from the root of the host, including the
  `/api/partner/v1` prefix and the query string exactly as sent, e.g.
  `/api/partner/v1/orders?client_reference=LSBAS-ABC123DEF456`. For the callback it is
  `/internal/ticketing/callback`.
- Rotation on this site: callbacks are accepted with `TICKETING_CALLBACK_SECRET` or
  `TICKETING_CALLBACK_SECRET_PREVIOUS`; calls to the engine are signed with
  `TICKETING_API_SECRET`.

## C3. Ticketing engine endpoints (`{TICKETING_API_BASE_URL}/api/partner/v1`)
1. `GET /events` returns upcoming home matches:
   `{"events":[{"event_id","name","kickoff_at","venue","sale_open","sale_close","stands":[{"stand_id","name","price_kobo","available"}]}]}`
2. `POST /orders` creates an order.
   Request: `{"client_reference":"LS-20261205-0001","season_bundle":false,"items":[{"event_id","stand_id","quantity":1}],"buyer":{"name","email","phone"},"return_url":"https://…"}`
   Response `201`: `{"order_id","client_reference","status":"pending_payment","amount_total_kobo","currency":"NGN","lines":[{"event_id","stand_id","quantity","unit_price_kobo","line_total_kobo"}],"payment":{"provider":"paystack","reference","access_code","authorization_url"},"expires_at"}`
   The engine prices the order from its own price list. Any price in the request is ignored.
3. `GET /orders/{order_id}` and `GET /orders?client_reference=…` return `{"order_id","client_reference","status","amount_total_kobo","paid_at","tickets":[…]}`. Status values: `pending_payment`, `paid`, `failed`, `expired`, `refunded`, `partially_refunded`. `tickets` is present only when `paid`.
4. Ticket object: `{"ticket_id","token","order_id","event_id","event_name","kickoff_at","venue","stand_id","stand_name","status"}` with status `valid`, `scanned`, or `void`. The `token` is an opaque signed string (base32, 24 to 32 characters) and is the **only** thing encoded in the QR code. No URL, no brand name.
5. `POST /tickets/lookup` with `{"email","order_reference"}` returns the buyer's tickets. Uniform response and timing whether or not a match exists (no account enumeration).
   *This site reads the response as `{"tickets":[…C3.4…]}` (an empty list when nothing matches).*
6. `POST /tickets/validate` with `{"token"}` returns `{"valid":true|false,"ticket":{…},"reason":"…"}` without changing state.
7. `POST /tickets/scan` with `{"token","scan_id","gate_id","device_id","scanned_at"}` returns `{"result":"admitted"|"already_scanned"|"invalid"|"wrong_match"|"void","first_scanned_at":"…","ticket":{…}}`. `scan_id` is a UUID used as the idempotency key.
8. `POST /tickets/scan/batch` with `{"scans":[{…as above…}]}` for offline sync. Conflicts are resolved by the earliest `scanned_at`; later duplicates are recorded as `already_scanned`.
   *This site reads the response as `{"results":[{"scan_id", …as C3.7 response…}]}`.*

## C4. Callback to the club site (`{CLUB_BASE_URL}/internal/ticketing/callback`)
The engine sends a signed `POST` with:
`{"event_id":"uuid","type":"order.paid|order.failed|order.expired|order.refunded|ticket.voided|ticket.reissued","occurred_at":"…","order":{…as C3.3…},"tickets":[…as C3.4…]}`
`event_id` is the idempotency key. The club site replies `200` quickly once stored, and `5xx` if it must be retried. The engine retries with exponential backoff for 24 hours and logs every attempt.

## C5. Payment flow
1. The club site calls `POST /orders`.
2. The fan pays with Paystack using the returned `access_code` or `authorization_url`. The Paystack account belongs to the company running the ticketing engine.
3. Paystack sends its webhook to the engine only. The engine verifies the Paystack signature, checks amount and currency against the order, marks it paid and issues tickets.
4. The engine sends `order.paid` to the club site (C4).
5. If the callback is missed, the club site can poll `GET /orders/{order_id}` from the return page.

## C6. White-label rules (shared)
- The club site calls the engine only from its **server**, never from the browser.
- For a white-label partner, the engine sends **no fan-facing email or SMS**. The club site sends all tickets, receipts and reminders under its own branding from its own domain.
- No fan-facing output (pages, tickets, PDFs, QR payloads, emails, SMS, headers, scripts) mentions the ticketing engine's brand or domain.
- **Honesty guardrails:** never say or imply that payment goes directly to the club if it goes to the company. The legal processing entity is named accurately in the Terms, the Privacy Policy and a short receipt footer ("Payments processed by `<legal_processor_name>`"), set in one executive-controlled setting. Do not rename or configure the Paystack business name to misstate who receives the money.

## C7. Version 1.1 additions (25 Nov 2026): club discounts, child tickets, season passes

All additions are optional fields, so a 1.0 engine that ignores them still works for plain
adult match tickets. **Both sides must support them before the club switches over.**

1. **Ticket type.** `POST /orders` items may carry `"ticket_type":"adult"|"child"` (default
   `adult`). Child tickets cost the same as adult tickets on the engine's price list (the
   club's family discount is a club adjustment, below). The engine echoes `ticket_type` in
   `lines` and in every ticket object.
2. **Club adjustments** (discounts and Star Points funded by the club). `POST /orders` may carry
   `"club_adjustments":[{"kind":"discount"|"points","label":"Family bundle","amount_kobo":225000}]`.
   The engine prices the lines from its own list as before (`subtotal_kobo`), subtracts the sum of
   the adjustments and charges `amount_total_kobo = subtotal_kobo − adjustments`. It refuses with
   `400 invalid_adjustment` if an amount is not a positive integer or the adjustments exceed the
   subtotal. The response adds `"subtotal_kobo"` and `"adjustments":[…as sent…]`. The adjustments
   come only from the club's signed server request, never from the browser. On a full refund the
   engine refunds `amount_total_kobo` (what the fan paid); the club reverses its own points.
3. **Season passes.**
   - `GET /season` returns `{"season":"2026/27","sale_open","sale_close","stands":[{"stand_id","name","price_kobo","available"}]}`
     (`404 not_found` when no season pass is on sale).
   - `POST /orders` with `"season_bundle":true` and items `[{"stand_id","quantity","ticket_type"}]`
     (no `event_id`) creates a season order. `lines[].event_id` is `null`.
   - Its tickets have `"kind":"season"`, `"season":"2026/27"`, `"event_id":null`; ordinary match
     tickets have `"kind":"match"`. A season pass token admits once per home match of that season:
     `POST /tickets/scan` answers `admitted` the first time on a home match day, `already_scanned`
     after that, and `wrong_match` when there is no home match of that season that day.

## This site's switches

| Name | Where | Meaning |
|---|---|---|
| `TICKETING_BACKEND` | Cloudflare variable | `legacy` (default) or `engine`. Engine mode only becomes active when the four secrets above are set **and** the Super Admin setting `legal_processor_name` is filled in; otherwise the site stays on `legacy`, and Admin › Tickets shows Super Admins why. |
| `TICKETING_CALLBACK_SECRET_PREVIOUS` | Cloudflare secret (optional) | The old callback secret during a rotation. |
| `legal_processor_name` | Admin › Tickets (Super Admin only) | The legal name of the company that receives ticket payments in engine mode. |
| `ticketing_legacy_import_confirmed` | Admin › Tickets (Super Admin only) | Once the engine has imported the old tickets, old `LS-TIX-…` numbers are checked by the engine too. Until then they are checked locally. |
