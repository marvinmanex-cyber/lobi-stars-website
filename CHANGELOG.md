# Lobi Stars FC website: change log

A dated record of every change to the website and the admin, newest first.
Each entry says what changed, who it affects and anything staff need to do.
How to use each feature is in the staff handbook (STAFF-GUIDE.md, and
STAFF-MATCHDAY-GUIDE.md for match days). Things the club still has to do are
in HANDOVER-TODO.md.

---

## 2026-10-18: Staff access and security, Phase 2: login security (in progress)

Being built now; this entry is completed when it goes live.

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
