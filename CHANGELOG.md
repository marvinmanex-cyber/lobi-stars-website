# Lobi Stars FC website: change log

A dated record of every change to the website and the admin, newest first.
Each entry says what changed, who it affects and anything staff need to do.
How to use each feature is in the staff handbook (STAFF-GUIDE.md, and
STAFF-MATCHDAY-GUIDE.md for match days). Things the club still has to do are
in HANDOVER-TODO.md.

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
