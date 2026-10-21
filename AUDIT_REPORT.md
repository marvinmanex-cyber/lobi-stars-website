# Audit: Match Checklist, "Go to task" links and AI Fix

Date: 21 October 2026 (Africa/Lagos). Audited by Claude, check only: no code
was changed for this audit.

How things were checked:
- **Code:** read, with file and line references below.
- **Automated tests:** run on the local test server.
- **Live checks** against the local server, signed in as a Super Admin:
  every task link opened, key pages opened, and a template edit tried and then
  put back.
- **Migrations:** run on a brand-new empty database (SQLite).

No Claude credit was spent and no real emails were sent. The AI tests use a
local stand-in for Claude and GitHub; the website's equivalent of
"CLAUDE_MOCK" is the test-only setting `ANTHROPIC_BASE_URL`.

---

## UPDATE (21 October 2026, later the same day): the open items are now built

After this audit you asked for everything to be built. Every item that was
⚠️ or ❌ has now been built and tested, apart from one ❓ that can only be
checked on the live site (A16).

| ID | Was | Now | Evidence |
|---|---|---|---|
| A3 | ⚠️ one template only | ✅ optional separate **home** and **away** templates (Templates › "+ Separate home template"); a match uses its own venue's template, otherwise the shared one | `pickTemplate` in `matchChecklist.js`; `create_variant` / `delete_template` in `templates.js`; server test "separate home template…" |
| B7 | ⚠️ no bar in the content editor | ⚠️ unchanged (the content editor is a separate app); those tasks are updated from the checklist | Documented in STAFF-GUIDE.md section 35 |
| B11 | ⚠️ only on digest days | ✅ broken links are emailed to the Super Admins every day, even when no reminder goes out | `checklistReminders.js` (no-digest branch) |
| B12 | ⚠️ banner not in an automated test | ✅ test checks the bar is hidden by default, only shown with `?from=checklist` and a numeric task, and part of the shared layout | `tests/match-checklist.test.mjs` |
| C3 | ⚠️ per feature only | ✅ model per **task type**; the advanced model can only be chosen for long writing (news and checklist drafts) and code proposals; cheap everywhere else | `modelFor`, AI Settings; server test "settings are checked…" |
| C5 | ⚠️ staff text sent as typed | ✅ emails and phone or card numbers are removed from everything staff type (fixes, drafts, notes, Ask Claude) | `scrubPersonal`; unit and server tests |
| C8 | ⚠️ warning email untested | ✅ the warning email is recorded in the fix log (mail log) even without email; tested at 85% (once a month) and the stop at 100% | `aiEmail`, `budgetCheck`; `tests/ai-fix-rules.unit.test.mjs` |
| C11 | ⚠️ verify/undo partial | ✅ every fix type has gather, prompt, schema, input, preview, apply, backup/undo where it changes something, and the daily verify | `FIX_ACTIONS`, `verifyApplied` |
| C12 | ⚠️ one link only | ✅ per-recommendation buttons on Analytics: Click to fix (Super Admins), Prepare fix (Head of Media, CRM Manager), Fix with my input; none for manual items | `analytics.astro` `aiButtons()`; permission `ai.prepare` |
| C13 | ⚠️ no Edit / Try again | ✅ before/after with new words highlighted, ✎ Edit (checked again), Try again with a note (always a new call), Cancel | `editFix`, `prepareFix({ note })`; server test |
| C14 | ⚠️ no "ask" rule | ✅ fact-based drafts may answer `{"needs": …}`; the question is shown ("Claude asks: …") | `NEEDS_HINT`, `allowNeeds`; tests |
| C15 | ⚠️ no "field empty" check | ✅ `canAutoApply` needs: on + low risk + allowed + **nothing to overwrite** + valid + no facts; tested, including "low risk but the field has content → approval" | `canAutoApply`; unit test |
| C16 | ⚠️ no facts banner | ✅ yellow "check the facts" banner on every fact text; fact texts can never auto-apply | AI Fix page, checklist drafts |
| C18 | ⚠️ partial | ✅ backup before apply; status, log and results saved in one batch; undo restores the exact value and **asks first if edited since**; verify sets verified **or failed** by re-running the Analytics rule | `applyFix`, `undoFix`, `verifyApplied`; tests |
| C19 | ❌ | ✅ `ai_fix_log` table and **Fix history** page with filters (what, fix type, who, dates, search) | `/admin/ai/history/` |
| C20 | ⚠️ | ✅ grouped estimate with **cost shown and confirmed**, one batch, "ready" email, **Ready to apply** list with tick boxes | `planAll`, `prepareAll`, `runBatchPoll`, `applyMany`; server test |
| C21 | ⚠️ | ✅ top 20 by batch, auto-apply, **summary email with spend**, once a week (claimed atomically); tested | `weeklyScan`; unit and server tests |
| C22 | ❌ | ✅ figure saved on apply, re-measured at 14 and 30 days, **Fix results** page (better / worse / no change) | `aiMetrics.js`, `recheckResults`, `/admin/ai/results/` |
| C23 | ❌ | ✅ **Draft with Claude** on 5 checklist writing tasks: match facts filled in, asks for missing facts, facts banner, saved as **Draft** only, task → submitted for review | `checklistDraft.js`, `tasks/[id]/draft.js`; server test |
| C24 | ⚠️ no warning | ✅ "Claude can make mistakes" note; read-only (no tools; tested) | AI Fix page; server test |
| C25 | ❌ | ✅ **code proposals** (Super Admins): one page file, checked edits, saved on an `ai-proposal/…` branch (never `main`), draft pull request when the token allows, download / email to a developer, "not live" label | `codeProposal.js`, `github.js`; server test |
| C26 | ⚠️ | ✅ `CLAUDE_MOCK=true` (no AI, no cost, logged) and `scripts/ai-dry-run.mjs` / `?action=dry_run` | unit and server tests |
| C27 | ⚠️ | ✅ tests added for verify, weekly duplicates, the auto-apply rule, edit checks, personal data, model choice, code edits, results | `tests/ai-fix-rules.unit.test.mjs` (10), `tests/ai-fix.test.mjs` (9) |
| D2 | ⚠️ | ✅ the real fault was in `schema.sql` (an index on a column the code adds later). Fixed: `schema.sql` plus all 8 migrations now build a brand-new database cleanly (42 tables) | SQLite check |
| D5 | ⚠️ | ✅ `.dev.vars.example` and the complete list in DEPLOYMENT.md now include every new variable | — |

**Things you may still do** (optional):
- add "Pull requests: Read and write" to the GitHub token, so code proposals
  open a pull request by themselves (HANDOVER-TODO A31);
- enter the model prices (A30).

---

## 1. Summary

The **Match Checklist** and the **"Go to task" links** are complete and
working. They are tested, permissions are enforced on the server, and they
are safe to use for the first home match on 8 November. Three small gaps:
- the "Checklist task" bar can't appear inside the content editor;
- broken links are only reported on days a reminder email goes out;
- delivery of the checklist emails can only be confirmed on the live site.

**AI Fix** is safe and working for what was built:
- one central Claude service, the cheap model by default;
- the monthly budget stop;
- Super-Admin-only access;
- checked, cleaned answers;
- undo for page changes.

But **about half of the AI requirements in this audit list were never
built**. The original AI Fix instructions were cut off part-way through
Stage 2, so I built Stage 1 and the core of Stage 2 to the plan you approved.
Missing:
- the fix history page and log;
- before/after results tracking;
- "Draft with Claude" on checklist tasks;
- code proposals;
- bulk review and cost estimate for "Fix all";
- weekly summary email;
- Edit / Try again on proposals;
- "check facts" banner;
- a dry-run command.

None of the missing parts creates a security risk or unexpected spending.
They are features still to build.

**Overall:**
- **Ready to go live:** the Checklist and Go-to-task links.
- **Safe to use, but not complete against this list:** AI Fix.
- **Tests:** the full suite ran 442 tests. 434 passed, 1 is skipped on purpose, and 7 failed only because I was changing the Inbox code while they ran. Run again afterwards, those 7 pass (see D1).

## 2. Scores

| Part | ✅ Done | ⚠️ Partial | ❌ Missing | ❓ Can't verify |
|---|---|---|---|---|
| A. Match Checklist (18) | 16 | 1 | 0 | 1 |
| B. Go-to-task links (12) | 9 | 3 | 0 | 0 |
| C. AI Fix (27) | 8 | 15 | 4 | 0 |
| D. General (8) | 6 | 2 | 0 | 0 |

---

## 3. Every item

### Part A: Match Checklist

All file paths start with `functions/api/_lib/` unless shown otherwise.

| ID | Requirement | Status | Evidence | What's wrong |
|---|---|---|---|---|
| A1 | Tables exist, migrations run | ✅ | `matchChecklist.js:63-104` creates `checklist_templates`, `checklist_template_tasks`, `match_checklists`, `match_checklist_tasks`, `checklist_activity_log`, `checklist_settings`, `checklist_reminder_log`; `migrations/0006_match_checklist.sql` ran cleanly on an empty database (D2) | — |
| A2 | Default template seeded (Before/During/After, home/away/both, offsets, owners, priorities) | ✅ | `matchChecklist.js:237` `SEED_TASKS` (33 tasks: phase, offset, owner, priority, applies_to); seeded by `seedDefaultTemplate` (:272); unit test "the 33 seed tasks" passes | — |
| A3 | Auto-generates for the next match from the correct home/away template | ⚠️ | `syncChecklists` (:352) makes a checklist for the next match and any within 14 days; home/away is decided per task (`tasksFromTemplate` :316 keeps only "home"/"away"/"both" tasks); server test "a new upcoming match gets its checklist straight away" passes | There is **one** template with home/away tags per task, not separate home and away templates. The Templates page edits only that one. Works the same in practice, but you can't keep two different templates. |
| A4 | Template edits don't change existing checklists | ✅ | Tasks are copied when the checklist is made (:378-388). **Proved:** renamed a template task, the existing checklist kept the old name, then renamed it back | — |
| A5 | Rescheduling moves unfinished due dates | ✅ | `rescheduledTimes` (:332), used at :406-412; unit test "kick-off moves" and server test "kick-off moved: due times move with it" pass | — |
| A6 | After match: awaiting close-out, post-match tasks active, closes when all done or by Super Admin, Archive | ✅ | :418-420 (3 h after kick-off or full time); `closeIfComplete` (:484); close action `functions/api/admin/match-checklist/index.js` POST; archive `?view=archive` and `src/pages/admin/match-checklist/archive.astro` | — |
| A7 | Back-to-back fixtures as tabs; cancelled handled without deleting | ✅ | Tabs `src/pages/admin/match-checklist/index.astro:239` (`drawTabs`); cancelled, hidden or deleted matches close the checklist with a note, never deleted (:396-401). Screenshot showed many tabs on test data | — |
| A8 | Headline, progress bar, overdue count, countdown, 3 sections, colours, filters | ✅ | `index.astro`: countdown :136, headline/progress/overdue in `draw()`, sections Before/During/After, colours red/amber/green/grey (CSS `.overdue/.soon/.done/.na`), filters :231 (phase, status, owner, search) | — |
| A9 | Each task: title, description, due, owner, priority, status, notes, attachment, completed by/at | ✅ | `taskHtml()` in `index.astro`; data from `loadChecklist` (:498) | — |
| A10 | Archive; Templates and Reminder settings Super Admin only | ✅ | Pages under `src/pages/admin/match-checklist/`; `templates.js` and `settings.js` return 403 unless Super Admin; server test checks 403 for a Matchday Admin | — |
| A11 | Permissions on the server | ✅ | `checklistApi.js:45` `changeStatus`: done, not applicable and untick (reason required) are Super Admin only (403). Owners, close and templates also Super Admin only. Server test "permissions" proves 403 for a normal admin on done, N/A, owners, close, templates and settings, and success for the Super Admin | — |
| A12 | Activity log; task history viewable | ✅ | `logActivity` (:307) on every change; history endpoint `tasks/[id]/history.js`; history shown under each task; server test checks "unticked" with its reason and "status_changed" | — |
| A13 | Uploads validated; CSRF | ✅ | `checklistApi.js:79` `checkUpload` (PDF/JPG/PNG/DOCX/XLSX by the file's first bytes, max 10 MB); stored privately in R2 with random names, downloaded only signed-in with `nosniff`. CSRF: SameSite=Strict cookie plus Origin check (`checklistApi.js:26`). Server tests: fake PDF refused, .exe refused, PNG accepted, foreign Origin 403 | — |
| A14 | PDF: logo, headline, progress, sections, details, footer, filename | ✅ | `checklistOutput.js:25` `checklistPdf`; filename `:13` (`checklist-home-vs-away-YYYY-MM-DD.pdf`); unit test checks a real PDF, clickable links and the filename; server test downloads one | — |
| A15 | Print view with empty tick boxes | ✅ | `mode: 'print'` in `checklistPdf`; unit test checks print mode | — |
| A16 | Email checklist with PDF; addresses validated; logged | ❓ | `functions/api/admin/match-checklist/email.js` validates up to 20 addresses (test: a bad address gives 400), attaches the PDF and logs it | The actual sending can't be checked locally (no email key on the test server). **How to check:** on the live site, Match Checklist › **Email PDF** to your own address. |
| A17 | Daily reminders: schedule, Lagos time, 3 days before, remind-from, post-match, one digest, sections, MATCH DAY subject, nothing when nothing due, no duplicates | ✅ | Every-minute timer calls `/api/internal/checklist-run` (`workers/kitchen-cron/index.js` CALLS). `checklistReminders.js:25` `runReminders`: waits for the Lagos send time, one email per person, "claim the day" (:60) plus a per-person log (no duplicates), no email when nothing is due. Selection and subject rules: `tasksToRemind` (:535), `digestSections` (:546), `digestSubject` (:557). Unit tests on reminder selection and email; server test "nobody gets the email twice on the same day" passes | — |
| A18 | Tests for generation, rescheduling, permissions, reminders, duplicates | ✅ | `tests/match-checklist.unit.test.mjs` (11 tests) and `tests/match-checklist.test.mjs` (8 tests): all pass | — |

### Part B: "Go to task" links

| ID | Requirement | Status | Evidence | What's wrong |
|---|---|---|---|---|
| B1 | Link fields on both task tables | ✅ | `matchChecklist.js:120` `LINK_COLUMNS` added to both tables (:101); migration 0006 has them (checked on an empty database) | — |
| B2 | Placeholders replaced | ✅ | `fillPlaceholders` (:219); unit test "task links: placeholders filled and encoded…" | — |
| B3 | Every seed task mapped to a real page, or "none" | ✅ | **Each link was opened as a Super Admin** (table below). 19 linked tasks all opened (200); every page section they jump to exists; content-editor links point at existing collections. 14 tasks have no page | — |
| B4 | Built at display time; absolute in emails/PDFs | ✅ | `buildTaskLink` (:203) is called when the page, email or PDF is made; emails and PDFs use `https://lobistarsfc.com/admin/match-checklist/go/?task=ID`; unit test "no relative links in emails" | — |
| B5 | Button on rows; none without link; external new tab, safe | ✅ | `index.astro:152` (`target="_blank" rel="noopener noreferrer"` for external); unit test "no link, no button" | — |
| B6 | Links in reminder emails and clickable in PDFs | ✅ | `checklistOutput.js` `taskLine` (go link per task); PDF link annotations; unit tests check both | — |
| B7 | Return banner only from the checklist; right button by role; server-enforced | ⚠️ | `src/components/admin/ChecklistBanner.astro:33` (only with `?from=checklist&task=<number>`), included on every admin page through `AdminNav`. Button: "Mark as done" (Super Admin) or "Mark as submitted for review", saved through the server-checked PATCH. Seen working in a browser on desktop and phone | It **doesn't appear in the content editor** (Squad & Players, and the 3 News links), because that editor is a separate app. The rest work. |
| B8 | Logged-out email link: login, then back; outside addresses refused | ✅ | `functions/admin/_middleware.js` keeps the address; `src/lib/safeNext.ts:7` only allows `/admin` pages of this site. Unit test refuses `//evil`, `https://evil`, `javascript:` and backslashes; server test "signing in from an emailed task link comes back to the task" | — |
| B9 | No-access page with "Back to checklist" | ✅ | `functions/admin/_middleware.js:55` `deniedPage(admin, url)`; server test checks the button appears only when coming from a task, and a script in the task number is refused | — |
| B10 | Link picker, external https only, Test link | ✅ | `templates.astro` (Opens drop-down, External address, Test link); server checks: `templates.js:41` (https only), :35 (known pages only), :72 (Test link with the next match); server test refuses http:// and unknown pages | — |
| B11 | Daily broken-link check to Super Admins | ⚠️ | `checklistReminders.js:13` `brokenLinks`, added to the Super Admins' copy of the daily email | It only runs inside the reminder email, so **on days with nothing outstanding no email is sent and broken links aren't reported**. It checks pages against the known list rather than loading them. |
| B12 | Tests for B2, B4, B5, B7, B8 | ⚠️ | B2, B4, B5, B8: automated tests pass. B7: the server side is tested (banner info, permissions) | B7's "banner only appears with ?from=checklist" was checked by hand in a browser, not by an automated test. |

**B3 table: every seed task and its link.** "Opens" = tested on the local site as a Super Admin.

| Task | Link | Opens? |
|---|---|---|
| Confirm fixture details | League › Fixtures | ✅ 200 |
| Player registration and eligibility check | Content editor › Squad & Players | ✅ 200 (collection exists) |
| Match day program: content written | Matchday Programme | ✅ 200 |
| Match day program: design approved and printed/published | Matchday Programme | ✅ 200 |
| Ticketing and gate arrangements | Match Tickets | ✅ 200 |
| Social media countdown and preview posts | Share any page (this match's page) | ✅ 200 (match page also 200) |
| Starting line-up graphic ready | Live Match Control › line-ups | ✅ 200, section found |
| Team sheet submitted | Live Match Control › matchday squad | ✅ 200, section found |
| Live social media updates | Live Match Control › timeline | ✅ 200, section found |
| Photography and video coverage | Live Match Control › gallery | ✅ 200, section found |
| Match stats captured | Live Match Control › stats | ✅ 200, section found |
| Incident log | Live Match Control › timeline | ✅ 200, section found |
| Full-time result posted | Live Match Control (this match) | ✅ 200 |
| Post-match press conference / interviews | New News post (Reaction/Interview, prefilled) | ✅ 200 (collection exists) |
| Match report published | New News post (Match Report, prefilled) | ✅ 200 (collection exists) |
| Highlights video uploaded | Live Match Control › Watch Live links | ✅ 200, section found |
| Injury report | New News post (Team News, prefilled) | ✅ 200 (collection exists) |
| Gate takings and expenses reconciled | Match Tickets | ✅ 200 |
| Thank-you post for fans and sponsors | Share any page (this match's page) | ✅ 200 |
| Opposition scouting, Medical and fitness report, Travel booking, Hotel and feeding, Stadium inspection, Security and police liaison, Match officials' hosting, Media accreditation list, Pre-match press conference, Kit check, Ambulance and medical team, Crowd and security monitoring, Post-match analysis, Disciplinary reports to the league | none (no page on the website) | — |

### Part C: AI Fix

Note: items marked ❌ or ⚠️ below are mostly parts of the AI spec that arrived
cut off. They were not in the approved plan, not broken code.

All file paths start with `functions/api/_lib/` unless shown otherwise.

| ID | Requirement | Status | Evidence | What's wrong |
|---|---|---|---|---|
| C1 | API key only in the environment, never in the browser | ✅ | The key is read only in `claude.js` (headers). A search of all browser code and the built site found no key and no direct Anthropic calls; the only mention is the words "ANTHROPIC_API_KEY is not set" as a message on AI Settings | — |
| C2 | One central Claude service used by everything | ✅ | Only `claude.js` talks to Anthropic (search: no other `api.anthropic.com` or `x-api-key`). Callers: AI Fix (`aiFix.js`), Ask Claude (`admin/ai/ask.js`), weekly summary (`analyticsInsights.js`, now moved onto the service), Test connection | — |
| C3 | Cheap model default; advanced only for long writing/code; per feature | ⚠️ | `claude.js:30` (Haiku default, Sonnet "advanced"); every feature defaults to cheap (`AI_DEFAULTS`); per-feature choice on AI Settings; unit test | The choice is per **feature**, not per **task type**: news drafts and title fixes share the "fix" feature, so you can't give only long-form writing the advanced model. Nothing ever uses the advanced model unless a Super Admin chooses it. |
| C4 | Problems found by code, not Claude | ✅ | The 12 rules in `analyticsInsights.js` `analyse()`; Claude is called only in `prepareFix` and `prepareAll` | — |
| C5 | No personal data in prompts | ⚠️ | Every prompt checked: page address, current title and description, Google numbers, search phrases, next match, totals and figures (`aiFix.js:64-140`, `ask.js`, weekly summary). Server test checks no `@`, "password" or "phone" in a prompt | What **staff type into the input box** is sent as typed. If someone types a fan's phone number or email, it would go to Claude. No filter removes it. |
| C6 | JSON validated, HTML cleaned, IDs checked; no direct access | ✅ | `claude.js:127` `validateJson` (types, lengths, only known fields), `:115` `cleanText` (removes HTML, scripts, `javascript:`); one retry on bad JSON (tested). The page address comes from the recommendation, never from Claude. Claude has no tools: it only returns text. Writes are limited to `src/data/seo.json` and new news files (`github.js:8`) | — |
| C7 | ai_usage_log, ai_settings, cost per call, prices | ✅ | `claude.js` `ensureAiSchema`, `logUsage`, `costOf`; `migrations/0007_ai_fix.sql`; prices entered on AI Settings | The prices are **blank** until you enter them; until then the cost is estimated on the high side (US$3/$15 per million tokens). |
| C8 | Warning at 80%, block at 100%, message shown | ⚠️ | `claude.js:94` `budgetCheck`. Server test proves the block at 100% (fix refused with "Monthly AI budget reached", the bar flag set, Test connection still allowed) | The 80% warning email is in the code (:98) but **not covered by a test**, and real email can't be sent locally. |
| C9 | AI Settings page | ✅ | `src/pages/admin/ai/settings.astro`, `functions/api/admin/ai/settings.js`; server test (settings checks, Test connection logged by feature) | — |
| C10 | Every recommendation type categorised with risk | ✅ | `aiFix.js:17` `REC_TYPES`; table in section 3a below; unit test "every recommendation type has a category" | — |
| C11 | Registry: gather, prompt, schema, inputs, preview, apply, undo, verify | ⚠️ | `aiFix.js:64` `FIX_ACTIONS` | **Verify** exists only for Google titles. **Undo** exists for titles and news drafts (copy-only drafts change nothing). "Re-run sync" has no undo (nothing to undo). |
| C12 | Buttons on /admin/analytics/ by role; How-to steps | ⚠️ | Analytics has one **Fix with AI** button for Super Admins (`src/pages/admin/analytics.astro:42`). All the per-recommendation buttons (Prepare fix, Write the draft, How to do it) are on the AI Fix page | No per-recommendation buttons on Analytics itself. Other admins get no "Prepare fix" (AI Fix is Super Admin only, as approved). |
| C13 | Before/after preview; Approve / Edit / Try again with note / Cancel | ⚠️ | Old wording struck through and new shown for titles; **Apply** and **Discard** work (tested) | **No Edit** before applying, **no "Try again with a note"**, no colour highlights. Preparing again with the same facts returns the saved answer, so you can't ask for a different version. |
| C14 | Input flow; Claude asks for missing info | ⚠️ | Input box with a plain label and minimum length (server test: too short is refused); prompts say "Never invent facts… use only what you are given" (`aiFix.js:14`) | Prompts don't tell Claude to **ask** for missing information; they tell it to keep the text short when facts are thin. |
| C15 | Auto-apply only when low risk + allowed + field empty + enabled + valid | ⚠️ | `aiFix.js:231` `maybeAutoApply` (low risk + in the allowed list + setting on). Only "re-run sync" can be allowed; the settings server refuses anything that changes pages (server test: `seo_title_description` stripped from the allowed list) | There's **no "field is empty" check**. It isn't needed today, because nothing that changes content can auto-apply at all (stricter than asked), but the rule as written isn't implemented. |
| C16 | Everything else needs approval; fact fixes never auto-apply; "check facts" banner | ⚠️ | All content changes wait for **Apply** (`applyFix` :239 needs "awaiting approval"); news is saved as **Draft** only | **No "check facts" banner** on news-draft previews. |
| C17 | Non-Super Admins can't apply, approve or undo (server) | ✅ | Permission `ai.fix` (`adminRoles.js:86`, only the Super Admin role has it) on every `/api/admin/ai` address plus `aiGuard`; server test: Head of Media gets 403 | — |
| C18 | Backup, transaction, exact undo, edited-since warning, verify sets verified/failed | ⚠️ | Previous title saved before applying; undo restores it exactly (server test); news undo refuses if the article was published since | **No "edited since" warning** for titles. Verify only sets "verified" (never "failed") and checks the live title instead of re-running the Analytics rule. GitHub commits are atomic; there's no database transaction around the status update. |
| C19 | ai_fix_log and Fix history page with filters | ❌ | Applied and undone fixes go to the general Activity Log; status is kept in `ai_recommendation_meta` | No separate log, no history page. |
| C20 | Fix all: grouped, batch, cost shown and confirmed, bulk review, email when ready | ⚠️ | Batch API used (`claude.js:207`; server test proves sent and collected); button shows the count and confirms the click | **No cost estimate**, no grouping, **no bulk review screen with tick boxes**, no "ready" email. |
| C21 | Weekly: schedule, detection, top 20 by batch, auto-apply, summary email, duplicate protection | ⚠️ | `aiFix.js:316` `weeklyScan` (day/time in Lagos from AI Settings; once a week via `last_scan_week`; batch; auto-apply); timer `/api/internal/ai-run` | **No summary email with spend.** Batch size is the "max items per batch" setting (default 50), not 20. Duplicate protection is not covered by a test. |
| C22 | Before/after metrics at 14 and 30 days; Fix results page | ❌ | — | Not built. |
| C23 | "Draft with Claude" on checklist writing tasks | ❌ | — | Not built. The checklist only marks some tasks "submitted for review" automatically from Live Match Control data, with no AI. |
| C24 | Ask Claude: read-only, no personal data, short history, cheap, budget, mistake warning, logged | ⚠️ | `admin/ai/ask.js` (no tools, so it can't change anything; totals only; last 6 messages at :13; cheap model; budget guard; logged). Server test proves 6 messages and an answer | **No "Claude can make mistakes" warning** shown. |
| C25 | Code proposals (branch + pull request or download) | ❌ | GitHub token is limited (one repository, Contents only) and kept in the environment | Code proposals were not built. |
| C26 | Mock mode end to end; dry-run command | ⚠️ | The test stand-in (`ANTHROPIC_BASE_URL`, `GITHUB_API_BASE`) runs the whole flow without spending money; see `tests/ai-fix.test.mjs` | **No `CLAUDE_MOCK` switch** for the real site, and **no dry-run command** that lists what would be fixed and its cost. |
| C27 | Tests for budget, auto-apply, approval, permissions, JSON, undo, verify, weekly duplicates, Ask read-only | ⚠️ | `tests/ai-fix.unit.test.mjs` (7) and `tests/ai-fix.test.mjs` (6) cover budget block, permissions, JSON checks and retry, apply/undo, approval, batches and Ask's 6 messages | **No tests** for verify, weekly duplicate protection, or the auto-apply decision itself. |

#### 3a. Recommendation types (C10)

| Recommendation | Category | Risk | Fix | Input needed |
|---|---|---|---|---|
| Google figures not coming in (`setup:gsc`) | manual_only | low | — | — |
| Daily Google sync stopped (`setup:stale`) | auto_fix (no Claude) | low | Re-run the sync (auto-applied) | — |
| Seen in Google, few clicks (`ctr:<page>`) | auto_fix | normal | New Google title and description (approval) | — |
| Just below the top of Google (`rank:<phrase>`) | input_needed | normal | News draft, saved as Draft | Facts for the story |
| Busy page Google barely shows (`index:<page>`) | manual_only | low | — | — |
| Google clicks dropped (`trend:gsc-down`) | manual_only | low | — | — |
| Phone visitors leave sooner (`ux:mobile`) | manual_only | high | — | — |
| Visitors leave a page quickly (`eng:<page>`) | manual_only | high | — | — |
| Ticket / food checkouts not finished (`funnel:*`) | manual_only | high | — (payments) | — |
| Few newsletter sign-ups (`grow:newsletter`) | input_needed | low | Sign-up line to copy | What subscribers get |
| Few visitors from social media (`grow:social`) | input_needed | low | Posts to copy | Optional |
| Supporters abroad (`grow:diaspora`) | input_needed | low | Posts to copy | Optional |

### Part D: General

| ID | Requirement | Status | Evidence | What's wrong |
|---|---|---|---|---|
| D1 | Full test suite | ✅ | `npm test` on the local test server: **442 tests, 434 passed, 1 skipped on purpose, 7 failed**. All 7 were in Website Health (5) and Match Tickets (2); they got a "server error" because, during that run, I was editing the Inbox code (for your new Delete request) and the test server reloads instantly. Re-run straight after: **all 10 tests in those two files pass**. The previous full run (same day, before the Inbox work) passed **441 of 441** | — |
| D2 | Migrations clean on a fresh database | ⚠️ | All 7 files run through SQLite on an empty database: 0001, 0002, 0003, 0005, **0006 (checklist)** and **0007 (AI)** OK, all new tables and link columns created | **0004 (Benue State, from before these features) fails on a completely empty database**: "no such table: events", because the `events` table is created by the website's code, not by a migration. The live database already has it, so it doesn't affect the live site. Also: Wrangler's own local migration command gives "internal error" on this computer (a tool problem, not the SQL). |
| D3 | Africa/Lagos everywhere | ✅ | Lagos day, time and month helpers (`matchChecklist.js:32-33`, `claude.js` `lagosMonth`); reminder time, weekly scan and budget month all use Lagos; screens format with `timeZone: 'Africa/Lagos'`. Nigeria has no summer time, so the fixed +1 hour is correct | — |
| D4 | Scheduled jobs | ✅ | One Cloudflare Cron Trigger, `workers/kitchen-cron/wrangler.toml` line 10: `crons = ["* * * * *"]`. It calls 12 jobs every minute, including **`/api/internal/checklist-run`** (checklist sync and reminders) and **`/api/internal/ai-run`** (AI batches and weekly scan). See section 5 | There is **no server crontab line**: this site runs on Cloudflare, and the Worker is already deployed (21 Oct). |
| D5 | Environment variables, and what's missing from the example file | ⚠️ | Variables the new features use: `ANTHROPIC_API_KEY` (set), `AI_SUMMARY` (set), `GITHUB_TOKEN` (set), `CRON_SECRET`, `RESEND_API_KEY`, `PROGRAMME_BUCKET` (set); optional `CLAUDE_MODEL_DEFAULT`, `CLAUDE_MODEL_ADVANCED`, `GITHUB_REPO`, `GITHUB_BRANCH`, `SITE_URL`, `CLUB_NAME`; test-only `ANTHROPIC_BASE_URL`, `GITHUB_API_BASE` | There is **no `.env.example`**; the project uses `.dev.vars.example`, which is **missing** `ANTHROPIC_API_KEY`, `AI_SUMMARY`, `GITHUB_TOKEN`, `CLAUDE_MODEL_DEFAULT`, `SITE_URL` and `CLUB_NAME`. The "complete list" in DEPLOYMENT.md is also missing `CLAUDE_MODEL_*`, `GITHUB_TOKEN`, `GITHUB_REPO`, `CLUB_NAME` (they are listed in each feature's own section). |
| D6 | Security scan | ✅ | **No real secrets** in the code: the two hits are a key-format check and a key generated inside a test. Every new admin address checks the signed-in role (`guard` / `aiGuard` in all 11 files); both timer addresses need `CRON_SECRET` (live check: 403 without it). CSRF via SameSite=Strict plus Origin check. Uploads checked by content. Open redirects blocked (`safeNext`). New pages escape everything shown (`esc()` / `textContent`) | Notes, not failures: (1) the **GitHub repository is Public**, so anyone can read the code; (2) the Origin check only refuses a *different* origin, and requests with no Origin header rely on the SameSite cookie, which is the normal approach. |
| D7 | Nothing existing broken | ✅ | 20 key pages opened as a Super Admin, all 200: home, fixtures, results, table, tickets, news, dashboard, analytics, league fixtures, Live Match Control, match settings, Website Health, all checklist and AI pages, two APIs. Full test suite: see D1 | — |
| D8 | TODOs, placeholders, stubs | ✅ | A search of all new files for TODO, FIXME, "not implemented" or placeholder code found none | — |

---

## 4. Priority fix list

**1. Security**
- (small) Strip email addresses and phone numbers from what staff type before it goes to Claude (C5).
- (small) Consider making the GitHub repository **Private** (D6). One click, no code change.

**2. Could break the live site or spend money unexpectedly**
- (small) Add tests for the weekly-scan duplicate protection and the auto-apply decision (C21, C27).
  - Both work in code but aren't proven by tests.
  - A repeat weekly scan would spend money twice.
- (small) Add a test for the 80% budget warning email (C8).
- (small) Fix migration 0004 so it also works on an empty database (D2).
  - Only matters if the database is ever rebuilt from scratch.
- (small) Add the new variables to `.dev.vars.example` and to the complete list in DEPLOYMENT.md (D5).

**3. Missing features (from the AI spec)**
- (medium) Fix history page and log, with filters (C19).
- (medium) Edit / "Try again with a note" on proposals, plus a "check facts" banner on drafts (C13, C16).
- (medium) "Fix all" improvements (C20):
  - estimated cost shown before sending;
  - bulk review with tick boxes;
  - "ready" email.
- (medium) Weekly summary email with spend; top 20 limit (C21).
- (medium) "Draft with Claude" on checklist writing tasks, saved as Draft (C23).
- (medium) Dry-run command and a `CLAUDE_MOCK` switch (C26).
- (medium) Verify: re-run the Analytics rule, set "failed" when it didn't help, plus a test (C18).
- (medium) Model choice per task type, so the advanced model can be used for long writing only (C3).
- (large) Before/after results at 14 and 30 days, and a Fix results page (C22).
- (large) Code proposals as GitHub pull requests, never merged automatically (C25).

**4. Small improvements**
- (small) "Claude can make mistakes: check before using" note on Ask Claude (C24).
- (small) Per-recommendation buttons on the Analytics page itself (C12).
- (small) Report broken task links even on days with no reminder email (B11).
- (small) Automated browser test for the checklist banner (B12).
- (small) "Field is empty" rule for auto-apply, for future fix types (C15).
- (small) Allow separate home and away templates (A3).

---

## 5. Things you must do yourself

1. **Nothing to add on a server for scheduling.** The website runs on Cloudflare, and the timer Worker (`lobistars-kitchen-cron`, every minute) is already deployed with the checklist and AI jobs. If it is ever redeployed: in `workers/kitchen-cron`, run `npx wrangler deploy`.
2. **Anthropic key:** done (21 Oct). Keep a little prepaid credit at console.anthropic.com › Billing.
3. **Prices:** on **AI Settings › Prices**, type the US$ per million input and output tokens for the two models shown (from anthropic.com/pricing), then **Save**. Until then the spend shown is estimated on the high side.
4. **Email:** Resend is set up (A1 done). On the live site, test it: Match Checklist › **Email PDF** to yourself, and **Reminder settings › Send a test reminder to me**.
5. **GitHub token:** done (21 Oct, expires in about a year). Put a reminder in your calendar to renew it and replace `GITHUB_TOKEN` in Cloudflare.
6. **Optional:** make the GitHub repository Private (github.com › lobi-stars-website › Settings › Danger Zone › Change visibility).
7. **Delete the local `Secrets` file** in the "Lobi Official Website" folder; the key is safely in Cloudflare.

---

## 6. Manual testing checklist (in the browser)

### As a normal admin
Ask a Super Admin to make you a test "Matchday Admin" login.

1. Open **Matchday › Match Checklist**.
   - You see the next match, a progress bar, a countdown and three sections.
   - The tick boxes are greyed out, and hovering shows "Only super admins can mark tasks as done."
2. Open **Details, notes, file and history** under a task.
   - Set **Submitted for review**, add a note and press **Save**.
   - Upload a PDF. The history shows your change.
3. Try uploading a `.txt` file renamed to `.pdf`: it's refused.
4. Press **Go to task →** on "Match stats captured".
   - Live Match Control opens at the stats section, with a blue **Checklist task** bar.
   - Press **Mark as submitted for review**, then **Back to checklist**: you're back on the same task.
5. Open **Settings › AI Fix** in the address bar (`/admin/ai/`): you get the "no access" page.
6. Open **Match Checklist › Templates**: the tab is hidden, and the address shows "no access".

### As a Super Admin
1. **Match Checklist:**
   - tick a task, and check it shows who and when;
   - untick it: you must give a reason;
   - change a task's owner.
2. Press **Download PDF** (logo, sections, footer), **Print view** (empty boxes) and **Email PDF** (to yourself).
3. Go to **Templates**:
   - edit a task's due time and press **Test link**;
   - check the existing checklist didn't change.
4. Go to **Reminder settings**: check the preview of today's email, then press **Send a test reminder to me**.
5. Sign out. Open a "Go to task" link from the test email: after you sign in, it opens the task's page.
6. Go to **AI Settings**:
   - check "Claude is connected" and "GitHub is connected";
   - press **Test connection**;
   - check the spend table shows a "Test connection" row.
7. Go to **AI Fix**:
   - on a "Needs a few words" card, type facts and press **Write the draft with Claude**, then check the result;
   - for social posts, press **Copy**;
   - for a news draft, press **Save as Draft in News**. It appears as a **Draft** in the content editor, and **Undo** removes it.
8. On **Analytics**, check the **Fix with AI** button next to Recommendations.
9. On the AI Fix page, press **Ask Claude** with a question about your figures. A short answer appears.
