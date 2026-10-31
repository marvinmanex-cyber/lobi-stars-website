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

### Email
Accreditation emails, reminders and the newsletter use the site's existing
Resend setup. These are Cloudflare secrets:
- `RESEND_API_KEY`
- optionally `RESEND_FROM` / `NEWSLETTER_FROM`

Without the key, emails are skipped (and logged); everything else works.
