# Lobi Stars FC website: disaster recovery

How to get the website and its data back if something goes badly wrong, up to
losing the whole Cloudflare account. Part 1 is for the club (a monthly habit,
10 minutes). Parts 2 to 4 are for whoever does the recovery (the developer).

Tested on 18 Oct 2026: an empty database was rebuilt from a backup with these
steps and every table came back with the same number of rows.

---

## What is kept where

| What | Where it lives | Copy outside Cloudflare |
|---|---|---|
| The website itself (pages, design, code, news articles, photos in the site) | GitHub: github.com/marvinmanex-cyber/lobi-stars-website, and this computer | Yes (GitHub) |
| The database (fans, contacts, newsletter, tickets, food orders, Rewards, votes, staff accounts, Activity Log, settings) | Cloudflare D1 `lobi-stars-tickets` | Only if the club downloads the **encrypted copy** every month (Part 1) |
| Nightly backups of the database (kept 30 days) | Cloudflare R2 `lobistars-backups` | No: same Cloudflare account |
| Match Day Programme PDFs and pictures | Cloudflare R2 `lobistars-programmes` (weekly copy in `lobistars-backups`) | Keep the original PDFs in Google Drive |
| The backup key | Cloudflare (secret `BACKUP_KEY`) and the club's password manager or paper copy | Yes (the club's copy) |
| Passwords, PINs, two-step login secrets, sign-in links | Database, **never** in backups | No, on purpose: people set new ones after a rebuild |
| API keys (Resend, Paystack, Telegram, etc.) | Cloudflare secrets | No: made again at each provider (list in Part 4) |

---

## Part 1. The club: once a month (10 minutes)

1. Sign in at **lobistarsfc.com/admin** as a Super Admin.
2. Open **Settings › Data Backup**. Under **Automatic backups**, press
   **Download encrypted copy** next to the newest day. Enter the 6-digit code
   from your authenticator app when asked.
3. A file named like `lobi-stars-encrypted-backup-2026-10-18.json` is
   downloaded. Upload it to a **Google Drive** folder called
   "Lobi Stars website backups" (or copy it to a USB stick kept at the club).
   Keep the last 3 and delete older ones.
4. The file is locked: without the backup key nobody can read it, so it is
   safe in Google Drive. **Never put the backup key in the same folder.**
5. The Data Backup page shows **"Last encrypted copy kept outside Cloudflare"**
   and turns red after a month.

Also keep the **original Match Day Programme PDFs** in Google Drive.

The backup key itself: in a password manager entry called
"Lobi Stars website backup key" (or on paper in the club safe). See
HANDOVER-TODO.md, A22.

---

## Part 2. Which situation are you in?

| Situation | What to do | Key needed? |
|---|---|---|
| Someone deleted or changed data by mistake, **in the last 7 days** | Cloudflare D1 Time Travel: puts the whole database back to any minute. `npx wrangler d1 time-travel restore lobi-stars-tickets --timestamp=2026-10-18T09:00:00Z` (check the time first with `npx wrangler d1 time-travel info lobi-stars-tickets --timestamp=...`) | No |
| Data lost **8 to 30 days ago** | Admin › Settings › Data Backup › **Download for restoring** (the day you need), then Part 3, steps 3 and 4 (only the tables you need: `node scripts/restore-backup.mjs file.json contacts newsletter_subscribers > restore.sql`) | No (Cloudflare unlocks it) |
| The website looks broken after an update | Cloudflare › Workers & Pages › lobi-stars-website › **Deployments** › choose the last good one › **Rollback** | No |
| **The Cloudflare account is lost** (closed, hacked, no access) | Part 4: rebuild everything, using the encrypted copy from Google Drive and the backup key | **Yes** |

---

## Part 3. Unlocking an encrypted copy (any computer with Node.js)

1. Install **Node.js** (nodejs.org, LTS) and **Git** (git-scm.com).
2. Get the code:
   `git clone https://github.com/marvinmanex-cyber/lobi-stars-website.git` and
   `cd lobi-stars-website`.
3. Put the encrypted copy in that folder. Make a text file `backup-key.txt`
   containing the backup key (paste the line from the password manager). Then:
   ```
   node scripts/decrypt-backup.mjs lobi-stars-encrypted-backup-2026-10-18.json backup-key.txt > restore.json
   node scripts/restore-backup.mjs restore.json > restore.sql
   ```
   The first command says how many tables and rows it unlocked ("wrong key"
   means the key doesn't match this file). **Delete backup-key.txt
   straight away** afterwards, and treat restore.json and restore.sql as
   private: they contain fans' details unencrypted.
4. Load it into the database:
   ```
   npx wrangler d1 execute lobi-stars-tickets --remote --file=restore.sql
   ```
   On the live database this puts rows back and leaves newer rows alone. On a
   new, empty database it first creates every table (the structure is in each
   backup), then the rows, then the indexes and the Activity Log protection.

---

## Part 4. Rebuilding after losing the Cloudflare account

Allow about half a day. Work through it in order.

### A. A new Cloudflare account and the code
1. Create a Cloudflare account (use a club email, turn on two-step login).
2. **Add the domain** lobistarsfc.com to it (Websites › Add a site, Free plan)
   and change the nameservers at the domain registrar to the two Cloudflare
   gives. This can take a few hours, so do it first.
3. On the computer: install Node.js and Git, clone the code (Part 3, steps 1
   and 2), then `npm install` and `npx wrangler login`.

### B. Database and storage
4. `npx wrangler d1 create lobi-stars-tickets`. Copy the new `database_id`
   into `wrangler.toml` (replace the old one).
5. `npx wrangler r2 bucket create lobistars-programmes` and
   `npx wrangler r2 bucket create lobistars-backups`.
6. Load the data: Part 3, steps 3 and 4 (with `--remote`).
7. Let the rebuilder in (the restored settings have the old admin code
   switched off):
   ```
   npx wrangler d1 execute lobi-stars-tickets --remote --command "UPDATE admin_security SET value = '0' WHERE key = 'admin_code_off'"
   ```

### C. The website
8. Create the Pages project:
   `npx wrangler pages project create lobi-stars-website --production-branch main`.
   Better: in the Cloudflare dashboard, Workers & Pages › Create › Pages ›
   **Connect to Git** › the GitHub repository (build command `npm run build`,
   output `dist`), so Content CMS saves rebuild the site again.
9. Add the **secrets** (Workers & Pages › lobi-stars-website › Settings ›
   Variables and Secrets, type Secret). Make new random values where it says
   "new" (for example `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).

   | Name | Value |
   |---|---|
   | `ADMIN_CODE` | new: a long temporary code, only for the rebuild (step 13 switches it off) |
   | `SUPER_ADMIN_EMAILS` | `dkakaan2@gmail.com,dkakaan@lobistarsfc.com,marvinmanex@gmail.com` |
   | `BACKUP_KEY` | the **same** backup key (so the old encrypted copies stay readable) |
   | `SESSION_SECRET`, `CRON_SECRET`, `ANALYTICS_SALT`, `INBOX_INBOUND_KEY`, `MEDIA_INBOUND_KEY`, `TELEGRAM_WEBHOOK_SECRET` | new random values |
   | `RESEND_API_KEY`, `RESEND_FROM`, `REPLY_TO_EMAIL`, `INBOX_REPLY_DOMAIN` | Resend (resend.com): make a new Full access API key; the others as in HANDOVER-TODO.md A1 and A2 |
   | `PAYSTACK_SECRET_KEY` | Paystack dashboard › Settings › API Keys |
   | `TURNSTILE_SECRET_KEY` | Cloudflare › Turnstile › add a widget for lobistarsfc.com (also put the new site key in `src/data/fan-settings.json`) |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | new: `npx web-push generate-vapid-keys` (fans turn match alerts on again) |
   | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_KITCHEN_CHAT_ID`, `TELEGRAM_PUBLIC_BOT_TOKEN`, `TELEGRAM_PUBLIC_CHANNEL`, `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_TOKEN`, `TERMII_API_KEY`, `TERMII_SENDER_ID`, `PAGES_DEPLOY_HOOK` | only those the club uses (HANDOVER-TODO.md section A) |

   Never add `FANS_DEV_LINKS`, `SOCIAL_POST_FAKE`, `PAYSTACK_FAKE` or
   `STAFF_TEST_PASSWORDS` (testing only).
10. Deploy: `npm run build` then
    `npx wrangler pages deploy dist --project-name lobi-stars-website --branch main`
    (or push to GitHub if connected). Then Pages › Custom domains: add
    **lobistarsfc.com** and **www.lobistarsfc.com**.

### D. Timer jobs, email and webhooks
11. Timer job (kitchen alerts, newsletters, backups, security emails):
    `cd workers/kitchen-cron`, `npx wrangler secret put CRON_SECRET` (the same
    new value as on the website), `npx wrangler deploy`. Media mailbox:
    `cd workers/media-mail`, `npm install`,
    `npx wrangler secret put MEDIA_INBOUND_KEY`, `npx wrangler deploy`.
12. Email (DEPLOYMENT.md has the details):
    - Cloudflare › Email Routing: info@ → iorwasederekkakaan@gmail.com,
      dkakaan@ → dkakaan2@gmail.com, media@ → the lobistars-media-mail
      Worker; other role addresses as before.
    - Resend: add the domain again (DKIM and SPF records), the reply.
      subdomain and its inbound webhook
      `https://lobistarsfc.com/api/inbox/inbound?key=<new INBOX_INBOUND_KEY>`.
    - DMARC record `v=DMARC1; p=none;`.
    - Paystack webhook stays `https://lobistarsfc.com/api/paystack-webhook`.
    - Telegram: run the webhook script again (DEPLOYMENT.md, "Kitchen Order
      Alerts"). Google Search Console: verify the domain again (new DNS TXT).

### E. People back in
13. Sign in at lobistarsfc.com/admin with the temporary `ADMIN_CODE` ›
    Settings › Login & Security › **Send the Super Admin invites** (or Staff ›
    **Resend invite** for each). Each Super Admin chooses a new password and
    sets up two-step login again (the old ones are never in backups). When two
    have signed in: **Switch off the admin code** again, and set **Send
    security emails to** dkakaan@lobistarsfc.com.
14. Other staff: Staff › **Resend invite** (accounts and roles came back,
    passwords didn't). Gate helpers: new PINs in Commerce › Matchday Helpers.
15. Fans: their accounts, Rewards points, tickets and orders came back; they
    sign in with **Forgot password** the first time. Phone match alerts are
    turned on again by each fan.
16. Upload the Match Day Programme PDFs again from Google Drive.
17. Settings › Data Backup › **Start a backup now**, and the next day check the
    dashboard's **Last backup** card is green.

### F. Check it works
- The home page, fixtures, news and shop pages open on lobistarsfc.com.
- A test sign-up to the newsletter arrives in the Fan Database and its email
  arrives.
- A small real payment (or Paystack test keys first) completes.
- The Activity Log shows the history from before the loss.
