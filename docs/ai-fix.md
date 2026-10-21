# AI Fix (technical notes)

Settings › **AI Fix** (`/admin/ai/`), **Fix history** (`/admin/ai/history/`),
**Fix results** (`/admin/ai/results/`) and **AI Settings**
(`/admin/ai/settings/`). Claude prepares fixes for the Analytics
recommendations; a Super Admin checks and applies them. How staff use it:
STAFF-GUIDE.md, section 36 (and section 35 for "Draft with Claude" in the
Match Checklist).

## Who can do what (checked on the server)

| Permission | Who has it | What it allows |
|---|---|---|
| `ai.fix` | Super Admins only | Everything: apply, edit, undo, discard, bulk review, Fix all, AI Settings, code proposals |
| `ai.prepare` | Roles with "All reports" (Head of Media, CRM Manager) and Super Admins | See AI Fix, ask Claude to prepare a fix, Ask Claude, Fix history, Fix results |
| `ai.draft` | Content roles (news editing), the report roles and Super Admins | "Draft with Claude" on Match Checklist writing tasks |

`ai.prepare` and `ai.draft` are given automatically from a role's other
permissions (`rolePermissions` in `adminRoles.js`). Every apply, edit, undo or
settings call is refused with 403 unless the person is a Super Admin
(`SUPER_ACTIONS` in `functions/api/admin/ai/index.js`, `aiGuard({ superOnly })`).

## Principles

- **Problems are found by code, not by Claude.** The 12 Analytics rules
  (`analyticsInsights.js`) decide what needs doing. Claude is only called when
  a fix, draft or proposal is being prepared.
- **Claude never touches the website.** It returns JSON, which our code checks:
  - types, lengths and allowed fields (`validateJson`);
  - HTML, scripts and `javascript:` links removed (`cleanText`);
  - edits a person makes are checked the same way.

  The change is then made through the fixed whitelist (`FIX_ACTIONS` in
  `aiFix.js`). AI Fix can only write:
  - `src/data/seo.json`;
  - new files in `src/content/news/` (always status Draft);
  - page code, only on a separate `ai-proposal/…` branch, never on `main`.

  The allowed files are in `github.js`.
- **No personal data is sent.** Before anything goes to Claude, emails and phone
  or card numbers are removed from staff text and from Ask Claude
  (`scrubPersonal`; dates, scores and crowd numbers are kept). Prompts carry
  only:
  - page addresses, titles and search phrases;
  - totals;
  - match facts from the fixtures and Live Match Control;
  - what staff type.
- **Claude asks instead of inventing.** Fact-based drafts allow the reply
  `{"needs": "…"}`; the question is shown to staff (`allowNeeds`).
- **Lowest cost:**
  - the cheap model (`CLAUDE_MODEL_DEFAULT`) everywhere;
  - the advanced model can only be chosen for long writing (news drafts,
    checklist drafts) and code proposals;
  - small output limits;
  - the same facts are never sent twice (`data_hash`);
  - Fix all and the weekly check-up use Message Batches (half price);
  - Ask Claude keeps only the last 6 messages.

## Files

| Part | File |
|---|---|
| Central Claude service (calls, batches, JSON checks, mock mode, personal data removal, budget, usage log, fix log, AI emails) | `functions/api/_lib/claude.js` |
| Categories, fix whitelist, prepare / edit / apply / undo / verify, Fix all, weekly check-up, dry run, history, results | `functions/api/_lib/aiFix.js` |
| Before/after figures | `functions/api/_lib/aiMetrics.js` |
| Code proposals | `functions/api/_lib/codeProposal.js` |
| Checklist "Draft with Claude" | `functions/api/_lib/checklistDraft.js`, `functions/api/admin/match-checklist/tasks/[id]/draft.js` |
| GitHub (content files; proposal branches) | `functions/api/_lib/github.js` |
| Admin API | `functions/api/admin/ai/` (`index`, `settings`, `ask`, `history`, `results`, `code`), `functions/api/_lib/aiApi.js` |
| Timer job | `functions/api/internal/ai-run.js` (called every minute by `workers/kitchen-cron`) |
| Dry run | `scripts/ai-dry-run.mjs` |
| Pages | `src/pages/admin/ai/` (`index`, `history`, `results`, `settings`), `src/components/admin/AiTabs.astro`; buttons on `src/pages/admin/analytics.astro` |
| Tables | `migrations/0007_ai_fix.sql`, `migrations/0008_ai_fix_history.sql` (also created on first use) |
| Tests | `tests/ai-fix.unit.test.mjs`, `tests/ai-fix-rules.unit.test.mjs` (in-memory database), `tests/ai-fix.test.mjs` (server, with a stand-in for Claude and GitHub) |

## Recommendation types

| Recommendation | Category | Risk | Fix | Input from staff |
|---|---|---|---|---|
| `setup:gsc` Google figures not coming in | manual_only | low | none | — |
| `setup:stale` daily Google sync stopped | auto_fix (no Claude) | low | `rerun_sync` (auto-applied by default) | — |
| `ctr:<page>` seen in Google, few clicks | auto_fix | normal | `seo_title_description` → `src/data/seo.json` | — |
| `rank:<phrase>` just below the top of Google | input_needed | normal | `draft_news` → news Draft | the facts |
| `index:<page>` busy page Google barely shows | manual_only | low | none | — |
| `trend:gsc-down` Google clicks dropped | manual_only | low | none | — |
| `ux:mobile` phone visitors leave sooner | manual_only | high | code proposal possible (Super Admins) | the page |
| `eng:<page>` visitors leave quickly | manual_only | high | code proposal possible (Super Admins) | — |
| `funnel:*` checkouts not finished | manual_only | high | none (payments) | — |
| `grow:newsletter` | input_needed | low | `draft_newsletter_blurb` (copy) | what subscribers get |
| `grow:social` | input_needed | low | `draft_social_post` (copy) | optional |
| `grow:diaspora` | input_needed | low | `draft_social_post` (copy) | optional |

Statuses: `open`, `preparing`, `awaiting_input`, `awaiting_approval`, `applied`,
`verified`, `failed`, `undone`, `dismissed`.

## The life of a fix

1. **Prepare.** One click (normal API), or Fix all (one batch, half price,
   results within 24 hours, then an email to the Super Admins).
2. **Review.** The preview shows before and after with new words highlighted,
   plus a "check the facts" banner on fact texts. A Super Admin can:
   - **Edit** (checked again);
   - **Try again with a note** (always a new call);
   - **Cancel**;
   - tick several fixes and **Apply selected**.
3. **Apply.**
   - A backup of the previous value is kept (`applied_json`).
   - The status, the log line and the results row are saved in one batch.
   - The figure the recommendation is about is recorded (`ai_fix_results`).
4. **Undo.** Restores the exact previous value. If the item was edited since,
   it asks first (409, then `force`); a published news article is never deleted.
5. **Verify** (daily):
   - **verified** when the Analytics rule no longer flags it;
   - **failed** if the change never showed on the live page within 2 days, or
     the rule still flags it after 30 days.
6. **Results** (daily): the figure is measured again at 14 and 30 days and
   judged **better / worse / no change** (Fix results page).

**Auto-apply** only happens when all of these are true (`canAutoApply`):
- it is switched on;
- the fix is low risk;
- the fix type is in the allowed list;
- nothing is overwritten;
- the proposal passed its checks;
- it contains no facts to check.

Today only "re-run the Google sync" qualifies. Page changes and texts never
qualify.

## Weekly check-up

Runs on the AI Settings day and time (Lagos), once a week only: the week is
claimed in `ai_settings.last_scan_week` with a conditional write. It:
1. checks applied fixes;
2. prepares the top 20 automatic fixes in one batch;
3. applies the eligible ones;
4. emails the Super Admins a summary with this month's spend.

## Budget

- `monthly_budget` (default US$10) and `warn_at_percent` (80).
- One warning email a month at the warning level.
- At 100%, every call except Test connection is refused, and Super Admins see
  a "Monthly AI budget reached" bar.
- Prices per model are entered on AI Settings. Until then every model counts
  at US$3 in / US$15 out per million tokens (on the high side); batches count
  half.
- Every AI email is also written to the fix log (the mail log), even when email
  isn't set up.

## Code proposals (Super Admins)

Only for the layout recommendations (`eng:<page>`, `ux:mobile`).

1. Claude reads that one page file (at most 24,000 characters) and returns up
   to 6 find-and-replace edits.
2. Each edit's "find" must appear exactly once, and outside scripts are refused.
3. The result is saved on a new `ai-proposal/…` branch, and a **draft** pull
   request is opened. That needs "Pull requests: Read and write" on the token;
   otherwise the page says so.
4. The proposal can be downloaded or emailed to a developer.

Nothing is merged by the website.

## Mock mode and dry run

- `CLAUDE_MOCK=true`: answers are made up locally, so they pass every check.
  There is no API call and the cost is 0, but everything is logged. Batches
  finish at once. Use it for training and local testing only.
- Dry run (`node scripts/ai-dry-run.mjs`, or `POST /api/internal/ai-run?action=dry_run`
  with `CRON_SECRET`) shows, without using AI or changing anything:
  - what the weekly check-up would send to Claude;
  - what it would do without AI;
  - the estimated cost.

## Environment

| Name | Needed | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes (set) | server side only |
| `GITHUB_TOKEN` | yes (set) | fine-grained, this repository only, Contents: read and write; add "Pull requests: read and write" for automatic draft pull requests |
| `CLAUDE_MODEL_DEFAULT` / `CLAUDE_MODEL_ADVANCED` | optional | defaults `claude-haiku-5-5` / `claude-sonnet-5-5` |
| `GITHUB_REPO`, `GITHUB_BRANCH` | optional | defaults `marvinmanex-cyber/lobi-stars-website`, `main` |
| `CLAUDE_MOCK` | optional | `true` = no AI, no cost (testing/training only) |
| `ANTHROPIC_BASE_URL`, `GITHUB_API_BASE` | **tests only** | point at the local stand-in; never set on the live site |

## Testing locally

1. `npm run build`, then start `wrangler pages dev dist` with the usual
   variables plus `ANTHROPIC_API_KEY=sk-test-local
   ANTHROPIC_BASE_URL=http://127.0.0.1:8899/v1 GITHUB_TOKEN=gh-test-local
   GITHUB_API_BASE=http://127.0.0.1:8899/gh SITE_URL=http://127.0.0.1:<port>`.
2. Without a server:
   `node --test tests/ai-fix.unit.test.mjs tests/ai-fix-rules.unit.test.mjs`.
3. With the server: `BASE=http://127.0.0.1:<port> node --test tests/ai-fix.test.mjs`.
   The test starts its own stand-in for Claude and GitHub on port 8899, so no
   money is spent.
