# Deployment & operations notes

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

There's no admin UI for events yet — manage them from this same D1 Console.

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
