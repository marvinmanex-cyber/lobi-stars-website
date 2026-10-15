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
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Food order phone notifications, Kitchen Screen push and fan match alerts | See "Kitchen Order Alerts". |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_KITCHEN_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` | Telegram kitchen group alerts and the Accept button | See "Kitchen Order Alerts". |
| `CRON_SECRET` | Repeat kitchen alerts and scheduled social posts (cron Worker) | Same value on the cron Worker. |
| `TELEGRAM_PUBLIC_BOT_TOKEN`, `TELEGRAM_PUBLIC_CHANNEL` | Share Hub: automatic posts to the club's public Telegram channel | See "Share Hub". |
| `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_TOKEN`, `FACEBOOK_GRAPH_VERSION` | Share Hub: optional automatic posts to the Facebook Page | See "Share Hub". |
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

## Match Day Programme (4-page digital programme, R2 + fan sign-in by email code)

Registered fans read each match's 4-page programme online or download the PDF
at **lobistarsfc.com/programme** (the permanent short link for QR codes).
Staff upload and publish it at **/admin/programmes** (Matchday Operators,
Media and Super Admins).

**How it fits the site.** There is no separate login: fans sign in with a
6-digit code emailed to them, which signs them into their normal fan account
(`members`, cookie `ls_session`, 90 days for programme sign-ins), creating
one if the email is new. Details already known from the newsletter or the fan
database are copied in. Programme readers appear in the Fan Database as source
"Match Day Programme"; fans who tick "Send me club news" also join the one
newsletter list. Tables are created on first use (`ensureProgrammeSchema`,
`functions/api/_lib/programme.js`; columns added to `members` in
`ensureFanSchema`): `programmes`, `programme_pages`, `programme_links`,
`programme_events`, `programme_settings`, `fan_login_codes` (code and IP stored
only as hashes). No migrations folder and no cron job: scheduled programmes go
live when their time comes (checked on each request).

**Code.** `functions/api/_lib/programme.js`, `functions/api/_lib/fanCode.js`,
`functions/api/fan/*` (request / verify / profile / logout / me /
delete-request), `functions/api/programme/*` (current, archive, details, cover,
page images, download, events, link redirects), `functions/api/admin/programmes/*`,
pages `src/pages/programme/{index,read,join}.astro`,
`src/pages/admin/{programmes,programme-preview}.astro`, components in
`src/components/programme/`, offline page cache in `src/pages/sw.js.ts`,
tests `tests/programme.test.mjs`.

### Setup (once)
1. **Create the R2 bucket** (Cloudflare account that runs the site):
   `npx wrangler r2 bucket create lobistars-programmes`
2. **Switch on the binding:** in `wrangler.toml` remove the `# ` in front of the
   three `[[r2_buckets]]` lines (binding `PROGRAMME_BUCKET`), commit and push.
   Do this only after step 1, or the deployment fails.
3. **Secrets:** nothing new. It uses `SESSION_SECRET`, `RESEND_API_KEY` (codes
   can't be emailed without it), and optionally `TURNSTILE_SECRET_KEY` plus the
   site key in `src/data/fan-settings.json`.
4. **Database:** nothing to run; tables appear on first use.
5. Open /admin/programmes: the yellow "File storage is not connected" note
   should be gone. Upload a test programme, preview it, publish it, then check
   /programme on a phone.

### Local testing
```
npm run build
npx wrangler pages dev dist --r2=PROGRAMME_BUCKET --binding FANS_DEV_LINKS=1 SESSION_SECRET=local-test-secret ADMIN_CODE=test-code-123
BASE=http://127.0.0.1:8788 node --test tests/programme.test.mjs
```
Without `RESEND_API_KEY` on localhost the sign-in code is printed in the
wrangler log (and, with `FANS_DEV_LINKS=1` only, returned to the page and shown
in the browser console). The D1 database already has its binding in
`wrangler.toml`, so no `--d1` flag or migration command is needed.

### Preparing the PDF
A4 portrait, **exactly 4 pages**, ideally under 10 MB (25 MB maximum). Export
from the design app as "PDF (print)" with images at about 150 dpi. The admin
page reads the PDF in the browser (pdf.js 4.10.38 from cdn.jsdelivr.net),
blocks anything that isn't 4 pages, warns about landscape pages and files over
10 MB, and makes the page images (1240 px wide, JPEG) and a cover (600 px). The
server checks every file again (PDF signature and size, exactly 4 JPEG pages
under 2 MB each, cover under 500 KB). Each upload is a new version: all files
are stored under a new folder in R2 before the database switches over, then
the old version is deleted.

### Troubleshooting
- **Code email not arriving:** `RESEND_API_KEY` set and the domain verified in
  Resend? Ask the fan to check spam/promotions and to wait 60 seconds before
  "Resend code". Limits: 3 codes per email per 15 minutes, 10 per connection
  per hour; 5 wrong tries kill a code.
- **"This PDF has N pages":** export again with exactly 4 pages (no blank
  pages; spreads must be single pages).
- **Upload too large / 413:** export with smaller images (150 dpi) or lower
  JPEG quality; page images over 2 MB are re-compressed automatically.
- **Reader blank:** the fan must be signed in (the reader asks), the programme
  must be Live (not Draft, Hidden or Scheduled for later), and the bucket
  connected. Staff can check with Preview, which shows drafts too.
- **"File storage is not connected":** the R2 binding is still commented out
  in `wrangler.toml` (Setup steps 1-2).

## Season tickets

`functions/api/_lib/seasonTickets.js`: settings in `season_settings`
(enabled, season, info, per-stand price and limit), `season_orders`
(Paystack reference `LSSZN-…`; paid through the shared webhook via
`extraPayments.js`), `season_passes` (`LS-SZN-…`, in the QR code
`/verify/<id>`), `season_pass_scans` (one row per pass and match; the gate
claims it with `ON CONFLICT DO NOTHING`, so two doors can't both admit).
`/api/validate-ticket` sends `LS-SZN-…` codes to `scanSeasonPass`: only on
the day of a home match (Nigerian time), only within the pass's season.
Public: `/season-tickets/` (`/api/season-tickets`, `/checkout`, `/order`),
banner on `/tickets/`. Admin: `/admin/season-tickets/` (Commerce). Unpaid
orders hold places for 30 minutes. Tests: `tests/season-tickets.test.mjs`
(needs `PAYSTACK_FAKE=1` and `STAFF_SCAN_CODE`).

## Security notes (review of 12 October 2026)

- **Headers:** `public/_headers` (static pages) and
  `functions/api/_lib/securityHeaders.js` (pages built by Functions: admin,
  `/m/`, server-rendered pages) send `X-Frame-Options: SAMEORIGIN` +
  `frame-ancestors 'self'`, HSTS for 180 days (no `includeSubDomains`, because
  stream.lobistarsfc.com points to the commentary partner), and a
  Permissions-Policy (camera only for this site, for the gate scanner). No site-wide
  Function middleware is used on purpose: it would count every file request
  against the free plan's daily Functions limit.
- **Email-code sign-in:** codes and links hashed; 10 minutes; 5 tries per code;
  3 codes per email per 15 minutes; 10 codes per connection per hour; **10
  wrong tries per email and 30 per connection per hour across codes**; Origin
  check on every POST; same reply for known and unknown emails. Set Turnstile
  (`TURNSTILE_SECRET_KEY`) before email goes live.
- **"Delete my data"** from someone not signed in goes to the Inbox but does not
  add that address to the Fan Database.
- **Never set in production:** `FANS_DEV_LINKS`, `SOCIAL_POST_FAKE`, `PAYSTACK_FAKE`.
- Tests: `tests/security-review.test.mjs`.

## Monthly partner reports

`functions/api/_lib/partnerReport.js`: per partner and calendar month
(Nigerian time) the numbers from `pageviews`, `track_events` (partner_click),
partner page views, `newsletter_issues` / `newsletter_clicks` (sponsor advert
matched to the partner by name) and `programme_events`; a branded email /
printable page (`/api/admin/partner-reports/view?slug=&month=`). Recipients in
`partner_report_contacts`, history in `partner_report_sends` (one successful
send per partner and month unless forced). Automatic sending
(`partner_report_settings.auto_send`): the cron Worker calls
`/api/internal/partner-reports`; from the 2nd of the month, at most hourly, it
sends last month's reports (needs `RESEND_API_KEY`). Admin: Partners page
(roles Super Admin, Commercial). Tests: `tests/partner-reports.test.mjs`.

## Website Health (uptime monitoring)

`functions/api/_lib/uptime.js`: every 5 minutes (the cron Worker calls
`/api/internal/health-check` each minute with `CRON_SECRET`; a round is
claimed in `uptime_meta` so it runs at most every 5 minutes) the site fetches
`/`, `/tickets/`, `/programme/`, `/api/events`, runs `SELECT 1`, and during a
commentary window probes the stream. Results go to `uptime_checks` (kept 30
days), outages to `uptime_incidents`; open incidents show in the admin bell
and Super Admins are emailed (when `RESEND_API_KEY` is set). Admin page
`/admin/health/` (Settings); "Check now" = `POST /api/admin/health`.
`GET /api/health` (public, no details) answers 200 when the site and database
work: point a free outside monitor (e.g. UptimeRobot, every 5 minutes) at it.
Tests: `tests/health.test.mjs`.

## MatchDay Kitchen (/kitchen/, 14 October 2026)

- Page: `src/pages/kitchen/index.astro`, styles `src/styles/kitchen.css`,
  script `src/lib/kitchen.ts`, logo `public/images/matchday-kitchen-logo.png`
  (+ `public/kitchen-favicon-32.png`, `public/kitchen-touch-icon.png`,
  `public/images/og-kitchen.jpg`; original in design-sources/logo-originals).
- Uses the existing food backend only: `/api/food/menu`, `/api/food-checkout`
  (Pay Online; `returnTo: 'kitchen'` brings the fan back to /kitchen/?ref=&t=),
  `/api/food/whatsapp-order` (same message format, Turnstile), `/api/food/order`
  (status). Prices are always worked out on the server (`priceCart`).
- Additive changes: food_items gets `spice` (0-3) and `badge` columns (added
  automatically on first use); `/api/food/menu` also returns `opensAt` and
  `closesAt` (automatic ordering mode).
- Seat: section = stand, "Row X, Seat Y" in the seat field (20 characters);
  "At half-time" is written at the start of the order note.
- Site: green MatchDay Kitchen pill in the main menu, match bar button,
  homepage section, links instead of /food (which still works). The floating
  phone button (`src/components/KitchenFab.astro`) is switched off since 15 Oct 2026
  (it covered content); one media query + one line bring it back.

## Homepage: one hero and a slim match bar (14 October 2026)

- Order: hero, then the match bar (`src/components/news/MatchBar.astro`, built
  by `functions/api/_lib/matchBar.js` on the server), then the one-line Match
  Day Programme strip, then the rest. The match is `matchBarMatch()`
  (`tickets/rules.js`): the shared next match, or the first postponed one if
  nothing else is left; no match hides the bar.
- One main button (Buy ticket from ₦X / Listen live when live / Match
  Centre); More menu: Match Centre, Add to calendar (/api/calendar?match=…),
  Share, Listen live (/commentary/, commentary_click tracking).
- "Upcoming Matches" lists the matches after the bar's (`afterBar`), no big card.
- The Match Centre page and /api/matches/<slug> now include the ticket state
  and "from" price, and home matches get a Listen live link before match day.

## Homepage Match Day Programme strip (14 October 2026)

- Built on the server for every homepage request (`functions/index.js` +
  `functions/api/_lib/programmeStrip.js`), so it works without JavaScript.
  The match is `nextLobiMatch()` (`functions/api/_lib/tickets/rules.js`), the
  same helper as the Upcoming Matches featured card: live first, else the
  earliest unfinished Lobi Stars match; finished, cancelled, abandoned and
  postponed (match or league status) are skipped.
- The button always reads "Read free →" and opens /programme/?src=homepage
  (the programme page says when the programme isn't out yet). Hidden while
  the programme feature or the "Homepage banner" switch is off, or when no
  match is left.
- Freshness: the homepage is cached for 30 seconds and the cache is cleared
  on every admin save. To force it by hand, save anything in the admin (or
  wait 30 seconds); no redeploy is needed.

## Logos: no white circles (14 October 2026)

- Every club crest (Lobi Stars and opponents) uses the shared class
  `.club-logo` (`src/styles/club-logo.css`, loaded by the main layout) or the
  `<ClubLogo>` component: a sized box, `object-fit: contain`, and no
  background, border, radius, padding or shadow (forced with `!important`, so
  a local style can't add the circle back). Size with `--logo-h` (and
  `--logo-w`). Without a file: the club's initials as plain text
  (`.club-logo--mono`, colour `--logo-c`).
- Files with a white (or black) background baked in now have transparent
  copies (`public/images/*-transparent.png`, made with
  `scripts/logo-remove-background.mjs`, which flood-fills only the background
  joined to the edges). Originals are kept in public/images (emails already sent
  link to them) and in `design-sources/logo-originals/`.
  `functions/api/_lib/logoFiles.js` swaps stored addresses (league teams in
  D1, older content) for the transparent copy when a logo is shown. No
  database change.
- `wikki-tourists.jpg` has no copy (its white inside joins the background);
  it needs a transparent file from the club.
- Emails, share images (`integrations/og/shareImages.mjs`, `og-default.jpg`)
  and the offline page show logos without a circle. App icons and favicons
  are unchanged: install icons need a solid background (iOS and Android
  maskable icons).
- Partner logos are NOT part of this (restored 14 October 2026 at the club's
  request): they keep their original files on their white cards
  (PartnerLogo.astro, card colour still works) and their round white card on
  share pictures.
- Exception, Zeva Premium Lager only (requested 14 October 2026): the white
  background was removed from `public/images/zeva-premium-lager.png` (800 px,
  transparent, made from the club's 1254 px upload; original kept in
  `public/images/originals/zeva-premium-lager-original.png`). Its partner file
  has `logoNoCard: true`, so PartnerLogo shows it without the white card
  (180 px tall on its page, 140 px on phones). The footer shows the Principal
  Partner on its own row (`size="feature"`, 96 px / 72 px tall); the header
  logo is 44 px / 36 px tall.
- Club crest on match cards, tickets and emails: `public/images/lobi-stars-fc-transparent-256.png`
  (256 px, 20 KB, made from the 640 px `lobi-stars-fc-transparent.png`, which is
  still used for share images and the search-engine logo). Server-rendered cards
  don't get the build's image optimisation, so keep display copies small.
- Msendo Table Water (Official Water Partner, added 15 October 2026): the card
  logo `public/images/msendo-table-water.png` is the wordmark cut from the club's
  flyer, rebuilt on white from the red channel (one ink colour, #05512C) so the
  yellow swoosh and flyer background are gone; it sits on the normal white card.
  The partner page also shows the club's two uploads, `msendo-bottle.png` and
  `msendo-flyer.png`, in a `.pd-gallery` block (two columns, one on phones).

## Match cards and wording (fixtures redesign, 14 October 2026)

- One card builder for every match card: `functions/api/_lib/fixtureCard.js`
  (homepage via `tickets/upcomingHtml.js`, /fixtures and /results via
  `leaguePages.js`, the details block on the Match Centre and Matchday Live).
  Styles: `src/styles/fixture-card.css`; countdown and Share: `src/lib/fixtureCards.ts`
  (one 1-second timer per page, stopped when no countdown is left).
- Times are stored in UTC and shown in Nigerian time without a "WAT" label;
  `<time datetime>`, JSON-LD and the calendar feed keep the full time with `+01:00`.
- "Benue" now reads "Benue State" (JSON-LD `addressRegion`, the seed venue).
  `migrations/0004_benue_state.sql` updates the stored venue; the site also
  does it itself the first time the league loads, so running it is optional.
  The club nickname "Pride of Benue" and company names are unchanged.

## League, fixtures and table

**The data.** The official 2026/27 Nigeria National League Conference D
season (8 clubs, 56 fixtures, 14 matchdays, kick-off 16:00 Nigerian time = 15:00 UTC)
lives in the `league_*` tables (functions/api/_lib/leagueDb.js). They are
created and seeded on first use from `functions/api/_lib/league/seed.js`, so a
deploy needs no manual step; `migrations/0002_league.sql` and
`migrations/0003_league_seed_nnl_d.sql` hold the same SQL for anyone who
prefers wrangler migrations (made by `node scripts/build-league-seed-sql.mjs`).
All times are stored in UTC and shown in Nigerian time (Africa/Lagos, UTC+1).

**Link with Matches & Fixtures.** Every league fixture involving Lobi Stars
has a linked `events` row (so tickets, match pages, commentary, Predict & Win,
alerts and the programme keep working). League › Fixtures owns its teams,
date, time and venue (`syncEvent`); the old editor keeps them. The score of a
linked match lives in `match_centre`, written by Live Match Control and by
League (`writeCentre`), and the league reads it from there, so the two never
disagree. Friendlies added only in Matches & Fixtures still show on /fixtures.

**How the table is calculated** (functions/api/_lib/league/standings.js, pure
code shared by Functions, pages and tests): only full-time and awarded matches
with both scores count (live ones only if the rule is switched on);
points = wins x win points + draws x draw points + defeats x loss points +
active adjustments (overall table only). Clubs are ordered by the
competition's tie-break list (points, goal difference, goals scored, wins,
then head-to-head points, goal difference and goals among the clubs still
level), then the recorded tie decision, then alphabetically (flagged
"level"). It can't be typed in, so it is always consistent with the results.

**Public pages.** /fixtures, /results and /table are rendered on the server
(functions/fixtures/index.js, functions/results.js, functions/table.js via
functions/api/_lib/leaguePages.js): real HTML for search engines and without
JavaScript, filters as normal links (filtered views are `noindex`). JSON-LD
SportsEvent per fixture. Public APIs: `/api/league/overview`, `/fixtures`,
`/results`, `/table`, `/calendar.ics?team=lobi|fixture=<id>`, `/crest/<code>`
(cached 30 s). `src/components/league/NextMatchCard.astro` and `MiniTable.astro`
are ready to place on any page.

**Admin** (/admin/league/…, roles Matchday Operator, Media, Super Admin; APIs
under /api/admin/league/, every write in `league_audit_log`): dashboard,
fixtures (postpone, reschedule, swap, cancel, matchday bulk shift with
preview), results (batch save, table before/after), live mode (double-tap
protection), table & rules (adjustments never deleted, tie decisions, rules
preview), clubs & venues, CSV import (dry run, finished matches protected)
and export, history with undo. The setting `league_admin_emails` (JSON list)
limits rules, adjustments, tie decisions, import and undo to those staff.

**How to…**
- *Enter results:* League › Results, choose the matchday, Save matchday.
- *Postpone / reschedule:* League › Fixtures › Postpone (reason) / Reschedule.
- *Points adjustment / tie decision:* League › Table & Rules.
- *Change the rules:* League › Table & Rules › Rules (preview, then save).
- *Import a revised fixture list:* League › Import & Export (template, upload,
  check the preview, Apply changes).
- *Undo a mistake:* League › History › Undo.
- *Match day:* check Fixtures; Live Match Control or League Live mode during
  the match; check Results after full time; enter the other results after the
  matchday.

**Troubleshooting**
- *The table looks wrong:* League › Table & Rules › Check data, then
  **Explain** on the row; check adjustments and the tie-break order.
- *A time looks one hour off:* times are typed in Nigerian time and
  stored as UTC; a device set to another time zone shows its own time in
  date pickers. The website always shows Nigerian time.
- *A fixture is missing:* check it is published and not filtered (Lobi Stars /
  All Conference D); a postponed match shows in the "Needs a new date" box.
- *The calendar didn't update:* calendar apps refresh subscribed feeds every
  few hours (Google can take up to a day); each change raises the event's
  SEQUENCE so the new time replaces the old one.
- *Sample data for local testing:* `node scripts/dev-sample-results.mjs`
  (local database only; remove with `--clear`).

**Commands**
```
npx wrangler d1 migrations apply lobi-stars-tickets --local   # optional: the site also seeds itself
node --test tests/league.standings.test.mjs                   # table calculation (no server)
node scripts/check-league-seed.mjs                            # the 56-fixture season checks
npm run build && npx wrangler pages dev dist                  # then: BASE=http://127.0.0.1:8788 node --test tests/league.api.test.mjs
npx wrangler d1 migrations apply lobi-stars-tickets --remote  # optional, after deploying
```

## Sharing pages (Share button + Admin › Share any page)

**How the button works.** `src/components/ShareButton.astro` is a `<details>`
menu of plain links (WhatsApp, Facebook, X, Telegram, Email), so it works with
JavaScript off. One small inline script (event delegation, so it survives the
in-page navigation used while commentary plays) works everything out **when
the button is pressed**: the page's canonical address (tracking parameters
removed) plus `utm_source=<platform>&utm_medium=social&utm_campaign=page_share`,
the og:title and og:description. On phones with a share sheet
(`pointer: coarse` + `navigator.share`) it opens the phone's own sheet
(`utm_source=native`); elsewhere the menu (a bottom sheet under 640 px).
"Copy link" needs JavaScript (`utm_source=copy`). Each choice is counted once
per page and platform per session with `navigator.sendBeacon` to
`POST /api/share/event` (page and platform only: no IP, browser or ID; the
endpoint checks Origin and answers only 204 or 400). No third-party scripts.

**Where it shows.** In the breadcrumb strip of every public page through
`Layout.astro` (`share` prop, default on). Never on noindex pages, `/admin`,
`/kitchen`, `/scan`, `/fans/*` (sign-in and account), `/payment`, any
`.../success/`, `.../order/` or `.../checkout/` page, the 404 page, or the
programme pages (they have their own Share with tracked links). Opt a page
out with `<Layout share={false}>`. News stories have it under the byline and
at the end instead (`share={false}` on their Layout). Match pages: a share bar
on the Match Centre template that `functions/matches/[slug].js` switches on
for each match's own address (the bare `/match-centre/` page doesn't show it).

**Link cards.** `src/components/HeadMeta.astro` writes every head tag (title,
description, canonical, og:*, twitter:*). The build step
(`integrations/og/index.mjs`) gives every indexable page a 1200x630 JPEG:
a branded card with the page title (pages without a photo), the partner's
logo (partner pages), or the page's own photo cropped to 1200x630 (news
stories, players). The fallback image is `/images/og-default.jpg`
(1200x630, 66 KB); the homepage keeps it on purpose. Titles stay under 70
characters and descriptions between 70 and 160.

**Admin › Share any page** (`/admin/share/`: Media, Matchday Operator, Super
Admin). APIs in `functions/api/admin/share/`: `pages` (type-ahead from the
sitemap, cached 10 minutes), `preview` (own host name only, at most 3
same-host redirects, 6 s, 1.5 MB, HTML only; falls back to the ASSETS binding),
`page-post` (Telegram and Facebook through `postLink` in
`functions/api/_lib/shareAdapters.js`, only when their secrets are set; 3 per
platform per page per hour), `page-mark` (manual posts) and `page-stats`.
Captions come from `buildPageCaption` in `functions/api/_lib/pageShare.js`;
hashtags from the `settings` row `page_share_hashtags`. Club posts carry
`utm_campaign=club_post`. Every post or mark is in the activity log.

**Bookmarklet.** The page shows a "Share to club socials" bookmark that opens
`/admin/share/?url=<current page>`; how to add it on a computer and on a phone
is on the page.

**Database.** `page_share_events`, `page_share_posts` and `settings` are made
on first use. The same SQL is in `migrations/0001_page_sharing.sql` if you
prefer wrangler migrations (optional; the database is `lobi-stars-tickets`):

```
npx wrangler d1 migrations apply lobi-stars-tickets --local
npm run build && npx wrangler pages dev dist
npx wrangler d1 migrations apply lobi-stars-tickets --remote
```

**Troubleshooting**
- *Preview has no image:* check the page in Admin › Share any page; the
  checklist says what is missing. Images must be full https addresses, JPEG or
  PNG, under 300 KB.
- *Preview text or picture is old:* Facebook, WhatsApp and X keep their own
  copy for days. Facebook: paste the address into the Facebook Sharing
  Debugger (developers.facebook.com/tools/debug) and press **Scrape Again**.
  X refreshes on its own within about a week.
- *The share menu doesn't open:* check the page isn't one of those above where
  it is switched off. Without JavaScript the menu still opens (no Copy link).
- *WhatsApp shows no image:* the image is over about 300 KB or not reachable
  without signing in. Check with Admin › Share any page.
- Tests: `tests/page-share.test.mjs`.

## Share Hub (sharing programmes to social media)

Staff share a programme from **Admin › Matchday Programme › Share** (a button
on every programme, and after Publish / Schedule in the wizard).

**How link cards work.** Every shared link is a tracked share page
`https://lobistarsfc.com/m/<slug>?src=<platform>&v=<n>` (`functions/m/[slug].js`).
It returns a small HTML page with og:/twitter: tags (title, description and the
1200x630 card `/m/<slug>/card.jpg?v=<n>`) for link-preview robots, and sends
people straight on to `/programme/scan/?c=<platform>&slug=<slug>`, where they
sign in to read or download. Everyone gets the same HTML (no user-agent
tricks). Drafts, hidden and unknown programmes redirect to the scan page and
reveal nothing. Visits are counted per platform (each platform is also a QR
campaign with the same code), robots and link previews are not.
`?v=` changes whenever the share images are saved, so WhatsApp and X fetch
a fresh preview. The card is served outside `/api/` on purpose: robots.txt
blocks `/api/`, and X's crawler respects that. `/api/programme/<slug>/share/card.jpg`
is the same image (alias).

**Tracked links and bio links.** Per platform: `/m/<slug>?src=facebook`
(this programme) and the evergreen bio link `/p/facebook` (always the current
programme; put it in the Instagram / TikTok bio).

**Tables** (created on first use, `ensureShareSchema` in
`functions/api/_lib/share.js`): `social_platforms` (seeded: Telegram, Facebook,
X, WhatsApp, Instagram, TikTok, YouTube, with caption templates and hashtags),
`programme_captions`, `social_posts`; `programmes.share_assets_version`,
`social_autopost_at`, `social_autopost_platforms`, `social_autopost_done`. QR
campaigns telegram, facebook, twitter, whatsapp, instagram, tiktok, youtube and
fanshare are added for the statistics.

**Code.** `functions/api/_lib/share.js` (captions, limits, links),
`shareAdapters.js` (Telegram / Facebook), `shareRun.js`, `shareCard.js`;
`functions/m/[slug].js`, `functions/m/[slug]/card.jpg.js`;
`functions/api/admin/programmes/[id]/share*`, `functions/api/admin/share/platforms.js`,
`functions/api/internal/social-autopost.js`; `src/components/admin/ShareHub.astro`;
`src/components/programme/FanShareMenu.astro`. Tests: `tests/share-hub.test.mjs`.

### Telegram channel bot (automatic posts, free)
1. In Telegram, open **@BotFather**, send `/newbot`, give it a name (e.g.
   "Lobi Stars FC") and a username ending in `bot`. Copy the token.
   (A separate bot from the kitchen bot is safest.)
2. Open the club's public channel › Administrators › Add Admin › search the
   bot › allow **Post Messages**.
3. In Cloudflare Pages › Settings › Variables and Secrets add
   `TELEGRAM_PUBLIC_BOT_TOKEN` (the token) and `TELEGRAM_PUBLIC_CHANNEL`
   (`@yourchannelname`, or the numeric id `-100…` for a private channel;
   with `@name` the Share Hub can link to each post). Redeploy.
4. In the Share Hub, Telegram shows "ready". Posts are the link card photo,
   the caption and a "Get the programme" button. Captions over 1,024
   characters are sent as a second message.

### Facebook Page token (optional, automatic posts)
Checked against Meta's documentation (Pages API, Graph API v26.0, October 2026):
posting to `/{page-id}/feed` needs a **Page access token** from someone who can
do the CREATE_CONTENT, MANAGE and MODERATE tasks on the Page, with the
permissions `pages_manage_posts`, `pages_read_engagement` (and, per Meta's
guide, `pages_manage_engagement`, `pages_read_user_engagement`). For the club's
own Page used by people with a role on the app, App Review isn't needed.
1. At developers.facebook.com create an app (type **Business**) and add the
   Lobi Stars Page's admin as an app admin.
2. Open **Graph API Explorer**, select the app, **Get User Access Token**
   with `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`,
   `pages_manage_engagement`, `pages_read_user_engagement`; approve the Page.
3. Exchange it for a long-lived user token:
   `GET https://graph.facebook.com/v26.0/oauth/access_token?grant_type=fb_exchange_token&client_id=<APP_ID>&client_secret=<APP_SECRET>&fb_exchange_token=<SHORT_TOKEN>`
4. `GET https://graph.facebook.com/v26.0/me/accounts?access_token=<LONG_USER_TOKEN>`:
   copy the Page's `id` and `access_token` (a Page token made from a
   long-lived user token does not expire unless the password changes or
   access is removed). Check it in the Access Token Debugger.
5. Add `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_TOKEN` and optionally
   `FACEBOOK_GRAPH_VERSION` (default `v26.0`) as Cloudflare secrets; redeploy.
Before each post the site asks Facebook to re-read the link (scrape), then
posts the caption (without the link line) with the link, so Facebook shows the
card. Until these are set, Facebook uses its share window.

### Scheduled posts
The cron Worker `workers/kitchen-cron` (every minute) also calls
`/api/internal/social-autopost` with `CRON_SECRET`. Each programme is claimed
with a conditional UPDATE, so it posts once; failures stay in the Share Hub
with a Retry button. Deploy/redeploy the Worker after pulling this change:
`cd workers/kitchen-cron && npx wrangler deploy`.

### Crawlers
`/m/*` must stay reachable: don't block it in robots.txt, Cloudflare WAF,
Bot Fight Mode or Access. Test:
```
curl -s -A "facebookexternalhit/1.1" "https://lobistarsfc.com/m/<slug>?src=facebook" | grep og:
```
should print the og: tags.

### Troubleshooting
- **Preview shows no image:** the programme has no share images yet (open the
  Share Hub, it makes them), or a firewall/bot protection blocks robots on
  `/m/`. The card must be under 400 KB (the hub aims for 280 KB).
- **Preview is old:** save the share images again (new `?v=`), then for
  Facebook use **Open Facebook Sharing Debugger › Scrape Again**.
- **Telegram post fails:** the bot isn't an admin of the channel with "Post
  Messages", or the channel name/token is wrong. The error is shown in the hub.
- **Facebook token expired** (error 190): make a new Page token (steps above).
  Missing permission (error 200/10): add `pages_manage_posts`.
- **WhatsApp shows no image:** WhatsApp ignores big preview images; the card is
  kept under 280 KB. Old chats keep the old preview; a new `?v=` fixes new shares.

### Local testing
```
npx wrangler pages dev dist --r2=PROGRAMME_BUCKET --binding SESSION_SECRET=x ADMIN_CODE=test-code-123 CRON_SECRET=cron-test-secret TELEGRAM_PUBLIC_BOT_TOKEN=000:test TELEGRAM_PUBLIC_CHANNEL=@test SOCIAL_POST_FAKE=1
BASE=http://127.0.0.1:8788 node --test tests/share-hub.test.mjs
```
`SOCIAL_POST_FAKE=1` pretends to post (tests only; **never** set it in production).
No migration commands are needed: tables are created on first use.

## QR advert campaigns (Match Day Programme)

Short links **/p/<code>** (`functions/p/[code].js`, `functions/p/index.js`)
count the scan (not link previews or robots: WhatsApp, Facebook, Twitter,
Telegram, Slack, Google, headless browsers, curl, HEAD requests) and always
answer **302** to `/programme/scan/?c=<code>` with `Cache-Control: no-store`.
Unknown codes, switched-off campaigns and database errors still redirect, so a
printed QR code is never a dead end. Campaigns are never deleted and their
codes never change.

- **Tables** (created on first use, `ensureQrSchema` in
  `functions/api/_lib/qr.js`): `qr_campaigns` (seeded: gate, screen, social,
  status, radio, flyer, kiosk) and `qr_events` (campaign, programme, fan,
  type scan/landing/signin_started/signin_completed/download/read, device
  android/ios/desktop/other, in_app). No IP addresses, emails or user agents.
  Also `fan_login_codes.link_token_hash`, `members.first_src` and the setting
  `scan_auto_download`.
- **Scan page** `/programme/scan/` and **email link page**
  `/programme/confirm/` (`src/components/programme/ScanApp.astro` in the tiny
  stand-alone frame `ScanShell.astro`: inline CSS, own fonts, no external
  scripts; Turnstile loads only when sign-in starts). The sign-in email now has
  the code and a one-tap button; the link only signs in when the fan taps
  Continue (email scanners open links), works once and dies with the code.
- **API:** `/api/fan/auth/request` takes `src` and `intent`;
  `/api/fan/auth/verify-link`; `/api/qr/event` (landing); the download takes
  `?src=` and, opened as a page, sends problems back to the scan page;
  `/api/programme/current` returns `pdfSizeBytes` and `scanAutoDownload`.
  Admin: `/api/admin/qr/campaigns` (GET, POST), `/api/admin/qr/campaigns/:id`
  (PATCH only), `/api/admin/qr/stats`. Every change is in the Activity Log.
- **Admin:** Matchday Programme › QR advert campaigns
  (`src/components/admin/QrCampaigns.astro`). The QR codes are made in the
  browser with the site's bundled `qrcode-generator` (error correction Q,
  dark on white, 4-module quiet zone), so no CDN script is needed.
- **Nothing extra to set up** beyond the Match Day Programme itself (R2
  bucket, Resend). Tests: `tests/qr-campaigns.test.mjs`.

### Troubleshooting
- **Scan counts look too high:** link previews and robots are already left
  out. Sharing the short link in chats also counts real taps; use a separate
  campaign (e.g. "status") for links shared online and keep "gate" for posters.
- **Download doesn't start in Facebook / Instagram / TikTok:** those in-app
  browsers often block files. The page shows "open in Chrome or Safari" with
  Copy link, and "Read online" works everywhere. On iPhone: Share, then Save to
  Files.
- **"This link has expired":** email links last 10 minutes and work once
  (signing in with the code also uses it up). "Send me a new code" starts again.

## Fan match alerts (Web Push, free)

Fans subscribe with the **🔔 Match alerts** box (`src/components/MatchAlerts.astro`)
through the public service worker `/sw.js` (push handler for `kind: 'match'`).
API: `/api/push/public-key|subscribe|status|unsubscribe` (no account, rate
limited, stores only the push endpoint, keys and choices in `fan_push_subs`).

- **Needs:** the same `VAPID_*` keys as the kitchen. `CRON_SECRET` + the
  `lobistars-kitchen-cron` Worker are recommended: every minute it also checks
  whether commentary went on air (`checkRadioOnAir`) and continues sends.
- **Automatic alerts** come from `functions/api/admin/match-centre/[id].js`
  (kick-off, goal, half-time, second half, full time) and from
  `/api/commentary` + the cron (radio on air). Each is claimed once per match in
  `fan_alert_once (event_id, kind)`. Staff switch them in `fan_alert_settings`.
- **Sending at scale:** a job (`fan_push_jobs`) is sent in batches of 40 per
  request (D1/subrequest limits on the free plan). The first batch is sent
  straight away; then it chains itself via `/api/internal/fan-push-run`
  (Bearer `CRON_SECRET`), open admin pages call `/api/admin/fan-alerts/run`,
  and the cron continues it. Gone subscriptions (404/410) are switched off.
- Tables are created automatically on first use (`ensureMatchAlertsSchema`).
- Admin page: `/admin/fan-alerts/` (Super Admin, Matchday Operator).
- Tests: `tests/match-alerts.test.mjs`.

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

## Match tickets: several matches in one payment (13 October 2026)

**No migration to run.** The two new tables create themselves the first time
the tickets pages are used (`functions/api/_lib/ticketShop.js`):

- `league_ticket_settings`: one row per event (seats per stand, sale open/close, most per order, on sale).
- `league_ticket_orders`: one row per basket (reference `LSBAS-…`, one Paystack payment).
  Each match in the basket is a normal row in `orders` (`basket_id` set, reference `LSBAS-…-1`, `-2`, …),
  so the tickets, QR codes and gate scanner are unchanged.

The first time, matches that already had prices are switched on (so the seven
matches on sale stay on sale); every new match starts **off**.

**Secrets (already in the list above):** `PAYSTACK_SECRET_KEY` (the live key
once testing is done), `RESEND_API_KEY` + `RESEND_FROM`, `TURNSTILE_SECRET_KEY`
(and the site key in `src/data/fan-settings.json`), `STAFF_SCAN_CODE`.

**Webhook:** the same URL as before, `https://lobistarsfc.com/api/paystack-webhook`.
It checks the amount and currency and is safe to receive twice (tickets are
only issued once; the email is only sent once).

**No oversell:** each stand's seats are taken in one SQL statement that only
inserts the order if sold + held (unpaid orders less than 30 minutes old) + wanted
fits the capacity.

**Access:** `/admin/tickets` and `/api/admin/tickets/*` use the website's own
admin login and roles (Super Admin, Commercial; the scanner also Matchday).
No Cloudflare Access rule is needed.

**Endpoints:** `GET /api/tickets/catalogue`, `POST|GET /api/tickets/basket`,
`POST /api/tickets/lookup` (5 per 15 minutes per IP, 20 a day per email),
`/api/admin/tickets` (sales), `…/match/:id` (PUT settings), `…/bulk`,
`…/orders` (search), `…/orders/:id/resend|refund`, `…/export.csv`.

**Tests:** `tests/tickets.unit.test.mjs`, `tests/tickets.api.test.mjs` (Paystack fake mode only).

## Ticket discounts (14 October 2026)

- Pricing: `functions/api/_lib/tickets/discounts.js` (pure `computeOrderPricing`,
  `publicOffers`, `ruleProblem`); database side `functions/api/_lib/ticketDiscounts.js`
  (schema, seeds, allowances, `holdChunkStatement`, `orderChunks`, `lockedTotalOk`, report).
- Used by `/api/tickets/price` (preview, rate-limited), `/api/tickets/basket`
  (checkout; refuses a total the buyer didn't see with 409 `repriced`), the
  Paystack webhook and the success-page verify (`lockedTotalOk`: the locked
  snapshot priced again must equal the amount charged).
- Admin: `/admin/tickets/discounts/` and `/api/admin/tickets/discounts` (+ `/preview`, `/report.csv`);
  per match `allowDiscounts` / `discountCap` on `/api/admin/tickets/match/:id`.
- Database: `migrations/0005_ticket_discounts.sql` (tables + seeds, safe any time):
  `npx wrangler d1 migrations apply lobi-stars-tickets --remote`. The new
  columns (orders.ticket_type, tickets.ticket_type, league_ticket_orders.discount_*,
  league_ticket_settings.allow_discounts / discount_cap, ...) are added by the
  site itself on first use (`ensureDiscountSchema`), because SQLite cannot add a
  column only if it is missing.
- The orders table only allows 1 to 10 tickets per row, so a large order is
  stored as several rows of at most 10 in the same payment. Most per order per
  match is now 1 to 50.
- Seeded OFF: group 10-19 tickets 10%, 20+ 15%; early bird 10% at least 7 days
  before kick-off; family 15% for 1-2 adults + 1-4 children under 16. Global:
  stacking off, max total 25%, lowest ticket price ₦0, 1 group/family order per
  email per match.
- Tests: `tests/ticket-discounts.unit.test.mjs`, `tests/ticket-discounts.api.test.mjs`.

## Lobi Stars Rewards (Phase 1, 14 October 2026; not launched)

- `functions/api/_lib/rewards.js`: tables `rewards_members` (seq -> member
  number LSR-000123, status, terms version) and `rewards_ledger` (type EARN /
  BONUS / REDEEM / EXPIRE / REVERSE / ADJUST, status PENDING / AVAILABLE /
  REVERSED, source, source_ref, UNIQUE(source, source_ref) so nothing is
  awarded twice); members.date_of_birth (and state). Created on first use.
- Balance = sum of AVAILABLE rows; pending = PENDING rows. EARN/BONUS rows need
  an active member with a verified email.
- Settings in `settings.rewards_settings` (JSON, defaults in rewards.js):
  welcomeBonus 50, profileBonus 20, termsVersion, live false.
- APIs: GET `/api/rewards/me`, POST `/api/rewards/join` { agree }, POST
  `/api/rewards/profile` { state, dateOfBirth }. `/api/fans/register` accepts
  joinRewards + rewardsAgree; `/api/fans/verify` gives the waiting bonuses.
- Pages: `/rewards/` (noindex, preview with ?preview=1 until live),
  `/rewards/terms/` (approved; text in `functions/api/_lib/rewardsTerms.js`, editable
  at `/admin/rewards/terms/` via `/api/admin/rewards/terms`, served by `/api/rewards/terms`), Rewards box on `/fans/account/` and the register form.
- Test: `tests/rewards.api.test.mjs` (needs FANS_DEV_LINKS=1 locally).
- Earning (14 October 2026): `functions/api/_lib/rewardsRules.js` (pure rules,
  `tests/rewards-rules.unit.test.mjs`) and `functions/api/_lib/rewardsEarn.js`
  (hooks that never throw). Hooked into `fulfillOrder.js` (tickets, PENDING with
  event_id), `extraPayments.js` (membership + bonus, shirts, season tickets),
  `foodOrders.js` (food PAID), `validate-ticket.js` (attendance + streak),
  `matches/[slug]/motm.js` and `predict.js` (monthly cap), ticket refund action
  and the Paystack webhook (`refund.processed` / `charge.dispute.create` reverse
  by `rewards_ledger.pay_ref`). Referrals: `rewards_referrals`, `?ref=` + browser
  id at `/api/fans/register`.
- Job: `rewardsSweep` (release ticket points of full-time matches, prediction
  results, birthdays) from `/api/internal/rewards-run` (cron Worker, CRON_SECRET,
  at most every 10 min; added to `workers/kitchen-cron/index.js` CALLS: redeploy
  the Worker) and per fan in `/api/rewards/me`.
- Admin: `/admin/rewards/`, `/api/admin/rewards` (GET/PUT settings),
  `/api/admin/rewards/member` (lookup, adjust, suspend), `/api/admin/rewards/run`.
  Routed to the `fans` area in `adminRoles.js`.
- Test: `tests/rewards-earn.api.test.mjs`.
- Tiers: `functions/api/_lib/rewardsTiers.js` (tierStatus: AVAILABLE EARN/BONUS/
  REVERSE points since `seasonStart`; paid member = members.membership_season
  equals the season label "2026/27"; last season's tier during `tierGraceMonths`;
  purchaseMultiplier and presaleMs only when `live`; upgrade email once per tier
  per season via rewards_members.tier_notified; celebration via tier_seen).
  Pure rules in rewardsRules.js (tierFor, effectiveTier, tiersProblem,
  tierBenefits). Presale: `ticketState(..., { earlyMs })`, `catalogue(env,
  { earlyMs })`, used by `/api/tickets/catalogue` and `/api/tickets/basket`
  for the signed-in fan. APIs: `/api/rewards/tier` (seen, legend-wall),
  `/api/rewards/legend-fans`; page `/rewards/legend-fans/` (noindex; /rewards/star-fans
  redirects). Top tier renamed Star -> Legend (Oct 2026): settings saved with key
  'star' are read as 'legend' (rewardsSettings), rewards_members.star_wall renamed
  legend_wall, tier_notified/tier_seen ':star' -> ':legend', catalogue min_tier
  'star' -> 'legend' (all in the schema setup; balances and ledger untouched).
  Test: `tests/rewards-tiers.api.test.mjs`.
- Catalogue and redeeming: `functions/api/_lib/rewardsCatalogue.js` (tables
  rewards_catalogue, rewards_redemptions with UNIQUE idem_key and voucher_code,
  rewards_codes; seeds once; `redeem()` = one db.batch: redemption inserted only
  if spendable points, stock and per-fan limit allow, then the REDEEM ledger row
  and stock -1 follow it; ticket rewards via holdLineStatement + fulfillOrder at
  ₦0 (reference RWD-...); refunds as a REVERSE row with source 'redeem', not
  counted for tiers). The job expires vouchers. No airtime/data rewards (removed
  Oct 2026 with the VTU adapter; old airtime/data catalogue rows are archived). APIs `/api/rewards/catalogue`, `/api/rewards/redeem`
  (also `action: 'code'`), `/api/rewards/wallet`; admin `/api/admin/rewards/
  catalogue` and `/fulfilment`. Pages `/rewards/catalogue/` (noindex),
  `/admin/rewards/catalogue/`, `/admin/rewards/fulfilment/`.
  Test: `tests/rewards-redeem.api.test.mjs`.
- One-off actions: settings newsletterBonus 20, alertsBonus 10,
  firstPurchaseBonus 50, programmeRead 5 (monthly cap with votes/predictions).
  Hooks: `/api/newsletter` (earnNewsletter by email), `/api/push/subscribe`
  (earnAlerts for the signed-in fan), `/api/programme/:slug/event` type `open`
  (earnProgramme), first purchase inside earnPurchase (carries the pay_ref, so
  refunds/disputes reverse it). Test: `tests/rewards-actions.api.test.mjs`.
- Fan guide `/rewards/` reads every number from `GET /api/rewards/info` (settings,
  tiers with benefit lines, catalogue); FAQPage JSON-LD in the page (no numbers).
  Settings expiryMonths 12 and exampleJerseyNaira / exampleTicketNaira /
  exampleFoodNaira (David example; to confirm). Column setup tolerates two
  first requests at once ("duplicate column" ignored).
- Pay with points / vouchers at checkout: `functions/api/_lib/rewardsCheckout.js`
  (checkoutOptions, holdCheckoutRewards = PENDING minus ledger row source
  'points_payment' + voucher status 'reserved', confirmCheckout on payment,
  releaseCheckout on failure, releaseAbandoned in the Rewards job after 90 min;
  order columns points_used / points_kobo / voucher_code / voucher_kobo).
  Used by `/api/tickets/basket` (usePoints), `/api/food-checkout` and
  `/api/shop/personalise` (usePoints, voucherCode). Ticket basket integrity:
  rows = total_kobo + points_kobo. UI `src/components/rewards/CheckoutRewards.astro`
  (`/api/rewards/checkout` options). Settings pointValueKobo 500,
  payWithPointsMaxPercent 50, payWithPointsMin 100. Test:
  `tests/rewards-checkout.api.test.mjs`.
- Phones (under 768px): homepage Club Shop is a scroll-snap slider (dots,
  arrows, "Visit the Shop"), /shop one card per row, readable ShopCard styles;
  MatchDay Kitchen card header row (FoodPromo.astro). Tablet/desktop unchanged.

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
VALUES ('evt-2026-08-15', 'Lobi Stars', 'Kano Pillars', 'NNL', '2026-08-15T15:00:00Z', 'Aper Aku Stadium, Makurdi', 500000, 250000, 100000);
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

A match ticket (`LS-TIX-…`) is only accepted on the Nigerian calendar day of
its own event; any other day it is refused with "Wrong match: this ticket is
for <home> v <away> on <date>" and stays valid (tests/gate-match-day.test.mjs).

Each ticket can only be scanned once — a database-level check prevents two
doors admitting the same ticket at the same moment.
