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

## Updated table (after the work)

Filled in at the end of the work (L6).
