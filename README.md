# Lobi Stars FC website (lobistarsfc.com)

The site is built with Astro, then served by Cloudflare Pages.
- **Server code:** Pages Functions (`functions/`).
- **Database:** D1 (`env.DB`).
- **Files:** R2.

Further documents:
- How staff use each feature: **STAFF-GUIDE.md** (and STAFF-MATCHDAY-GUIDE.md).
- Setup: **DEPLOYMENT.md**.
- What changed: **CHANGELOG.md**.
- What the club still has to do: **HANDOVER-TODO.md**.

## Media Centre

A separate, private page for the club's media staff, at
**/media-centre** (https://lobistarsfc.com/media-centre).
1. Media staff create content there.
2. A Super Admin approves it in the main admin, under **Media Centre ›
   Approval Queue**.
3. Approved content appears automatically on the public website, in the
   places that already show it.

STAFF-GUIDE.md section 41 explains every screen in plain English.

### How it is separated from the admin
- **Users:** Media Centre users are a separate table (`mc_users`). They are
  not admin staff.
- **Sign-in:** a Login ID (letters + 2–4 digits, e.g. `Iorbee68`) and a
  password. There is no email sign-in.
- **Session:** a separate cookie (`ls_media`, HttpOnly, Secure,
  SameSite=Strict) and a separate API (`/api/media-centre/*`, guarded by
  `functions/api/media-centre/_middleware.js`).
- **The page:** one shell (`src/pages/media-centre/index.astro`, with the
  scripts in `src/scripts/mediaCentre/`). It is served for every
  `/media-centre/...` address by `functions/media-centre/[[path]].js`, with
  strict security headers.
- **No admin access:** both admin middlewares (`functions/admin/_middleware.js`
  and `functions/api/admin/_middleware.js`) refuse any request that carries a
  Media Centre session and no admin session. This applies to GET and POST, on
  every route.
- **Changes:** every change needs the session's CSRF token (`X-CSRF-Token`)
  and must come from the same website (`Origin`).
- **Passwords:**
  - At least 8 characters. Stored as PBKDF2-SHA256 with 100,000 rounds
    (`functions/api/_lib/password.js`; Cloudflare Workers can't run bcrypt
    or Argon2 within their CPU limits).
  - A temporary password must be changed at the first sign-in.
  - **Accepted exception (31 Oct 2026):** the brief asked for bcrypt or
    Argon2. The site uses PBKDF2-SHA256 instead, the same as the admin
    logins. It is a recognised password-hashing standard (NIST SP 800-132,
    OWASP), and Cloudflare's Web Crypto runs it natively.
  - bcrypt and Argon2 would need a JavaScript library that goes over the
    Workers free plan's 10 ms CPU limit per request.
  - Revisit if the club moves to Workers Paid (HANDOVER A33).
- **Lockout:** 5 wrong passwords lock the account for 15 minutes.
- **Idle sign-out:** after 30 minutes without activity, enforced by both the
  server and the page.

### For Super Admins
- **Create users:** Admin › Media Centre › Users & settings › *Add a user*
  (full name, Login ID, temporary password). The same page has Reset
  password, Change Login ID, Rename, Unlock, Sign out and Disable/Enable.
  There is no limit on the number of users.
- **Approve content:** Admin › Media Centre › Approval Queue. Each item has a
  preview, a comparison with the live version and earlier versions, and
  these actions: **Approve**, **Edit then approve**, **Return with comment**,
  **Reject**. Published items can be **unpublished**; they are never
  deleted.
- **View the log:** Admin › Media Centre › Activity log. Filter by person,
  dates, section and action, or download a CSV. The `mc_activity` table is
  append-only: database triggers refuse UPDATE and DELETE, and no code
  changes rows.
- **Deadlines and limits:** Admin › Media Centre › Users & settings ›
  Settings:
  - accreditation closing time (hours before kick-off) and the most
    journalists per match;
  - newsletter deadline and publish time;
  - the media team email;
  - the press-release media contact.

### Workflow (all content types)
- **Statuses:** `draft` → `submitted` → `published` (or `scheduled` →
  `published`). A submission can also be `returned` (with a comment) or
  `rejected`; published content can later be `unpublished`.
- **Revisions:** every submission, approval and return is saved in
  `mc_revisions`.
- **Corrections:** a correction to published content keeps `live_json` (the
  live version) until it is approved.
- **Where the code is:**
  - `functions/api/_lib/mediaCentre.js`: schema, users, sessions, log,
    items;
  - `functions/api/_lib/mediaApprovals.js`: decisions, scheduled
    publishing;
  - `functions/api/_lib/mediaKinds.js`: each content type and how it
    publishes.

### Latest News (phase 2)
- **Editor:** `src/scripts/mediaCentre/news.ts`.
- **Live preview:** loads `/news/mc-preview-template/`, a hidden noindex
  page built from the real article template
  (`src/content/news/mc-preview-template.md`, a draft), and puts the story
  into it.
- **Rich text:** cleaned in the browser (`files.ts`) and again on the server
  with HTMLRewriter (`functions/api/_lib/mediaSanitize.js`). Only these tags
  are kept: p, br, b/strong, i/em, u, h2, h3, blockquote, ul, ol, li,
  a[href http(s)/mailto/site], img[src Media Centre upload / site image,
  alt].
- **Uploads:** `/api/media-centre/upload`. The file type is checked from its
  first bytes; the limit is 5 MB. Files are stored in R2 (`SQUAD_BUCKET`,
  `media-centre/`) and served by `/api/media-file/<id>` (staff only unless
  public).
- **Publishing** (`functions/api/_lib/mediaNews.js`):
  - Approval writes `src/content/news/<date>-<slug>.md` (with `mcId`,
    `newsTab`, `coverCaption`, `coverCredit`, `isBanner` for breaking news,
    `players`, `matchDate`/`contentType` for the match) plus the photos
    (`public/images/news/mc/`).
  - Everything goes in ONE GitHub commit (`commitFiles` in `github.js`,
    which needs `GITHUB_TOKEN` with Contents read/write). Cloudflare Pages
    rebuilds in about 3 minutes.
  - Unpublish rewrites the file with `status: draft`.
- **Scheduled stories:** published by the every-minute timer
  (`/api/internal/newsletter-run` → `mediaCron.js`).

### Media accreditation (phase 3)
- **Public pages:** `src/pages/media/index.astro` (the Media page, linked
  from the footer) and `src/pages/media/accreditation.astro` (the form, with
  photo crop). The form posts multipart data to `/api/media/accreditation`.
  It is protected by a honeypot field `website`, 6 requests per hour per IP,
  and a same-origin check.
- **Form tokens:** both public forms carry a signed token
  (`mediaFormToken.js`, HMAC with `SESSION_SECRET`). It must be at least
  3 seconds old and at most 4 hours old.
- **Returning applicants:** `POST /api/media/accreditation/prefill` emails a
  6-digit code (stored hashed in `mc_prefill_codes`, 15 minutes, 5 tries).
  The saved details only come back with that code, or through an invitation
  emailed to that address. The answer is the same whether or not the email
  is known.
- **Content security policy:** the Media Centre page allows scripts from the
  site only (`script-src 'self'`), with no inline scripts or inline event
  handlers.
- **Reminder tests:** on a local server only, `ALLOW_TEST_CLOCK=1` lets
  `/api/internal/newsletter-run?now=<ISO>` run the reminders as if it were
  that time. It is never set on the live site.
- **Logic** (`functions/api/_lib/mediaAccreditation.js`):
  - only home matches;
  - closes `accreditation_close_hours` before kick-off;
  - one pending or approved request per email per match;
  - the per-match limit is `accreditation_max`.
- **Tables:** `mc_accreditations`, `mc_contacts`, `mc_invites`.
- **Media Centre API:** `/api/media-centre/accreditations` (list, invite),
  `/:id` (approve / reject / info) and `/:id/card` (PDF). Any Media Centre
  user can decide.
- **Card:** `cardPdf()` uses pdfLite (54 × 85.6 mm, the JPEG badge and the
  JPEG passport photo, with the QR drawn from qrcode-generator).
- **Verification:** `functions/media/accreditation/verify/[token].js` (the
  token is random, not the card number). It shows VALID / REVOKED / EXPIRED
  (12 hours after kick-off) and never the phone or email.
- **Revoke:** `/api/admin/media-centre/accreditations` (Super Admins).

### Lobi Stars Weekly (phase 4)
- **Template:** `functions/api/_lib/mediaNewsletter.js` (15 sections;
  `missing()` lists the required ones and respects "No match this week").
  The editor is `src/scripts/mediaCentre/newsletter.ts`.
- **Preview:** `POST /api/media-centre/newsletter` renders it with the
  site's own newsletter template (`renderNewsletter`). `GET` returns the
  last result and next match for the fill-in buttons.
- **On approval:** the kind's `scheduleFor` returns the Wednesday 08:00 of
  the item's week (`newsletter_publish`), or now if that has passed.
  Publishing creates a `newsletter_issues` row (status `scheduled`) that the
  existing sender handles (`runScheduledNewsletters`): batches of 100,
  retries, `newsletter_deliveries` as the send log, an unsubscribe link, a
  plain-text version, and the archive at `/newsletter/<slug>/`. Pictures are
  marked public so email programs can show them.
- **Reminders:** `mediaCron.js` (Monday from 09:00 to `media_team_email`;
  Tuesday 30 minutes after the deadline to the Super Admins), once a week,
  logged.

### Extra sections (phase 5)
- **Press releases** (`mediaPress.js`, kind `press`):
  - public pages from the database, `functions/media/press-releases/[[path]].js`,
    using the shell `src/pages/media/press-releases/index.astro`;
  - the PDF at `/media/press-releases/<slug>.pdf` (pdfLite);
  - on the first publication it is emailed to `mc_contacts`.
- **Matchday Desk** (`mediaMatchday.js`):
  - kind `lineup`: scheduled, written into `match_centre.lineups_json` and
    `squad_json`;
  - kind `live`: created by `/api/media-centre/live` when the user has no
    grant;
  - `applyLiveUpdate()` updates `match_centre` (status, score, timeline),
    clears the homepage cache and sends the usual `autoAlert` fan alerts;
  - grants are in `mc_live_grants`, managed in Admin › Media Centre.
- **Library** (`mediaLibrary.js`, kind `album`):
  - approval commits `src/content/gallery/<slug>-NN.md` and the photos
    (`public/images/gallery/mc/`) in one GitHub commit;
  - the gallery schema gained `album`, `credit`, `players`, `mcId` and
    `hidden`;
  - pictures for reuse come from `/api/media-centre/library`.
- **Interview requests** (`mediaInterviews.js`): the public form posts to
  `/api/media/interview-request`; requests are in `mc_interviews`.
- **Press kit** (`mediaPressKit.js`, kind `presskit`): approval marks the
  files public; the page `/media/press-kit` reads `/api/media/press-kit`.
- **Content calendar** (`mediaCalendar.js`, `mc_calendar`): match days come
  from `events`; Wednesdays from `newsletter_publish`.

### Email
Accreditation emails, reminders and the newsletter use the site's existing
Resend setup. These are Cloudflare secrets:
- `RESEND_API_KEY`
- optionally `RESEND_FROM` / `NEWSLETTER_FROM`

Without the key, emails are skipped (and logged); everything else works.
