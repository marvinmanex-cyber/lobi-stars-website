# Lobi Stars Statistics Center

The private page where the club's statisticians record every match, event by event:
**lobistarsfc.com/staff/statistics-center/** (built 27 Nov 2026). A sibling of the IT Center
(`/staff/squad-data/`) and the Media Centre: its own sign-in, never shown on Google, no public menus.

## Who can use it

| Who | How they sign in | What they can do |
|---|---|---|
| Statistician (e.g. Jiki Benjamin) | Login ID (name + 2–4 digits) and their own password | Create matches, line-ups, live entry, review |
| Statistician with **May publish** | Same | All of the above, plus **Verify and Publish**, reopen, settings |
| Website Super Admin | Their Super Admin email, password and two-step code | Everything |

Accounts are made by a Super Admin in **Admin › Statistics Center › Statisticians & activity**, with a
temporary password that must be changed at the first sign-in. 5 wrong passwords lock an account for 15 minutes;
4 hours without activity signs you out. Everything (sign-ins, every change with old and new values, exports) is in
the activity log, which cannot be changed or deleted.

## Setup steps

Nothing to install: the tables are created automatically on first use.
1. Admin › Statistics Center: add each statistician (tick **May publish** for the senior one).
2. Give them the Login ID and temporary password in person or by WhatsApp.
3. They open lobistarsfc.com/staff/statistics-center/ and choose their own password.

## The flow

1. **New match**: pick the fixture (teams, date, venue, competition are filled in) or type a friendly.
2. **Setup**: match details, then the line-up: the whole squad (the Squad page list) as cards with Starting /
   Substitute / —, a live "Starting XI: n of 11" count, warnings (12+ starters, a shirt number twice) and the
   starting and finishing formations. When the Media Centre's Matchday Desk already has a line-up for the same fixture
   (or the match page has one), it is filled in (read only from there). Opponents are typed by name and number.
3. **Live entry** (phone or tablet): Kick-off, then one tap per action: Goal, Shot, Corner, Foul, Yellow, Red,
   Offside, Substitution, Injury, Save. Each asks team → player → details → minute (filled from the clock).
   Undo last is one tap. **Works without a connection**: taps are kept on the device and sent when the
   connection returns ("unsynced" shows at the top).
4. **Review & publish**: the checklist, every event (edit, remove, restore, add with an exact minute), minutes
   corrections, coach ratings, Man of the Match, possession, attendance, report, highlights link.
   **Verify and Publish** records who verified it.
5. Publishing updates the website by itself: the **/stats/** page, each **player page** (season numbers and a
   new match-by-match list), the **match page** (score, line-ups, timeline, team stats) and a new public
   **/stats/matches/<match>/** page. Drafts and live entry are never public. A published match can be
   reopened for corrections; the website keeps the published version until it is published again.

## Store events, not totals

Every action is one row in `sx_events` (who, what, when, outcome, who entered it). Scores, half-time score,
"score at the time", team stats, minutes played, goals, assists, cards, clean sheets, season and career totals,
form and head-to-head are all worked out from the events and line-ups (`functions/api/_lib/statsCentreData.js`),
so correcting one event corrects every total.

| Fact | Recorded once in | Read by |
|---|---|---|
| Teams, date, venue, competition | `sx_matches` (from the fixture in `events`) | everything |
| Line-ups, shirt numbers, ratings, MOTM | `sx_lineups` | minutes, player stats, public line-ups |
| Every action | `sx_events` | every total |
| Published version | `sx_matches.published_json` | public pages, season totals |
| Website player stats per match | `player_match_stats` (written on publish) | /stats, player pages |
| Website match page data | `match_centre` (written on publish) | /matches/<match>/ |

Tables: `sx_users`, `sx_sessions`, `sx_activity` (append-only), `sx_settings`, `sx_matches`, `sx_lineups`, `sx_events`.

## Event types

goal, shot, pass_key, corner, free_kick, throw_in, penalty, tackle, interception, clearance, block, aerial_duel,
gk_save, gk_claim, foul_committed, foul_won, yellow_card, red_card, offside, substitution, injury, stoppage,
var_decision. The live screen has one-tap buttons for the Phase 1 set; the rest can be added on the Review page.

## Stat definitions

- **Goal**: recorded for the team the goal counts for. Own goal: type "own goal" and choose the player from the
  other team who put it in. A goal also counts as a shot on target.
- **Assist**: the last pass or touch by a team-mate leading directly to the goal (none for own goals).
- **Shot**: any attempt. On target = would have gone in without a save or a defender on the line (goals count);
  off target; blocked (by an outfield player); woodwork.
- **Foul**: for the player who committed it ("foul won" for the player fouled).
- **Cards**: a second yellow is recorded as a red (type "second yellow").
- **Minutes played**: a starter from 0 until substituted or sent off (or full time); a substitute from the minute
  they came on. Added time counts as the period's last minute. Can be corrected per player on Review.
- **Clean sheet**: a goalkeeper who played 60+ minutes in a match where Lobi Stars conceded none.
- **Possession**: typed in after the match (an estimate) until Phase 2.

## Checks before publishing

Errors stop publishing: score not matching the goal events, Lobi Stars without 11 starters, a substitution
of a player who was not on the pitch (or bringing on someone already on), minutes outside the half or after
full time, events after a red card, a Lobi goal without a scorer. Warnings are shown but don't stop it:
opponent line-up missing or not 11, more than 5 substitutions, full time not pressed, no events.

## Exports

Events CSV and matches CSV per season (Exports page), one match's events CSV and a printable match report on the
Review page. Every download is logged.

## Test checklist

Automated: `node --import ./tests/json-hook.mjs --test tests/stats-centre.unit.test.mjs` (10 tests on an
in-memory database, using the demo match in `tests/fixtures/stats-centre-demo.mjs`: Lobi Stars FC 3–1 Demo United
FC, 21 events). By hand on the live site:
- [ ] Score consistency: add and remove a goal; the score and "score at the time" follow.
- [ ] Undo: Undo last removes the last event; Review › Removed events restores it.
- [ ] Offline: switch the phone to airplane mode, tap three events, "3 unsynced" shows; switch back, it clears.
- [ ] Permissions: a statistician without "May publish" cannot publish; a signed-out browser gets the sign-in page;
      the admin page needs a Super Admin.
- [ ] Public pages show published matches only: a draft match has no /stats/matches/ page.

## BST Analysis Form (built 27 Nov 2026)

The paper match-analysis form, on screen: **/staff/statistics-center/bst-analysis/** (menu: BST Analysis Form).
Staff only (statisticians and Super Admins); nothing from it is ever shown on the public website.

**Library:** every analysis (match, opponent, date, Draft/Final, last saved, prepared by) with Open, PDF, Excel and,
for Super Admins, Reopen. **New analysis:** choose a match that has none (one analysis per match). No match yet?
Create it first (New match); the form never asks for match details or line-ups again.

**Section 1, match sheet:** teams, date, time, venue and tournament (read only, from the match), the team list
(starters 1–11, reserves 12–20; Lobi Stars or the opponent) with links to Match Setup, and the starting and finishing
formations (4-3-3, 4-4-2, 4-2-3-1, 3-5-2, 5-3-2, 4-1-4-1, 3-4-3, 4-5-1 or custom), saved on the match.

**Section 2, data collection:** 2-minute blocks per half (1st half 2' … 44', 45', then 45+2' …; 2nd half 47' … 90',
90+2' …; extra time when the match has it). "+ Add stoppage block" adds a block (removable while empty; a block appears
by itself when an event happened in added time). Choose Lobi Stars or the opponent. For the chosen block, every row
has big − and + buttons (phones and tablets); the full grid below shows everything (tap a column to choose a block);
the clock's current block is marked "now". Keyboard: ← → blocks, ↑ ↓ rows, + and −.

| Row | Recorded where (once) |
|---|---|
| Offence/Attack, Defense, Dangerous Attack, Crossing | the form (`sx_bst_cells`), counts |
| xG, xA | the form, 0.00–9.99 per block |
| Shot on/off target, Blocked shots, Free kicks, Corners, Keeper saves, Fouls, Tackles won, Offsides, Cards | **events** (`sx_events`, shared with live entry): a + adds one event (no player; add the player later on Review), a − removes the latest in that block |
| Goal Attempt | worked out: on target + off target + blocked |
| Goal For / Goal Against | worked out from the goal events |

Counts are added on the server (+1 / −1), so two people tapping at the same time both count. The Game Overview and
the half notes save themselves 800 ms after typing stops; if someone else saved the same text in between, the save is
refused and you choose "Keep my text" or "Use their text" (never a silent overwrite). The page shows "Saving…",
"Saved HH:MM:SS" or "Offline — will sync" (changes are kept on the device and sent when the connection returns), and
warns when someone else has the same analysis open.

**Summary:** goal attempts per half and for the match, on target, shot accuracy, goals for and against, xG, and a
momentum chart (Offence/Attack vs Defense per block).

**Mark as Final** (needs 11 Lobi Stars starters, goals matching the score, nothing after full time, both Lobi
formations): read only afterwards; only a Super Admin can reopen. Records who finalised it and when.

**Exports:** PDF = the print page (A4 landscape, 2 pages: match sheet and team list, then the grid with totals and the
momentum chart; Lobi Stars branding, "Prepared by", the date; "DRAFT" across a draft), Excel (.xlsx: Grid, Totals,
Match & line-up; tick to include the opponent), CSV (the grid) and a **blank form** to print for paper use at the ground.

Tables: `sx_bst_analyses` (one per match), `sx_bst_cells`, `sx_bst_presence`; `sx_matches.formation_home_finish` /
`formation_away_finish`. Tests: `tests/stats-bst.unit.test.mjs`.

## Add-on 2 (built 27 Nov 2026)

- **Opponent registry** `sx_opponent_players` (club key, name, shirt number, usual position, last seen): filled from
  Match Setup, offered next time, "copy from our last match against them"; `sx_lineups.opponent_player_id` links rows.
  Warnings (not blocks) for a player or shirt number twice. The opponent line-up stays optional.
- **BST**: Lobi Stars | Opponent | Both for the team list and grid (Both: two rows per metric and the difference).
- **Tag players** (`#/tag/<match>`): events without a player, one tap each, progress bar; edits the event (no new event).
- **Data quality panel** (`bstQuality`), **undo/redo** (last 20), **clock buttons**, **summary page**
  (`/bst-analysis/<id>/summary/`), **dark mode / big buttons**.
- **Coach share links** `sx_share_links` (token stored as a SHA-256 hash; 1–30 days; revocable; notes only if ticked):
  `/staff/statistics-center/share/<token>/` (read only, no scripts, noindex).
- Email to the Super Admins when an analysis is Final; **recycle bin** (restore); **season JSON export**.
- Tests: `tests/stats-addon2.unit.test.mjs` (seed: an opponent with 14 saved players).

## Free-tool improvements (built 27 Nov 2026)

| Improvement | Where | Free tool |
|---|---|---|
| Weather at kick-off | Match Setup › Weather › Fill in | Open-Meteo forecast, archive and geocoding (no key) |
| Match report draft | Review › Write a draft from the events | own template (`draftReport`) |
| Stat graphic PNG | Review › Stat graphic | browser canvas |
| Installable app, opens offline | manifest + service worker (`/staff/statistics-center/sw.js`, scope limited to the Statistics Center; never stores API answers) | Web App Manifest, Service Worker |
| Live keyboard shortcuts | live screen | built in |
| Public stats feed | `/api/stats/feed.json` (published only; CORS open; 5-minute cache) | own API |
| Second check (four-eyes) | Settings; Review › I have checked this match | built in (`sx_matches.second_check_by/at`) |
| WhatsApp share | Review (published), public match page | wa.me links |
| Google Sheets sync | Exports › Google Sheets (`/api/stats-centre/sheet.csv?key=`; key stored hashed) | Google Sheets IMPORTDATA |
| Screen stays on | live screen | Screen Wake Lock API |

Code: `functions/api/_lib/statsExtras.js`; tests: `tests/stats-extras.unit.test.mjs`.

## Coming next (queued by the owner)

3. Phase 2: pitch maps, xG model, video clips, set pieces, player comparison, season analytics, scouting reports,
   training tags, scheduled reports.
