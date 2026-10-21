# Match Checklist (technical notes)

Admin › Matchday › **Match Checklist** (`/admin/match-checklist/`). Every
upcoming Lobi Stars match gets its own checklist, copied from a master
template and grouped into **Before**, **During** and **After** the match.
All staff logins can see it (every role except the gate and kitchen helper
logins). Only **Super Admins** can tick a task as done or not applicable;
the server enforces this. Checklists can be downloaded as a PDF, printed, or
emailed as a PDF. A daily reminder email starts 3 days before kick-off.

How staff use it: STAFF-GUIDE.md, section 35.

## Where things are

| Part | File |
|---|---|
| Tables, template seed, task links, generation and reminder logic | `functions/api/_lib/matchChecklist.js` |
| Migration (the same tables, for `wrangler d1 migrations apply`) | `migrations/0006_match_checklist.sql` |
| Permission checks, status rules, upload checks | `functions/api/_lib/checklistApi.js` |
| PDF and email layouts | `functions/api/_lib/checklistOutput.js`, `functions/api/_lib/pdfLite.js` (no library) |
| Daily reminder email | `functions/api/_lib/checklistReminders.js` |
| Admin API | `functions/api/admin/match-checklist/` (`index`, `tasks/[id]`, `tasks/[id]/history`, `tasks/[id]/file`, `pdf`, `email`, `templates`, `settings`) |
| Timer and manual jobs | `functions/api/internal/checklist-run.js`, `scripts/checklist.mjs` |
| Admin pages | `src/pages/admin/match-checklist/` (`index`, `archive`, `templates`, `settings`, `go`) |
| "Checklist task" banner (every admin page) | `src/components/admin/ChecklistBanner.astro`, included by `AdminNav.astro` |
| Safe redirect after signing in | `src/lib/safeNext.ts` (used by `src/pages/admin/login.astro`) |
| Tests | `tests/match-checklist.unit.test.mjs`, `tests/match-checklist.test.mjs` |

## Data

Seven tables, created by `ensureChecklistSchema()` the first time they are
needed (the project's usual way) and also listed in
`migrations/0006_match_checklist.sql`. Existing tables are not changed.

- `checklist_templates`, `checklist_template_tasks`: the master list. The 33
  default tasks are seeded when there is no template yet.
- `match_checklists`: one per match (`match_id` is unique). Statuses:
  `active`, `awaiting_closeout` (3 hours after kick-off, or at full time),
  `closed` (the archive). There is no foreign key to `events`, because a
  match can be deleted; the checklist is then closed with a note.
- `match_checklist_tasks`: the tasks, copied from the template. Due times are
  stored as UTC plus the offset from kick-off, so they move when kick-off moves.
- `checklist_activity_log`: every change (who, when, old and new value, reason).
- `checklist_settings`: reminder settings (key/value).
- `checklist_reminder_log`: one row per person per day, so nobody gets the
  reminder twice in a day.

Task link columns on both task tables: `link_type` (`internal`, `external`,
`none`), `link_route`, `link_params`, `link_url`, `link_label`.

## When checklists are made and updated

`syncChecklists()` runs when a match or fixture is saved (events and league
fixtures endpoints), when the checklist page opens, and every 15 minutes from
the timer. It:

- makes a checklist for the next Lobi Stars match and any other within
  14 days (`GENERATE_WITHIN_DAYS`), never twice for the same match;
- moves the due times of unfinished tasks when kick-off changes;
- sets `awaiting_closeout` 3 hours after kick-off or at full time;
- closes the checklist with a note if the match is cancelled, switched off or deleted.

A checklist closes by itself when every task is done or not applicable, or
when a Super Admin closes it.

## Permissions (server side)

| Action | Who |
|---|---|
| See checklists, PDF, print view, history | every staff login except gate and kitchen helpers (`matchday.checklist.view`, added to every role) |
| Notes, files, status Not started / In progress / Submitted for review, email the PDF | the same, except read-only roles |
| Done, Not applicable, untick (a reason is required), owners, close a checklist | Super Admins |
| Templates, reminder settings | Super Admins |

Refused actions get `403`. Changes from another website are refused (Origin
check, on top of the SameSite=Strict admin cookie). Uploads: PDF, JPG, PNG,
DOCX or XLSX only, checked by the file's first bytes, at most 10 MB, stored
privately in R2 (`PROGRAMME_BUCKET`, folder `checklist-files/`, random names)
and downloaded only through the signed-in admin API.

## Task links ("Go to task")

Each task can open the admin page where the work is done. Links are built
when the page, email or PDF is made, so they always use the match's current
values. Placeholders: `{match_id}`, `{fixture_id}`, `{home_team}`,
`{away_team}`, `{match_date}`, `{competition_id}`, `{season_id}`,
`{opponent_id}`, `{match_slug}`, `{site_url}`. A missing value hides the button
and reports the link as broken.

- Internal links get `?from=checklist&task=<id>` (before any `#`). The page
  then shows the **Checklist task** banner with "Back to checklist" and
  "Mark as submitted for review" (admins) or "Mark as done" (Super Admins).
- Emails and PDFs use `https://lobistarsfc.com/admin/match-checklist/go/?task=<id>`,
  which opens the task's current link. Signing in first comes back to it;
  `safeNext()` only allows `/admin` pages of this website, so a link can't
  send staff to another site after they log in.
- External links must start with `https://` and open in a new tab
  (`rel="noopener noreferrer"`).
- The no-access page shows "Back to checklist" when opened from a task.
- The daily check lists broken links (unknown page, missing match value, bad
  external address) in a "Broken task links" note in the Super Admins' copy
  of the reminder email.

### Default task to page mapping

Confidence: **high** = the exact place the work is done (for this match where
possible); **medium** = the nearest related page.

| Task | Page | Confidence |
|---|---|---|
| Confirm fixture details (date, kickoff, venue, broadcast) | League › Fixtures | high |
| Player registration and eligibility check | Squad & Players (content editor) | medium |
| Match day program: content written | Matchday Programme | medium |
| Match day program: design approved and printed/published | Matchday Programme | medium |
| Ticketing and gate arrangements | Match Tickets | high |
| Social media countdown and preview posts | Share any page, with this match's page | high |
| Starting line-up graphic ready | Live Match Control › line-ups | medium |
| Team sheet submitted | Live Match Control › matchday squad | medium |
| Live social media updates | Live Match Control › live timeline | medium |
| Photography and video coverage | Live Match Control › gallery | medium |
| Match stats captured | Live Match Control › stats | high |
| Incident log (injuries, cards, crowd issues) | Live Match Control › live timeline | medium |
| Full-time result posted | Live Match Control (this match) | high |
| Post-match press conference / interviews | News: new Reaction/Interview post, prefilled | high |
| Match report published | News: new Match Report, prefilled | high |
| Highlights video uploaded | Live Match Control › Watch Live / highlights links | medium |
| Injury report | News: new Team News post, prefilled | medium |
| Gate takings and expenses reconciled | Match Tickets (sales) | medium |
| Thank-you post for fans and sponsors | Share any page, with this match's page | medium |

No page on the website (no button; a Super Admin can add an external link in
Templates, e.g. a shared form or document): opposition scouting, medical and
fitness report, travel booking, hotel and feeding, stadium inspection,
security and police liaison, match officials' hosting, media accreditation
list, pre-match press conference, kit check, ambulance and medical team,
crowd and security monitoring, post-match analysis, disciplinary or incident
reports to the league.

Note: pages in the content editor (Squad & Players, News) don't show the
Checklist task banner, because the editor is a separate app. Use the
checklist page to update those tasks.

## Reminders

The timer Worker (`workers/kitchen-cron`) calls `/api/internal/checklist-run`
every minute. From the reminder time (default 08:00 Lagos) it sends **one**
email per person per day with everything outstanding across all open
checklists: Overdue, Due today, Due in the next 3 days. Subject:
`[N outstanding] Match checklist: Home vs Away — date`, starting with
`MATCH DAY:` on match day. Nothing is sent when nothing is outstanding.

A task is included from `reminder_days_before` days before kick-off (default 3),
or earlier from its own "remind from" time, and after-match tasks for
`post_match_reminder_days` after the match (default 3). Recipients: all admins
(default), or task owners plus Super Admins; plus any extra addresses.

## Environment

| Name | Needed | Notes |
|---|---|---|
| `RESEND_API_KEY` | already set | sends the reminder and checklist emails |
| `CRON_SECRET` | already set | the timer Worker and `scripts/checklist.mjs` |
| `PROGRAMME_BUCKET` (R2 binding) | already set | uploaded task files |
| `SITE_URL` | optional | absolute links in emails and PDFs (default `https://lobistarsfc.com`) |
| `CLUB_NAME` | optional | how Lobi Stars matches are recognised (default `Lobi Stars`) |

## Manual commands

```
CRON_SECRET=... node scripts/checklist.mjs generate            # make / update checklists now
CRON_SECRET=... node scripts/checklist.mjs remind --dry-run    # who would get what today
CRON_SECRET=... node scripts/checklist.mjs remind --force      # send today's reminder now
```

Add `--base http://127.0.0.1:8788` to run against a local server.

## Testing locally

1. `npm run build`, then start `wrangler pages dev dist` with
   `ADMIN_CODE=test-code-123 CRON_SECRET=cron-test-secret --r2=PROGRAMME_BUCKET`.
2. `node --test tests/match-checklist.unit.test.mjs` (no server needed).
3. `BASE=http://127.0.0.1:8788 node --test tests/match-checklist.test.mjs`.
4. By hand: add a match 5 days ahead in Admin › League › Fixtures, open
   Matchday › Match Checklist, press a "Go to task" button, check the banner,
   sign in as a non-Super Admin and check the tick boxes are greyed out.
