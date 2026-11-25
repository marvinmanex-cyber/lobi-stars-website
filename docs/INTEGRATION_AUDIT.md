# Ticket sales: audit before connecting the ticketing engine

Written 25 Nov 2026 before any integration code. "The ticketing engine" (Partner API) is
the separate system that will hold orders, payments, tickets and scans. This file
describes what the club site does **today** (the `legacy` backend), so nothing fans see
changes when the `engine` backend is switched on. The contract is in
[INTEGRATION_CONTRACT.md](INTEGRATION_CONTRACT.md).

## 1. Where everything lives today

| Part | Files | What it does |
|---|---|---|
| Match list | `functions/api/tickets/catalogue.js`, `_lib/ticketShop.js` (`catalogue`, `decorateMatches`), `_lib/tickets/rules.js` (`ticketState`) | Every Lobi Stars **home** match with its stands (VIP Sitting / Grand Stand / Popular Stand = tiers `VIP` / `Premium` / `Regular`), prices, seats left and state (`on_sale`, `not_on_sale`, `sold_out`, `closed`). Prices and capacities come from the `events` table (price columns) and `league_ticket_settings` (on sale, open/close times, capacity, stand mode paid/free/soon, amount off, max per order). |
| Live price | `functions/api/tickets/price.js` | The order summary on /tickets: `priceBasket` + discounts (`ticketDiscounts.priceWithDiscounts`). Nothing held. |
| Checkout | `functions/api/tickets/basket.js` (POST) | One payment for one or more matches ("single", "next 3", "all" are just selections in the page). Server prices the basket, applies discounts (group, early bird, family bundle, per-stand amount off), Star Points (Rewards), members' priority window, free-stand limits; holds seats atomically in `orders` (pending, 30-minute hold); creates the basket row in `league_ticket_orders` (reference `LSBAS-…`); starts Paystack (`_lib/paystackClient.initialize`) on the **club's** Paystack account. Free baskets (₦0) are issued at once. Amounts in kobo; any browser price is ignored; `expectedTotalKobo` mismatch → 409 `repriced`. |
| Season tickets | `functions/api/season-tickets/*`, `_lib/seasonTickets.js` | Separate flow: one `LS-SZN-…` pass per person, scanned once per home match (`season_pass_scans`). |
| Paystack webhook | `functions/api/paystack-webhook.js` | Club Paystack account. `charge.success` for `LSBAS-…` → checks amount + currency + locked discount → `fulfilBasket`. Also food, membership, shirts, refunds/disputes (points reversal). |
| Issuing tickets | `_lib/ticketShop.fulfilBasket`, `_lib/fulfillOrder.js` | Marks the basket and lines paid, creates one `tickets` row per seat (`LS-TIX-` + 12 characters), sends ONE email. Safe to repeat. |
| Return page | `src/pages/tickets/success.astro` + GET `/api/tickets/basket?reference=` | If the webhook has not arrived, verifies with Paystack and fulfils; then shows the tickets per match (`basketTickets`). |
| QR codes | `functions/api/qr/[id].js` (PNG), `_lib/ticketPdf.js` (PDF), `success.astro` (canvas download), `src/components/tickets/TicketsView.astro` | Every ticket QR today encodes `https://lobistarsfc.com/verify/<ticket id>`. |
| Emails | `_lib/ticketShop.sendBasketEmail`, `_lib/email.js` (`ticketBlocksHtml`, `sendEmail` via Resend) | From `noreply@lobistarsfc.com` (club domain), Reply-To info@. One QR image per ticket + PDF attachment. No SMS for tickets. |
| Find my tickets | `functions/api/tickets/lookup.js`, `/tickets/lookup` page | Email + order reference → the tickets. Same 404 message for any miss; rate-limited (5 per 15 min per address, 20 per email per day). |
| Resend / PDF | `functions/api/tickets/resend.js`, `functions/api/tickets/pdf.js` | Re-send the email; download the PDF. |
| Gate scanning | Lobi Gate Control: `functions/api/gate-control/[[route]].js`, `_lib/gateCheck.js`, `_lib/gateTicketNumber.js`, `_lib/gateExtras.js` (offline), `_lib/gateMatchday.js` | Camera / typed number / offline. Results: admitted, valid (look up), used, wrong_match, void, unpaid, fake, not_lobi, bad_number, readmitted, banned, gates_closed, stand_full, wrong_gate, passes, practice. Check-in is one atomic `UPDATE … WHERE status = 'valid'`. Offline: the phone downloads today's ticket list (`GET offline`) and sends queued check-ins (`POST sync`); a ticket already used elsewhere is reported as a double entry. Every attempt is recorded in `gc_scans`. |
| Admin roles | `_lib/adminRoles.js`, `functions/api/admin/_middleware.js` | Every admin API is checked on the server; a path not in the rules is **Super Admin only**. Super Admins come from `SUPER_ADMIN_EMAILS`. |

Tables involved: `events`, `league_ticket_settings`, `league_ticket_orders` (baskets), `orders` (one row per match + stand line, at most 10 tickets), `tickets`, `season_orders`, `season_passes`, `season_pass_scans`, `gc_scans`, `settings`.

## 2. What the engine contract covers, and what it does not

| Today's feature | Contract | Decision in this build |
|---|---|---|
| Stands, prices, seats left, sale open/close | `GET /events` | Engine values are fed into the same `ticketState` rules, so the page looks the same. |
| Several matches in one payment | `POST /orders` items | Yes. |
| Price changed while paying | Engine prices the order | Engine total ≠ total shown → the existing 409 "price has changed" message. |
| Discounts (group, early bird, family bundle) | Contract 1.1 `club_adjustments` | Worked out here as today (on the engine's prices) and sent as a club discount line. A per-stand "amount off" set here does not apply in engine mode (set the price in the engine instead). |
| Child / family tickets | Contract 1.1 `ticket_type` | Each ticket is sent as adult or child; the gate shows ADMIT CHILD as today. |
| Star Points (Rewards) | Contract 1.1 `club_adjustments` (kind `points`) | Held, confirmed and released here as today; sent as a club points line. Points are earned and reversed here as today. |
| Free stands (₦0) | Engine price 0 | Supported if the engine marks the order paid at once; otherwise refused. |
| Members' priority window | Local rule | Kept (checked before the order is sent). |
| Season tickets (one pass per person) | Contract 1.1 `GET /season` + `season_bundle` | One pass token per person, valid once per home match, as today. |
| Seat holds | Engine (`expires_at`) | Engine holds; no local capacity hold in engine mode. |
| Refunds, voids, reissues | Callbacks | Applied to the local display copy. |
| Banned list, gates closed, stand full, wrong gate | Local gate rules | Kept, checked before the engine scan. |

## 3. Things to fix or confirm (found in the audit)

1. **Who receives the money.** Today the club's own Paystack account takes ticket payments. In engine mode the company that runs the engine takes them. Terms, Privacy and every receipt must name that company: the new Super Admin setting `legal_processor_name`. Engine mode **will not switch on** until it is set.
2. No existing copy says fan payments go "directly to the club" (checked: Terms "Card payments are processed securely by Paystack", Privacy "Card payments are handled by Paystack"). The new line is added next to these.
3. No ticket SMS exists today, so none is added.
4. There is no GitHub Actions CI in this repo: the Cloudflare build (`npm run build`) runs the build tests, so the no-branding-leak test is added there.
5. There is no queue (Cloudflare Queues) on this account: callback emails are sent with `waitUntil` after the reply, and retried on the next callback, poll or "Resend email" if they fail (the same pattern as today).

## 4. Data flow (for the Privacy Policy)

Fan → club site (name, email, phone, matches, stands) → club server → ticketing engine (the same fields, server to server, signed) → Paystack (the engine's account) → engine → signed callback → club site stores a display copy (order, buyer, tickets, status) and sends the tickets by email from the club domain. Card details never touch the club site. Deletion requests: the club deletes its copy (existing data-protection tools) and asks the engine operator to delete theirs.
