# Lobi Stars FC Live: launch readiness (Aeson Sports Radio relay)

Checked 21 Oct 2026 against commit `c44f039` (production runs the same commit).
Local tests ran on `wrangler pages dev`; the live site got read-only GET
requests and invalid-signature webhook calls only. Builds on
`docs/radio-audit.md`.

## 1. Overall verdict: NOT READY

**The website side is ready.** Every code item works locally and on
lobistarsfc.com, and Aeson's status feed is read live. **The audio side does
not exist yet:** there is no stream server, no `stream.lobistarsfc.com` DNS
record, no HTTPS certificate and no listen address saved. Fans would see "Off
air" for the whole match. Once Aeson's server is up and the three manual steps
below are done, this becomes READY (a re-check takes about 10 minutes).

Note: the fixture on the site is **Sunday 8 November 2026**, kick-off 16:00
(Nigerian time), commentary from 15:45, not 7 November. Check that the date is
right in Admin › Fixtures.

## 2. Results

| Item | Status | Evidence | What's needed |
|---|---|---|---|
| A1 Build / local server | READY | `npm run build` 0 errors (routes check OK); `wrangler pages dev` restarted clean, 0 errors in the log. | — |
| A2 Functions exist and run | READY | Local and live: `GET /api/live-status` 200 JSON; `POST /api/aeson-webhook` refuses unsigned (401 locally, 503 live: no secret yet); GET 405. | — |
| A3 Bindings and secrets (names only) | NEEDS MANUAL TEST | `wrangler.toml`: D1 `DB` → `lobi-stars-tickets`; R2 `PROGRAMME_BUCKET`, `BACKUP_BUCKET`. No KV is used (by design). Production has `SESSION_SECRET` (encrypts an admin-saved webhook secret). **Not set:** `AESON_WEBHOOK_SECRET`, no admin-saved webhook secret, no saved listen address. | Save the webhook secret (task 3). Confirm in the dashboard: Workers & Pages › lobi-stars-website › **Settings › Bindings** (D1 `DB`) and **Settings › Variables and Secrets › Production**. |
| A4 Secret leak scan | READY | No secret names or values, partner names or addresses in any built public file, the live /commentary page, its 4 scripts or /api/live-status. Browser storage: nothing for commentary; `ls_admin_code` / `ls_staff_code` are session-only, used only by the old shared-code logins (shared admin code is off live). | — |
| B1 Admin partner section | READY | Fields present (status, primary, backup, secret); values save and reload; secret field empty after reload ("saved" placeholder), not in the page or admin API; `/admin/commentary/` without login → 302. | — |
| B2 `/api/live-status` | READY | Server-side read cached 15 s (same timestamp 3 s later, new one after 16.5 s); fields onAir/listeners/broadcast/liveMatch/stale; bad URL → 200 with onAir:false, stale:true. | — |
| B3 Webhook | READY | Missing, wrong-secret, old-timestamp and changed-body signatures refused (401); a correctly signed test message flipped the status at once; tests/partner-radio.test.mjs 5/5. | — |
| B4 /commentary page | READY | At 360 px with a mocked live status: "Live now", score 2–1, "Live · 67'", three scorers, commentators; off air: "Off air – next match: …"; polls every 20 s (gaps 20, 20 s); primary 503 → backup played; no overflow; only club branding (outside links = the club's own social accounts and share buttons). Only console entry: the deliberate 503 of the broken primary. | — |
| B5 Test stream + health check | READY (after fix) | Test stream: real audio "working (audio/mpeg)", HTML page "not working (text/html)", dead address "not working (Could not connect)", Aeson feed "working (off air, 0 listening)". Health check: dead → FAIL, HTML → FAIL, audio → PASS (see fix). | — |
| C1 Live /commentary | READY | HTTPS 200, no console errors, 0 px overflow at 360 px; shows "Off air – next match: Lobi Stars FC vs Bichi First FC, Sun, 8 Nov 2026, 15:45", play disabled. | — |
| C2 Live `/api/live-status` | READY | Valid JSON: onAir false, stale false (Aeson's feed read), listeners 0, next match 8 Nov. | — |
| C3 Live webhook, invalid signature | READY | All-zero signature and no signature: both refused (HTTP 503 "Invalid signature": no secret saved yet); status unchanged. | After task 3 the refusal becomes 401. |
| C4 DNS `stream.lobistarsfc.com` | NOT READY | A, AAAA and CNAME: NXDOMAIN (no record). | Task 1. |
| C5 HTTPS on stream.lobistarsfc.com / listen URL | NOT READY | No host to connect to; no listen address saved. | Tasks 1–2. |
| C6 Site reaches Aeson's feed | READY | Fetched server-side by the Function (last read OK, no errors); CORS not needed. | — |
| C7 Production = latest commit | READY | Production deployment source `c44f039` = `git HEAD`. | — |
| Request budget (free plan) | NEEDS DECISION | ≈4 function requests a minute per listener; 500 listeners × 2½ h ≈ 300,000 a day vs 100,000 free. | Blocker 3. |

## 3. Fixes made in this pass

One commit, `c44f039` "radio: launch-check fixes", deployed:
- The Website Health **stream** check tested the relay's partner feed whenever
  `PARTNER_ORIGIN_STREAM_URL` was set, even when fans connect straight to a
  stream.lobistarsfc.com address, so a dead or HTML address showed "on air".
  It now tests the address fans actually use. Verified: dead → FAIL, HTML →
  FAIL, real audio → PASS; health, commentary and partner tests 18/18.

## 4. Blockers, in priority order

**1. No audio stream (Aeson server, DNS, HTTPS, listen address).** Needs
Aeson's server first (setup guide already sent). When Aeson gives the server IP
and a working Listen URL, paste into Claude Code in VS Code:

```
Aeson's stream server IP is <IP> and the Listen URL is https://stream.lobistarsfc.com/<path>.
Guide me step by step to add the Cloudflare DNS record "stream" (A, DNS only / grey cloud),
then check that stream.lobistarsfc.com resolves to that IP (not a Cloudflare address), has a
valid HTTPS certificate and returns audio, then save the Listen URL as the Primary listen
address in Admin › Live Commentary, press Test stream, and update docs/launch-readiness.md.
```

**2. No webhook secret.** Not strictly blocking (status still updates within
15 s), but needed for "within seconds". Paste:

```
Help me create a strong webhook secret for Aeson Sports Radio, save it in Admin › Live
Commentary › Broadcast partner (never print it), and write the message I send Aeson with
the webhook address and the signing instructions from COMMENTARY-STREAM-SETUP.md.
```

**3. Free-plan request budget.** A big audience could use up the day's
100,000 function requests mid-match. Decide one, then paste:

```
For Lobi Stars FC Live on match days, either (a) tell me exactly how to move the Cloudflare
account to Workers Paid (US$5/month), or (b) reduce the commentary player's requests (poll
/api/live-status every 30-45 s while playing and fold the 60 s listener check-in into it),
keeping all current behaviour, then test and deploy.
```

## 5. Outstanding manual tasks

| # | Who | Task |
|---|---|---|
| 1 | Aeson + Marvin | Aeson sets up the stream server (guide: "Aeson Radio: live streaming for Lobi Stars FC Live") and sends the server IP. Marvin adds Cloudflare › lobistarsfc.com › DNS › Add record: **A**, name **stream**, value = that IP, proxy **DNS only (grey cloud)**. |
| 2 | Aeson + Lobi Stars staff | Aeson issues the HTTPS certificate for stream.lobistarsfc.com and sends the Listen URL. Staff paste it into Admin › Live Commentary › **Primary listen address** (and a backup if Aeson has one), **Save settings**, then **Test stream**: every line should say working. |
| 3 | Lobi Stars staff | Webhook secret: make a long random code, save it in Admin › Live Commentary › Broadcast partner, send it to Aeson privately with the webhook address shown there (handover A7a). |
| 4 | Marvin | Confirm the fixture date (8 vs 7 November) in Admin › Fixtures. |
| 5 | Club | Decide on the request budget (blocker 3) before the first match. |
| 6 | Aeson + staff | A 5-minute live test at the stadium on the matchday internet connection, at least a few days before the match. |

## 6. Matchday check for Lobi Stars staff

1. Open **lobistarsfc.com/commentary** on a phone using mobile data, 15 minutes before kick-off.
2. Confirm it shows **LIVE** ("Live now") and that audio plays when you press play.
3. After a goal, confirm the score updates within about 20 seconds (the goal must be entered in **Live Match Control**).
4. Report any problem in the shared WhatsApp group.
