# AI Fix (technical notes)

Settings › **AI Fix** (`/admin/ai/`) and **AI Settings** (`/admin/ai/settings/`),
Super Admins only (permission `ai.fix`). Claude prepares fixes for the
Analytics recommendations; a Super Admin checks and applies them. How staff
use it: STAFF-GUIDE.md, section 36.

## Principles

- **Problems are found by code, not by Claude.** The 12 Analytics rules
  (`analyticsInsights.js`) decide what needs doing. Claude is only called when
  a fix is being prepared.
- **Claude never touches the website.** It returns JSON. Our code checks the
  types, lengths and fields (`validateJson`), removes HTML, scripts and
  `javascript:` links (`cleanText`), and then applies the change through a
  fixed whitelist (`FIX_ACTIONS` in `aiFix.js`). The only files AI Fix can
  write are `src/data/seo.json` and new files in `src/content/news/`
  (`ALLOWED` in `github.js`).
- **No personal data is sent:** only page addresses, page titles, search
  phrases, totals, the next match and what staff type in.
- **Lowest cost:**
  - every feature uses the cheap model (`CLAUDE_MODEL_DEFAULT`, Haiku) unless
    a Super Admin switches it;
  - small output limits (`max_tokens` 300–1200 per fix);
  - the same facts are never sent twice (`data_hash`);
  - "Prepare all" and the weekly scan use the Message Batches API (half
    price, results within 24 hours);
  - Ask Claude sends only the last 6 messages.

## Files

| Part | File |
|---|---|
| Central Claude service (normal and batch calls, JSON checks, budget, usage log) | `functions/api/_lib/claude.js` |
| Categories, fix whitelist, prepare / apply / undo, batches, weekly scan | `functions/api/_lib/aiFix.js` |
| GitHub commits (content files only) | `functions/api/_lib/github.js` |
| Admin API | `functions/api/admin/ai/` (`index.js`, `settings.js`, `ask.js`), `functions/api/_lib/aiApi.js` |
| Timer job (collect batches every 5 min, weekly scan) | `functions/api/internal/ai-run.js` (called by `workers/kitchen-cron`) |
| Pages | `src/pages/admin/ai/index.astro`, `src/pages/admin/ai/settings.astro` |
| Google title/description overrides read by every page | `src/data/seo.json`, `src/layouts/Layout.astro` |
| Tables | `migrations/0007_ai_fix.sql` (also created on first use by `ensureAiSchema`) |
| Tests | `tests/ai-fix.unit.test.mjs`, `tests/ai-fix.test.mjs` |

The weekly Analytics summary (`writeAiSummary`) also goes through `claude.js`
now, so it counts towards the budget and the usage log.

## Recommendation types

| Recommendation | Category | Risk | Fix action | Input from staff |
|---|---|---|---|---|
| `setup:gsc` Google figures not coming in | manual_only | low | none | — |
| `setup:stale` daily Google sync stopped | auto_fix (no Claude) | low | `rerun_sync` (auto-applied by default) | — |
| `ctr:<page>` seen in Google, few clicks | auto_fix | normal | `seo_title_description`: commit to `src/data/seo.json` | — |
| `rank:<phrase>` just below the top of Google | input_needed | normal | `draft_news`: new file in `src/content/news/`, status Draft | the facts for the story |
| `index:<page>` busy page Google barely shows | manual_only | low | none (Request indexing in Search Console) | — |
| `trend:gsc-down` Google clicks dropped | manual_only | low | none | — |
| `ux:mobile` phone visitors leave sooner | manual_only | high | none | — |
| `eng:<page>` visitors leave quickly | manual_only | high | none (page layout is code) | — |
| `funnel:*` checkouts not finished | manual_only | high | none (payments) | — |
| `grow:newsletter` | input_needed | low | `draft_newsletter_blurb` (text to copy) | what subscribers get |
| `grow:social` | input_needed | low | `draft_social_post` (texts to copy) | optional |
| `grow:diaspora` | input_needed | low | `draft_social_post` (texts to copy) | optional |

Statuses: `open`, `preparing` (in a batch), `awaiting_input`,
`awaiting_approval`, `applied`, `verified` (the change is seen on the live
page), `failed`, `undone`, `dismissed`.

Auto-apply: on by default, but only for low-risk fixes that don't change pages
(today: `rerun_sync`). Anything that changes the website always waits for a
Super Admin.

## Budget

- Settings: `monthly_budget` (default US$10), `warn_at_percent` (80).
- Before every call, this month's estimated spend (Lagos month) is added up
  from `ai_usage_log`. At the warning level the Super Admins get one email a
  month. At 100% every call except Test connection is refused, and Super Admins
  see "Monthly AI budget reached" on every admin page.
- Prices per model (US$ per million tokens) are entered on AI Settings. Until
  then the budget counts every model at US$3 in / US$15 out, on the high side,
  so it is never overspent. Batches count half.

## Environment

| Name | Needed | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes (already set) | server side only |
| `CLAUDE_MODEL_DEFAULT` | optional | default `claude-haiku-5-5` |
| `CLAUDE_MODEL_ADVANCED` | optional | default `claude-sonnet-5-5`; only used if a Super Admin chooses it per feature |
| `GITHUB_TOKEN` | to apply page fixes and news drafts | fine-grained token, this repository only, "Contents: read and write" (handover A29) |
| `GITHUB_REPO`, `GITHUB_BRANCH` | optional | defaults `marvinmanex-cyber/lobi-stars-website`, `main` |
| `ANTHROPIC_BASE_URL`, `GITHUB_API_BASE` | **tests only** | point at the local stand-in server; never set on the live site |

## Testing locally

1. `npm run build`, then start `wrangler pages dev dist` with the usual
   variables plus `ANTHROPIC_API_KEY=sk-test-local
   ANTHROPIC_BASE_URL=http://127.0.0.1:8899/v1 GITHUB_TOKEN=gh-test-local
   GITHUB_API_BASE=http://127.0.0.1:8899/gh SITE_URL=http://127.0.0.1:<port>`.
2. `node --test tests/ai-fix.unit.test.mjs` (no server needed).
3. `BASE=http://127.0.0.1:<port> node --test tests/ai-fix.test.mjs`. The test
   starts its own stand-in for Claude and GitHub on port 8899, so no money is
   spent.
