# Lobi Stars FC website: change log

A dated record of every change to the website and the admin, newest first.
Each entry says what changed, who it affects and anything staff need to do.
How to use each feature is in the staff handbook (STAFF-GUIDE.md, and
STAFF-MATCHDAY-GUIDE.md for match days). Things the club still has to do are
in HANDOVER-TODO.md.

---

## 2026-10-22: Squad & Staff Data Portal: "Forgot the password?"

**What changed**
- The portal sign-in page has a **Forgot the password?** link. The person
  enters their name and WhatsApp number or email and presses **Ask for a new
  password**.
- The three Super Admins get an email and a bell alert, and a **New password
  requested** box appears on Settings › Squad & Staff Data Portal with
  **Generate new password** and **Ignore this request**. Making a new
  password clears the request. Every request is in the Activity Log.
- The password is never sent out automatically (it is shared by everyone who
  uses the portal). Requests are limited to 3 an hour per connection and 10 a day.

**Staff need to do:** nothing. Staff guide §38 explains changing the
username and password and answering a request.

## 2026-10-22: Squad & Staff Data Portal, Phase 7 (privacy, backups, health checks, guides)

**What changed**
- **Privacy Policy:** new section "Player and staff profiles" (/privacy/#squad-profiles),
  a **draft for legal review**: what is collected, what is public, sharing
  with the media partner for match coverage, legal basis, who sees private
  details, and erasing private details 2 seasons after someone leaves. It is
  linked from the portal footer (the policy itself never shows the portal address).
- **Keeping private details:** every day, the private details of people
  marked "Left the club" more than 2 seasons ago are erased automatically,
  also from earlier seasons' copies of their profile; the public profile stays
  as club history. Super Admins can change the period (1–5 seasons) in
  Settings › Squad & Staff Data Portal. Each erasure is in the Activity Log.
- **Backups:** squad profiles are in the nightly encrypted backup; the photos
  and recordings are now copied weekly (Sundays) too. The portal password,
  sessions and devices are left out.
- **Website Health:** five new checks: the portal stays private (not linked,
  not in the sitemap, hidden from search engines; password made), repeated
  wrong portal passwords, answers refused or stuck on a device, the Data
  Package matches schemaVersion 1.0, and every submitted or verified profile
  has its photo. The storage check now includes the squad photo storage.
- The portal now tells the club when an answer or photo is refused, or stays
  waiting on a device for more than 30 minutes while online (Activity Log,
  without the answer).
- Fixed: people marked "Left the club" were not hidden from a hand-made
  Squad entry with the same name.
- Staff guide: new sections 38 (Squad & Staff Data Portal) and 39 (Data
  Package format). HANDOVER-TODO: A34 (switch the portal on) and E2 (legal review).

**Staff need to do:** HANDOVER-TODO.md A34 and E2.

## 2026-10-22: Squad & Staff Data Portal, Phases 5–6 (review, publishing, exports, partner feed)

**What changed**
- **Review (Matchday › Squad: Profile Submissions):** the Website & Data
  Officer and Super Admins see every submitted profile, with all answers,
  photos and the recording. Buttons: Verify, Request changes (a note is
  required, and the portal shows it), Left the club, Restore. Super Admins can
  also remove a profile. The bell shows how many profiles are waiting, and
  reviewers get an email when one is submitted.
- **Publishing:** when a profile is verified, the website rebuilds (at most
  every 2 minutes, once PAGES_DEPLOY_HOOK is set) and the person appears on
  /squad with **public details only**: age instead of date of birth, never the
  legal name, phone, email or emergency contact. A verified portal profile
  replaces a hand-made squad entry with the same name. "Left the club" takes
  them off the website.
- **Exports (portal and review page):** PDF, Word, Excel, CSV, JSON and the
  **Media Partner Data Package** (ZIP with data.json, CSVs, photos, recordings,
  team details), schemaVersion 1.0. Every download is checked before it is
  saved and is written to the export log. Private details are never in them.
- **Full club records:** only Super Admins, with their sign-in code, can
  download the version with private details (Excel or PDF). It is logged.
- **Partner feed:** /api/partner/squad for the media partner, with a key
  (LOBI_PARTNER_API_KEY), the same structure as data.json, `?since=` for
  changes only, and photo and audio links that stop working after 24 hours.
- **New season:** "Carry over" copies last season's verified profiles as
  drafts for the new season.

**Staff need to do:** nothing until the portal password is generated (see
HANDOVER-TODO.md).

## 2026-10-22: Squad & Staff Data Portal, Phases 2–4 (screens, autosave, photos, recordings)

**What changed**
- **Portal home:** season, how it works, ADD A PLAYER / ADD A COACH / STAFF
  MEMBER, live counts, and saved profiles with search (name or number),
  filters, season, status badges, and Continue / View / Edit / Delete draft.
- **Profile form:** Player or Coach / Staff Member (switching keeps the shared
  answers), every field marked Public / Media / Private, career rows (add,
  remove, drag or arrows), 300-character notes, live shirt-number and
  "this person may already exist" warnings, and the under-18 guardian section
  appears automatically.
- **Saving:** every answer saves by itself. Changes are kept on the device if
  the network or power goes off and are sent when the connection returns.
  If two people edit one profile, the later answer wins and the other is told.
- **Photos:** take or choose a photo; it is straightened, cropped 4:5,
  location data removed, made in 3 sizes, and named after the person
  (e.g. 09-musa-adeyemi.webp), with quality warnings.
- **Name pronunciation:** record up to 10 seconds (an MP3 copy is made).
- **Submit:** checks every required answer, the photo, the shirt number and
  under-18 consent, highlights what is missing, then sends the profile for
  club review. Submitted profiles are view-only; only drafts can be deleted.
- Every change is in the Activity Log in plain English (private details are
  never written there).

## 2026-10-22: Squad & Staff Data Portal, Phase 1 (private link, login, access)

**What changed**
- New private **Squad & Staff Data Portal** at /staff/squad-data (not linked
  anywhere, never indexed). Its own login: one shared username and password,
  plus "Your name", which is recorded with every action.
- Locked for 15 minutes after 5 wrong passwords, human check after 3, signed
  out after 60 minutes without activity (2-minute warning). The portal login
  opens nothing else: every admin page and API answers "no access".
- New **Settings › Squad & Staff Data Portal** (Super Admins): copy the link,
  set the username, generate a new password (shown once; signs everyone out),
  open/close the portal, current season, who is signed in (sign out all), and
  devices used. A sign-in from a new device appears on the bell.

**Staff to do**
- A Super Admin generates the portal password and sends the link and login
  to the admin in charge (STAFF-GUIDE "Squad & Staff Data Portal").

## 2026-10-22: Receipts saved with the customer's name; WhatsApp on computers

**What changed**
- Receipt PDFs are saved with the customer's name, e.g.
  `Achigbe-George-Alexander-Receipt-FD-20261022-0004.pdf`.
- **WhatsApp on a computer:** Windows' Share window often doesn't offer
  WhatsApp, so the board now saves the PDF and shows **Open WhatsApp chat
  with …**; attach the saved receipt (📎 › Document › Downloads) and send.
  On phones and tablets the PDF itself still goes through the Share sheet.

## 2026-10-22: "Request failed" on the Live Order Board: less load on the server

**What happened**
- Cloudflare's free plan allows 10 ms of computing per request; the website
  normally uses 15–70 ms. After a busy spell (several admin tabs open, each
  checking every 8 seconds, plus the live connections) Cloudflare cut every
  admin request off at 10 ms: "Request failed" and "Reconnecting…".

**What changed**
- Admin tabs you are not looking at no longer ask the server anything; they
  catch up the moment you switch back. Phone push notifications still arrive.
- The live connections of the Live Order Board and the Kitchen Screen are
  shorter and lighter, close while the tab is hidden, and no longer flash
  "Reconnecting…" on every routine reconnect.

**Staff to do**
- Move Cloudflare to the **Workers Paid plan (US$5/month)** before the first
  home match: HANDOVER-TODO A33. This is the real fix.

## 2026-10-22: The notification settings box can be closed

**What changed**
- The "On this device" notification box (Kitchen Alerts, Food Orders) now
  has a **✕ Close** button, and closes when you click outside it, press Esc,
  or after **Save choices**.

## 2026-10-22: Receipt buttons fixed: PDF saves to Downloads, WhatsApp sends only the PDF

**What changed**
- **PDF** now saves the receipt straight into the Downloads folder (it opened
  a blank tab before).
- **WhatsApp** now sends **only the PDF file** through the device's Share
  window (choose WhatsApp, then the customer): no message text. On a Windows
  computer this needs the WhatsApp app. Without file sharing, the PDF is
  saved and a button opens the customer's chat to attach it. No more blank
  tabs.

## 2026-10-22: Food receipts are now a compact PDF

**What changed**
- The buyer's receipt is now a **PDF**: one compact page (no empty space)
  with the MatchDay Kitchen logo and only the payment details.
- **WhatsApp:** on a phone the PDF file itself is shared to WhatsApp (choose
  the buyer); on a computer the chat opens with the receipt and a PDF link.
  The broken characters (�) in the WhatsApp message are fixed (no emojis).
- **Email:** the PDF is attached. New **PDF** button on delivered orders.
- The receipt page has **Download the receipt (PDF)**.

## 2026-10-22: Kitchen Screen shows incoming orders and updates at once; buyer email optional

**What changed**
- The **Kitchen Screen** now shows a grey strip **"Coming in, NOT PAID yet:
  don't cook yet"** with WhatsApp orders waiting for payment and card payments
  in progress, so the kitchen sees every order as soon as it is placed. Paid
  orders still go to NEW as before.
- The Kitchen Screen now updates **instantly** (the same live connection as
  the Live Order Board) instead of every 10 seconds.
- Why it looked dead before: it only shows paid orders, and WhatsApp orders
  only become paid when staff press "Payment received" on the Live Order
  Board; delivered orders leave the screen.
- The buyer's **email is now optional** on the food order form and the
  MatchDay Kitchen page ("only if you want your receipt by email"), also for
  Pay Online. Paystack gets the club's orders address when the buyer gives
  none.

## 2026-10-22: Food receipts by WhatsApp and email; board links open in a new tab

**What changed**
- On the **Live Order Board**, delivered orders have **Receipt to the buyer:
  WhatsApp | Email**. WhatsApp opens a chat with the buyer with the receipt
  ready to send; Email sends a receipt with the **MatchDay Kitchen logo**
  (needs Resend). Each shows a ✓ with the time once sent.
- New receipt page for buyers (from the link in the message): logo, items,
  total, seat, payment, and **Print or save as PDF**.
- **Notifications**, **Kitchen Screen** and **Orders list** on the board now
  open in a new tab, so the board stays open. Notifications opens Kitchen
  Alerts with this device's notification settings.

**Staff to do**
- Nothing. Email receipts start working once Resend is set up (HANDOVER-TODO).

## 2026-10-22: Website Health: three AI buttons on every problem

**What changed**
- Every problem on **Settings › Website Health** now has three buttons:
  **1. Fix it for me** (runs the website's safe fix, no AI cost),
  **2. Teach AI to fix this next time** (switch the safe fix to run by itself
  whenever the problem appears, or Claude's one-time setup steps and a
  request for the developer), and **3. Show me how to fix it myself**
  (numbered steps written by Claude for that exact problem).
- **Fix everything I can** at the top runs every safe fix at once.
- Lowest cost: Claude only when you press 2 or 3, the cheapest model, and
  each answer is saved and reused while the problem is the same. AI usage
  shows as "Website Health steps" in AI Settings.
- Switched-on automatic fixes run from the every-minute health job (at most
  every 6 hours per problem) and are written in the Activity Log.

## 2026-10-22: Score verification, Phase 7 (summary email, health checks, tests)

**What changed**
- **Matchday summary email** to the Data Officer and Super Admins once the
  day's conference matches are confirmed (or 4 hours after the last
  kick-off): results, sources, what is still open, the top of the table and
  Lobi Stars' position.
- **Website Health** checks the every-minute score check, automatic score
  sources, and old conflicts or reports waiting for review.
- Tests cover the whole flow: two sources agree → table; one source → no
  change; conflict alert; verified override; official correction; the same
  submitter counts once; message formats read by rules or Claude; team-name
  aliases and unmatched names; postponed / abandoned / awarded; points
  deductions; tie-breakers; the live table arrows; the missing-result
  reminder; and that prohibited websites can never be fetched.
- Score verification is now complete (Phases 1 to 7). The STAFF-GUIDE section
  37 explains every screen.

## 2026-10-22: Score verification, Phase 6 (licensed data API)

**What changed**
- The website can now check a **licensed football data API** (API-Football
  or Sportmonks) by itself: every 2 minutes on matchdays, every 6 hours
  otherwise. It is one source and stays off until a Super Admin confirms the
  licence with a note and the key is added.
- **Coverage test** on League › Score Sources now really checks the service
  (today's matches, recognised team names).
- Each automatic source shows a status (working / not working / waiting /
  off), last checked and last success.
- The legal rule is built in and tested: no request is ever made to a source
  that is off, has no confirmed licence, uses a non-secure address, or is a
  prohibited website (Soccerway, Sofascore, Flashscore…).

**Staff to do**
- Only if the club buys a data plan: see HANDOVER-TODO A32 item (4).

## 2026-10-22: Score verification, Phase 5 (the table everywhere)

**What changed**
- **/table** now has a **mini scoreboard** of the round being played, and a
  **Live table** mode (when "count live matches" is on): confirmed scores of
  matches in play count as they stand, and the arrows show places gained or
  lost since kick-off.
- The **homepage** (under the next matches) and **Matchday Live** now show a
  small league table: the same data as /table.
- The table after each completed round is **saved** (Other Games › Saved
  tables); a later correction saves a new version with the reason.
- The table still can't be typed in by hand, and League › Results now goes
  through score verification (Phase 4), so nothing bypasses the rules.

**Staff to do**
- Check the official NNL tie-breaker order and points in League › Table &
  Rules (HANDOVER-TODO A32).

## 2026-10-21: Score verification, Phase 4 (the two-source rule now decides the table)

**What changed**
- A result now counts in the league table only when **two independent sources
  agree**, or staff mark it **official** or **verified**. One source alone is
  "Unconfirmed" and is not shown or counted (a setting can show unconfirmed
  scores; they still never count).
- **This includes Lobi Stars' own matches.** Live Match Control is one source;
  enter the final score in Other Games too (second source), or set a verified
  result.
- Full-time results typed in **League › Results** still update the table at
  once: they are saved as verified results.
- **Conflicts:** when sources disagree for more than 3 minutes, the match card
  turns red with each source's score side by side (**Accept this score**,
  **Enter correct score**, **Open match**). The Data Officer and Super Admins
  get a bell notification and an email.
- **Official corrections** replace any earlier result; the table is worked out
  again and the Super Admins are told.
- **Missing-result reminder** 115 minutes after kick-off (adjustable).
- New **Settings** at the bottom of League › Score Sources.
- Every decision is written in plain English in League History.
- The commentary partner's system can now send scores (Commentary Assist,
  needs `COMMENTARY_ASSIST_SECRET`).
- Fix: the "All Conference D" fixtures page no longer fails if a match has no
  valid kick-off date.

**Staff to do**
- On matchday, enter our own final score in Other Games as well as Live Match
  Control (see STAFF-MATCHDAY-GUIDE section 3a).

## 2026-10-21: Score verification, Phase 3 (score emails and WhatsApp messages)

**What changed**
- New **Matchday › Score Messages** (Website & Data Officer and Super Admins).
  - Paste a WhatsApp message and say who sent it.
  - Emails to **scores@lobistarsfc.com** arrive here automatically once that
    address is switched on.
- The website reads the scores itself for the usual formats (several matches
  per message). Only unclear messages go to Claude (AI), which reads but never
  decides. Every original message is kept.
- Unknown senders, unrecognised teams and anything the website isn't sure
  about wait under **Waiting for you** (bell notification and email to the
  Data Officer): **Approve** (choose the match) or **Reject** (with a reason).
- AI usage for this appears as "Reading score messages" in AI Settings.

**Staff to do**
- Switch on the scores@ address (HANDOVER-TODO A32). Optional: the commentary
  partner's email address for `COMMENTARY_SCORE_EMAILS`.

## 2026-10-21: Score verification, Phase 2 (Other Games, club network, official results)

**What changed**
- New **Matchday › Other Games** (Website & Data Officer and Super Admins):
  every conference match of the round as a phone-friendly card, with the
  confirmed score, every report received and a light (🟢 agreed, 🟡 one
  source, 🔴 disagree).
  - Quick entry: **−** / **+** for goals, status buttons, minute.
  - **Mark as official result** (note required) and **Set verified result**
    (reason required). Both are logged and can be withdrawn with a reason.
- New **Matchday › Club Network Submitters**: add trusted club officers; each
  gets a private link and an 8-digit PIN (shown once), with renew and remove,
  and each one's number of reports and accuracy.
- New public form **lobistarsfc.com/scores/submit/** for those officers:
  made for phones, with a human check and limits on wrong links/PINs and on
  how often a person can send.
- **Points adjustments** now have an optional **official reference** (NNL
  letter, date or link), shown with the reason under the public table. New
  shortcut **Matchday › Points Adjustments**.
- Nothing on the public table changes yet: the two-source rule that updates
  the table comes in Phase 4.

**Staff to do**
- Send the list of club officers who may send scores (HANDOVER-TODO A32).

## 2026-10-21: Score verification, Phase 1 (sources, score reports, team names)

**What changed**
- New **League › Score Sources** (Website & Data Officer and Super Admins):
  the seven places results can come from, each with on/off, priority and
  description.
  - The licensed data API and any other licensed source stay off until a
    Super Admin confirms a licence or written permission, with a note.
  - Soccerway, Sofascore, Flashscore and similar websites can never be read
    automatically without that.
- New **League › Unmatched Team Names**: team names from score reports that
  match no team. Link a name once and it is saved as one of that team's names.
- Behind the scenes:
  - every score report from every source is now stored and never overwritten;
  - "two independent sources" is defined (the same person twice counts once;
    the licensed API counts once).
- Nothing changes on the public site yet. The matchday screen, club network
  form, AI reading of score messages, the two-source rule and the automatic
  table follow in the next phases.

**Who it affects:** the Website & Data Officer and Super Admins.

**What staff need to do:** nothing yet.

---

## 2026-10-21: Phone header gets out of the way when scrolling

**What changed**
- On phones and tablets, the white header (logo, partner, search, basket,
  account) now slides away while you scroll down the page and comes back as
  soon as you scroll up a little. It is always shown at the top of a page,
  when the menu is open and when using a keyboard. The computer view is
  unchanged. Match Centre tabs and the programme reader bar move up with it.

**Who it affects:** fans on phones and tablets.

**What staff need to do:** nothing.

---

## 2026-10-21: AI Fix completed (everything from the audit)

**What changed**
- **Analytics** has a button on each recommendation:
  - **Click to fix** for Super Admins, **Prepare fix** for the other report
    roles (Head of Media, CRM Manager);
  - **Fix with my input** when Claude needs a few words.

  Those roles can now open AI Fix and prepare fixes; applying stays with the
  Super Admins.
- **Proposals**:
  - the old and new wording are shown side by side, with the new words
    highlighted;
  - **✎ Edit** before applying (checked again);
  - **Try again with a note**;
  - a **check the facts** warning on texts with facts;
  - Claude **asks for missing facts** instead of guessing.
- **Fix all**:
  - shows the fixes grouped by type, with the **estimated cost**, before
    sending;
  - an email when they are ready;
  - a **Ready to apply** list with tick boxes (Apply selected / Discard
    selected).
- **Fix history** page (every step, every AI email, with filters) and **Fix
  results** page (the figure each fix was meant to improve, at 0, 14 and 30
  days: better / worse / no change).
- **Applied fixes are checked daily:**
  - **verified** when Analytics no longer flags the problem;
  - **failed** if the change never went live, or the problem is still there
    after 30 days.
  - Undo asks first if the item was changed again since.
- **Weekly check-up**: up to 20 automatic fixes at half price, and a summary
  email with the month's spend. It runs once a week only.
- **Match Checklist › Draft with Claude** on the five writing tasks:
  - the match details are filled in automatically;
  - the draft is saved as a Draft in News or as posts to copy;
  - the task moves to *Submitted for review*.
- **Code proposals** (Super Admins, layout problems): saved on a separate
  GitHub branch for a developer, never live by themselves; download or email.
- **Safety and cost**:
  - emails and phone numbers typed by staff are removed before anything goes
    to Claude;
  - the advanced (dearer) model can only be chosen for long writing and code;
  - a mock mode (`CLAUDE_MOCK`) and a dry-run command for testing without AI;
  - the budget warning email is recorded even if email isn't set up.
- **Match Checklist**:
  - optional separate **home** and **away** templates;
  - broken task links are reported to the Super Admins every day.
- The base database file (`schema.sql`) now works on a brand-new database.

**Who it affects:** Super Admins; Head of Media and CRM Manager (prepare
fixes); content editors (Draft with Claude in the checklist).

**What staff need to do:** nothing.

Optional:
- add "Pull requests: Read and write" to the GitHub token so code proposals
  open a pull request automatically (HANDOVER-TODO.md A31);
- enter the model prices on AI Settings (A30).

---

## 2026-10-21: Delete messages in the Inbox

**What changed**
- **🗑 Delete** on any Inbox conversation moves it to a new **Deleted** tab,
  where **↩ Restore** brings it back. Deleted conversations are removed for
  good after 30 days, with the original form message.
- **Delete forever** (Super Admins only) removes one straight away.
- A fan's reply to a deleted conversation brings it back. Deleted
  conversations don't count as unread or waiting anywhere (dashboard,
  notifications, daily summary, Website Health, search).

**Who it affects:** staff who answer the Inbox; Super Admins for Delete forever.

**What staff need to do:** nothing. See STAFF-GUIDE.md, "Deleting a conversation".

---

## 2026-10-21: Content editor changes go live by themselves again

**What changed**
- Cloudflare's automatic build (after every save in the content editor or
  push to GitHub) had been failing, because the website now needs Node.js 22
  and Cloudflare was using an older default. The project now tells Cloudflare
  to use Node 22 (`.node-version`); the first automatic build succeeded on
  21 Oct 2026.

**Who it affects:** everyone who edits News, Squad, Gallery or other pages in
the content editor: changes appear about 2 minutes after saving, without
waiting for the website manager.

**What staff need to do:** nothing.

---

## 2026-10-21: AI Fix (Settings › AI Fix and AI Settings, Super Admins)

**What changed**
- New **AI Fix** page: the Analytics recommendations sorted into what Claude
  can prepare, what needs a few words from staff first, and what only a person
  can do. Claude prepares (better Google titles and descriptions, news drafts
  saved as Draft, social media posts, a newsletter sign-up line); a Super
  Admin checks and presses **Apply**. Everything can be undone.
- New **AI Settings** page: monthly AI budget (default $10) with a warning
  email at 80% and a stop at 100%, this month's spend by feature, the model
  per feature (cheap by default), prices, the weekly scan and **Test
  connection**.
- Lowest cost: the cheap model everywhere, short answers, nothing sent twice,
  bulk work at half price (Message Batches). Claude only ever gets totals and
  page text, never fans' details, and cannot change the website itself.
- The weekly Analytics summary now counts towards the AI budget.
- Analytics › Recommendations has a **Fix with AI** button (Super Admins).
- **Prepare all automatic fixes** shows how many fixes it will send, confirms
  your click in a blue line under it ("Sending…", then "Received…"), and says
  when there is nothing automatic to prepare.
- Pages can now take a Google title and description from `src/data/seo.json`
  (empty for now, so nothing changed on the public site).

**Who it affects:** the three Super Admins.

**What staff need to do:** to let **Apply** change pages and save news
drafts, add the GitHub token (HANDOVER-TODO.md, A29). Optionally enter the
model prices on AI Settings (A30).

---

## 2026-10-21: Weekly summary by Claude switched on

**What changed**
- The optional weekly summary in **Admin › Analytics › Recommendations** is
  now on (Anthropic key and `AI_SUMMARY` added in Cloudflare). Claude writes
  a short plain-English report every Monday from the website's totals only (no
  names, emails, phones or orders). **Write a new summary now** makes one at
  any time.
- Headings in the summary show in bold instead of with stars around them.

**Who it affects:** staff who read Analytics.

**What staff need to do:** nothing. The key uses prepaid credit at
console.anthropic.com (a few US cents a week); top it up if the summary stops.
To switch it off, delete `AI_SUMMARY` in Cloudflare.

---

## 2026-10-21: Match Checklist (Matchday › Match Checklist)

**What changed**
- New **Match Checklist** in the Matchday menu: every upcoming Lobi Stars
  match gets its own list of tasks (31 for a home match, 25 for an away match),
  grouped Before / During / After the match, made by itself from a master
  template as soon as the match is in the fixtures. Due times follow kick-off
  if it moves.
- Every staff login (except gate and kitchen helpers) can see it, add notes,
  upload files (PDF, JPG, PNG, DOCX, XLSX, up to 10 MB) and set a task to
  *Submitted for review*. **Only Super Admins tick tasks as done**, choose
  owners and close checklists; the website refuses anyone else.
- **Go to task →** buttons open the right admin page for the match (19 of the
  33 tasks; the rest happen outside the website). A **Checklist task** bar on
  that page has *Back to checklist* and *Mark as submitted for review* /
  *Mark as done*.
- **Download PDF**, **Print view** (empty tick boxes) and **Email PDF**.
- A daily reminder email at 08:00 (Lagos time), from 3 days before kick-off:
  one email per person listing what is overdue, due today and due in the next
  3 days. Super Admins can change the time, days and recipients, and send a
  test.
- Super Admins edit the master list in **Templates** (with task links and a
  *Test link* button) and see closed checklists in **Archive**.
- Signing in from a link in an email now brings you back to that page (only
  pages of the admin are allowed). The "no access" page has a *Back to
  checklist* button when you came from a checklist task.
- The website sets some tasks to *Submitted for review* by itself when it
  sees the work done in Live Match Control or the Matchday Programme
  (line-ups, squad, stats, photos, full-time result, match report, programme).
  A Super Admin still ticks them done.
- Fix: **Live Match Control** and **Match Tickets & Settings** no longer
  send you to the login page when opened in a new tab while you are signed in
  (for example from a link in an email).

**Who it affects:** all admin staff; Super Admins for ticking off tasks.

**What staff need to do:** nothing to set up. Super Admins: look through
**Templates** once and add owners; see HANDOVER-TODO.md (G1) for links to
add to the tasks that have no page on the website.

---

## 2026-10-21: Lobi Stars FC Live connected to Aeson Sports Radio's on-air status

**What changed**
- **Admin → Commentary** has a **Broadcast partner: Aeson Sports Radio** box:
  Aeson's status address, the primary and backup listen addresses (the same
  fields as before), and a webhook secret saved encrypted and never shown again.
- The commentary player (on /commentary, Matchday Live and the homepage
  banner) now shows **Live now** only while Aeson is on air during a match's
  commentary window, **Starting soon** when the window is open but Aeson isn't
  on air yet, and **Off air – next match: …** otherwise. While live it shows
  the score, the minute, the goal scorers and the commentators' names. The
  score and scorers come from Live Match Control first.
- If the primary listen address fails, the player switches to the backup
  straight away (before: after two failures), and alternates if needed.
- Aeson can push on-air / off-air changes to the website (signed with the
  shared secret), so the player updates within seconds; otherwise the website
  reads Aeson's status every 15 seconds. If Aeson's status can't be read, fans
  see "Off air" outside match windows and can still listen during them.
- **Test stream** and **Website Health** now also check Aeson's status feed.
- Nothing on the public pages names Aeson or links to it (white-label).

**Staff need to:** agree a webhook secret with Aeson and save it in the
Broadcast partner box; give Aeson the webhook address shown there. The stream
address itself still waits for Aeson's server (handover A7).

**Handbook:** STAFF-GUIDE.md › 9 (Broadcast partner; What fans see on the
player); STAFF-MATCHDAY-GUIDE.md › 11; technical: COMMENTARY-STREAM-SETUP.md ›
Status feed and webhook; audit: docs/radio-audit.md.

---

## 2026-10-20: Faster, sturdier site: only dynamic addresses run the website code

**What changed**
- Cloudflare was running the website's code for every single request,
  including every font, picture and script (because the site has more than
  100 dynamic addresses, Cloudflare's automatic setting falls back to "all").
  Two consequences: in busy moments some requests were cut off for using too
  much processing time (the Website Health "Request failed", and occasionally a
  font, logo or match list), and the free plan's 100,000 requests a day would
  have run out at around 3,000 page views, a real risk on a match day.
- A routing file now sends only the dynamic addresses (data, admin, short
  links, match pages and so on) through the code; pages, fonts, pictures
  and scripts are served directly, faster, without using the daily allowance.
  The build checks the file stays complete.
- Website Health checks 3 pages per step instead of 8, so each step stays
  within Cloudflare's per-request time limit (more, shorter steps).

**Staff need to:** nothing.

---

## 2026-10-20: Website Health: "Request failed" fixed; Telegram and shop wording

**What changed**
- Pressing **Run full check now** could show "Request failed" when one step
  of the check took longer than Cloudflare allows for a single request. The
  check itself always finished in the background, but the page stopped
  following it. The page now retries a slow step ("A slow step is being
  retried…") and carries on to "Check finished".
- "Social media links work" no longer warns about a missing Telegram address
  while the club has no public Telegram channel connected (handover A12).
  Once one is connected, its t.me link is used and checked.
- Shop product names in Website Health now show the season ("2026/27 Away
  Jersey") instead of "{season} Away Jersey", as on the shop page.

**Staff need to:** nothing.

---

## 2026-10-20: Backup restore tested (passed)

**What changed**
- The newest automatic backup was unlocked with the club's backup key and
  rebuilt into a separate test database (never the live one), following the
  disaster-recovery steps. All 105 tables and 7,115 rows came back exactly,
  and key tables matched the live site. The key file, the backup file and the
  test database were deleted afterwards.
- Recorded in DISASTER-RECOVERY.md › Restore tests.

**Staff need to:** a Super Admin presses **Mark restore tested** in
Admin › Website Health (the next test is due within 90 days, by mid-January
2027).

---

## 2026-10-20: Homepage group photo fixed on phones; full phone/tablet/desktop check

**What changed**
- The group photo slide (six fans in club shirts) on the homepage no longer
  shows black above and dark red below on phones. The whole group is shown
  across the screen, slightly larger, with its top and bottom edges fading
  into a soft, blurred copy of the same photo. Tablets held upright get the
  same treatment.
- Each hero slide in the CMS has a new setting **On phones and tablets**:
  "Fill the screen" (default) or "Show the whole photo" (for wide group
  photos).
- Every public page (80 pages) was checked on a phone, a tablet and a
  computer screen: no sideways scrolling, broken pictures or page errors.

**Staff need to:** nothing.

**Handbook:** STAFF-GUIDE.md › Homepage hero photos.

---

## 2026-10-20: TikTok connected (all social accounts now linked)

**What changed**
- The club's TikTok account (https://www.tiktok.com/@lobistarsfc) is
  connected: the TikTok icon in the footer, the Contact page, the "Follow us"
  links, the newsletter footer and the Share Hub now open it.
- All six accounts are now live: Facebook, X, Instagram, YouTube, TikTok and
  the WhatsApp Channel. Nothing is shown as "coming soon" any more.

**Staff need to:** nothing. To change an address later: Content CMS ›
Site Settings › Social links.

---

## 2026-10-20: Analytics charts and downloads (Excel, PowerPoint, PDF, PNG, CSV)

**What changed**
- More charts on Admin › Analytics:
  - **pie charts:** Google search by device and by country, GA4 visits by
    device (next to "How visitors arrived");
  - **bar charts:** top search phrases (clicks and appearances), top pages
    (search clicks, GA4 sessions and page views), key events this period
    against the period before, top 10 pages and top states.
- **Download & present** buttons at the top of the page:
  - **Excel (all data):** one file, one sheet per section (21 sheets:
    Summary, daily visits, sources, devices, pages, states, matchday,
    commentary, partners, Google daily, search phrases, pages from all
    sources, countries, GA4 channels and devices, key events, at a glance,
    recommendations with their steps);
  - **PowerPoint slides:** a ready-made deck in club colours: title,
    key figures, at a glance, one slide per chart, one slide per
    recommendation with its steps;
  - **Print / PDF:** a clean printable report (no menus or buttons, every
    "How to do it" guide open). Choose "Save as PDF" in the print window.
- Under every chart a **Chart (PNG)** button (a picture with its title and
  period, for WhatsApp or slides), and under every table a **Table (CSV)**
  button (opens in Excel).
- Downloads use the period chosen at the top. The fan sign-up list (names)
  is never included in any download.

**Staff need to:** nothing.

**Handbook:** STAFF-GUIDE.md › Charts, downloads and presentations.

---

## 2026-10-20: Recommendations box on the Analytics page (analytics intelligence, Phase 4)

**What changed**
- Admin › Analytics has a **Recommendations** box near the top. The website
  analyses the last 28 days (Google search, GA4 and its own counting, compared
  with the 28 days before) and shows:
  - **At a glance:** a few plain-English sentences on how things are going;
  - **recommendations**, each with a priority (Do this first / Worth doing /
    When you have time), what was found (with the figures), a **"How to do it"
    step-by-step guide** and a button to the right place (Search Console, News,
    Newsletter, Share Hub…).
- What it looks for: pages Google shows often but few people click (with a
  suggested new title), search phrases just below the top of Google, busy
  pages that don't appear in Google, a drop in Google clicks, phone visitors
  leaving sooner than computer visitors, pages people leave quickly, ticket and
  food checkouts started but not finished, few newsletter sign-ups, few visits
  from WhatsApp and social media, supporters abroad, and a stopped sync.
- **Mark as done** hides a recommendation for 30 days (recorded in the
  Activity Log); **Show again** brings it back.
- Optional **weekly summary written by Claude** (Mondays after 06:00). It is
  **off** and costs nothing unless switched on (handover A28). It receives
  only totals, never names, emails, phone numbers or orders.
- Only staff with "All reports" analytics access see the box.

**Staff need to:** nothing. To switch on the Claude summary, see handover A28.

**Handbook:** STAFF-GUIDE.md › Recommendations.

---

## 2026-10-19: "Google & Search" on the Analytics page (analytics intelligence, Phase 3)

**What changed**
- Admin › Analytics has a new **Google & Search** section, using the same
  period buttons (Today, 7 days, 30 days, This season, Custom) and comparing
  with the period before:
  - Google search: clicks, appearances in Google, click rate, average
    position (lower is better: "2.8 places higher" is good news);
  - GA4: sessions, users, engagement rate, average session length;
  - one day-by-day chart with the website's own page views, GA4 sessions and
    Google search clicks and appearances;
  - top search phrases, GA4 channels (how visitors arrived), the 10 key
    events, Google search by country;
  - one table per page joining search clicks, appearances, click rate,
    position, GA4 sessions and the website's own page views.
- **Sync now** fetches the last 4 days from Google straight away (with
  progress), and the section shows when the last sync ran and any problem.
- Only staff with "All reports" analytics access see it; other roles that can
  open Analytics (broadcast, partner reports) don't.

**Staff need to:** nothing. GA4 figures appear 24–48 hours after GA4 was set
up (19 Oct); search figures are already there from 30 Sep.

**Handbook:** STAFF-GUIDE.md › Google & Search data.

---

## 2026-10-19: Daily Search Console and GA4 sync (analytics intelligence, Phase 2)

**What changed**
- The website can now copy Google Search Console figures (clicks,
  impressions, click rate, position: in total and by page, search phrase,
  country and device) and GA4 figures (sessions, users, engagement by page,
  channel and device, plus the 10 key events) into its own database, once a
  day. Nothing is shown on screen yet: the "Google & Search" part of
  Admin › Analytics comes in Phase 3.
- The first sync takes the last 90 days; after that a daily sync from 05:00
  Nigeria time re-reads the last 4 days (Search Console figures arrive 2–3 days
  late). It works in small steps, retries when Google is busy, and records any
  failure in the Activity Log without stopping the rest.
- Staff with "All reports" analytics access can press **Sync now** (Phase 3
  page; the address is /api/admin/analytics-sync).
- Only totals come from Google; no names, emails, phone numbers or orders.
- The timer Worker (lobistars-kitchen-cron) calls the new sync job.

**Staff need to:** set up the Google service account and give it access
(handover A27). Until then the sync does nothing.

**Handbook:** STAFF-GUIDE.md › Google & Search data.

---

## 2026-10-19: Google Analytics 4 with consent (analytics intelligence, Phase 1)

**What changed**
- Google Analytics 4 can be switched on with the `GA4_MEASUREMENT_ID` setting.
  It loads **only after a visitor presses Accept** in the cookie banner
  (Consent Mode: everything denied by default; only analytics granted after
  Accept; advertising features off). Before that nothing is sent to Google;
  choosing Reject later switches it off and removes its cookies.
- Ten key events with no personal data: ticket_purchase_start,
  ticket_purchase_complete, kitchen_order_start, kitchen_order_complete,
  newsletter_signup, membership_signup, watch_live_click,
  whatsapp_channel_join_click, social_click (platform) and
  prediction_submitted. Page addresses are sent without their ?query part
  (order and sign-in links carry private tokens).
- Fixed: pages reached with the menu's quick (in-page) navigation were not
  counted by the website's own visitor counting either; they now are.
- The cookie banner mentions Google Analytics and links to the Privacy Policy;
  the Privacy Policy (section 4) explains Google Analytics.

**Staff need to:** create the GA4 property and add the Measurement ID in
Cloudflare (handover A26). Until then GA4 stays off.

**Handbook:** STAFF-GUIDE.md › Google Analytics 4.

---

## 2026-10-19: MatchDay Kitchen menu, stand drop-down; VIP tickets ₦500

**What changed**
- **Ticket prices:** every home match still to be played is now Popular Stand
  ₦100, Cover Stand ₦200, **VIP ₦500** (VIP was ₦300). Tickets already bought
  keep the price paid. Change any match in Commerce › Match Tickets.
- **MatchDay Kitchen seat:** "Section" is a drop-down with **Popular Stand,
  Cover Stand and VIP Seating** (it was free text, so fans didn't know what to
  write). The phone number was already asked for (and required) at checkout,
  next to the name, for both Pay Online and WhatsApp orders.
- **New menu:** 39 items in 5 categories: MatchDay Combos (shown first),
  Meals, Suya & Grills, Snacks, Drinks. Every item states its portion (for
  example "3 skewers, about 300 g"), spice level and badges (Best Seller, New,
  Spicy). Every combo is cheaper than buying its items separately. The old
  sample items are archived (kept for past orders).
- Until the kitchen uploads its own photos, each item shows a large food emoji
  instead of initials.
- **Brand promise** under the MatchDay Kitchen title: "Great Food. Every Match.
  Order online. Enjoy from your seat."

**Staff need to:** upload real photos of each dish and confirm prices and
portions with the caterer (Admin › Food › Menu; handover D6).

**Handbook:** STAFF-GUIDE.md › MatchDay Kitchen (stands list).

---

## 2026-10-19: Phones: the footer no longer lifts when scrolling to the end

**What changed**
- On phones, scrolling past the end of a page no longer bounces the page and
  shows a white strip under the black footer (which made the footer look as if
  it was moving up). The elastic bounce at the page edges is switched off on
  phones, and the area behind and below the footer is the footer's dark colour.
  (On Android, this also turns off "pull down to refresh" on the website.)
- Checked every page at phone, tablet and desktop width: no sideways
  scrolling, broken pictures or failed files. The only messages came from
  Cloudflare's anti-robot box itself (not the website).

**Staff need to:** nothing.

---

## 2026-10-19: WhatsApp food orders go to 0708 009 4985

**What changed**
- "Order on WhatsApp" (MatchDay Kitchen) now sends fans' orders to
  **0708 009 4985** (+234 708 009 4985) instead of 0903 039 9416. Changed in
  the live kitchen settings (Admin › Food › Menu › Order on WhatsApp) and as the
  built-in default; the programme editor's "Order food on WhatsApp" preset uses
  it too.
- The club management number 0903 039 9416 on the Contact and Help pages is
  unchanged.

**Staff need to:** make sure someone answers 0708 009 4985 on WhatsApp on
matchdays (handover D7).

---

## 2026-10-19: WhatsApp Channel changed

**What changed**
- The website's WhatsApp Channel links now open the "Lobi Stars (Yes Father
  Channel)" channel (https://whatsapp.com/channel/0029VaeAqYI8qIzwLEdy3E1o)
  instead of the channel connected earlier today: the homepage card, the footer
  icon, the channel strips, the Contact page and the Share Hub.

**Staff need to:** nothing.

---

## 2026-10-19: YouTube connected; Facebook and Instagram confirmed

**What changed**
- The club's YouTube channel (https://www.youtube.com/@lobistarsfootballclub4809)
  is connected: the footer YouTube icon, the Contact page and the Share Hub
  open it.
- Facebook (https://www.facebook.com/LobiStars) and Instagram
  (https://www.instagram.com/lobistarsfc) were confirmed by the club; the
  website already linked to these exact pages.
- Only TikTok is still "coming soon".

**Staff need to:** send the TikTok address (handover C5).

---

## 2026-10-19: WhatsApp Channel connected

**What changed**
- The club's WhatsApp Channel (https://whatsapp.com/channel/0029VbDjpp55Ejxt1yY0g33E)
  is connected: the homepage "Join WhatsApp Channel" button, the footer
  WhatsApp icon, the "Join our WhatsApp Channel" strips on Watch Live and news
  articles, the Contact page and the Share Hub now open it (in a new tab).
- YouTube and TikTok are still shown as "coming soon" until their addresses
  are sent.

**Staff need to:** send the YouTube and TikTok addresses (handover C5).

---

## 2026-10-19: Homepage membership: clearer heading

**What changed**
- The small gold line above "Official 2026/27 Membership" on the homepage now
  reads "Join Lobi Stars Football Club Membership" (was "Join the Red & Gold
  family"), so fans know it is the club's own membership.

**Staff need to:** nothing.

---

## 2026-10-19: Phones: no big empty space above the footer

**What changed**
- On phones, every page now ends with a short, even space (about 32 px)
  before the black footer, instead of 120 to 400 px of empty space. Short pages
  are no longer stretched to 60% of the screen height, the footer's 70 px top
  margin is removed on phones, and the extra bottom padding of the page
  containers (standard pages, legal pages, partners, Stats, Awards, Predict &
  Win, Man of the Match, Commentary, Rewards, Hospitality, Season Tickets) is
  the same 32 px. The Match Alerts box no longer keeps a blank line under its
  button until there is a message.
- Tablets and computers are unchanged.

**Staff need to:** nothing.

---

## 2026-10-19: Footer tagline: Makurdi removed

**What changed**
- The footer tagline on every page now reads "The Pride of Benue. Proudly
  representing Benue State since 1969." (was "...representing Makurdi and
  Benue State..."). It can be edited in the Content CMS (Site Settings & Shop ›
  Season, Homepage Stats & Footer Text).

**Staff need to:** nothing.

---

## 2026-10-19: Footer social icons: even spacing on phones; new Instagram icon

**What changed**
- On phones the six social icons spread evenly across the full width (the
  first at the left edge, the last at the right, equal gaps). Computers and
  tablets are unchanged.
- A new Instagram icon: a clean camera glyph on Instagram's own colours,
  filling the circle to its edge (the old one showed a band at the top, so it
  looked cut).

**Staff need to:** nothing.

---

## 2026-10-19: WhatsApp Channel card on phones: green background

**What changed**
- On phones, the homepage "Join the Lobi Stars WhatsApp Channel" card sits on
  a full-width WhatsApp-green band (bright green fading lighter to the right),
  with the white card floating on it and green showing all round, instead of a
  white box with a green stripe. The green box has rounded corners that follow
  the card's curve and ends at its green edge: around it is the same dark as
  the sections above and below (no white). Tablets and computers are unchanged.

**Staff need to:** nothing.

---

## 2026-10-19: Homepage hero: line removed

**What changed**
- The small gold line "Pride of Benue · Makurdi, Nigeria" above "Lobi Stars"
  in the homepage hero is removed. The hero now starts with the club name.
  ("Pride of Benue" elsewhere, such as the footer tagline, is unchanged.)

**Staff need to:** nothing.

---

## 2026-10-19: Footer: "Follow us on social media"

**What changed**
- The footer's social icons have one heading, **"Follow us on social media"**
  (in gold), covering every account. The separate "Follow us on WhatsApp" line
  is gone: the WhatsApp icon is with the others.

**Staff need to:** nothing.

---

## 2026-10-19: YouTube, TikTok and WhatsApp Channel shown before their links

**What changed**
- The YouTube, TikTok and WhatsApp Channel icons (footer), the "Follow us on
  WhatsApp" link, the homepage "Join the Lobi Stars WhatsApp Channel" card and
  the WhatsApp Channel strips (Watch Live, news articles) are now **visible**.
  Until the club sends each address they are **not clickable** (nothing
  happens; "Coming soon" on hover); the Contact page lists them as text.
- When an address is put in (Content CMS › Social links, replacing the
  `REPLACE_WITH_…` placeholder), that item becomes a working link with no other
  change. Facebook, X and Instagram work as before.

**Staff need to:** send or enter the three addresses (handover C5).

---

## 2026-10-19: Homepage on phones: shorter match section

**What changed**
- On phones (up to 767 px wide) the homepage "Upcoming Matches" section shows
  only its heading and a full-width **See all matches** button (to /fixtures),
  followed straight by MatchDay Kitchen. The next match is still the featured
  match bar above it, chosen automatically as before.
- Tablets and computers are unchanged (checked: identical screenshots). The
  match cards stay in the page, only hidden on phones, so countdowns, share
  buttons and search engines are unaffected.

**Staff need to:** nothing.

---

## 2026-10-19: WhatsApp button removed; one social links list; WhatsApp Channel card

**What changed**
- The floating green "Chat on WhatsApp" button is gone from every page. The
  management number 0903 039 9416 is shown on the Contact page (next to
  WhatsApp) and the Help page ("Still need help?"). MatchDay Kitchen WhatsApp
  ordering is unchanged.
- One shared list of the club's social links (src/data/social.ts), filled from
  the Content CMS social links. YouTube, TikTok and WhatsApp Channel hold
  `REPLACE_WITH_…` placeholders until the club sends the addresses; a
  placeholder or empty address is never shown.
- Footer social icons come from that list: "Lobi Stars on …" labels, open in
  a new tab, 44 px touch targets; plus a "Follow us on WhatsApp" link once the
  channel address is set.
- Homepage: a new "Join the Lobi Stars WhatsApp Channel" card just above the
  newsletter (Official channel, a green Join WhatsApp Channel button, "Free to
  join. Your phone number stays private."), shown only once the channel
  address is real.

**Staff need to:** put the YouTube, TikTok and WhatsApp Channel addresses in
the Content CMS (handover C5).

**Handbook:** STAFF-GUIDE.md › Social links and the WhatsApp Channel.

---

## 2026-10-19: Social links entered once

**What changed**
- The Share Hub uses the club's social links from the Content CMS (Site
  Settings › Social links) when a platform has no address of its own, so each
  address is entered once (footer icons, Share Hub and Website Health). Facebook,
  X and Instagram now show in the Share Hub.
- Website Health's "Social media links work" check counts those links too.

**Staff need to:** add the YouTube, TikTok and WhatsApp Channel addresses in
the Content CMS (handover C5).

---

## 2026-10-18: Data Backup: clear confirmation when sending

**What changed**
- **Send one now** shows "Sending…" and can't be pressed again while it works,
  then a green confirmation right under it (time, address, the email subject)
  and a notice at the bottom of the screen. Pressing it again within 2 minutes
  asks first. Every other message on the Data Backup page also appears as a
  notice at the bottom, so it is seen wherever you are on the page.

**Staff need to:** nothing.

---

## 2026-10-18: Website Health (Super Admins only)

**What changed**
- Settings › Website Health is rebuilt: about 55 read-only checks in 9 groups
  (pages and content, fan journeys, payments, email, matchday and broadcast,
  background tasks, security, outside services, speed). Each problem says what
  is wrong, why it matters, numbered fix steps and who should fix it, with
  Check again, Fix it (safe fixes only, confirmed and logged), Copy details
  for developer, Mark as acknowledged and History. A score card, group cards,
  "Run full check now" with progress, and a printable PDF report.
- A **🩺 Website Health** button at the top of the Dashboard with a green /
  amber / red dot and the number of problems.
- Only the three Super Admins can open it (a new permission, refused to every
  other role on the server; Head of Media no longer sees it).
- Automatic: a full check every hour, a quick check every 15 minutes on home
  matchdays, an email and a bell alert when something breaks (to
  dkakaan@lobistarsfc.com; not repeated for 6 hours unless worse; "Resolved"
  when fixed), a daily summary of warnings at 08:00, 90 days of history and the
  30-day uptime.
- New public address `/health/ping` (answers "ok") for an outside uptime
  monitor. The website now records when Paystack last sent a payment
  confirmation, so a missing webhook is noticed.

**Staff need to:** nothing. Super Admins: set up the free outside monitor once
(handover A23).

**Handbook:** STAFF-GUIDE.md › 29. Website Health.

---

## 2026-10-18: Weekly encrypted backup by email (and into Google Drive)

**What changed**
- Every Monday morning (after that night's backup) the website emails the
  encrypted backup to the address set in Settings › Data Backup (set to
  **dkakaan2@gmail.com**); **Send one now** sends one straight away. A failed
  send is alerted like a failed backup.
- New scripts/google-drive-backup-saver.gs: a free Google script for
  dkakaan2@gmail.com that saves each emailed copy into the Drive folder "Lobi
  Stars website backups" and keeps the newest 12.

**Staff need to:** set up the Google script once (DISASTER-RECOVERY.md, Part 1).

**Handbook:** STAFF-GUIDE.md › Data backup; DISASTER-RECOVERY.md.

---

## 2026-10-18: Disaster recovery: encrypted copies outside Cloudflare

**What changed**
- Settings › Data Backup › Automatic backups: **Download encrypted copy** for
  each day: the whole backup, still locked with the backup key, as one file to
  keep in Google Drive or on a USB stick. The page shows when the last copy was
  kept and turns red after a month.
- Each nightly backup now also holds the database structure, so a brand-new,
  empty database can be rebuilt from it.
- New tool scripts/decrypt-backup.mjs unlocks an encrypted copy with the key;
  scripts/restore-backup.mjs now rebuilds the tables, loads them in the right
  order, fills the "no password set" marker where passwords were left out, and
  adds the indexes and the Activity Log protection after the rows.
- New DISASTER-RECOVERY.md: the monthly habit for the club and step-by-step
  recovery for every situation, up to losing the Cloudflare account. Tested:
  an empty database was rebuilt and every table matched.

**Staff need to:** a Super Admin downloads the encrypted copy once a month
(handover A22).

**Handbook:** STAFF-GUIDE.md › Data backup; DISASTER-RECOVERY.md.

---

## 2026-10-18: Clear the Recent security events list

**What changed**
- Settings › Login & Security › Recent security events has a **Clear this
  list** button, shown only to the Super Admin who receives the security
  emails (dkakaan@lobistarsfc.com). The list then shows only newer events.
- Nothing is deleted: the Activity Log keeps the full history (it can't be
  changed, so nobody who broke into an account could hide what they did), and
  "list cleared" is itself recorded.
- If someone changes who receives the security emails, the previous person is
  emailed.

**Staff need to:** nothing.

**Handbook:** STAFF-GUIDE.md › Login & Security.

---

## 2026-10-18: Security emails to one chosen Super Admin

**What changed**
- New setting in Settings › Login & Security › Security alerts: **Send
  security emails to** every Super Admin, or only one of them. Set to
  **dkakaan@lobistarsfc.com**. It covers the alerts, the weekly security
  summary, warnings about changed payment/email keys and the monthly access
  review. Every Super Admin still sees the alerts in the 🔔 bell.
- Emails about a person's own account still go to them, and
  dkakaan@lobistarsfc.com now gets a copy (marked "Copy:") of: password
  changed, two-step login turned on or off, a backup code used (a new device
  and a lockout already reach them as alerts). Sign-in codes and password
  links are never copied, so nobody else can use them.
- Approval requests (new staff, big points changes and so on) go to the
  Super Admins who can approve **and** to dkakaan@lobistarsfc.com.

**Staff need to:** nothing.

**Handbook:** STAFF-GUIDE.md › Activity Log and security alerts; Login & Security.

---

## 2026-10-18: Staff access plan, Phase 7: data protection and backups

**What changed**
- Fans' emails and phone numbers are **partly hidden in every list**
  (`a***@gmail.com`, `0803****21`); the full details are only on the fan's own
  page, for roles allowed to see fan accounts.
- **Downloads of fans' details need a fresh two-step code** at the moment of
  downloading (plus download rights), and file names include the date and the
  downloader's initials. The ticket orders download now also needs download
  rights and is logged.
- **Deleting a fan's data** now also clears season-ticket and ticket-shop
  orders bought with their email.
- **Automatic encrypted backups every night** (02:00) to separate storage, kept
  30 days; programme files copied weekly; a **Last backup** card on the
  dashboard; alerts if a backup fails or is late; **Start a backup now** and
  **Download for restoring**; a restore tool for the developer
  (scripts/restore-backup.mjs) and steps in the handbook.
- **New role: Contractor:** temporary access (at most 14 days) without fans'
  data, downloads, staff or logs; every sign-in is reported to the Super Admins.

**Staff need to:** nothing. The developer switches the automatic backups on
(handover A22).

**Handbook:** STAFF-GUIDE.md › Protecting fans' data; Data backup (section 25);
Staff roles (Contractor).

---

## 2026-10-18: Staff access plan, Phase 6: Activity Log and alerts

**What changed**
- **Activity Log** shows who, what, when and from where (device and country;
  network address for Super Admins only), with filters for person, type and
  dates, and "Show older". League, Rewards and ticket changes (refunds, points
  adjustments) now appear there too, plus score and match status changes.
- Entries **can't be changed or deleted** (enforced by the database) and are
  kept for at least 12 months.
- **Security alerts** to the Super Admins by email and in the bell: fan-data
  downloads and backups, role and permission changes, emergency code use,
  two-step login resets, lockouts, new-device sign-ins by Super Admins and CRM
  Managers, and more than 10 failed sign-ins in 10 minutes.
- **Weekly security summary** email every Monday from 08:00.
- The Export Log also lists backups.

**Staff need to:** nothing.

**Handbook:** STAFF-GUIDE.md › Activity Log and security alerts.

---

## 2026-10-18: Staff access plan, Phase 5: matchday helper accounts

**What changed**
- New **Commerce › Matchday Helpers** page (Matchday Operations Manager and
  Super Admins): make a temporary **Gate** or **Kitchen** helper for one match
  (name, phone, match). Each gets a username, a 6-digit PIN and a one-time QR
  login link, with **Share on WhatsApp**.
- Helpers sign in at **lobistarsfc.com/helper** (or with the link) and see only
  their one screen: the gate ticket scanner or the Kitchen order board. No menu
  or other pages; the gate shows only the fan's first name.
- Their login lasts the whole match day on that device (no 30-minute timeout,
  no two-step login) and stops at 23:59 on match day (or a set finish time; at
  most 06:00 the next morning). **New PIN**, **Later finish** and **Switch off**
  (signed out at once). Five wrong PINs lock it for 15 minutes.
- Every ticket scan records the helper's (or staff member's) name; kitchen steps
  already did. The gate scanner now also accepts a staff login with scanner
  access, and shows only the fan's first name.

**Staff need to:** the Ops Manager makes helper logins before each home match.
Later: remove the old shared gate code (handover A21).

**Handbook:** STAFF-GUIDE.md › Creating matchday helper accounts;
STAFF-MATCHDAY-GUIDE.md › Gate and kitchen helpers.

---

## 2026-10-18: Staff access plan, Phase 4: approvals for sensitive actions

**What changed**
- New **Settings › Approvals** page (Super Admins). These wait for another
  Super Admin's approval: inviting new staff; giving someone Super Admin or a
  role that can download fan data; adding "Download fan contact data" to a
  role; adjusting Rewards points by more than 1,000; news articles ticked
  **Official statement** (optionally every article). Each can be switched off.
- Nobody approves their own request; rejecting needs a reason; the person
  asking is emailed the decision; approvers get an email and a 🔔 notice; all
  recorded in the Activity Log.
- **Official statements:** a new tick in the Content CMS. The article stays off
  the website until approved, and an edit needs approving again. The News
  screen shows "Waiting for approval".
- If nobody else could approve, the action goes ahead and is recorded (the club
  is never stuck).
- The season Prediction League prize (CMS) can only be changed by Super Admins.
  The Predict & Win prize per game is fixed in the code.
- Paystack and email keys (in Cloudflare): any change is noticed within a
  minute, recorded and emailed to the Super Admins (keys never shown).

**Also today:** the Live Order Board and Kitchen Screen always show the newest
open orders (a limit could hide the newest on a very busy day).

**Staff need to:** nothing. Optional: a Cloudflare deploy hook so approved
statements appear within 2 minutes (handover A20).

**Handbook:** STAFF-GUIDE.md › Approvals; section 1 (Official statements).

---

## 2026-10-18: Website Health project, Phase 1: the three Super Admins

**What changed**
- Only three people can be Super Admins: dkakaan2@gmail.com,
  dkakaan@lobistarsfc.com and marvinmanex@gmail.com. The list is the
  `SUPER_ADMIN_EMAILS` server setting in Cloudflare and can't be changed from
  the website. Emails are matched ignoring capitals and spaces.
- Full Super Admin access needs all three: the Super Admin role, an email on
  the list, and the email proven by accepting the invite. A fourth Super Admin
  can't be made, and listed Super Admins can't be given another role.
- Their accounts are made automatically from the list (an existing account is
  upgraded, never duplicated). **Send the Super Admin invites** on Login &
  Security emails their invites. Super Admins must set up two-step login before
  they can open anything (no 7-day grace).
- A change to the list is recorded in the Activity Log and emailed to everyone
  on the old and new list. If a Super Admin is disabled, the other two are
  emailed.
- **New role: Head of Media.** All content, matchday, broadcast, fans and
  Inbox, Rewards, partners, commerce, reports and site settings; not staff,
  approvals, logs, security settings, Website Health or service keys. Anyone
  holding the Super Admin role who isn't on the list gets Head of Media rights
  and is moved to Head of Media.
- The @lobistarsfc.com email rule (when switched on) exempts only the three
  Super Admin emails.
- **The old emergency admin code** keeps working until the Super Admins are set
  up. Once two of the three have signed in with two-step login, **Switch off the
  admin code** retires it. After that it's refused, recorded and reported, and
  the three Super Admins are each other's backup.
- Super Admins with a Gmail address see a one-time reminder to switch on Google
  2-Step Verification. Their confirmation is recorded.

**Who it affects:** the three Super Admins. There were no staff accounts on
the live site, so nobody had to be moved to Head of Media.

**Staff need to:** the three Super Admins accept their invites (handover A19).

**Handbook:** STAFF-GUIDE.md › Staff roles (Super Admin, Head of Media); Adding
and removing staff (the three Super Admins, the old emergency admin code);
section 25 (Gmail notice, Login & Security).

---

## 2026-10-18: Staff access and security: staff account management, roles matched to the plan, login security gaps closed

**Roles now follow the club's staff access plan exactly.** The permission
names and what each role includes were rebuilt from the plan (for example
`fans.inbox.reply`, `rewards.points.adjust`, `commerce.gate_scan`). Main
differences from the version of earlier today:
- Fan Support can edit fan accounts, manage memberships and mark Predict &
  Win prizes paid (still no downloads).
- Tickets, food and the kitchen belong to the Matchday Operations Manager
  (not Commercial).
- Media Editor is the social media and video role; Media Contributor uploads
  only.
- Commentary belongs to the Broadcast Operator; fan match alerts to the Media
  Editor and Matchday Admin.
- Only the Super Admin and CRM Manager can download fan data (the old
  per-person "Can export fan data" switch no longer grants downloads).
- Three extra permissions: general fan messages, the media@ mailbox, and
  "Newsletter: send" (Content Editors write the newsletter; the CRM Manager and
  Super Admins send it).
- Live Match Control and Match Tickets & Settings save only the parts your
  role may change (score and status, squad, stats, stream links, preview,
  prices, commentary); other parts are kept as they were.
- The content CMS shows each person only the sections their role can edit.

**Staff account management (new)**
- **Invites:** Super Admins invite staff by email; the person chooses their
  own password and sets up two-step login with a one-time link (48 hours). No
  admin ever chooses or sends a password. Status shows Active, Pending invite
  or Disabled.
- **Forgot password** on the login page (a reset link, 2 hours) and **Send
  password reset** on the Staff page.
- **Leaver process:** **Disable (leaver)** needs a reason; the account stops at
  once and is signed out everywhere; who and why are recorded; accounts are
  never deleted. **Re-enable** sends a new password link.
- **Role emails:** each person can have a role email (e.g. media@), and the
  club's role email directory (media@, news@, social@, design@, web@,
  broadcast@, fans@, info@, partnerships@, tickets@) is edited in the CMS.
  The contact page, partners page, Rewards page and season tickets show the
  right one, but only once its mailbox is marked ready; until then they show
  info@.
- **Monthly access review:** on the 1st of each month the Super Admins and club
  management get an email listing every account (unused for 30+ days
  highlighted) with a link to **Keep** or **Disable** each one.
- **Emergency (break-glass) account:** the owner admin code; every use emails
  the Super Admins and club management straight away and is marked 🚨 in the
  Activity Log.
- Role changes are emailed to the Super Admins and recorded.

**Login security gaps closed**
- A 2-minute warning before the 30-minute idle sign-out ("Stay signed in").
- **Email me a code:** a 6-digit code by email as a fallback for two-step
  login (10 minutes, works once).
- Generic error messages: "Email or password is incorrect." and a lockout
  message that doesn't say whether the address has an account.
- Sign-ins from a new device are emailed to the Super Admins as well as the
  person; lockouts and two-step resets are emailed to the Super Admins.
- IP allowlist option for "Super Admins and CRM Managers".

**Who it affects:** all staff. New staff are invited by email from now on.

**Staff need to:** nothing straight away. Club to-dos: create the role
mailboxes or forwarders and tick "Mailbox ready" for each (handover A17);
decide who keeps the emergency admin code sealed (A18); add club management
emails in Login & Security.

**Handbook:** STAFF-GUIDE.md › Before you start (your first time, forgot
password, security rules for all staff); Staff roles and what each can do;
Adding and removing staff; section 25 (what to do if you lose your phone,
emergency account, Login & Security).

---

## 2026-10-18: Staff access and security, Phase 2: login security

**What changed**
- **Login sessions:** each sign-in is now recorded on the server. "Log out"
  really ends it (a copied cookie stops working), and staff can see every
  device they're signed in on and **Log out of all other devices** (My
  account). Super Admins see everyone signed in (Settings › Login & Security).
- **Signed out automatically** after 30 minutes without activity and after 12
  hours at most. Automatic page refreshes don't count as activity. The Kitchen
  Screen and the Live Order Board stay signed in while open (12 hours at most).
- **Passwords:** at least 12 characters (was 10). Very common passwords, your
  own email or name, and passwords that have leaked from other websites
  (checked with Have I Been Pwned, which never sees the password itself) are
  refused. Existing passwords keep working until they're changed.
- **Temporary passwords:** new staff (and anyone whose password a Super Admin
  resets) must choose their own password before they can do anything else.
- **Lockout:** after 3 wrong attempts a "not a robot" check appears; after 5
  the account is locked for 15 minutes and the person is emailed. Super
  Admins can **Unlock** it.
- **Two-step login backup codes:** 10 single-use codes when two-step login is
  turned on, for a lost phone. New codes can be made at any time.
- **Two-step login can be made compulsory** (Settings › Login & Security),
  with 7 days for each person to set it up. It can only be switched on once a
  Super Admin has a personal account with two-step login and has signed in
  with it, so nobody gets locked out.
- **Security emails:** sign-in from a new device, backup code used, password
  changed, two-step login on/off, account locked. Every use of the owner admin
  code is emailed to the Super Admins.
- **Optional IP allowlist:** limit where Super Admins (or all staff) can sign
  in from. It can't be saved in a way that signs out the person saving it; the
  owner admin code always works.
- **Optional rule:** new staff emails must end with @lobistarsfc.com (off).
- **Leavers:** deactivating someone signs them out on every device straight
  away. Super Admins can also **Sign out everywhere** for a person, and can't
  deactivate themselves or change their own role.
- **Protection against other websites:** changes to the admin must come from
  the admin's own pages, and admin pages can't be shown inside another website
  or load scripts from unknown sites.
- The owner admin code is no longer kept in the browser after logging in.

**Who it affects:** all staff. Everyone is signed out once when this goes
live (the sign-in system changed), so log in again.

**Staff need to:** nothing straight away. Super Admins: create a personal
staff account with two-step login, sign in with it once, then decide whether
to require two-step login for everyone (handover list A16).

**Handbook:** STAFF-GUIDE.md › Before you start: logging in; Staff accounts;
section 25 (My account, backup codes, where you're signed in, Login &
Security). STAFF-MATCHDAY-GUIDE.md › If something goes wrong.

## 2026-10-18: Staff access and security, Phase 1: roles and permissions

**What changed**
- Staff roles are now built from permissions (for example "See the fan
  database", "Edit fans", "Download fan contact data", "Run Live Match
  Control"). There are 12 roles: Super Admin, Content Editor, Media Editor,
  Media Contributor, Matchday Admin, Broadcast Operator, CRM Manager, Fan
  Support, Commercial Manager, Matchday Operations Manager, Gate Staff and
  Kitchen Staff.
- A Super Admin can change what any role includes (Settings › Staff Users &
  Roles › Roles and what they include). Changes apply within a minute, can be
  undone with "Back to the default" and are recorded in the Activity Log.
  Only Super Admins can manage staff and roles.
- Some roles can look at a screen but not change it (for example Fan Support
  can look up fans but not edit or download them; Media sees Live Match
  Control but cannot change the match).
- The Inbox shows each role only its own messages: Fan Support the contact
  form, Commercial Manager sponsorship and hospitality, Media the media@
  emails; CRM Manager and Super Admin everything.
- Opening a screen outside your role shows a "You don't have access to this
  section" page with a button back to the Dashboard (before, you were sent
  to the Dashboard). The website checks every request, so typing a link
  directly doesn't get round it.
- The sidebar shows only the links you can open.

**Who it affects:** all staff accounts. The owner admin code is still a
Super Admin. Old role names still work and now mean the new role (Media →
Media Editor, Matchday Operator → Matchday Admin, Commercial → Commercial
Manager, Fan Relations → Fan Support, Kitchen → Kitchen Staff). "Analyst"
and "All areas" can no longer be given to new accounts.

**Staff need to:** nothing. When creating staff logins, pick from the new
role names.

**Handbook:** STAFF-GUIDE.md › Roles; Inbox (who sees what); Newsletter
(who can use it); Fan Match Alerts.

---

## Earlier changes (summary)

### 2026-10-17
- Newsletter: schedule a send for a date and time (or send now); send to all
  subscribers or only to chosen people; searchable subscriber list.
- Newsletter sender news@news.lobistarsfc.com; weekly on Wednesday by 9 pm,
  written by the media team.
- media@lobistarsfc.com: emails go to the media Gmail and into the admin
  Inbox for the Media role (end-to-end test still to do: HANDOVER-TODO F10).
- Fans' replies to Inbox emails come back into the Inbox.
- Cloudflare: timer Worker (kitchen alerts, scheduled newsletters), media-mail
  Worker, phone-alert keys and Matchday Programme storage set up.
- Google Search Console verified and sitemap submitted.

### 2026-10-16
- Emails sent as "Lobi Stars FC" from noreply@lobistarsfc.com, replies go to
  info@.
- Turnstile human check switched on for public forms.
- New admin login code and session secret.
- Membership form example names changed to "Tever" / "Adakole".

### 2026-10-15
- Lobi Stars Rewards: My Rewards, Wallet and Points History pages, member
  card QR, badges, header balance, points expiry, notifications, Rewards
  Reports with checks for suspicious accounts, pay with Star Points.
- Privacy Policy: Rewards sections (approved and published).
- Msendo Table Water added as Official Water Partner.
- Ticket prices: Popular ₦100, Cover ₦200, VIP ₦300.
- MatchDay Kitchen page: Share button.
- Personalised shirts: no-refund agreement at checkout.
- Navigation fixes on phones and tablets; accessibility and speed fixes;
  fixtures, results and table cached for 30 seconds.

### 2026-10-14
- Lobi Stars Rewards built (earning, tiers, catalogue, redeeming; hidden
  until launch).
- Ticket discounts (group, early bird, family bundle; all off by default).
- MatchDay Kitchen: order food to your seat at /kitchen/.
- Tickets page redesign; homepage hero and slim next-match bar.
- Zeva Premium Lager as Principal Partner.
