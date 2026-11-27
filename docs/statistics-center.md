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
2. **Setup**: match details and line-ups. Lobi Stars players come from the squad list (real player pages);
   opponents are typed by name and number.
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

## Coming next (queued by the owner)

1. BST Analysis Form (2-minute block grid, analyst metrics, PDF/Excel exports).
2. Opponent line-up registry and BST improvements.
3. Phase 2: pitch maps, xG model, video clips, set pieces, player comparison, season analytics, scouting reports,
   training tags, scheduled reports.
