# Deployment & operations notes

## ⚠️ Action needed: drop ticket prices to ₦100 for testing

Run this in the D1 database's **Console** tab to set every seat tier on the
existing sample matches to ₦100 (10000 kobo) while testing real payments:

```sql
UPDATE events SET vip_price_kobo = 10000, premium_price_kobo = 10000, regular_price_kobo = 10000;
```

Raise these back to real prices the same way once you're ready.

## ⚠️ Action needed: two new tables + one new secret

Two features were added that need setup on the already-live database and
Pages project before they'll work: real payment for in-seat food orders, and
real member login/signup.

**1. Add the new tables.** In the D1 database's **Console** tab, re-paste
and run the whole updated `schema.sql` -- every statement in it uses
`IF NOT EXISTS`, so re-running it against a database that already has the
events/orders/tickets tables only creates the missing ones (`food_orders`,
`members`, and `pageviews` for the `/admin/analytics` visitor dashboard).

**2. Add a new secret.** Member login sessions are signed with a secret the
same way ticket QR codes are. In **Settings → Variables and secrets** for
the Production environment, add:

| Variable | Value |
|---|---|
| `SESSION_SECRET` | Any long random string (e.g. generate one at [1password.com/password-generator](https://1password.com/password-generator/) or similar, 32+ characters) -- mark it Encrypt |

Then trigger a fresh deployment (a new commit, not "Retry" on an old one --
see the note further down about why retrying doesn't pick up new config).

## All Cloudflare variables and secrets (complete list)

Set in **Cloudflare → Workers & Pages → the project → Settings → Variables and
Secrets** (Production). Mark keys and codes as **secret**. Never put any of
these in git.

| Variable | Needed for | Notes |
|---|---|---|
| `DB` (D1 binding) | Everything | Already bound (see below). |
| `ADMIN_CODE` | Owner sign-in to /admin | Long and private; staff use their own logins. |
| `SESSION_SECRET` | Fan and staff sessions, ticket QR codes | Long random value. |
| `PAYSTACK_SECRET_KEY` | Tickets, membership, shirts, food | Test key (`sk_test_`) while testing, then the live key. |
| `RESEND_API_KEY` | All emails | From Resend → API Keys. |
| `RESEND_FROM` | Ticket, food and general emails | e.g. `Lobi Stars FC <noreply@lobistarsfc.com>`. |
| `FAN_EMAIL_FROM` | Fan account / reminder emails (optional) | Falls back to `RESEND_FROM`. |
| `NEWSLETTER_FROM` | The weekly newsletter (optional) | e.g. `Lobi Stars FC <news@lobistarsfc.com>`; falls back to `RESEND_FROM`. |
| `INBOX_FROM_EMAIL` | Inbox replies | e.g. `info@lobistarsfc.com`; staff first names are added ("Ade from Lobi Stars FC"). |
| `INBOX_REPLY_DOMAIN` | Fans' replies into the Inbox | e.g. `reply.lobistarsfc.com` (needs its MX record). |
| `INBOX_INBOUND_KEY` | Fans' replies into the Inbox | Long random secret, also in the provider's webhook URL `/api/inbox/inbound?key=…`. |
| `TURNSTILE_SECRET_KEY` | Human check on sign-up and enquiry forms | Site key goes in `src/data/fan-settings.json`. |
| `STAFF_SCAN_CODE` | Ticket scanner at /scan | Short PIN for gate staff. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Food order phone notifications and Kitchen Screen push | See "Kitchen Order Alerts". |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_KITCHEN_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` | Telegram kitchen group alerts and the Accept button | See "Kitchen Order Alerts". |
| `CRON_SECRET` | Repeat kitchen alerts (cron Worker) | Same value on the cron Worker. |
| `TERMII_API_KEY`, `TERMII_SENDER_ID` | Food order SMS / WhatsApp (optional) | |
| `PARTNER_ORIGIN_STREAM_URL` | Lobi Stars FC Live commentary | Server-only; see COMMENTARY-STREAM-SETUP.md. |
| `COMMENTARY_BRAND_NAME` | Commentary player name (optional) | |
| `ANALYTICS_SALT` | Visitor analytics (optional) | Falls back to `SESSION_SECRET`. |

**Local testing only, never in production:** `PAYSTACK_FAKE=1` (pretend
payments) and `FANS_DEV_LINKS=1` (shows email links and counts Inbox replies
as sent without an email service).

### Local test server and demo data

```
npm run build
npx wrangler pages dev dist --ip 127.0.0.1 --port 8833 --binding FANS_DEV_LINKS=1 \
  SESSION_SECRET=local-test-secret ADMIN_CODE=<local code> PAYSTACK_SECRET_KEY=sk_test_local PAYSTACK_FAKE=1 \
  INBOX_INBOUND_KEY=test-inbound INBOX_REPLY_DOMAIN=reply.lobistarsfc.com
BASE=http://127.0.0.1:8833 ADMIN_CODE=<local code> npm run seed:local   # demo messages and contacts
BASE=http://127.0.0.1:8833 ADMIN_CODE=<local code> npm test             # all automated tests
```

`seed:local` refuses to run against anything except 127.0.0.1 / localhost.

## Kitchen Order Alerts (Kitchen Screen push + Telegram, free)

When a food order becomes **PAID** (Paystack confirmed, or staff press
"Payment received" on a WhatsApp order) the kitchen is alerted once
(`kitchen_alerted_at` is claimed in one UPDATE, so it can never send twice):
an encrypted **Web Push** to every Kitchen Screen device and a message in the
**Telegram kitchen group** with an **✅ Accept** button. Until someone accepts
(Kitchen Screen, live board or Telegram) it is re-alerted every N minutes, up
to a maximum (Admin › Commerce › Food: Kitchen Alerts). Tickets never contain
phone numbers, totals or payment details. No SMS or paid services.

Code: `functions/api/_lib/kitchenNotify.js` (tickets, notifyKitchen, repeats,
Telegram), `functions/api/_lib/webPush.js` (RFC 8291 aes128gcm + RFC 8292
VAPID with Web Crypto; no npm library; checked against the RFC 8291 example in
`tests/web-push.test.mjs`), `functions/api/admin/kitchen/*` (Kitchen Screen
API, staff login, role Kitchen or Commerce), `functions/api/telegram/webhook.js`
(public, secret header), `functions/api/internal/kitchen-repeat.js` (cron),
`workers/kitchen-cron/` (the cron Worker), `src/pages/admin/kitchen.astro`
(the Kitchen Screen, its own manifest `public/kitchen.webmanifest`),
`public/admin-sw.js` (push → notification + refresh the screen). Statuses:
PAID → **ACCEPTED** → PREPARING → OUT_FOR_DELIVERY (ready) → DELIVERED.

### 1. Secrets (Cloudflare Pages → Settings → Variables and Secrets)
| Name | What |
|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Push keys. Make them once: `npx web-push generate-vapid-keys` (only to generate; not used at runtime). Same keys as the food phone alerts. |
| `VAPID_SUBJECT` | `mailto:info@lobistarsfc.com` |
| `TELEGRAM_BOT_TOKEN` | From **@BotFather** (`/newbot`). |
| `TELEGRAM_KITCHEN_CHAT_ID` | The kitchen group's id (negative number, e.g. `-1001234567890`). Add the bot to the group, send a message, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`. |
| `TELEGRAM_WEBHOOK_SECRET` | Any long random text (letters, numbers, `_`, `-`). |
| `CRON_SECRET` | Any long random text; the same value goes on the cron Worker. |

### 2. Telegram webhook (once)
```
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/set-telegram-webhook.mjs
```
(PowerShell: `$env:TELEGRAM_BOT_TOKEN="..."; $env:TELEGRAM_WEBHOOK_SECRET="..."; node scripts/set-telegram-webhook.mjs`)
It points Telegram at `https://lobistarsfc.com/api/telegram/webhook` for button presses only.
In the group, the bot needs permission to send messages (BotFather → `/setprivacy` can stay enabled; buttons still work).

### 3. Re-alert cron Worker (free Cron Trigger, every minute)
```
cd workers/kitchen-cron
npx wrangler deploy
npx wrangler secret put CRON_SECRET     # paste the same CRON_SECRET as on Pages
```
Without it, repeats still happen while a Kitchen Screen is open (each refresh checks), but not when every screen is closed.

### 4. Kitchen devices
On the kitchen phone/tablet: log in with a staff account (role **Kitchen**:
it only opens the Kitchen Screen), open **https://lobistarsfc.com/admin/kitchen/**,
name the device and tap **Turn on kitchen alerts** (allows notifications,
keeps the screen awake, turns the sound on). Install it to the home screen
(Android: browser menu → Install app; iPhone: Share → Add to Home Screen, then
open it from the icon and tap the button again). Check with **Send test alert**
on Admin › Food: Kitchen Alerts.

### Troubleshooting
- **No sound:** tap the screen once after opening it (browsers need a tap
  before playing sound); check 🔇 Mute isn't on and the device volume is up.
- **No push on iPhone:** iOS 16.4 or newer, the page must be opened from the
  Home Screen icon, and notifications allowed in iPhone Settings → Notifications
  → Lobi Stars Kitchen. Low Power Mode can delay them.
- **No push at all:** VAPID keys set? Device listed as Active on Kitchen Alerts?
  "Stopped" means the browser unsubscribed: open the Kitchen Screen and turn
  alerts on again. The alert log shows each failure.
- **Telegram button does nothing:** run the webhook script again, check
  `TELEGRAM_WEBHOOK_SECRET` matches, and that the message came from the group
  in `TELEGRAM_KITCHEN_CHAT_ID`. `getWebhookInfo` (printed by the script) shows
  Telegram's last error.
- **Repeats stop when screens are closed:** deploy the cron Worker (step 3).

## Food ordering (Paystack and Order on WhatsApp)

- Public: `/food` (menu from `GET /api/food/menu`), Paystack checkout
  `POST /api/food-checkout`, WhatsApp checkout `POST /api/food/whatsapp-order`
  (saves the order as `AWAITING_WHATSAPP` with server prices and returns the
  `wa.me` link and message), order status `GET /api/food/order?ref=&t=`.
- Admin: `/admin/food-orders/` (list), `/admin/food-orders/live/` (live board,
  WhatsApp box, open/closed switch), `/admin/food-orders/menu/` (menu, prices,
  photos, sold out, Ordering settings incl. WhatsApp number, pickup points,
  bank details and reply templates). APIs under `/api/admin/food-*` use the
  site's own staff login and roles (Commerce).
- Data: D1 tables `food_items`, `food_categories`, `food_orders` (columns
  `channel` paystack/whatsapp, `fulfilment` seat/pickup, `pickup_point`),
  `food_settings`. Tables and columns are created automatically on first use;
  there are no manual migrations.
- Optional settings: `TURNSTILE_SECRET_KEY` (+ site key in
  `src/data/fan-settings.json`) adds the human check to WhatsApp orders;
  `RESEND_API_KEY` for staff email alerts; VAPID keys for phone alerts.
- Local: `npm run build` then the `wrangler pages dev dist …` command below.

## Site (Astro + Cloudflare Pages)

Already live on `main`. Cloudflare Pages build settings (already configured):

- **Framework preset:** Astro
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Root directory:** `/`

```
npm install
npm run dev      # local preview at http://localhost:4321
npm run build    # production build, output in dist/
npm run preview  # serve the production build locally
```

## What's editable from `/admin` without touching code

| Section | Where it shows | CMS collection |
|---|---|---|
| Hero background slides | Homepage hero | Homepage Hero Slides |
| Sponsor logos | Top bar | Sponsor Logos |
| Club management & staff | Homepage "Club Management" | Club Management & Staff |
| Club shop products | Homepage "Club Shop" | Club Shop / Merchandise |
| News articles | Homepage teaser + `/news` | News Articles |
| Player profiles | `/squad` | Squad / Players |
| Fixtures & results | `/fixtures` | Fixtures & Results |
| Match photo albums | `/gallery` | Gallery Photos |

**Not yet wired to the CMS:** the About/Archives section's history photo and
Media Vault photos (low-churn, straightforward to convert the same way later).

CMS sign-in is GitHub-account-based (personal access token), not email/
password — only accounts with write access to this repo can sign in at
`/admin`.

---

## Ticketing system setup (Cloudflare D1 + Paystack + Resend)

This is new infrastructure, separate from the static site. You'll need
accounts with **Cloudflare** (you have this), **Paystack**, and **Resend**
(for sending ticket emails). Everything below is done through the Cloudflare
dashboard directly — no `wrangler` CLI required.

### 1. Create the D1 database and apply the schema

Cloudflare dashboard → **Storage & Databases → D1 SQL Database → Create
Database**, name it exactly `lobi-stars-tickets`. Open its **Console** tab and
paste in the contents of `schema.sql` (repo root), then Execute. That creates
the `events`, `orders`, and `tickets` tables and seeds two placeholder
fixtures so `/api/events` isn't empty at first.

To replace the placeholders with real fixtures, run in the same console
(dates in ISO 8601 UTC, prices in **kobo**, i.e. ₦5,000 = `500000`):

```sql
DELETE FROM events WHERE id LIKE 'evt-sample-%';

INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo)
VALUES ('evt-2026-08-15', 'Lobi Stars', 'Kano Pillars', 'NPFL', '2026-08-15T15:00:00Z', 'Aper Aku Stadium, Makurdi', 500000, 250000, 100000);
```

Or manage matches from the built-in UI at **`/admin/matches`** (enter the
`ADMIN_CODE` passcode) — it can create, edit, hide/show and delete fixtures
without touching SQL. A match that already has orders can't be deleted; hide
it instead. The D1 Console remains available for bulk edits.

### 2. Bind the D1 database to the Pages project

Because `wrangler.toml` exists in this repo, Cloudflare Pages manages
bindings from that file instead of the dashboard -- the dashboard's own
Settings → Functions → Bindings UI is disabled for this project (it'll
show "Bindings for this project are being managed through wrangler.toml").

The binding is already declared in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "lobi-stars-tickets"
database_id = "d91166bc-53f5-4363-a44c-0f41ba01a1d6"
```

If you ever recreate the D1 database, get its real ID from the database's
own Settings page (or the URL when viewing it) and update `database_id`
here -- a placeholder or wrong ID fails the entire deployment, not just
the ticketing endpoints.

### 3. Set secrets

In **Settings → Environment variables** (mark each as "Encrypt" / secret, not
plaintext), for the **Production** environment:

| Variable | Value |
|---|---|
| `PAYSTACK_SECRET_KEY` | From Paystack dashboard → Settings → API Keys & Webhooks |
| `RESEND_API_KEY` | From Resend dashboard → API Keys |
| `RESEND_FROM` | `Lobi Stars FC <info@lobistarsfc.com>` (domain must be verified in Resend) |
| `STAFF_SCAN_CODE` | A short PIN you choose — gate staff enter this at `/scan` before scanning |
| `ADMIN_CODE` | A separate passcode for the staff tools at `/admin/matches` (manage ticketed fixtures) and `/admin/analytics` (visitor dashboard). Keep it different from `STAFF_SCAN_CODE`. |

### 4. Register the Paystack webhook

Paystack dashboard → Settings → API Keys & Webhooks → Webhook URL:

```
https://lobistarsfc.com/api/paystack-webhook
```

This is the source of truth for marking orders paid and issuing tickets —
the `/tickets/success` page also double-checks directly with Paystack as a
fallback, but the webhook is what makes it reliable if a buyer closes their
browser mid-redirect.

### 5. Test it end to end

1. Go to `/#tickets` on the live site, pick a match, seat tier, and enter
   your own email — you'll land on Paystack's real checkout (use a
   [Paystack test card](https://paystack.com/docs/payments/test-payments/)
   if your account is still in test mode).
2. After paying, you should land on `/tickets/success` with QR codes, and
   receive the same by email.
3. Go to `/scan`, enter the `STAFF_SCAN_CODE`, and scan one of the QR codes
   (camera) or type the ticket ID and press Enter (simulating a physical
   barcode scanner). It should show **ADMIT**. Scanning the same ticket
   again should show **DO NOT ADMIT — already used**.

### How gate scanning works in practice

`/scan` works two ways, both calling the same `/api/validate-ticket`
endpoint:
- **Phone/tablet camera** — tap "Use Camera Instead", point at the QR code.
- **Physical USB/Bluetooth barcode scanner** — these emulate a keyboard, so
  plug one into any laptop/tablet open to `/scan`, and scanning types the
  ticket code into the input field and submits it automatically. No app or
  special integration needed.

Each ticket can only be scanned once — a database-level check prevents two
doors admitting the same ticket at the same moment.
