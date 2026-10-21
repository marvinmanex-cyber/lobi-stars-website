# Lobi Stars FC Live: Aeson Sports Radio relay audit

Audit of 21 Oct 2026, before any change. Status key: DONE / PARTIAL / MISSING /
CONFLICT / MANUAL.

What already exists: a white-label player ("Lobi Stars FC Live") on
`/commentary`, the Matchday Live tab, the homepage LIVE banner and a pop-out
mini player, all driven by one audio engine (`src/lib/livePlayer.ts`) that
polls `GET /api/commentary` (on-air state from the fixtures' commentary
windows, cached 15 s). Admin › Matchday › Live Commentary
(`src/pages/admin/commentary.astro`) has the public stream address, backup
stream address, commentators, maximum listeners, Save, Test stream, and a
broadcast report. Website Health has a "Commentary stream" check.

Aeson's status feed `https://www.aesonsports.com/api/radio/status` already
answers (HTTP 200, Vercel) with:
`{"onAir":false,"isLiveDJ":false,"listeners":0,"listenUrl":null,"backupListenUrl":null,"broadcast":null,"updatedAt":"…","stale":true}`.
It has no live-match fields yet, so match, score and scorers come from the
club's own Live Match Control, with Aeson's values used where present.

| Item | Status | Evidence | Action |
|---|---|---|---|
| L1 Admin "Broadcast partner: Aeson Sports Radio" | PARTIAL | `functions/api/admin/commentary.js` GET/PUT already store `stream_url` and `backup_url` in D1 `commentary_settings` (lobistarsfc.com addresses only); the admin page has the fields, Save and Test stream. No status URL, no webhook secret, no partner section. | Extend the same API and page: a partner section with the status URL (default Aeson's URL), reusing the existing primary/backup fields, and a webhook secret that is encrypted at rest (AES-GCM, key derived from `SESSION_SECRET`) and never returned after saving (or `AESON_WEBHOOK_SECRET` from Cloudflare). |
| L2 `GET /api/live-status` | MISSING | Only `GET /api/commentary` exists (fixture windows, no partner data). | Build it: reads Aeson's feed server-side, cached 15 s in D1 (so a webhook update shows everywhere at once); returns `{ onAir, listeners, broadcast, liveMatch, stale }` plus the existing commentary state, so players poll one address instead of two. Aeson unreachable → `onAir:false, stale:true`, never an error page. |
| L3 `POST /api/aeson-webhook` | MISSING | No webhook endpoint. | Build it: HMAC-SHA256 over `<timestamp>.<raw body>` (`X-Aeson-Timestamp`, `X-Aeson-Signature: sha256=<hex>`), five-minute replay window, constant-time compare; stores the pushed status (or re-fetches the feed) immediately. |
| L4 `/commentary` page | PARTIAL | Brand, Live badge, match strip with score, commentators, "Off air – commentary starts at …", backup switch after **2** failures, polling `/api/commentary` every 20 s (60 s when off air). No minute, no scorers, no "next match" wording, not polling live-status. | Extend `livePlayer.ts` and `LivePlayer.astro` (no rewrite): poll `/api/live-status` every 20 s, show minute and goal scorers, "Off air – next match: …", switch to the backup on the first error and alternate after that. Partner text is cleaned (no partner names, AzuraCast or links); the stream address stays lobistarsfc.com-only. |
| L5 Test stream + health check report Aeson | PARTIAL | `functions/api/admin/commentary/test.js` probes the streams only; health check `stream` covers the stream address only. | Add an "Aeson Sports Radio status feed" result to Test stream, and a new health check `partner_status` (matchday category). |
| L6 Report | MISSING | — | Updated table below, files changed, bindings and secrets, DNS reminder, test checklist. |
| — Aeson's feed exists | DONE (Aeson side) | Answers 200 with the fields above. | Nothing to build; the site reads `onAir`, `listeners`, `broadcast`; `listenUrl` is never passed to fans (white-label). |
| — Cloudflare / DNS | MANUAL | No `stream` DNS record yet; no webhook secret yet. | See "Manual steps" in the report. |

## Updated table (after the work, 21 Oct 2026)

| Item | Status | Evidence | Commit |
|---|---|---|---|
| L1 Admin "Broadcast partner: Aeson Sports Radio" | DONE | Status address (blank = Aeson's standard), primary + backup listen addresses (the existing fields, moved into the box), webhook secret (AES-GCM at rest, `webhookSecretSet` only in the API, never the value), webhook address with Copy, last status line. Short secret and non-https status address refused. | 2ba565a |
| L2 `GET /api/live-status` | DONE | Live on lobistarsfc.com: reads Aeson's feed (`stale:false`, off air, 0 listeners), next match listed, no partner text. Unreachable feed tested: 200 with `onAir:false, stale:true`. | ea8efa3 |
| L3 `POST /api/aeson-webhook` | DONE | Missing, wrong-secret, old-timestamp and changed-body messages all 401; a valid one flips `onAir` (live-status reflected it within 0.2 s); off-air flips back; GET 405; no secret saved yet = 503. | ac26c74 |
| L4 `/commentary` page | DONE | Browser test: "Live now", "Live · 61'", score 0–2, both scorers, commentators; "Starting soon" when Aeson is off during the window; "Off air – next match: …" otherwise; primary 503 → backup played ("Live"); no partner text, secrets or partner addresses in the page or poll. Fixed a double-count that stopped the backup switch. | 4883241 |
| L5 Test stream + health check | DONE | Test stream adds "Aeson Sports Radio status feed" (and warns when no webhook secret); health check `partner_status` PASS ("answers (401 ms): off air, 0 listening"). | 13bc45d |
| L6 Report | DONE | This section; tests/partner-radio.test.mjs (5 tests) + existing commentary, Matchday Live and alert tests (27) pass. | (this commit) |
| Cloudflare / DNS / Aeson | MANUAL | See below. | — |

## Files changed

- New: `functions/api/_lib/partnerRadio.js` (settings, encrypted secret, feed reader with 15 s D1 cache, text cleaning, HMAC), `functions/api/live-status.js`, `functions/api/aeson-webhook.js`, `tests/partner-radio.test.mjs`, `docs/radio-audit.md`.
- Changed: `functions/api/admin/commentary.js`, `functions/api/admin/commentary/test.js`, `functions/api/_lib/healthChecks.js`, `src/pages/admin/commentary.astro`, `src/lib/livePlayer.ts`, `src/components/commentary/LivePlayer.astro`.
- Docs: `STAFF-GUIDE.md` (section 9), `STAFF-MATCHDAY-GUIDE.md` (item 11), `COMMENTARY-STREAM-SETUP.md` (status feed and webhook contract, with a Node signing example), `DEPLOYMENT.md` (variables), `CHANGELOG.md`, `HANDOVER-TODO.md` (A7a).
- New D1 table `partner_status` (created automatically). No new bindings: D1 (`DB`) and the Cloudflare cache only; there is no KV namespace in this project.

## Manual steps (Cloudflare, DNS, Aeson)

1. **Webhook secret** (pick one): save a long random code in Admin › Commentary › Broadcast partner, **or** add the Cloudflare secret `AESON_WEBHOOK_SECRET` (it wins). Share it with Aeson privately with the webhook address `https://lobistarsfc.com/api/aeson-webhook`.
2. **Optional:** `AESON_STATUS_URL` (only if Aeson's feed moves; the admin field does the same).
3. **DNS** (when Aeson's server is ready): Cloudflare › lobistarsfc.com › DNS › Add record: **A**, name **stream**, value = Aeson's server IP, proxy **DNS only (grey cloud)**. Then Aeson issues the HTTPS certificate; then paste the listen address into Primary listen address and press Test stream.
4. **Aeson:** keep `/api/radio/status` answering, send the signed webhook on every on-air / off-air change, and (optional) add `liveMatch` to the feed (contract in COMMENTARY-STREAM-SETUP.md).

## Test checklist (live)

- [ ] Off air: /commentary shows "Off air – next match: …"; play button disabled outside the commentary window.
- [ ] Window open, Aeson off air: badge "Starting soon", play possible.
- [ ] Aeson on air (webhook): badge "Live now" within seconds; score, minute, scorers, commentators shown.
- [ ] Backup fallback: with a backup address set, stop the primary feed: the player says "Reconnecting…" then plays the backup.
- [ ] Webhook: a message with a wrong secret or an old timestamp is refused (401); a correct one flips the status within seconds.
- [ ] Aeson feed unreachable: live-status answers `onAir:false, stale:true`; Website Health shows the partner check as WARNING (FAIL around a match).
- [ ] No secrets on the client: view source of /commentary and open /api/live-status: no secret, no Aeson address or name.

## Risk to watch: the free plan's daily request allowance

Each fan with the player open polls `/api/live-status` every 20 s and sends a
listening check-in every 60 s: about 4 function requests a minute. 500
listeners for a 2½-hour broadcast is about 300,000 requests, above the free
plan's 100,000 a day, after which the site's dynamic parts stop until
midnight UTC. Before a big match, consider Cloudflare Workers Paid (US$5 a
month, 10 million requests) or a longer poll interval. Not changed here: a
paid plan is the club's decision.
