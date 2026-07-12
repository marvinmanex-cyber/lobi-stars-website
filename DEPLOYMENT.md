# Deploying the multipage rebuild

This branch (`feature/multipage-astro-ticketing`) turns the site into an Astro
project. It is not yet merged to `main` — review it first (see below), then
merge when you're happy with it.

## 1. Cloudflare Pages build settings

The site now needs a build step. In the Cloudflare Pages dashboard, on this
project's Settings → Builds & deployments, set:

- **Framework preset:** Astro
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Root directory:** `/` (unchanged)

Cloudflare Pages will run `npm install && npm run build` on every push and
deploy the `dist/` folder. No environment variables are required for the site
itself.

## 2. Reviewing before merging to main

```
npm install
npm run dev      # local preview at http://localhost:4321
npm run build    # production build, output in dist/
npm run preview  # serve the production build locally
```

Once you're happy, merge `feature/multipage-astro-ticketing` into `main` and
push — Cloudflare Pages will pick up the new build settings automatically on
the next deploy (make sure you've changed the build settings in step 1 first,
otherwise Cloudflare will try to serve the raw repo files instead of running
the build).

## 3. New pages added

- `/news` and `/news/<article>` — pulled from the CMS "News Articles" collection
- `/squad` and `/squad/<player>` — pulled from the CMS "Squad / Players" collection
- `/fixtures` — pulled from the CMS "Fixtures & Results" collection
- `/gallery` — pulled from the CMS "Gallery Photos" collection

These are empty until content is added via `/admin` (see below) — each shows a
friendly "nothing here yet" message with a link to `/admin` rather than a
blank page.

## 4. What's now editable from `/admin` without touching code

| Section | Where it shows | CMS collection |
|---|---|---|
| Club management & staff (Chairman, Head Coach, etc.) | Homepage "Club Management" | Club Management & Staff |
| Club shop products | Homepage "Club Shop" | Club Shop / Merchandise |
| News articles | Homepage teaser + `/news` | News Articles |
| Player profiles | `/squad` | Squad / Players |
| Fixtures & results | `/fixtures` | Fixtures & Results |
| Match photo albums | `/gallery` | Gallery Photos |

**Not yet wired to the CMS** (still hardcoded in the homepage — lower churn,
more "branding" than day-to-day content, but straightforward to convert later
the same way if you want them editable too):
- Hero background slides (the rotating photos behind "LOBI STARS")
- Sponsor logos in the top bar
- The "About / Archives" section's history photo and Media Vault photos
- Ticket booking matches/seat tiers, membership tiers, sponsorship packages
  (these are part of interactive booking flows, not simple content lists)

## 5. Admin access (who can sign in at /admin)

The CMS (Sveltia CMS) authenticates against **GitHub**, not email/password.
Signing in means generating a GitHub personal access token tied to a GitHub
account that has write access to this repository
(`marvinmanex-cyber/lobi-stars-website`).

- `marvinmanex@gmail.com` — presumably already has access as the repo owner/
  account holder.
- `iorwasederekkakaan@gmail.com` — needs to be added as a **collaborator** on
  the GitHub repo before they can sign in. That needs their **GitHub
  username** (not their email) — go to the repo's Settings → Collaborators →
  Add people, or tell me the username and I can talk you through it.

Once added, they go to `/admin`, click "Sign in with personal access token",
follow the pre-filled GitHub link (scopes are pre-selected), paste the token
in, and they're in.

## 6. Still outstanding (not part of this branch)

The ticketing system (online purchase + QR/barcode gate scanning via
Cloudflare D1 + Paystack) is a separate, larger piece of work not yet
started. Ask to pick that up whenever you're ready.
