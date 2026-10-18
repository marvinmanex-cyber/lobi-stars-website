# Lobi Stars FC website: change log

A dated record of every change to the website and the admin, newest first.
Each entry says what changed, who it affects and anything staff need to do.
How to use each feature is in the staff handbook (STAFF-GUIDE.md, and
STAFF-MATCHDAY-GUIDE.md for match days). Things the club still has to do are
in HANDOVER-TODO.md.

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
