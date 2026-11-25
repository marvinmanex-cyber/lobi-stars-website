# Handover for the ticketing engine operator

For the team that runs the ticketing engine (Partner API) which will sell Lobi Stars FC
match tickets and season passes for lobistarsfc.com. The club site's side is built, tested
against a stand-in for the engine, and live but switched off. This page lists what the engine
must do before the club switches over, and the tests both sides run together.

The full contract is [INTEGRATION_CONTRACT.md](INTEGRATION_CONTRACT.md). Where this page and the
contract differ, the contract wins.

## 1. What the engine must support

Version 1.0 (sections C1 to C6):

- [ ] JSON over HTTPS; money as integer kobo with `"currency":"NGN"`; phones as `+234XXXXXXXXXX`.
- [ ] Signed requests both ways (C2): `X-Partner-Key`, `X-Timestamp`, `X-Nonce`, `X-Signature` =
      lowercase hex `HMAC-SHA256(secret, timestamp.nonce.METHOD.path_with_query.sha256_hex(body))`.
      300-second window, nonces remembered for 10 minutes, constant-time comparison, two active
      secrets during a rotation, `401 invalid_signature` on failure.
- [ ] `Idempotency-Key` on every POST: the same key returns the original result.
- [ ] `GET /events`, `POST /orders`, `GET /orders/{id}`, `GET /orders?client_reference=`,
      `POST /tickets/lookup`, `POST /tickets/validate`, `POST /tickets/scan`, `POST /tickets/scan/batch` (C3).
- [ ] The engine prices every order from its own price list and ignores any price in the request.
- [ ] Ticket tokens: base32, 24 to 32 characters; the QR code holds the token and nothing else.
- [ ] Signed callbacks to `https://lobistarsfc.com/internal/ticketing/callback` (C4) for
      `order.paid`, `order.failed`, `order.expired`, `order.refunded`, `ticket.voided`,
      `ticket.reissued`, with `event_id` as the idempotency key; retry with backoff for 24 hours
      on a `5xx` or no answer.
- [ ] The Paystack webhook goes to the engine only; the engine checks amount and currency before
      marking an order paid (C5).
- [ ] **No emails or SMS to fans.** The club site sends every ticket and receipt.
- [ ] No mention of the engine's brand or domain in anything a fan can see: tokens, QR codes,
      payment page text, headers (C6).
- [ ] The Paystack business name is the company's real registered name. The club shows that
      legal name on every receipt and in its Terms and Privacy Policy.

Version 1.1 (section C7), needed for the club's discounts, Star Points, family bundles and season passes:

- [ ] `ticket_type` (`adult` | `child`) on order items, echoed in `lines` and in every ticket.
      Child tickets cost the same as adult tickets on the engine's list.
- [ ] `club_adjustments` on `POST /orders` (`discount` and `points` lines in kobo): charge
      `subtotal_kobo − adjustments`; refuse with `400 invalid_adjustment` when an amount is not a
      positive integer or the total of the adjustments is more than the subtotal; return
      `subtotal_kobo` and `adjustments`.
- [ ] `GET /season` and `season_bundle: true` orders: one pass token per person, `kind: "season"`,
      admitted once per home match of that season; `wrong_match` on a day with no home match.

Three details decided by the club site (please confirm, or tell us what to change):

1. `path_with_query` is the full path from the host root, including `/api/partner/v1` and the
   query string exactly as sent (for the callback: `/internal/ticketing/callback`).
2. `POST /tickets/lookup` answers `{"tickets":[…]}`, an empty list when nothing matches, at the
   same speed either way.
3. `POST /tickets/scan/batch` answers `{"results":[{"scan_id", "result", "first_scanned_at", "ticket"}]}`.

## 2. What the club sends you, and what you send the club

| From the engine to the club (by a secure channel, never email) | From the club to the engine |
|---|---|
| The base URL of the Partner API (https) | The callback URL above |
| The club's key id (`X-Partner-Key`) | The key id the club will check on your callbacks (optional) |
| The secret for the club's calls to you | The legal processor name the club will show fans, for you to confirm |
| The secret for your callbacks to the club | The legacy ticket export (`legacy_import`), once, privately |

## 3. Set-up in the engine before testing

- Every Lobi Stars home match, with the same kick-off time as on lobistarsfc.com (the club matches
  engine matches to its own by kick-off time, within 3 hours).
- Three stands per match. Names or ids must make clear which is which: **VIP Sitting** (or id
  `VIP`), **Grand Stand** (`Premium`), **Popular Stand** (`Regular`). A stand the engine does not
  list shows as "Opening soon" on the club site.
- Sale open and close times per match, and seats available per stand.
- The season pass offer (season, prices per stand, sale dates), if season passes are sold.

## 4. Tests to run together (on a test Paystack account first, then small real amounts)

| # | Test | Expected |
|---|---|---|
| 1 | Club calls `GET /events` | The club's tickets page shows the engine's prices and seats left |
| 2 | Buy 1 VIP ticket and pay | `order.paid` callback, one email from lobistarsfc.com with the QR (token only), the receipt names the processor |
| 3 | Buy, then let the payment expire | `order.expired`; the club's order shows as failed; nothing to scan |
| 4 | Send the same callback twice | The club answers `200` both times and acts once |
| 5 | Send a callback with a wrong signature | `401 invalid_signature` |
| 6 | Family bundle (1 adult, 2 children) with the club's family discount switched on | Order has `club_adjustments` (discount), `ticket_type` child × 2; the engine charges the discounted total |
| 7 | Pay part with Star Points | Order has a `points` adjustment; total reduced by its value |
| 8 | Scan a ticket at the gate | `admitted`; the second scan `already_scanned` |
| 9 | Scan offline on two phones, then reconnect | One batch; the earliest scan wins; the later one is a double entry |
| 10 | Refund an order in the engine | `order.refunded`; the ticket is refused at the gate (cancelled) |
| 11 | Season pass: buy, scan on two match days | One pass; admitted once per match day; `wrong_match` on other days |
| 12 | Engine unreachable during a scan | The club's gate app shows CANNOT VERIFY and admits nobody |
| 13 | "Find my tickets" with right and wrong details | Tickets for the right details; the same "not found" answer for wrong ones |

## 5. Switching over

The club sets `TICKETING_BACKEND=engine` for one match after tests 1 to 13 pass, watches it, then
keeps it on. Setting `TICKETING_BACKEND=legacy` switches back at once; orders already made in the
engine still complete and their tickets still scan. Old club tickets (`LS-TIX-…`) arrive in a
`legacy_import` file whose tokens are the `LS-TIX-…` numbers themselves; the club ticks
"imported" once you confirm they scan.
