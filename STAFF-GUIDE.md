# Lobi Stars FC website: staff guide

This guide is for club staff who update the website. You don't need any
technical knowledge: everything is done through web pages in your browser.

---

## Before you start: logging in

There are two places where you make changes:

| What you want to change | Where | How fast it appears on the site |
|---|---|---|
| Matches, scores, live updates, messages, fans, food orders, partners, awards (everything in the admin menu) | **Admin** (https://lobistarsfc.com/admin/login) | Straight away |
| News, players, shop, videos, club pages | **Content CMS** | About 1–2 minutes after you press Save |

**Your first time (setting up your login):** a Super Admin invites you, and you
get an email **"Your Lobi Stars FC admin account"**. Press **Set up your
account** (the link works once, for 48 hours), choose your own password (at
least 12 characters), then set up two-step login: scan the QR code with an
authenticator app on your phone, type the 6-digit code, and **save your 10
backup codes** somewhere safe away from your phone. Nobody else ever chooses
or knows your password.

**Every time after that:**
1. Go to **https://lobistarsfc.com/admin/login**.
2. Type your staff email and password, then the 6-digit code from your phone
   app. No phone to hand? Type one of your backup codes, or press **email me
   a code** and use the code we email you (it works once, for 10 minutes).
3. You land on the **Dashboard** (see "Finding your way around the admin"
   below).

**Forgot your password?** Press **Forgot your password?** on the login page
and type your email: you get a link to choose a new one (it works for 2
hours). Then sign in as usual with your two-step code.

**Staying signed in:** you're signed out after **30 minutes without
activity** (a box warns you 2 minutes before; press **Stay signed in**) and
after **12 hours** at most; just log in again. The Kitchen
Screen and the Live Order Board stay signed in while they're open on a
tablet. After **3 wrong attempts** a "not a robot" box appears; after **5**,
the account is **locked for 15 minutes** and the account holder is emailed
(a Super Admin can press **Unlock**). Full details: section 25.

**The first time you open the Content CMS** on a computer or phone, it asks for
a **GitHub access token**. This is a long password-like code that the website
manager gives you once. Paste it in and the CMS remembers it on that device.
The CMS shows you only the sections your role can edit (for example a Media
Contributor sees Gallery, Homepage slides and Partners).

**Security rules for all staff**
- Never share your password, your codes or your backup codes, not even with
  club staff. Nobody from the club will ever ask for them.
- Use a password you don't use anywhere else.
- Lock your phone and computer; log out on shared computers.
- If you get an email about a sign-in or change you didn't make, sign in,
  press **Log out of all devices** (My account), change your password and tell
  the Head of Media.
- Downloaded fan lists contain personal data: keep them private and delete
  them when you're done.
- Lost your phone? See "What to do if you lose your phone" in section 25.


### Finding your way around the admin
- **Menu on the left**, grouped into colour-coded sections: 🏠 Overview,
  ⚽ Matchday, 📰 Content, 👥 Fans & Inbox, 🛒 Commerce, 🤝 Partners,
  📊 Analytics and ⚙️ Settings. You only see the sections your role allows.
  On a computer, the **«** button shrinks the menu to icons (hover an icon to
  see its links). On a phone, tap **☰** to open the menu.
- Links with **↗** open the **Content CMS** (or another tool such as the
  ticket scanner) at the right place.
- **← Back** (top left, on every admin page except the Dashboard): takes you
  back to the admin page you were on. If you opened the page directly, it goes
  up one level instead (a Food page → Food: Orders, Possible Duplicates → Fan
  Database, anything else → Dashboard). The Kitchen Screen has **← Admin**,
  and the login page has **← Back to the website**.
- **Top bar:** where you are (e.g. *Fans & Inbox › Fan Database*), a **search
  box** (fans, members, Inbox messages by name or LS- reference, matches and
  news), the **🔔 bell** (unread Inbox messages, messages waiting over 48
  hours, Predict & Win prizes not yet paid, commentary stream problems) and who
  is signed in, with **Log out**.
- **Dashboard:** the next match (with a button to open live match control on
  match day), messages this week (and how many wait for a reply), new contacts this week, page views today, people
  listening to the commentary, the latest Predict & Win winner and whether the
  prize is paid, plus quick actions.
- All the old admin addresses (e.g. /admin/matches, /admin/fans) still work,
  so old bookmarks are fine.
- **Where everything is:**

  | Section | Screens |
  |---|---|
  | 🏠 Overview | Dashboard |
  | ⚽ Matchday | Match Tickets & Settings, Live Match Control, Match Checklist, Predict & Win, Live Commentary |
  | 🏆 League | League Dashboard, Fixtures, Results, Table & Rules, Clubs & Venues, Import & Export, League History |
  | 📰 Content | News & Articles (including Team News), Fan Awards, Squad & Players ↗, Videos ↗, Gallery ↗, Club Pages ↗, Content CMS ↗ |
  | 👥 Fans & Inbox | **Inbox**, Fan Database, Newsletter Subscribers, Fan Accounts, Contact Sources & Downloads, Possible Duplicates, Members |
  | 🛒 Commerce | Ticket Scanner ↗, Food: Live Order Board, Food: Orders, Food: Analytics, Food: Menu & Prices, Shirt Personalisation Orders, Shop Products ↗, Hospitality Packages ↗, Membership Settings ↗ |
  | 🤝 Partners | Partners & Open Categories, Sponsorship Enquiries (opens the Inbox), Partner Reports, Partner Profiles ↗ |
  | 📊 Analytics | Traffic & Engagement, Contact Sources, Matchday Analytics, Commentary / Broadcast Report, Food Analytics |
  | ⚙️ Settings | Site Settings & Social Links ↗, Promo Bar ↗, Commentary & Stream Settings, Staff Users & Roles, Inbox Emails & Templates, Export Log, Activity Log |

- **Light or dark:** the 🌙 / ☀️ button in the top bar switches dark mode.
  Your choice is remembered for your account on that device.
- **Long tables** (more than 25 rows) get a **filter box** above them (type a
  name, match or word to narrow the rows) and **page numbers** below. Column
  headers stay visible while you scroll.

### Staff roles and what each can do (set by a Super Admin in Settings › Staff Users & Roles)
| Role | Job | Can do |
|---|---|---|
| Super Admin | One of the three website owners | Everything: staff, roles, approvals, login security, Website Health, backups, all data. **Only the three people in the Super Admin list** |
| Head of Media | Head of Media & Communications | All content, matchday, broadcast, fans and Inbox, Rewards, partners, commerce, reports and site settings. Not staff, approvals, logs, security settings, Website Health or service keys |
| Content Editor | Media Officer / Club Writer | All content (news, team news, programme, club pages, help, videos, gallery), uploads, writes the newsletter (can't send it to subscribers), media@ mailbox |
| Media Editor | Social Media & Video Officer | Videos, gallery, uploads, live matchday updates (preview and report, fan match alerts, sharing to socials), media@ mailbox |
| Media Contributor | Graphic Designer & Club Photographer | Uploads only: gallery, homepage images, partner logos |
| Matchday Admin | Website & Data Officer | Fixtures and results, Live Match Control, stats, squad, Man of the Match, Predict & Win; site settings, promo bar, social links (not broadcasting) |
| Broadcast Operator | Live Broadcast Coordinator | Watch Live links, Live Commentary, commentary settings, broadcast report |
| CRM Manager | CRM Officer | All fan data **including downloads**, the whole Inbox, newsletter (write and send), Rewards, all reports |
| Fan Support | Fan Relations & Membership Officer | General fan messages, fan accounts, memberships, Rewards look-up and fulfilment, paying Predict & Win prizes. **No downloads** |
| Commercial Manager | Commercial & Partnerships Officer | Partners, partner reports, shop, hospitality, shirt personalisation, sponsorship and hospitality enquiries (only those in the Inbox) |
| Matchday Operations Manager | Ticketing & Matchday Operations Officer | Tickets, gate scanner, food orders and the kitchen; creates matchday helper accounts |
| Contractor | Developer / contractor (temporary) | Content, matchday, broadcast and site settings for up to 14 days. No fans' data, Inbox, Rewards, downloads, staff or logs |
| Gate Staff | Matchday helper | Only the gate ticket scanner |
| Kitchen Staff | Matchday helper | Only the Kitchen order board |

Some screens have parts for different roles. On **Live Match Control**, only
Live Match Control staff change the score, status and timeline; the squad,
stats, stream links and preview/report each need their own permission, and
parts you can't change are kept as they were when you save. On **Match
Tickets & Settings**, prices are for ticketing staff, commentary on/off for the
Broadcast Operator, teams and dates for fixtures staff.

Older role names still work and are shown as the new role: Media → Content
Editor, Matchday Operator → Matchday Admin, Commercial → Commercial Manager,
Fan Relations → Fan Support, Kitchen → Kitchen Staff.

**Changing what a role includes:** a Super Admin opens **Settings › Staff
Users & Roles › Roles and what they include**, opens a role, ticks or unticks
permissions and presses **Save**. It applies to everyone with that role within
a minute, and **Back to the default** undoes it. Every change is in the
Activity Log. Only the Super Admin role can manage staff and roles. Seeing the
**Match Checklist** is part of every staff role (not the gate and kitchen
helper logins) and stays on whatever else a role includes.

Downloading fan contact data needs the **Download fan contact data**
permission: only the Super Admin and CRM Manager roles have it.
If you open a screen your role doesn't include, you see a **"You don't have
access to this section"** page with a button back to the Dashboard; ask a
Super Admin if you need it. The server checks every request, so typing a
link directly doesn't get round it. **Settings › Activity Log** shows every
staff action (exports, deletions, staff and role changes, award and
membership changes, Inbox replies, notes, assignments and status changes).

> **Tip:** Bookmark https://lobistarsfc.com/admin/login on the devices you use.

---

## 1. Add a news article

> **Published or Draft:** every story has a **Status**. **Published** stories appear on
> the website; **Draft** stories are hidden from the website, Google and search
> but stay in the CMS and on Admin → Manage news (marked "Draft"). The starter
> sample stories are all drafts, so you can use them as examples or delete them.
> The homepage news rows appear once at least **3** stories are published.
>
> **Official statements:** tick **Official statement** for official club
> statements. They stay hidden until a Super Admin approves them (Settings ›
> Approvals); editing one afterwards needs approving again.


1. Log in, then click **Manage news**.
2. Click **+ New article**. The news editor opens.
3. Fill in:
   - **Title**: the headline.
   - **Summary**: one or two sentences. This shows on the news cards.
   - **Category**: First Team, Club, Tickets or Media Watch.
   - **Cover Image**: click to upload a photo from your computer or phone.
     Landscape (wide) photos look best.
   - **Cover Image Description**: say what's in the photo, e.g. "Players
     celebrating a goal at McCarthy Stadium". This helps blind visitors and Google.
   - **Published At**: the date and time of the story.
   - **Body**: the full story. Leave an empty line between paragraphs.
4. Optional ticks:
   - **Is this a video?** Tick it, paste the YouTube link into
     **Video Link** and type the length into **Video Duration** (e.g. 06:02).
   - **Featured** puts the story in the big top section of the home page.
   - **Sample article**: leave this **unticked** for real news.
5. Click **Save** (or **Publish**). The story appears on the site in about
   1–2 minutes.

**To edit or delete a story:** go to **Manage news**, click **Edit** next to
it, make your changes and save. To delete, open the story and choose
**Delete** from the editor's menu.

---

### Extra fields on a story (all optional)
- **Tags:** add **Community** to a **Club** story about community work
  (clinics, school visits, charity). It then also appears on the Community
  page (/club/community).
- **Author name / role / photo:** shown as a byline ("By Ngozi Bello, Club Media Officer"). Leave blank to show "By Lobi Stars FC".
- **Updated at:** set this when you change a story after publishing; the page then shows "Updated …".
- **Tagged players:** pick players from the squad. They appear as small chips linking to their profiles, and the story appears under "Latest news about …" on each player's profile.
- **Category → Features**, or **Series → Heritage**: long reads get a wide layout with a large photo, reading time, big pull quotes (start a paragraph with `>`) and a **Photo gallery**.
- **Category → Club:** community, partner and off-pitch stories. They get their own "Across the Club" row on the homepage.
- **Shop the story:** pick club shop products (e.g. the new home shirt on a kit launch story). They appear as product cards under the article with a link to the shop.
- **Members only:** only confirmed members (section 11) can read the story text. Everyone else sees the title, summary and cover photo, with "Become a member" and "Log in" buttons. A video in a members-only story is also hidden from non-members.

### Publishing Team News (injury and availability update)
1. New story → **Category: Team News** and **Matchday content type: Team News**.
2. Set **Match date** to the day of the match.
3. In **Team News table**, add a row per player: pick the player (or type a name), choose **Available / Doubtful / Injured / Suspended**, and add the injury or reason and the expected return.
4. Publish. The table appears colour-coded at the top of the story, and as **Squad availability** on that match's Match Centre page.

## 2. Add or update a fixture, result or score

### Add a new match (fixture)

The whole 2026/27 NNL Conference D season (all 56 matches) is already loaded.
Dates, times and venues are changed in **League › Fixtures** (section 33).

1. To add a match that isn't in the league list (a cup tie or a friendly), open
   **League › Fixtures**, scroll to **Add a fixture**, choose the competition
   (add it first with **Add a cup or friendly competition**), the teams, the
   date and the kick-off time (Nigerian time) and press **Add fixture**.
2. Every Lobi Stars match also appears in **Match Tickets & Settings**
   (Matchday menu). Open it there, fill in the **ticket prices** in naira (home
   matches) and tick **Visible on the site**. The teams, date and venue of a
   league match can't be changed there: they follow League › Fixtures.
3. Click **Save match**. Tickets go on sale straight away.
5. **Members' priority window (optional):** set **General sale opens** to let
   confirmed members buy tickets first. Until that time only members who are
   logged in can buy; everyone else sees "Members' priority window. General
   sale opens …". Leave it blank for no priority window.

To change a match, click **Edit** on it. Use **Hide** if a match should
temporarily disappear from the site. A match that already has tickets sold
can't be deleted, only hidden.

> **Home games:** for Kick-off, Full-time, stream links, Man of the Match voting and Predict & Win, see **STAFF-MATCHDAY-GUIDE.md**.

### Entering player stats (for the Stats page)
After each match (home **or** away), open **Admin → Match Centre**, choose the
match and scroll to **Player stats**. Press **Fill from matchday squad** to tick
the starting XI, then tick anyone who came on, and enter **minutes played**,
goals, assists and yellow/red cards. Press **Save Match Centre**. The
**/stats** page and the season tab on each player's profile page update
straight away (minutes appear only on the profile pages):
- Top Scorers, Assists, Appearances, Yellow and Red Cards come from these entries.
- **Clean Sheets** are worked out automatically for goalkeepers who played when Lobi Stars conceded nothing.
- **Man of the Match** wins come from the fan vote.
- The **team** figures (played, won, drawn, lost, goals, home/away record, longest unbeaten run, form) come from the final scores.
Leaderboards with no data are hidden. Fans can switch seasons with the season menu.

### Fixture card buttons
Fixture cards (homepage, Fixtures page, match page) show buttons only when they lead somewhere:
- **Match Preview** – when a published story has *Matchday content type: Preview* and that match's date.
- **Buy Tickets** – home games that are on sale (a future match with at least one seat price set in Match Tickets & Settings).
- **Matchday Live** – home games, from 24 hours before kick-off until the end of match day.

### Matchday content checklist
In **Admin → Match Centre**, each match shows a checklist of recommended content:
Preview (two days before), Team News (day before), Line-ups (1 hour before
kick-off), Live updates (during), Match Report, Highlights video and
Reaction/Interview (after). A green tick appears when the content exists:
either filled in on the Match Centre (preview, line-ups, live timeline,
report, stream link) or as a **published** story with that **Match date** and
**Matchday content type**. **Create article** opens a new story in the CMS
with the title, category, type and match date already filled in.

### Update the score and live events (Match Centre)

1. In **Match Tickets & Settings**, click **Match Centre** on the match (or click
   **Match Centre** at the top and choose the match from the list).
2. **Status & score:** set the status (Upcoming, Live, Half-time, Full-time,
   Postponed or Cancelled) and type in the score.
3. **Live timeline:** during the game, press **+ Goal**, **+ Yellow**,
   **+ Red**, **+ Sub** or **+ Note**, then type the minute (e.g. 23 or 45+2),
   choose the team and type the player's name. Press **Save Match Centre**
   after each update. While the status is **Live**, fans' screens refresh
   every 30 seconds.
4. You can also fill in the **preview** (before the match), **line-ups**
   (one player per line, e.g. "1 John Doe"), **report** (after the match),
   **stats** and **gallery** photo links.
5. After the final whistle, set the status to **Full-time** and save. The
   match moves to the **Results** page with its score.

> **Tip:** Press **View public page** to see exactly what fans see.

---

## 3. The league table (automatic)

The table is **worked out by the website** from the results, so it can't be
typed in and is always the same on every page. To change it:

- **Results:** enter them in **League › Results** (section 33). Lobi Stars'
  own score comes from Live Match Control automatically.
- **Points deductions** and **tie decisions:** **League › Table & Rules**.

The old "League Table" form in the Content CMS has been removed.

---

## 4. Add a player

> **Sample players:** the starter sample players are never shown on the public site.
> They still appear (marked "sample") in Admin → Match Centre's squad picker, so
> don't pick them for a real match. The squad page shows "The squad will be
> announced soon" until you add real players.


> **Since 22 October 2026 the Squad & Staff Data Portal is the normal way to add
> players and staff** (section 38): their verified profiles build the Squad
> pages, profile pages, share images and stats automatically. Use the Content
> CMS only for a quick placeholder.

1. Open the **Content CMS** and click **Squad / Players**, then **New**.
2. Fill in the name, position, shirt number, and upload a **photo**. Portrait
   photos with the player's head near the top work best.
3. Add as much as you know: date of birth, state of origin, nationality,
   height (e.g. 1.85 m), preferred foot, appearances, goals, assists and clean
   sheets (goalkeepers), plus a short bio.
4. Make sure **Sample player** is **unticked**.
5. Click **Save**. The player appears on the Squad page, with their own
   profile page, in 1–2 minutes.

To update a player's stats later, open them in **Squad / Players**, change the
numbers and save. **Delete the three "Sample" players** once real players are
added.

Coaches are under **Coaching Staff** in the CMS. Add the coach's real name,
role (e.g. Head Coach) and photo, and set **Group** to "Coaching Staff" so they
appear on the Squad page.

---

## 5. Change shop prices and Jumia links

1. Open the **Content CMS** and click **Site Settings & Shop**,
   then **Club Shop Products**.
2. Open the product you want to change.
3. **Price in Naira:** type numbers only, with no ₦ sign and no commas
   (e.g. 25000). The site shows it as ₦25,000. If you leave it empty, the site
   shows "Price coming soon".
4. **Jumia Product Link:** open the product on jumia.com.ng, copy the full
   web address from the address bar and paste it here.
5. **In Stock:** untick it if the item is sold out.
6. Click **Save**.

The **Shop on Jumia** button only works when a product has **both** a price
and a Jumia link. Otherwise it shows "Coming soon".

### Shirt personalisation (name and number, paid with Paystack)
Switched **OFF**. To switch it on, in **Club Shop Products → Shirt personalisation**:
1. Enter the **personalisation fee** (added to the shirt price), the **most
   letters** allowed and the **sizes**.
2. Fill in **How fans get their shirt** (e.g. where and when to collect it).
   Fans see this before paying and in their confirmation email.
3. On each shirt that can be personalised, tick **Can be personalised** and
   make sure it has a **price** and is **In Stock**.
4. Tick **Switch on** and save. A **Personalise with name & number** button
   then appears on those shirts. Fans see a preview, check the spelling and
   pay with Paystack.

Paid orders appear in **Admin → Shirt orders**. Change each order from
*New (to print)* to *Ready*, then *Collected / delivered* (or *Cancelled /
refunded*). Personalisation needs Paystack set up (the same account as tickets).

**No refunds on personalised shirts:** before paying, fans must tick "I
understand: Personalised shirts are printed to your order, so they can't be
returned, exchanged or refunded once paid, unless the shirt is faulty or we
print it wrongly." The same line shows on the Club Shop page and in the
confirmation email, and Admin → Shirt orders marks each order "no-refund
agreed" (the time is saved with the order). A faulty or wrongly printed shirt
is still replaced or refunded.

---

## 6. Add a video

1. On YouTube, open the video and copy its address, e.g.
   `https://www.youtube.com/watch?v=dQw4w9WgXcQ`.
2. The **video ID** is the 11 characters after `v=`. In this example it's
   `dQw4w9WgXcQ`. For a short link like `https://youtu.be/dQw4w9WgXcQ`, it's
   the part after the last `/`.
3. Open the **Content CMS** and click **Site Settings & Shop**,
   then **Video Library (YouTube)**.
4. Click **Add** and fill in the **YouTube ID**, **Title**, **Category**
   (Highlights, Goals, Interviews, Press Conferences or Behind the Scenes),
   **Duration** (e.g. 06:02) and **Date** (YYYY-MM-DD).
5. Click **Save**. The video appears on the Video page in 1–2 minutes.

---

## 7. Add or change a partner (sponsor)

1. Log in and click **Partners** in the admin links. This page lists every
   partner by tier and warns you about any problems, such as a missing logo or
   two partners in the same category.
2. Click **+ Add partner** (or **Edit** next to an existing one). The editor
   opens.
3. Fill in:
   - **Partner Name** and **Tier**: Principal Partner, Official Kit Partner,
     Official Club Partners, Official Suppliers, Media & Broadcast Partners, or
     Institutional & Community Partners.
   - **Category** (e.g. Telecom) and **Official Title** (e.g. Official Telecom
     Partner). Only **one** active Official Club Partner is allowed per
     category.
   - **Logo**: upload the partner's logo. A transparent PNG or SVG looks best.
     If there's no logo yet, the site shows the partner's name in the box
     instead. Logos always sit on a white card, so leave **Card colour behind
     the logo** empty. Only fill it in (for example #000000) for a logo that is
     all white and can't be seen on white. If a partner only has a logo on a
     black box, ask them for a transparent PNG or SVG; the web team can also
     clean it up with `scripts/logo-to-transparent.mjs` (instructions at the
     top of that file).
     The one exception is **Zeva Premium Lager** (Principal Partner): its logo is
     a cut-out with no white background, shown without a card, larger, in the
     header, on its own row at the top of the footer's Official Partners and on
     its partner page. The web team switches this on with `logoNoCard: true`
     in the partner's file; the original logo is kept in
     `public/images/originals/`.
   - **Website** (starting with https://), a one-line **Short Description**
     and **Partner Since** (the year).
   - **Display Order**: 1 shows first within its tier.
   - **Age restricted**: tick this for alcohol brands. The site then shows
     "18+ | Drink Responsibly" next to their logo everywhere.
4. Make sure **Active** is ticked and click **Save**. The partner appears on
   the home page, in the footer, on /partners and on their own partner page in
   about 1–2 minutes. Partners are shown **once per page**: the homepage
   "Our Official Partners" section shows every partner in one straight line
   (two lines on phones, or with more than 8 partners), so the footer partner
   strip is left out there and on the partner pages; every other page shows
   them in the footer.

**To remove a partner** without deleting them, untick **Active**.

**Partnership Opportunities:** the categories you're offering to new sponsors
are under **Site Settings… › Partnership Opportunities & Benefits**. When you
add an active Official Club Partner, their category disappears from the
opportunities list automatically. The same screen holds the audience figures
for "Why partner with Lobi Stars" (empty figures are hidden) and the
partnership brochure PDF (the download button only shows once a file is added).

---

## 8. How to read the analytics dashboard and export the fan database

### Google Analytics 4 (only with the visitor's consent)

Besides the website's own anonymous counting, the site can use **Google
Analytics 4**, but **only for visitors who press Accept** in the cookie banner.
Before that nothing at all is sent to Google; pressing Reject later switches it
off and removes its cookies. Google's advertising features are off, and the
site never sends names, phone numbers, emails, payments or what someone ordered.

Key events recorded in GA4 (Reports › Engagement › Events):
`ticket_purchase_start` (Pay pressed on Tickets), `ticket_purchase_complete`
(payment confirmed), `kitchen_order_start` / `kitchen_order_complete`
(MatchDay Kitchen, online or WhatsApp), `newsletter_signup`,
`membership_signup` (fan account created or online membership payment),
`watch_live_click`, `whatsapp_channel_join_click`, `social_click` (with the
platform) and `prediction_submitted`. GA4 is switched on by the
`GA4_MEASUREMENT_ID` setting in Cloudflare (handover A26). Pages visited
without a full page load (the menu's quick navigation) are counted too.

### Google & Search data (daily sync)

Once a day (from 05:00) the website copies figures from **Google Search
Console** (how often the club appears in Google search, the clicks, the search
phrases, countries, devices and pages) and from **Google Analytics 4** (visits
by page, where visitors came from, phone or computer, and the key events) into
its own database. The first sync fetches the last 90 days; each daily sync then
refreshes the last 4 days, because Google adds search figures 2–3 days late.

- It needs a Google "service account" with read-only access (handover A27).
  Until that is set up, nothing happens.
- If Google is busy, the sync tries again; if a part still fails, it is noted in
  the Activity Log ("Analytics sync failed") and the other parts carry on.
- Only totals are copied: never names, emails, phone numbers or orders.
- The figures appear under Admin › Analytics › **Google & Search** (only for
  staff with "All reports" access).

**Reading the Google & Search section** (it follows the period buttons at the
top of the page and compares with the period before):

- **Search clicks:** people who clicked through to the website from Google.
- **Appearances in Google:** how often the site was shown in Google results,
  clicked or not.
- **Click rate:** clicks ÷ appearances.
- **Average position:** where the site usually sits in Google's results;
  1 is the top, so a **smaller number is better** ("places higher" = good).
- **Sessions / Users (sum of days) / Engagement rate / Avg. session:** from GA4,
  only visitors who accepted cookies. Users are added up day by day, so someone
  who came on three days counts three times.
- **Day by day:** the website's own page views (everyone), GA4 sessions,
  Google clicks, and appearances (bars, right-hand scale).
- **Top search phrases**, **How visitors arrived (GA4)**, **Key events**,
  **Google search by country** and **Pages: search, visits and views** (one
  row per page with all the figures together).
- **Sync now** fetches the last 4 days straight away; the line next to it shows
  the last sync, and a red note appears if Google refused something.

The last 2–3 days of search figures are always low: Google adds them late.

### Recommendations (Admin → Analytics)

Near the top of the Analytics page, the **Recommendations** box tells you
what the figures mean and what to do about them. It always looks at the
**last 28 days** compared with the 28 days before (the period buttons don't
change it), and is refreshed every morning after the Google sync.

- **At a glance:** short sentences: Google clicks and appearances, the
  phrase people search most, how many visits come from abroad, GA4 visits,
  phones vs computers, ticket checkouts.
- **Each card** shows how urgent it is (**Do this first**, **Worth doing**,
  **When you have time**), what was found, with the figures, and
  **How to do it**: tap it for numbered steps. The button on the card opens
  the right place (Search Console, Admin › News, Newsletter, Share Hub…).
- **Mark as done** when you have dealt with it: the card is hidden for 30
  days and listed under "Marked as done" (with who and when; also in the
  Activity Log). **Show again** brings it back early. If the problem is still
  there after 30 days, the card returns by itself.
- Changes to page titles and descriptions are code changes: send the
  suggested wording to your web developer, or ask Claude in VS Code.
- A **weekly summary written by Claude** at the top of the box (every
  Monday; switched on 21 Oct 2026). Press **Write a new summary now** for a
  fresh one at any time. It is sent only totals, never personal details.

### Charts, downloads and presentations (Admin → Analytics)

Every part of the Analytics page is shown as a chart as well as a table:
pie charts for shares (devices, countries, channels, contact sources) and
bar charts for comparisons (top pages, states, search phrases, key events
this period against the period before).

First choose the period at the top (Today, 7 days, 30 days, This season or
Custom), then use the **Download & present** buttons:

- **Excel (all data):** every figure on the page in one Excel file, one sheet
  per section, including the recommendations and their steps.
- **PowerPoint slides:** a finished slide deck in club colours to present at a
  meeting or send to partners: title, key figures, at a glance, one slide per
  chart and one per recommendation. It opens in PowerPoint, Google Slides or
  Keynote and can be edited.
- **Print / PDF:** a clean report for printing; in the print window choose
  "Save as PDF" to get a PDF.
- **Chart (PNG)** under any chart: a picture of that chart with its title and
  period, ready for WhatsApp or a slide.
- **Table (CSV)** under any table: that table for Excel.

The list of the latest fan sign-ups (names) is never included in downloads.
If a button says "Loading the figures…", it waits until the page has
finished loading and then downloads by itself.

### The analytics dashboard (Admin → Analytics)

**Choose a period** at the top: Today, 7 days, 30 days, This season (from the
season start date in Site Settings) or Custom. All times are Nigerian time.
Every number is compared with the period of the same length just before it:
a green ▲ means up, a red ▼ means down.

| Card | What it means |
|---|---|
| **Page views** | Pages opened on the website (everyone, including people who rejected cookies). |
| **Unique visitors** | Different people, counted only for visitors who accepted cookies, so it is lower than the real number. |
| **Downloads** | Matchday programme and partnership brochure downloads. |
| **Enquiries** | Contact Us and partnership forms sent. |
| **Total contacts / New contacts** | People in the fan database at the end of the period / who joined during it. |

- **Where our contacts come from:** the share of all contacts who came through
  each source. One person can come through several (e.g. bought a ticket *and*
  joined the newsletter), so these can add up to **more than 100%**.
  **First source** shows how each person *first* reached us and always adds up
  to 100%.
- **Traffic sources:** where visitors clicked from (WhatsApp, Facebook,
  Instagram, X, Google, Direct = typed the address or used a bookmark).
  Tip: add `?utm_source=whatsapp` to links you share so they are counted
  correctly, e.g. `https://lobistarsfc.com/tickets/?utm_source=whatsapp`.
- **Top states:** where visitors are, from their internet connection (no IP
  addresses are stored).
- **Latest sign-ups:** first name and source only. Full details are only in
  the Fan database.
- **Matchday:** for each home game, visitors to its live page and clicks on
  Watch Live and commentary.
- **Lobi Stars FC Live (commentary):** for each match with commentary: listens
  (presses of Play), unique listeners, average listening time and peak
  listeners. **Broadcast Report (CSV)** downloads these figures. MOTM votes and predictions appear once those
  features are switched on.
- **Partners:** impressions (page views, because every page shows every
  partner logo in the footer), clicks to each partner's website and click
  rate. Press **Export Partner Report (CSV)** to get a file to send to
  sponsors for the chosen period.

Signed-in staff, search engines and other robots are never counted.

### The fan database (Admin → Fan database)

One row per person, merged from the newsletter, Contact Us, fan accounts
(Predict & Win), membership, ticket purchases, partnership enquiries, food
orders and brochure downloads. People are matched by email address **or**
phone number, and the newest name and state are kept.

- **Search** by name, email or phone, and **filter** by source, marketing
  consent, state or the date they were last seen. Click a column heading to
  sort. Click a person to see everything they've done.
- If your account doesn't have **Can export fan data**, emails and phone
  numbers are partly hidden and the download buttons don't appear. Ask the
  owner if you need it.

**Downloads** (only for staff with export permission):

| Button | What you get |
|---|---|
| **Full fan database (.xlsx)** | An Excel file: *All Contacts*, a *Summary* sheet and one sheet per source. |
| **Source breakdown (CSV)** | How many contacts came from each source. |
| **Marketing list (CSV)** | **Only** people with Marketing Consent = Y, with each person's unsubscribe link. Use only this list for marketing emails or SMS. |

Files are named with today's date, e.g. `lobi-stars-fan-database-2026-10-09.xlsx`.

### Privacy rules (Nigeria Data Protection Act 2023)

- **Every download is logged** with your name and the time (see *Download &
  privacy log* at the bottom of the page).
- Only download when you need to, keep files on club devices and delete them
  when you're done. Never share them outside the club.
- **Only send marketing to the Marketing list**, and include each person's
  unsubscribe link in every marketing email.
- **Someone asks to stop marketing:** open them and press **Unsubscribe from
  marketing**.
- **Someone asks to be deleted:** open them and press **Delete this person
  everywhere**. This removes them from the fan database, the newsletter,
  their fan account and their enquiries. Ticket and food payments are kept
  for the accounts, with their name and contact details removed. It cannot
  be undone.

### Adding and removing staff (Super Admin only, Settings › Staff Users & Roles)

- **The list** shows each person's name and personal email, role, role email,
  two-step login, last login and status: **Active**, **Pending invite** or
  **Disabled**.
- **Add someone:** fill in **Invite a staff member**: name, their own email
  (for signing in), role, and optionally their role email (e.g.
  media@lobistarsfc.com). They get an invite link (48 hours) and set their own
  password and two-step login. If it expires, press **Resend invite**.
- **Change a role:** pick it in the Role column. The Super Admins are emailed
  about every role change. You can't change your own role.
- **Leaver:** press **Disable (leaver)** and type why (e.g. "Left the club").
  The account stops working at once and they're signed out on every device.
  Accounts are never deleted, so their history stays in the Activity Log and
  their content stays on the site. Also remove them from GitHub (Content CMS)
  and any club email forwarders. **Re-enable** emails them a link to choose a
  new password.
- **Other buttons:** **Send password reset** (emails a link), **Reset
  two-step** (lost phone; the Super Admins are told), **Unlock** (after 5
  wrong attempts), **Log out of all devices**, **Role email**.
- **Monthly access review:** on the 1st of each month the Super Admins (and
  club management, if added in Login & Security) get an email listing every
  account; accounts not used for 30 days are highlighted. Open the link, sign
  in, and press **Keep** or **Disable** for each person. **Email the review
  now** sends it straight away.
- **Role email addresses:** the club's team addresses (media@, news@, social@,
  design@, web@, broadcast@, fans@, info@, partnerships@, tickets@). The website
  shows the right one on the contact page, tickets, partners and Rewards. Edit
  them in the Content CMS: **Site Settings › Role email addresses**. Tick
  **Mailbox ready** only once the address really receives email (a forwarder in
  Cloudflare Email Routing); until then the site shows info@.
- **The three Super Admins:** only the three people in the **Super Admin
  list** can be Super Admins. The list is a server setting
  (`SUPER_ADMIN_EMAILS` in Cloudflare), so it can't be changed from the
  website. Any change is recorded and emailed to all three. Their accounts are
  made automatically from the list. **Send the Super Admin invites** (Settings ›
  Login & Security) emails each one an invite. They must set up two-step login
  before they can open anything. A fourth Super Admin can't be made, and a
  listed Super Admin can't be given another role. Anyone else who somehow has
  the Super Admin role only gets Head of Media rights, and is moved to Head of
  Media. If a Super Admin is disabled, the other two are emailed.
- **The old emergency admin code:** the owner admin code still works until the
  Super Admins are set up. Once at least two of the three have signed in with
  two-step login, press **Switch off the admin code** (Login & Security). From
  then on the three Super Admins are each other's backup. Its history stays in
  the Activity Log, and anyone who tries the old code is refused and reported.

### Creating matchday helper accounts (Matchday Operations Manager, Commerce › Matchday Helpers)

- **Add a helper:** name, phone (for WhatsApp), **Gate ticket scanner** or
  **Kitchen order board**, and the match. Press **Make the helper login**.
- You get a **username** (e.g. `gate-terver-4821`), a **6-digit PIN** and a
  **QR code / link** (it works once). They're shown once: press **Share on
  WhatsApp** (or **Copy**) to send them to the helper only.
- The helper scans the QR code or opens the link (or goes to
  **lobistarsfc.com/helper** and types the username and PIN) and goes straight
  to their screen. They see **only** that screen: no menu, no other pages, and
  only the fan's first name (gate) or first name, seat and order (kitchen).
- Helpers stay signed in **all match day** on their phone (no 30-minute
  sign-out, no two-step login) and their login **stops at 23:59** on match day.
- **New PIN** (forgotten PIN; the old one stops working), **Later finish** (up
  to 06:00 the next morning), **Switch off** (signed out straight away). Five
  wrong PINs lock the login for 15 minutes; a New PIN unlocks it.
- Every ticket scan and kitchen step records the helper's name; the list shows
  how many tickets each gate helper scanned.
- The old shared gate code still works for now (until it's removed from
  Cloudflare; see the handover list).

### Activity Log and security alerts (Super Admins, Settings › Activity Log)

- **Every action is listed:** who, what, when and **from where** (the device,
  e.g. "Chrome on Android", and the country of the network they signed in
  from; Super Admins also see the network address). Sign-ins and failed
  sign-ins, two-step login changes, scores and match status, Predict & Win
  prizes, Rewards points, refunds, menu prices, partner and settings changes,
  roles and permissions, staff added or disabled, and every download.
- **Filters:** search, person, type (sign-ins and security, staff and roles,
  approvals, downloads and backups, matchday, commerce, fans, partners,
  settings) and dates. **Show older** loads more.
- **Nobody can change or delete an entry**, not even the developer through the
  website, and entries are kept for at least 12 months.
- **Security alerts** are emailed (within a minute) to the Super Admin chosen
  in Login & Security › **Send security emails to** (now only
  dkakaan@lobistarsfc.com), and appear in every Super Admin's 🔔 bell: any fan-data download or backup, role and permission
  changes, the emergency admin code, two-step login resets, lockouts, sign-ins
  from a new device by a Super Admin or CRM Manager, and more than 10 failed
  sign-ins on the whole site in 10 minutes.
- **Weekly security summary:** every Monday morning the Super Admins get an
  email with sign-ins per person, downloads, approvals, lockouts and anything
  unusual.
- **Export Log** (Settings › Export Log): every download and backup with who,
  when, what and how many rows.

### Protecting fans' data

- **Lists show fans' emails and phone numbers partly hidden** (`a***@gmail.com`,
  `0803****21`): the Fan Database, contact sources, newsletter subscribers and
  Predict & Win entries. The full details are only on a fan's own page, for
  roles allowed to see fan accounts (CRM Manager, Fan Support, Super Admin).
- **Downloads of fans' details** (contacts, food customers and orders, ticket
  orders, Predict & Win entries, the Rewards report, backups) need **download
  rights** (only the Super Admin and CRM Manager roles) **and a fresh two-step
  code**: the page asks for the 6-digit code when you press Download (it's good
  for 5 minutes). Files are named with the date and your initials, e.g.
  `lobi-stars-contacts-2026-10-18-AO.xlsx`. Every download is logged and the
  Super Admins are alerted.
- **Deleting a fan's data** (a deletion request): CRM Manager or Super Admin
  opens the fan in the Fan Database and presses **Delete this person**. Their
  details are removed from every part of the site (contacts, newsletter,
  membership, Rewards, messages, orders, tickets, season tickets, predictions
  and votes are anonymised). Only the record number stays in the Activity Log.
- **Contractors** (e.g. a developer helping for a few days): invite them with
  the **Contractor** role and an **Access until** date (at most 14 days). They
  can work on content, matchday and site settings, but never see fans' data,
  the Inbox, Rewards, downloads, staff or logs. Every time they sign in, the
  Super Admins are emailed. After the end date their login stops.

### Approvals (Super Admins, Settings › Approvals)

Some actions don't happen straight away: another Super Admin must approve them.
Nobody can approve their own request. The person asking sees "Sent for
approval", the approvers get an email and a 🔔 notice, and everything is
recorded in the Activity Log.

- **What needs approval** (each can be switched off on the Approvals page):
  - inviting a new staff member;
  - giving someone the Super Admin role, or a role that can download fan data
    (e.g. CRM Manager), or adding "Download fan contact data" to a role;
  - adjusting a fan's Rewards points by more than 1,000;
  - news articles ticked **Official statement** (and, if switched on, every
    news article).
- **Approve or reject:** open **Settings › Approvals**. Press **Approve** (it
  happens at once) or **Reject…** and type why; the person who asked is told.
- **Official statements:** writers tick **Official statement** in the Content
  CMS. The article stays hidden ("Waiting for approval" on the News screen)
  until a Super Admin presses **Approve for publishing**. It then appears at
  the next site update. If someone edits it afterwards, it needs approving
  again.
- **If nobody else can approve** (for example only one Super Admin has set up
  their account), the action goes ahead and is recorded, so the club is never
  stuck.
- **Predict & Win prize:** the prize for each home game is set in the website
  code (only the developer can change it). The season Prediction League prize
  in the Content CMS can only be changed by Super Admins.
- **Paystack and email keys** are kept in Cloudflare and can't be changed from
  the website. If one is changed, the Super Admins are emailed within a minute
  and it's recorded (the keys themselves are never shown).

**Import existing records** (on
the Fan database page) pulls older records into the database; it is safe to
press again.

---

## 9. Lobi Stars FC Live (live match commentary)

Fans listen to live commentary of every Lobi Stars match on
**lobistarsfc.com/commentary**, in the Commentary tab of Matchday Live, and
from the **Listen Live** button on the homepage LIVE banner. It is branded
**Lobi Stars FC Live** everywhere. Fans never leave our website.

### Switch commentary on or off (whole site)
**Admin → Commentary** → tick or untick **Lobi Stars FC Live is switched on** →
**Save settings**. Fans see the change within a few seconds. When it's off,
the player shows "Off air".

### Set it up for each match
**Admin → Match Tickets & Settings** → **Edit** the match:
- **Live commentary available for this match** is ticked by default (home and away games).
- **Commentary starts:** leave blank to start **15 minutes before kick-off**,
  or set an exact time.

Fans can only listen from the commentary start time until **15 minutes after
full time**. Outside that the player says "Off air" and doesn't connect.
Press **End Match** in Match Centre as usual at the final whistle; if nobody
does, commentary ends automatically 2 hours 30 minutes after kick-off.

### Test the stream (do this before every match)
**Admin → Commentary** → **Test stream**. Each line says **working ✓** or
**not working ✗**: the stream fans connect to, the backup, and **Aeson Sports
Radio status feed** (whether Aeson's on-air signal can be read, and whether
it says on air). If something is not working, contact Aeson Sports Radio.

### Broadcast partner: Aeson Sports Radio
Aeson Sports Radio produces the commentary; fans only ever see and hear
**Lobi Stars FC Live**. The **Broadcast partner** box on **Admin →
Commentary** holds:
- **Status address:** Aeson's on-air feed. Leave blank for Aeson's standard
  address. The website reads it every 15 seconds; the player shows **Live now**
  only while it says on air (during a match's commentary window). If it can't be
  read, the player still lets fans listen during the window.
- **Primary listen address:** the Lobi Stars address fans' players connect to
  (e.g. `https://stream.lobistarsfc.com/…`, or `/live/commentary`). Only
  lobistarsfc.com addresses are accepted. Leave blank to use the default.
- **Backup listen address:** optional. The player switches to it as soon as
  the primary fails, and back again if needed.
- **Webhook secret:** a long random code agreed with Aeson. Aeson signs every
  on-air / off-air message with it, so the website updates within seconds.
  It is saved encrypted and never shown again: type a new one only to replace
  it. The **webhook address** to give Aeson is shown under it (Copy button).
- The line under it shows the last status read: reachable or not, on air or off.
- **Commentators:** optional names shown on the player.
- **Maximum listeners:** only for the website relay; extra listeners see "full, try again".

### Check listener numbers
**Admin → Commentary → Right now** shows **Live listeners** (updated every 30
seconds) and the **peak** for the current match. After matches, see the
**Lobi Stars FC Live** panel on **Admin → Analytics**, or download the
**Broadcast Report (CSV)**.

### What fans see on the player
- **Live now** (red) while Aeson is on air during a match's commentary window,
  with the score, the minute (e.g. "Live · 61'"), the goal scorers under each
  team and the commentators' names. The score and scorers come from **Live
  Match Control** first, so keep it up to date.
- **Starting soon** when the commentary window is open but Aeson isn't on air
  yet (fans can already press play).
- **Off air – next match: …** with the next match and its commentary time.

### What fans see while listening
- After pressing **Play**, a **"now playing" bar** appears at the bottom of
  every page (match name, Live / Paused, Pause/Play, **Stop**, Open). Fans can
  browse the whole website and the commentary keeps playing.
- It also keeps playing with the phone locked or in another app, with
  play/pause on the lock screen.
- **Stop** ends listening: the bar disappears and the lock-screen controls go away.
- **Never commentary and video together:** starting any video (Watch Live,
  match replay, goal clip, video in a story) pauses the commentary. Pressing
  Play on the commentary again pauses the video and shows "Video paused for
  live commentary" in its place.
- When nobody is listening, the website works exactly as before.

### White-label rule
Never put the broadcast partner's name, logo or web address on the
commentary player or the commentary pages, and never link fans to an outside
site for commentary. The partner still appears on the Partners page.

---

## 10. Fan Awards (Goal of the Month, Player of the Month, Player of the Season)

Fans vote at https://lobistarsfc.com/awards. You set the votes up in
**Admin → Fan Awards**.

### Set up a vote
1. Choose the award: **Goal of the Month**, **Player of the Month** or **Player of the Season**.
2. Type the month or season, e.g. *October 2026* or *2026/27*.
3. Choose a **Sponsor** if a partner sponsors the award (e.g. Zeva Premium Lager).
   The award is then called "*Zeva Premium Lager Goal of the Month*" and shows the
   partner's logo, if their logo has been uploaded on the Partners page.
   Leave it as *No sponsor* otherwise.
4. Set when voting **opens** and **closes** (Nigerian time).
5. Add the nominees:
   - **Goal of the Month:** 3 to 5 goals. Upload each goal clip to the club's
     YouTube channel first, then paste the YouTube link. Pick the scorer and
     write a short description (e.g. *vs Kada City, 34'*).
   - **Player of the Month / Season:** pick at least 2 players from the squad list.
6. Press **Create award**.

### Rules (enforced by the website)
- Fans need a free fan account with a confirmed email. One vote per fan per
  award, and a vote can't be changed.
- Votes are only accepted between the opening and closing times.
- Fans can't see the counts while voting is open, only how many fans have
  voted. When voting closes, the winner appears on /awards under **Past
  winners**. A tie gives joint winners.
- You can see the live count in Admin → Fan Awards at any time.

### Changing or deleting
- **Edit** lets you change the dates, month/season and sponsor at any time.
  The nominees can only be changed before the first vote.
- To close voting early, edit the closing time to now.
- **Delete** removes the award and all its votes. It can't be undone.

---

## 11. Membership (Admin → Members)

A fan becomes an **official member for the season** only when the club
confirms their payment. Signing up on the Membership page creates an account
but is **not** membership on its own.

### Confirm a membership
1. The fan pays the club (however the club takes membership payments).
2. Open **Admin → Members** and search the fan's name, email, phone or member
   number (LS-MBR-…).
3. Press **Confirm 2026/27** and type how it was paid (e.g. "Cash at club
   office, receipt 0123"). This is saved with your name.

The top of the page shows how many people signed up on the Membership page but
are not confirmed yet. Search their names to confirm them once they have paid.
**Remove membership** undoes it (e.g. a payment that bounced).

### What members get
- A **digital membership card** on their account page (name, member number,
  season, member since). Ask to see it on their phone at the club.
- **Members-only stories** (section 1).
- The **ticket priority window** (section 2).

### Settings (CMS → Site Settings → Membership settings)
- **Price** per season (shown on the Membership page and the account page).
- **How to pay:** shown to fans who are not yet members. Fill it in once the
  club decides how fans pay (e.g. at the club office).
- **Allow online payment:** OFF. When switched on, fans can also pay on their
  account page with Paystack and become members straight away.

Membership runs per season: at the start of a new season (Current Season in
Site Settings), everyone needs confirming again.

---

## 12. Hospitality (/hospitality)

The Hospitality page has an enquiry form (name, phone, email, company, number
of guests, which match, message). Enquiries arrive in the **Inbox** (Fans &
Inbox › Inbox, see section 18) like the Contact form, and are saved in the fan
database under **Hospitality Enquiry**.

To show packages, open **CMS → Site Settings → Hospitality packages** and add
each package: name, what's included, and a price (or price text such as "From
₦50,000 per table"). Leave the list empty to show only the enquiry form.

---

## 13. In-seat food orders (Admin › Commerce › In-Seat Food › Orders)

**MatchDay Kitchen (lobistarsfc.com/kitchen):** the page fans use to order
food to their seat, made for phones: the next home match, whether the kitchen
is open (with "Orders close in…" or "Opens in…"), their seat (section, row,
seat), the menu by category ("Match Day Combos" first), a cart, and checkout
with **Pay online** (Paystack) or **Order via WhatsApp**. After ordering, the
same page shows the order's progress: Received, Preparing, On the way,
Delivered (it follows the status you set in Orders). Orders arrive in the
admin, the Kitchen Screen and Telegram exactly as before. A fan who wants it
at half-time chooses "At half-time" and the order note starts with "Deliver at
half-time."

**Seat QR codes:** a QR code on a seat can open
`lobistarsfc.com/kitchen/?section=Cover%20Stand&row=12&seat=34`; the seat is
then filled in for the fan. Use the stand names exactly as in Food Menu &
Prices › Ordering (stands list).

**Where fans find it:** the green **MatchDay Kitchen** button in the top menu,
the "MatchDay Kitchen" section on the homepage under Upcoming Matches, the
green "Order food to your seat" button in the homepage match bar (home
matches), the
Match Centre page of every home match, the ticket confirmation page, every
ticket email, the footer, Help and the Stadium page. The kitchen opens and
closes with the ordering setting in Food Menu & Prices (Automatic opens it
before kick-off of each home match and closes it 3 hours after kick-off).
The older page lobistarsfc.com/food still works until the club confirms the
new page.

### How an order works
1. The fan chooses food, enters their **name, seat, stand, phone and email**
   (and an optional note for the kitchen) and presses *Place Order & Pay*.
2. The order is saved straight away as **Awaiting payment** with a reference
   such as **FD-20261011-0042**, and the fan goes to Paystack to pay.
3. The order becomes **Paid** only when the website has checked with Paystack
   that the money really arrived (right amount, in naira, for that
   reference). A fan cannot fake this from their phone.
4. The fan's order page shows "Confirming your payment…", then a live
   tracker: **Paid → Preparing → On the way → Delivered**. They also get an
   email with a **Track your order** link (once the email service is set up).
5. Orders not paid within **15 minutes** become **Expired** automatically.
   You can change the time under **Settings** at the bottom of the page.

### Orders on WhatsApp
Next to *Place Order & Pay* fans can press the green **Order on WhatsApp**
button. Their choice of food stays in the basket even if they refresh the
page.
1. The fan enters their name, phone, seat (or chooses **I'll collect it** and
   a pickup point) and an optional note. Email is not needed.
2. The order is saved with a reference (FD-…) and the prices from the menu,
   and **WhatsApp opens** with a ready-made message to the club number, for
   example *"Order: FD-20261011-0042, 2 × Beef Suya: ₦3,000 … Total ₦3,300,
   Seat C14, Cover Stand"*. The fan presses Send. If WhatsApp doesn't open,
   the page has a "Tap here" button, a **Copy order message** button and the
   club number.
3. On the **Live Order Board** the order appears in the green **WhatsApp
   orders** box (with the loud alert). Then:
   - **💬 Chat on WhatsApp** opens a chat with the fan with the right message
     already typed (e.g. the confirmation with your bank details). Check it
     and press Send.
   - **Confirm order** once you have replied (status *Confirmed – awaiting
     payment*).
   - **Payment received** when the money has arrived (bank transfer or cash).
     **Only press this when you have seen the payment.** The order then goes
     into **Paid – start preparing** like any other order and counts in the
     takings.
   - **Cancel** if the fan doesn't pay or changes their mind (then use
     💬 to tell them).
4. From then on it is the same as a website order: Preparing → Out for
   delivery (or **Ready for pickup** / **Collected** for pickup orders) →
   Delivered. A 💬 button lets you message the fan at each step.
5. WhatsApp orders nobody confirms expire after **3 hours** (change it in
   Ordering settings).
6. Limits: one phone number can place at most 5 orders in 30 minutes, and a
   hidden robot trap blocks spam.

### Statuses
| Status | Colour | Meaning |
|---|---|---|
| WhatsApp – to confirm | WhatsApp green | A WhatsApp order: reply to the fan and confirm it. **Not paid: do not prepare.** |
| Confirmed – awaiting payment | light blue | WhatsApp order confirmed; waiting for the fan's payment. **Do not prepare.** |
| Awaiting payment | amber | Not paid yet. **Do not prepare.** |
| Paid | green | Payment confirmed. The kitchen is alerted: accept it. |
| Accepted by kitchen | teal | The kitchen has seen it; start cooking. |
| Preparing | blue | The kitchen is making it. |
| Out for delivery | purple | A runner is taking it to the seat. |
| Delivered | dark green | Handed to the fan. |
| Payment failed / Expired | red / grey | No money taken. Nothing to do. |
| Cancelled / Refunded | grey | Cancelled by staff; refund done in Paystack. |

### Running in-seat food on matchday (Live Order Board)
Open **Food: Live Order Board** on a tablet or phone in the kitchen. It
updates by itself (the top shows **● Live**); there is no need to refresh.

- **Ordering OPEN / CLOSED:** the big button at the top opens or closes food
  ordering for fans straight away (e.g. at half-time or when the kitchen runs
  out).
- **WhatsApp orders** (green box at the top): see "Orders on WhatsApp" above.
- Columns: **Paid – start preparing** | **Preparing** | **Out for delivery / ready** |
  **Delivered** (last 30 minutes). Below, **Awaiting payment** lists orders
  that are not paid yet: **do not prepare them**.
- Each card shows the **seat and stand** in big letters, the items and
  quantities, the fan's note, the total and a **timer** since payment (amber
  after 10 minutes, red after 20).
- Tap **Start preparing**, then **Out for delivery**, then **Delivered**. The
  fan's order page updates straight away. ↩ moves a card back if you tapped
  by mistake. Every tap is saved with your name.
- 🖨 prints a kitchen ticket (seat, items, note).
- New orders flash when they arrive. Each admin page also shows a pop-up and
  plays a sound: a soft chime for a **new unpaid** order (🟡) and a loud,
  urgent beep for a **PAID** order (🟢, start preparing). Tap anywhere on the
  page once so the browser allows sounds. **🔊** in the top bar mutes them.

**Receipts for the buyer:** every card in **Delivered** has **🧾 Receipt to
the buyer: WhatsApp | Email | PDF**. The receipt is a compact **PDF** (one
square-ish page): the MatchDay Kitchen logo, order number, when paid and
delivered, seat, payment, customer, the items with prices and the total.
- **WhatsApp on a phone or tablet:** sends **only the PDF** (no message):
  the Share window opens; choose **WhatsApp**, then the customer, and send.
  If it asks for one more tap, press **Send the receipt PDF on WhatsApp**.
- **WhatsApp on a computer:** the PDF is saved to **Downloads** and a button
  **Open WhatsApp chat with …** appears. Click it, then in the chat click
  📎 (or +) › **Document**, open Downloads, choose the receipt and send (or
  drag the file from the download bar into the chat).
- **Email:** type or check the buyer's address; the website sends the
  receipt with the PDF attached (needs Resend).
- **PDF:** saves the receipt PDF straight into your **Downloads** folder,
  named with the customer's name (e.g. Achigbe-George-Alexander-Receipt-FD-….pdf).
- A ✓ and the time show once a receipt was sent.

**Notifications**, **Kitchen Screen** and **Orders list** at the top open in
a **new tab**, so the board stays open. Notifications opens Kitchen Alerts
with this device's notification settings already showing (close the box with **✕**, a click outside it, or Esc).

### Kitchen alerts and the Kitchen Screen (Admin › Commerce › Kitchen Screen)

**What the Kitchen Screen shows:** only orders the kitchen should cook:
**NEW** (paid), **COOKING** and **READY** (for 15 minutes). A WhatsApp order
reaches NEW only after someone presses **Payment received** on the Live Order
Board, and a website order only once Paystack confirms the payment. Delivered
orders leave the screen. Above the columns, a grey strip **"Coming in, NOT
PAID yet: don't cook yet"** shows orders on their way in, so the kitchen can
get ready. The screen updates at once when an order is placed, paid or moved.

**Buyer's email:** optional on both order forms (website and MatchDay
Kitchen). Buyers only give it if they want the receipt by email; without it,
staff can send the receipt on WhatsApp.

When an order is **paid**, the kitchen is alerted straight away and must
**accept** it, so no paid order is missed.
- **The Kitchen Screen** (https://lobistarsfc.com/admin/kitchen/) is a
  full-screen app for the kitchen phone or tablet: big text, dark screen,
  three columns: **NEW** (paid, flashing, loud beep every 5 seconds until
  someone taps **ACCEPT**) → **COOKING** (**START COOKING**, then **MARK
  READY**) → **READY** (disappears after 15 minutes). Each ticket shows the
  reference, minutes since payment (amber after 5, red after 10), the food in
  big numbers, the note in yellow, the seat or pickup point and the fan's
  first name. No phone numbers or money.
- **First time on a device:** log in, open the Kitchen Screen, type a name
  (e.g. "Kitchen tablet") and tap **Turn on kitchen alerts** (allows
  notifications, keeps the screen on, turns the sound on). Install it as an
  app (Android: browser menu → Install app; iPhone: Share → Add to Home
  Screen, then open it from the new icon and tap the button again).
- **Each matchday:** open the Kitchen Screen and **tap the screen once** so
  the sound can play. **🔇 Mute 1 min** silences it briefly; **🔔 Alerts
  ON/OFF** switches this device's alerts.
- **Phone notifications** arrive even when the screen is closed; tap one to
  open the order.
- **Telegram:** each paid order is also posted in the kitchen Telegram group
  with an **✅ Accept** button. The first person to tap it accepts the order
  ("Accepted by Ada at 19:43").
- **Not accepted?** The alert repeats every 3 minutes (up to 5 times) with
  "⚠️ STILL WAITING". Accepting anywhere (Kitchen Screen, live board or
  Telegram) stops it. A cancelled order sends "❌ CANCELLED, do not cook".
- **Kitchen staff accounts:** give cooks a login with the **Kitchen Staff** role.
  It only opens the Kitchen Screen (no customer details).
- **Admin › Commerce › Food: Kitchen Alerts:** the page reads top to bottom:
  the 4 steps of how alerts work; **Setup** (4 cards, ✅ when that part is
  ready, ⚠️ with what is missing); **Settings** on the left (switches for
  kitchen alerts and Telegram, how often to repeat and how many times, then
  **Save settings**); **Kitchen devices** on the right (remove lost ones);
  and the **Last 50 alerts** with buttons to show All / Push / Telegram /
  Failed (on a phone each alert shows as a small card). **Send test alert**
  is at the top right. The orders list shows each order's kitchen status
  ("Alerted 19:42", "Accepted by …", "⚠️ Not accepted, 4 min") and a
  **Resend kitchen alert** button.

### The orders list (Food: Orders)
Search by reference, name, phone, email or seat, and filter by status,
payment, match, stand, date and **Ordered by** (website or WhatsApp). Tap an order to see everything (customer,
items, note, Paystack reference and the time of each step), move it on,
cancel it or mark it refunded. **⬇ Excel** downloads the filtered list (staff
with "Can export fan data" only).

### Turning on order notifications on your phone
1. Open the admin on your phone (on iPhone, first use Share → **Add to Home
   Screen** and open the site from the new icon).
2. Go to **Food: Live Order Board** (or Food: Orders) and tap **🔔 Notifications**.
3. Choose what you want: **🟢 Paid orders** (on by default) and/or
   **🟡 New orders awaiting payment**, then tap **Enable notifications** and allow.
4. Tap **Send test** to check. Notifications arrive even when the admin isn't
   open. Tap one to open the live board. **Turn off** stops them on that device.

### Alert settings (for everyone, at the bottom of Food: Orders)
Switch phone notifications on or off for everyone, set **email alerts**
(paid orders on by default; unpaid orders off to avoid a full inbox) and the
addresses that receive them, and optionally **SMS / WhatsApp** for paid
orders (needs a Termii account).

---

## 14. Managing the food menu, prices and photos (Admin › Commerce › Food Menu & Prices)

**MatchDay Kitchen extras** (optional, per item): **Spice level** (Not spicy,
Mild, Medium, Hot: shown as small red dots) and a **Badge** (Best Seller,
Spicy or New). To show combos first, create a category with "Combo" in its
name, e.g. **Match Day Combos**; it is always listed first on MatchDay Kitchen.

Open **Food Menu & Prices** in the menu on the left (or the "Edit the menu"
button on Food Orders). Changes show on the public food page straight away.

### Add an item
1. Press **+ Add item**.
2. Type the **name**, the **price** in whole naira (e.g. 2500) and choose a
   **category** (Meals, Snacks, Drinks…). Add a short description if you like.
3. **Photo:** drag a picture onto the box (or tap *choose a file*). JPG, PNG
   or WebP up to 5MB. Choose the frame (4:3 or square), use **Zoom** and drag
   the picture to position it, then press **Use this photo**. It is made
   smaller automatically so it loads fast on phones.
4. Optional: **Most per order**, **Stock this match** (counts down as orders
   are paid and shows *Sold out* at 0), **18+** for alcoholic drinks (fans
   must confirm they are 18 or older).
5. The **Preview** shows exactly what fans will see. Press **Save item**.

### Everyday changes (straight from the list)
- **Sold out** switch: turn it on when an item runs out; fans see it greyed
  out and can't order it. Turn it off when it's back.
- **Price box:** type the new price and press Enter. New orders pay the new
  price; past orders keep the price that was paid. The change is recorded in
  the item's history ("Price changed from ₦X to ₦Y").
- **Edit** to change anything else (name, photo, category, limits).
- **Duplicate** makes a hidden copy (handy for a similar item). Edit it and
  tick *Show on the menu*.
- **Reorder:** drag the ⠿ handle, or use ▲ ▼, to change the order fans see.

### Deleting
- An item that has **never been ordered** is deleted for good.
- An item that **has been ordered** is **archived** instead: hidden from fans
  but kept for order history and reports. Find it under **Archived items** and
  press **Restore** to bring it back.

### Categories
In the **Categories** tab you can add, rename and reorder categories. A
category can only be deleted when it has no items.

### Ordering settings
- **Open**, **Closed** ("In-seat ordering opens on matchday") or **Automatic**
  (opens a set number of minutes before kick-off of a Lobi Stars home game
  and closes at full time).
- **Unpaid orders expire after** (minutes), **Minimum order** (₦, 0 = none).
- **Stands / sections:** one per line (set to **Popular Stand, Cover Stand, VIP
  Seating**; this is also the default). Fans then pick their stand from a list
  instead of typing it.

**💬 Order on WhatsApp** (same tab, below):
- **Show the "Order on WhatsApp" button:** switch it on or off.
- **Club WhatsApp number:** where orders are sent: **0708 009 4985** (the
  club's food order number since 19 Oct 2026; the management number 0903 039
  9416 stays on the Contact and Help pages).
- **Unconfirmed WhatsApp orders expire after** (hours).
- **Pickup points:** one per line, e.g. *Main Stand Kiosk*. When there is at
  least one, fans can choose **I'll collect it** instead of seat delivery
  (for both ways of ordering). Leave empty for seat delivery only.
- **Bank details:** the account fans pay into. They are put into the
  "Order confirmed" message.
- **Ready-made WhatsApp replies:** the messages for *Order confirmed*,
  *Payment received*, *Ready / on its way* and *Cancelled*. You can use
  {name} (first name), {ref}, {total}, {bank}, {pickup}, {seat} and {where}.

---

## 15. Reading the food analytics (Admin › Commerce › Food: Analytics)

Only **paid** orders are counted: unpaid, expired, failed, cancelled and
refunded orders never appear in the figures. Pick a period (7 days, 30 days,
this season, all time or custom dates) and, if you like, **one match**.

- **Cards:** paid orders and portions, revenue, average order, unique
  customers (and how many came back), **payment conversion** (paid orders out
  of all orders started), unpaid/expired orders, and **average delivery time**
  (from payment to "Delivered").
- **Most ordered items:** each item's share of all portions sold, e.g.
  "Beef Suya – 34% (212 portions)". The slices always add up to 100%.
- **Fan favourite:** the number-one item.
- **Items ranked:** bar chart and table with portions, % of items, revenue
  and % of food revenue (from the price each fan actually paid).
- **By category:** Meals vs Snacks vs Drinks.
- **Orders by stand:** where to put more runners.
- **Orders per 15 minutes:** for one match it is shown against kick-off
  (half-time is usually the busiest); otherwise by time of day.
- **⬇ Food Report (Excel):** sheets for orders, items with % and customers.
  **⬇ Customers (Excel):** the customer list. Both need **Can export fan
  data** and are recorded in the Activity Log.

Food customers are also added to the **Fan Database** (source "Food Order"),
merged with any existing record with the same email or phone. Their food
orders show in their profile there. The **Dashboard** shows today's paid food
orders, money taken and the top item.

---

## 16. In-seat food: setup checklist and a test run

### Before the first matchday (website manager / club)
1. **Paystack webhook:** in the Paystack dashboard → Settings → API Keys &
   Webhooks, set the webhook URL to **https://lobistarsfc.com/api/paystack-webhook**
   (the same address tickets use). Food orders are only marked paid after the
   website checks each payment with Paystack.
2. **Keys:** use Paystack **test** keys while rehearsing (below), then switch
   `PAYSTACK_SECRET_KEY` in Cloudflare Pages to the **live** key.
3. **Phone notifications:** run `npx web-push generate-vapid-keys` once and add
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`
   (`mailto:info@lobistarsfc.com`) in Cloudflare Pages → Settings → Variables.
4. **Email:** add the Resend key (`RESEND_API_KEY`, `RESEND_FROM`), then enter
   the kitchen/manager addresses under **Food: Orders → Alert settings**.
5. **SMS / WhatsApp (optional):** create a Termii account, add `TERMII_API_KEY`
   (and `TERMII_SENDER_ID`), then switch it on in Alert settings.
6. **Menu:** add the real items, prices, descriptions and photos
   (**Food: Menu & Prices**); remove anything not sold.
7. **Stands:** enter the stands/sections list (Menu → Ordering settings).
8. **Ordering times:** choose **Automatic** (e.g. 90 minutes before kick-off
   of home games until full time) or open/close it by hand.
9. **Staff:** give kitchen and runner staff a **Commercial** staff account,
   and ask them to enable notifications on their phones.

### A test run with Paystack test keys (do this once before going live)
With the test secret key set in Cloudflare (the live site then takes test
payments only):
1. Open **Food: Live Order Board** on a tablet; tap the page once (sounds).
2. On a phone, order on **/food** → the board's *Awaiting payment* strip
   shows it, with a 🟡 pop-up and soft chime (and a phone alert if chosen).
3. Pay with a Paystack **test card** (Paystack shows test card numbers on the
   payment page in test mode). The order moves to **Paid** without
   refreshing, with a 🟢 pop-up, urgent beep, phone alert and email.
4. Close the payment page **without paying** on another order: it stays
   *Awaiting payment* and becomes *Expired* after the time limit.
5. Move the paid order through Start preparing → Out for delivery →
   Delivered and watch the fan's order page follow.
6. Change a price and mark an item sold out; check /food updates and the
   earlier order still shows the old price.
7. Check Food: Analytics and the Fan Database (the customer appears with
   source "Food Order").
8. Switch Cloudflare back to the **live** secret key.

---

## 17. Contacts: downloads, the sources chart and duplicates

Everyone who gives us their details (contact form, newsletter, fan accounts
for Predict & Win and voting, downloads, membership, tickets, sponsorship and
hospitality enquiries, food and shop orders) is stored **once**: the same email
**or** the same phone number means the same person, with all their sources
listed together. Nothing anyone submitted is ever deleted by merging.

### Downloading the contact list
On **Fans & Inbox › Fan Database** or **Analytics › Contact Sources** (staff
with **Can export fan data** only):
- **⬇ Download All Contacts (Excel)** – `lobi-stars-contacts-YYYY-MM-DD.xlsx`:
  sheet **All Contacts** (one row per person: name, email, phone, state, all
  sources, first source, first/last seen, number of interactions, email
  verified, member, marketing consent), sheet **Summary** (totals and % per
  source, date and time of the export) and **one sheet per source**.
- **⬇ Download Filtered List (Excel)** – exactly what you have filtered on
  screen (e.g. Newsletter only, a date range, or the slice you clicked).
- **⬇ Marketing List (Excel)** – only people who agreed to marketing, with an
  unsubscribe link for each.
Every download is recorded (your name, time, type and number of rows) in the
**Export Log** and the **Activity Log**. Keep downloaded files private and
delete them when you no longer need them.

### Reading the contact sources chart (Analytics › Contact Sources)
- **Where our contacts come from (pie):** each person counted **once**, by the
  first way they reached us, so the slices add up to 100%. **Click a slice**
  to list those people underneath; click it again (or *Show all sources*) to
  go back.
- **All channels used (bars):** how many people used each channel at least
  once. Someone who joined the newsletter and later bought a ticket is in both
  bars, so the bars add up to more than the total.
- **Cards:** total contacts, new this month, how many agreed to marketing, and
  the top source. The period buttons (7 days, 30 days, this season, all time,
  custom) apply to the charts, cards and list.

### Possible duplicates (Fans & Inbox › Possible Duplicates)
Shows pairs with the **same name and a very similar email** (a typo, dots,
or the same username at another provider) that couldn't be merged
automatically. Press **Merge** (choose whose details to keep; all sources and
history are combined) or **Keep separate** (never suggested again). The likeliest matches (similar emails) are listed first; people with the same name but no email come last.

### Managing sources (Settings access)
At the bottom of Contact Sources, **Manage sources** lets you rename sources
(e.g. "Predictor Registration"), change their colours and order, and **add a
new source** before a new form goes live. Give the new source's code to the
website manager so the form records contacts under it. Added sources can be
deleted only while no contacts came from them.

---

## 18. Answering messages in the Inbox (Fans & Inbox › Inbox)

Every message sent with the **Contact form**, the **Sponsorship / partnership
form** and the **Hospitality form** arrives in the Inbox, including all the
messages sent before the Inbox existed. Each one is a conversation with a
reference such as **LS-2026-00123**. You answer by email from the website: the
fan receives your reply from the club address, signed with your first name
(e.g. *Ade from Lobi Stars FC*), and when they reply to that email, their
answer comes back into the same conversation.

Who sees what: **Super Admin** and **CRM Manager** see every message.
**Fan Support** sees general fan messages (Contact Form); **Commercial
Manager** sees Sponsorship and Hospitality enquiries; **Content Editor** and
**Media Editor** see only the **Media email** conversations (emails to
media@lobistarsfc.com, below). Other roles can't read messages.

**The media mailbox (media@lobistarsfc.com):** emails to media@ arrive in the
media team's Gmail (lobistarsmedia@gmail.com) **and** in the Inbox as **Media
email** conversations. The media team logs in to the admin with their staff
account (email media@lobistarsfc.com, role Media) and answers from the Inbox:
the reply comes from *Name from Lobi Stars FC Media* <media@lobistarsfc.com>,
and the journalist's answer comes back into the same conversation. Other
Inbox staff can see them too (filter **Media email**).

### The screen
- **Left:** the list. Each message shows the sender, the subject, the first
  words, the type (**Contact Form**, **Sponsorship**, **Hospitality**), the
  time, a **blue dot** if nobody has opened it yet, and the status.
- **Tabs:** All, Unread, New, Open, Replied, Closed, Assigned to me, Spam, Deleted. The
  number on each tab is how many are in it. Use **All types** to show only
  one type, and the search box to find a name, email, subject, reference or
  any word in the messages.
- **Waiting too long:** a message still waiting for a reply turns **amber
  after 24 hours** and **red after 48 hours** (coloured edge and "2d
  waiting").
- **Right:** the whole conversation. The fan's messages are grey, staff
  replies are blue (with **✓ Emailed**), and private notes are **yellow**.
  **Sender details** at the top shows their name, email, phone, company or
  interest, every way they have been in touch with the club, other
  conversations from the same person, and a link to their **Fan Database**
  profile.
- **On a phone:** the list and the conversation are two screens. Tap a
  message to open it and **← Back** to return to the list.

### Statuses
| Status | Meaning |
|---|---|
| **New** | Nobody has replied yet. |
| **Open** | The fan replied again and is waiting for us (also gets the blue dot). |
| **Replied** | We replied; waiting for the fan. Set automatically when you send a reply. |
| **Closed** | Finished. Set it yourself when nothing more is needed. |

Change the status with the **Status** box at the top of the conversation. If
a closed conversation gets a new email from the fan, it opens again by itself.

### Replying
1. Open the conversation and read it (opening it removes the blue dot; use
   **Mark unread** to put it back).
2. Under **↩ Reply by email**, write your reply. Use **B** (bold), **I**,
   **🔗 Link** (type the full address, starting https://) and the list buttons.
   Pasted text keeps the words but not other programs' styling.
3. **Insert template…** adds a saved reply. `{first_name}` is filled in with the
   fan's first name automatically. Change anything you need before sending.
4. **📎 Attach** adds PDF or image files (JPG, PNG, WEBP, GIF), up to 5MB
   each and 5 per reply, e.g. a hospitality price list.
5. **👁 Preview** shows the email exactly as the fan will get it: the sender
   name, the subject (with the reference in square brackets), your reply, your
   name, and their original message quoted underneath.
6. **Send reply** (or Ctrl + Enter). The reply is emailed, added to the
   conversation, and the status becomes **Replied**. If you are the first to
   reply, the conversation is assigned to you.

Your half-written reply is kept while you look at other conversations (until
you leave the page). If a reply says **⚠ Not emailed**, the email service is
not set up yet (see the setup steps below); the reply is saved, but the fan
did not get it.

### Working as a team
- **Assigned to:** choose who looks after a conversation. **Assigned to me**
  lists yours.
- **🔒 Private note:** switch to the yellow tab to write a note for other
  staff (e.g. "Called them, sending the proposal Friday"). Notes are **never**
  emailed to the fan.
- Replies, notes, status changes, assignments, spam and template changes are
  recorded in the **Activity Log** (Settings › Activity Log). The content of
  private notes is not copied there.

### Deleting a conversation
- **🗑 Delete** (at the top of the conversation) moves it to the **Deleted**
  tab, after you confirm. Anyone who can reply in the Inbox can do this.
- In **Deleted**, press **↩ Restore** to bring it back. A deleted conversation
  can't be answered, re-assigned or have its status changed until restored.
- Deleted conversations are removed **for good after 30 days**, together with
  the original form message.
- **Delete forever** (Super Admins only, in the Deleted tab) removes it
  straight away. This can't be undone. If the person has no other record
  (newsletter, tickets, account…), they also leave the fan database.
- If the fan writes back to a deleted conversation, it comes back to the
  Inbox by itself.
- Every delete, restore and delete-forever is in the Activity Log.

### Spam
- **🚫 Mark as spam** moves a conversation to the **Spam** tab. It is kept for
  **30 days** (in case of a mistake, use **✅ Not spam**) and then deleted for
  good, together with the form record.
- The forms also block most spam automatically: a hidden trap field that
  only robots fill in, a limit on how many messages can be sent from one
  connection or email address per hour, the Cloudflare **Turnstile** human
  check once its keys are added, and everything fans send is cleaned so no
  harmful code can run in the admin.

### Templates (📝 Templates at the top of the Inbox, or Settings › Inbox Emails & Templates)
Saved replies everyone can use. Three starter templates are included; edit
them to match how the club wants to answer. You can use `{first_name}` (the
fan's first name), `{staff_name}` (your first name) and `{ref}` (the
reference).

### Alerts and the daily summary (⚙️ Email settings)
- **Email staff about each new message:** Contact Form messages go to every
  staff account whose role answers them (Fan Support, CRM Manager),
  Sponsorship and Hospitality messages to every **Commercial Manager**
  (and CRM Manager) account, media@ emails to the Media roles (they need their own staff login with that
  role). The email links straight to the conversation; answer from the Inbox,
  not by replying to the alert.
- **Daily summary:** one email a day (after 8am) listing every message still
  waiting for a reply, with how long it has been waiting. It is sent the first
  time anyone opens the admin after 8am, or when a new message arrives.
- **Also send both to:** extra addresses, e.g. a manager.
- The **🔔 bell** shows unread messages and messages waiting over 48 hours.

### Privacy
- Only the roles above can read messages.
- **Deleting a person** in the Fan Database (right to erasure) also deletes
  all their conversations, replies and notes.
- Messages are still also copied to the club's existing Formspree email inbox
  for now, so nothing is lost while the email service is being set up.

### Setup (website manager, once)
The Inbox works now, but **emails are only sent once these steps are done**.
Until then, replies are saved but not emailed, and a yellow note at the top of
the Inbox says so. (Menu names at Resend may differ slightly.)

**A. Sending replies (Resend)**
1. Create an account at resend.com and add the domain **lobistarsfc.com**
   (Domains → Add domain).
2. Resend shows a few DNS records. In **Cloudflare → lobistarsfc.com → DNS →
   Records**, add each one exactly as shown. Set them to **DNS only** (grey
   cloud). They are:
   - **DKIM** (a TXT record named like `resend._domainkey`): a digital
     signature that proves the email really comes from the club.
   - **SPF** (a TXT record, usually on a `send` subdomain, starting
     `v=spf1`): the list of services allowed to send email for the club.
     Never add a second SPF record on the main domain; if the club already
     has one (e.g. for Google Workspace), change nothing there.
   - An **MX** record for the same `send` subdomain (bounce handling).
3. Wait until Resend shows the domain as **Verified** (minutes to a few hours).
4. Add **DMARC** (tells other mail services what to do with fake emails
   pretending to be the club): a TXT record named `_dmarc` with the value
   `v=DMARC1; p=none; rua=mailto:info@lobistarsfc.com`. After a few weeks
   without problems, change `p=none` to `p=quarantine`. If a `_dmarc` record
   already exists, keep the existing one.
5. In Resend, create an **API key** (sending access).
6. In **Cloudflare → Workers & Pages → the website → Settings → Variables and
   Secrets** (Production), add:
   - `RESEND_API_KEY`: the API key (as a secret);
   - `INBOX_FROM_EMAIL`: the club address replies come from, e.g.
     `info@lobistarsfc.com` (staff names are added automatically);
   - `RESEND_FROM`: the sender for other website emails (tickets, sign-ups),
     e.g. `Lobi Stars FC <noreply@lobistarsfc.com>`.
7. Redeploy (or wait for the next update). The yellow note in the Inbox
   changes once the email service is connected.
8. Make sure `info@lobistarsfc.com` is a real mailbox or forwards to one, in
   case someone writes to it directly.

**B. Fans' replies coming back into the Inbox**
1. Use a separate address area so the club's normal email is untouched:
   **reply.lobistarsfc.com**. Replies are addressed to
   `reply+LS-2026-00123@reply.lobistarsfc.com`, so each one finds its
   conversation.
2. In Resend, set up **receiving** (inbound) for `reply.lobistarsfc.com`.
   Resend shows an **MX record**: in Cloudflare DNS add Type **MX**, Name
   **reply**, and the mail server and priority exactly as shown.
3. Make up a long random secret (30+ letters and numbers). In Resend →
   **Webhooks**, add the address
   `https://lobistarsfc.com/api/inbox/inbound?key=YOUR-SECRET` for the
   **email received** event.
4. In Cloudflare Variables and Secrets add `INBOX_REPLY_DOMAIN` =
   `reply.lobistarsfc.com` and `INBOX_INBOUND_KEY` = the same secret. Redeploy.
5. Test: send a message with the Contact form from your own email, reply to it
   from the Inbox, then reply to that email. Within a minute your answer
   appears in the conversation with status **Open** and a blue dot.

Other email services (Postmark, SendGrid Inbound Parse, Mailgun) also work:
point their inbound webhook at the same address with the same key.

---

## 19. Admin handover: what is ready and what still needs doing

**Ready to use now**
- The admin menu, dashboard, search, bell, dark mode and staff roles
  (sections "Finding your way around the admin" and "Roles" at the top).
- **Fans & Inbox:** the Inbox (section 18), the Fan Database, contact
  downloads, the contact sources chart and possible duplicates (section 17).
- In-seat food orders, menu and analytics (sections 13 to 16).
- Every page and every role has been checked automatically: each role opens
  exactly its own screens, every menu link works, old addresses still work and
  no admin page can appear in Google.

**Still to do before staff rely on it** (website manager / club)
1. **Staff accounts:** create a login for each person in **Settings › Staff
   Users & Roles** with the right role (e.g. Fan Support for whoever answers
   fans, Commercial Manager for sponsorship and hospitality). Only tick **Can export
   fan data** for people who need to download contact lists. Stop sharing the
   owner admin code.
2. **Email (Resend):** API key, the sender address for Inbox replies
   (suggested **info@lobistarsfc.com**) and the SPF, DKIM and DMARC records
   (section 18, Setup A). Until then nothing is emailed: Inbox replies,
   alerts, the daily summary, ticket and food receipts and fan account emails.
3. **Fans' replies into the Inbox:** the `reply` MX record and the inbound
   webhook (section 18, Setup B).
4. **Human check (Turnstile):** create a Turnstile widget in Cloudflare, put
   the site key in `src/data/fan-settings.json` (`turnstileSiteKey`) and the
   secret key in the Cloudflare variables (`TURNSTILE_SECRET_KEY`). It then
   protects fan sign-ups and the Contact, Sponsorship and Hospitality forms.
5. **Formspree:** messages are still also copied to the old Formspree email
   inbox. Once Inbox emails work, decide whether to switch that copy off.
6. **Templates:** edit the three starter reply templates to match how the
   club wants to answer (📝 Templates in the Inbox).
7. **In-seat food, commentary and the other open items:** see "Outstanding
   items for the club" in STAFF-MATCHDAY-GUIDE.md.

**Where to find each feature in this guide:** team news and the matchday
checklist (section 2), player stats (section 2), award votes (section 10),
members-only stories (section 1 and 11), shirt personalisation orders
(section 5), hospitality (section 12), the promo bar ("Other things you can
update in the CMS"), the club pages (section 20), the app (section 21),
language (section 22), search and sharing (section 23), the newsletter (section 24), and your account, login security and backups (section 25).

**Trying the admin safely:** the website manager can run the website on
their own computer with demo messages and contacts (`npm run seed:local`, see
DEPLOYMENT.md). This never touches the live site.

---

## 20. Trophy cabinet, values, community and transparency pages

All four are edited in the **Content CMS** (Admin › Content › Content CMS ↗,
then **Site Settings & Shop**). Nothing appears on the site until
the club has confirmed it, so wrong or invented information is never shown.

### Trophy cabinet and "Club at a Glance" (CMS › Honours / Trophy Cabinet)
- **Honours:** each competition, what it **counts as** (League title, Cup
  or Other honour) and the winning seasons. Tick **Verified** once checked.
- **Year founded** and **CAF competition appearances** (with the seasons):
  tick **Verified** once checked.
- Confirmed items appear as counters with icons (e.g. **2 League titles**,
  1998/99 · 2017/18) at the top of **/club/honours** and in a **Club at a
  Glance** strip on the homepage. A counter with nothing confirmed is hidden;
  with nothing confirmed at all, the homepage strip is hidden and the honours
  page says the list is being confirmed.
- **To confirm (club):** the league titles and seasons, the FA Cup year(s),
  the year founded (the site says 1969 but some sources differ) and the CAF
  appearances. The entries in the CMS are unconfirmed suggestions.

### Our Values (/club/values, CMS › Club Values)
- A **draft** mission and five values (Pride, Community, Discipline,
  Ambition, Integrity) are ready for the club to review. Change the wording as
  needed, then switch on **Published**.
- Until then the page only says the values are coming soon, and it is not in
  the menu, search or Google.

### Community (/club/community, CMS › Community)
- Lists **community projects** (title, description, when, photo) and an
  **introduction** from the CMS (switch on **Published** to show them), plus
  every published **Club** news story with the tag **Community** (newest
  first).
- The page appears in the **Club** menu and the footer as soon as there is a
  published project, introduction or tagged story.

### Transparency (/club/transparency, CMS › Transparency)
- For **annual reports**, **financial statements**, **official statements**
  and **policies**. For each document: title, type, date, the **PDF file**
  (upload it straight from your computer) and an optional short summary.
- The page appears in the menu, footer, search and Google once the first
  document is added. Documents are listed newest first with their size and
  a Download button.
- Only upload documents the club has approved for the public.

---

## 21. The Lobi Stars app (add to home screen)

The website can be installed on a phone like an app: it gets the club badge
on the home screen and opens full screen without the browser bar.

- **What fans see:** on a phone, from their **second visit**, a small box
  says **"Add Lobi Stars to your home screen"**.
  - **Android (Chrome, Edge, Samsung Internet):** an **Install** button
    opens the phone's own install window.
  - **iPhone / iPad:** it explains how: tap **Share** (the square with an
    arrow), then **Add to Home Screen**, then **Add**.
  - **Not now** (or ×) hides it for **30 days**. It never appears on
    computers, once the app is installed, while the cookie notice is open or
    while live commentary is playing.
- **Live information is always fresh:** the app never stores pages, scores,
  fixtures, tickets or commentary. Only pictures, icons and design files are
  kept on the phone to make it faster. Without a connection, fans see a
  "You're offline" page with a **Try again** button.
- **Staff:** you can install it the same way to check the site quickly. If
  someone reports the app looks out of date, ask them to close and reopen
  it; pages are always loaded fresh.
- How often the prompt is shown, accepted or dismissed is counted in the
  analytics as **install_prompt** clicks.

---

## 22. Language

The website is in **English only**. The draft Pidgin, Hausa and Tiv versions
were removed on 13 October 2026 at the club's request, so there is no
language switcher and nothing to translate.

---

## 23. Search engines and sharing (automatic)

Nothing to do for most of this; it is built in. What it means for staff:

- **Every page has its own title, description and share picture.** When a
  link is shared on WhatsApp, Facebook or X, the preview shows:
  - **news stories:** the story's cover photo, title and summary (so always
    write a clear **Summary** and choose a good **Cover Image**);
  - **players:** their photo (players without a photo get a red-and-gold
    card with their name);
  - **matches:** a card with both club crests, e.g. *Lobi Stars v Kada
    Warriors* (a club without a crest in the site gets its initials);
  - **other pages (awards, partners, club pages...):** a branded card with
    the page title (partners show their logo).
- **Google** is told what each page is (a news article, a match with its
  date, venue and teams, a player, the club) so results can show extra
  detail, and the **sitemap** (https://lobistarsfc.com/sitemap.xml) lists
  every public page and match automatically. Drafts, hidden pages and the
  admin are never listed.
- **New opponent crest:** when the club plays a team whose crest is not on
  the site yet, send the crest image (a **transparent PNG**, if the club has
  one) to the website manager so it appears on tickets, fixtures and the
  match share picture. Crests show in their own shape, never in a white
  circle.
- **Website manager, once:** add the site to **Google Search Console**
  (search.google.com/search-console), verify it with a DNS record in
  Cloudflare, and submit the sitemap address above.

---

## 24. The newsletter: The Lobi Stars Weekly (Admin › Fans & Inbox › Newsletter)

A free weekly email for fans, with the club badge, the week's news, the next
match and adverts from the club's sponsors. Super Admin, CRM Manager, Content
Editor and Commercial Manager (sponsor adverts) staff can use it.

### Where fans sign up
- **The newsletter page** (https://lobistarsfc.com/newsletter): what they
  get, the sign-up form and the **options**: *the weekly newsletter*,
  *matchday & ticket alerts* and *partner offers*. Past newsletters are
  listed at the bottom.
- **Homepage:** a red-and-black "The Lobi Stars Weekly Newsletter" band (labelled "Free email newsletter") after the news
  sections, with a **Sign up free** button.
- **End of every news story:** a "Get stories like this every week" box.
- **Footer of every page:** the quick sign-up form (weekly newsletter) and a
  **Newsletter options** link; "Newsletter" is also in the footer's Fans list.
- Everyone who signs up is saved in the **Fan Database** (source:
  Newsletter), with their options.

### Who receives it
Everyone in the fan database who agreed to club news by email and has not
unsubscribed, except people who switched the weekly newsletter off. The
number is shown at the top of the Newsletter screen ("will receive the
newsletter"). Every email has an **Unsubscribe** link and a **Newsletter
options** link where the fan can change what they get (or come back after
unsubscribing).

### Writing a newsletter
1. Open **Fans & Inbox › Newsletter** and press **＋ New newsletter**. It
   starts filled in with this week's date, the three latest published news
   stories, the next match and all active sponsor adverts.
2. **1. The email:** the **Subject** (what fans see in their inbox) and the
   **Preview text** (the grey line after the subject in most inboxes).
3. **2. Main message:** a **Headline** and your **Message**. Each fan is
   greeted by their first name ("Hi Ngozi,"). Leave an empty line between
   paragraphs. Add a **Main photo** (Upload, or paste a picture address) and,
   if you like, a **button** (e.g. text "Buy tickets", link /tickets/).
4. **3. Next match:** tick to show the next Lobi Stars match with date,
   kick-off time, venue and a tickets button. It is filled in
   automatically from the fixtures.
5. **4. Stories:** each has a title, short text, picture and link. **＋ Add
   from club news** adds a published story in one click; **＋ Add a story**
   adds your own (e.g. a community visit). Use ↑ ↓ to change the order and ✕
   to remove one.
6. **5. Sponsor adverts:** choose the **"In partnership with"** sponsor shown
   under the club badge at the top, then tick the sponsor adverts to include
   in this newsletter and put them in order with ↑ ↓. There is no limit on
   the number of sponsors; they appear two per row on a computer and one per
   row on a phone.
7. The **Preview** on the right (below on smaller screens) updates as you
   type. Switch between **Computer** and **Phone** to see both.
8. **6. Who receives it:** **All subscribers** (everyone who agreed to club
   emails, hasn't unsubscribed and has the weekly newsletter on), or
   **Selected people only**: search by name or email and tick the people (they
   show as green chips; ✕ removes one, **Clear all** starts again). Only
   subscribers can be picked, so everyone chosen has agreed to club emails. The
   send button then says "Send now to 2 selected", and a schedule sends to the
   selected people only. The **Subscribers** tab shows the full subscriber list
   (emails partly hidden unless your account can export fan data).
9. **💾 Save draft** at any time. Drafts stay in the list until sent.

### Testing and sending
- **Send test:** type your email (up to 5 addresses, separated by commas)
  and press **Send test**. The subject starts with [TEST]. Always send a
  test and check it on your phone before sending to everyone.
- **📨 Send now to … subscribers:** confirms the number, then sends. Large lists
  are sent in rounds automatically; keep the page open until it says it has
  finished. A newsletter can only be sent once and can't be changed after
  sending; use **Duplicate** to make a new one from it.
- **🕒 Schedule:** instead of sending now, choose a date and time (Nigerian
  time, 5 minutes to 60 days ahead; it starts on next **Wednesday 20:00**, as
  the newsletter goes out every Wednesday by 9 pm) and press **Schedule**. It is
  then **Scheduled** in the list ("Goes out 21 Oct 2026, 20:00") and goes out
  by itself at that time to everyone subscribed then, so nobody needs to be
  online. Until then you can still edit it (press **Save draft** after
  changes), **Change time**, **Cancel schedule** (back to a draft) or press
  **Send now** (the schedule is cancelled and it goes out at once). Scheduled
  newsletters go out within a minute or two of the time once the timer Worker
  is running (HANDOVER-TODO A14); until then, at the first visit to the
  website after that time.
- **Who can write and send newsletters:** the Content Editor writes; the CRM
  Manager and Super Admins **send or schedule** to subscribers (a Super Admin
  can give the Content Editor "Newsletter: send" in the roles editor if the
  media team should send it themselves). The Commercial Manager edits sponsor
  adverts. Routine: one main newsletter every **Wednesday by 9 pm**, by the
  media team (media@lobistarsfc.com).
- After sending, the newsletter gets a **web version**
  (lobistarsfc.com/newsletter/…) for "View it in your browser" and the
  archive on the newsletter page.
- **Results:** the list shows how many emails were sent and how many clicks
  the newsletter got. Each sponsor advert shows how many clicks it has had
  from newsletters, which is useful for sponsor reports. Sponsor links also
  carry "utm" tags so sponsors can see newsletter visits in their own
  analytics.

### Sponsor adverts (the Sponsor adverts tab, or Partners › Newsletter Sponsor Adverts)
- **＋ Add sponsor advert:** sponsor **name**, **logo** (Upload; a PNG with a
  clear background looks best; pictures are made smaller automatically),
  **website link** (must start with https://), a **title** shown above the
  name (e.g. "Official Banking Partner"), the **advert text** (an offer or a
  short message), the **button text** (e.g. "Open an account") and
  **Active**.
- Also optional: an **offer or promo code** (shown in a gold box, e.g.
  "10% off with code LOBISTARS"), the sponsor's **address**, **phone** and
  **email** (shown under the advert), and **Featured**: a big advert across
  the whole email, above the other sponsors, with a **wide advert picture**
  (about 1200 × 600) if you upload one.
- **Edit** to change anything, **Switch off** to keep an advert for later
  without using it, **↑ ↓** to set the default order, **Delete** to remove it
  for good (newsletters already sent are not changed).
- **Import club partners** adds every partner from the website's Partners
  page in one go (name, logo, website and title); then add advert text to
  each. Play has no logo on the website yet, so upload
  its logo here.
- Only include offers the sponsor has approved, and keep advert text short.

### Template & settings (🎨 tab)
Change the wording used in every newsletter: the name under the club badge
(e.g. "The Weekly Newsletter"), the "Next match" and stories headings, the
featured and sponsor advert headings and the line under them, the club
address in the footer, the "why you get this email" text and the social links
(Facebook, X, Instagram, YouTube, TikTok, WhatsApp Channel; leave a link
empty to hide it). **Back to the standard wording** undoes your changes. The
preview shows changes straight away; newsletters already sent stay as they
were.

### Before the first newsletter (website manager)
The newsletter can be written and previewed now, but **is only emailed once
the email service (Resend) is set up** (section 18, Setup A). Optionally set
`NEWSLETTER_FROM` in Cloudflare to the sender, e.g.
`Lobi Stars FC <news@lobistarsfc.com>` (otherwise the general sender is used).
Set up (17 Oct 2026): the newsletter comes from **Lobi Stars FC
<news@news.lobistarsfc.com>**; replies reach info@. **Routine:** one main
newsletter every **Wednesday by 9 pm**, written and sent by the media team
(media@lobistarsfc.com).
Until then the Newsletter screen shows a yellow note.

---

## 25. Your account, login security and data backups

### My account (click your name at the top right, or Settings › My Account)
- **Change your password:** type your current password and the new one
  twice. Passwords must be **at least 12 characters**; a short sentence you'll
  remember works well (e.g. *my dog eats jollof at 7*). The website refuses
  very common passwords, your own email or name, and any password that has
  leaked from another website in a data breach. Changing your password signs
  you out on your other devices, and you get an email about it.
- **Two-step login:** after your password you also type a 6-digit code from
  a free app on your phone (Google Authenticator, Microsoft Authenticator or
  Authy). Even if someone learns your password, they can't get in without
  your phone. **Everyone who can see fans' details (Super Admins and staff
  allowed to download contact lists) should turn it on**; the dashboard
  reminds them until they do (and a Super Admin can make it compulsory for
  everyone).
  1. Press **Turn on two-step login**.
  2. In the app, tap **+ / Add account** and scan the QR code (or type the key).
  3. Type the 6-digit code the app shows and press **Confirm**.
  From then on the login page asks for the code after your password. Each
  code works once and changes every 30 seconds; if it says the code is wrong,
  wait for the next one and make sure the phone's time is set automatically.
- **Backup codes:** when you turn two-step login on you get **10 backup
  codes** (like `abcd-efgh`). Each works **once**, typed instead of the phone
  code, if you lose your phone. Print them or write them down and keep them
  away from your phone; you won't see them again. My account shows how many
  are left; **Make new backup codes** gives you 10 new ones (the old ones stop
  working). You're emailed whenever a backup code is used.
- **What to do if you lose your phone:**
  1. Sign in with one of your **backup codes** (instead of the 6-digit code),
     or press **email me a code** on the login page.
  2. Once in, open **My account**: make new backup codes, or turn two-step
     login off and on again with your new phone.
  3. No backup codes and no email? Ask a Super Admin to press **Reset two-step**
     next to your name (the Super Admins are told). You then sign in with your
     password and set it up again.
  4. If the phone was stolen, press **Log out of all devices** and change your
     password too.
- **When the club requires two-step login** (see Login & Security below),
  you're emailed and have **7 days** to turn it on; a reminder shows at the
  top of every admin page. After that, only My account opens until it's on,
  and you can't turn it off.
- **Where you're signed in:** My account lists every device you're signed in
  on (browser, network, when). **Sign out** one, **Log out of all other
  devices**, or **Log out of all devices (including this one)**. If you see a
  device you don't recognise, sign it out and change your password.
- **Emails about your account:** a sign-in from a new device (the Super Admins
  are told too), a backup code used, a password change, two-step login turned
  on, off or reset, and a lockout after wrong attempts. If it wasn't you, sign in, log out of all devices,
  change your password and tell a Super Admin.
- The old owner admin code works only until the three Super Admins are set up
  and switch it off (see "The old emergency admin code" above). While it works,
  every sign-in with it is emailed straight away to the Super Admins and is
  marked 🚨 in the Activity Log.
- **Super Admins with a Gmail address** see a one-time notice after signing in:
  "Your website access depends on your email account. Please make sure Google
  2-Step Verification is switched on for this Gmail account." Press **It's
  switched on** once it is (the Login & Security page shows who has
  confirmed).

### Login & Security (Settings › Login & Security, Super Admins only)
- **The three Super Admins:** each one's account, two-step login, last login
  and Gmail confirmation; **Send the Super Admin invites**; and **Switch off
  the admin code** (needs two Super Admins signed in with two-step login).
- **The rules for everyone** are shown at the top: 12+ character passwords,
  signed out after 30 minutes without activity and after 12 hours, locked for
  15 minutes after 5 wrong attempts.
- **Two-step login for everyone:** press **Require two-step login**. It only
  works once at least one Super Admin has a **personal staff account** with
  two-step login on **and has signed in with it once** (so nobody can be
  locked out). Everyone without it is emailed and gets 7 days. The table
  shows who has it on and each person's deadline. **Stop requiring it**
  switches it back off.
- **Staff email addresses:** tick to make new staff accounts use a
  **@lobistarsfc.com** address. Leave it off until everyone has a club email.
- **Only allow sign-in from certain networks (optional):** choose Off, Super
  Admins only, Super Admins and CRM Managers (the roles that can download fan
  data), or All staff, and list the allowed network addresses (for
  example the club office's internet connection; your own address is shown).
  The page won't save a list that would sign you out. The owner admin code
  always works from anywhere.
- **Security alerts:** **Send security emails to** chooses who is emailed:
  every Super Admin, or only one of them (the club chose
  dkakaan@lobistarsfc.com). The others still see every alert in the 🔔 bell.
  Add **club management** addresses (e.g. the club secretary) so they're told
  too. Alerts: the emergency admin code used, accounts locked, two-step login
  resets, role changes, sign-ins from new devices, fan data downloads, backups
  failing, the weekly summary and the monthly access review. Emails about
  your **own** account always go to you, and the chosen Super Admin gets a
  copy of the important ones (a new device, a lockout, a password change,
  two-step login turned on or off, a backup code used). Sign-in codes and
  password links are never copied, so nobody else could use them. Approval
  requests go to the Super Admins who can approve **and** to the chosen
  Super Admin.
- **Recent security events:** the latest sign-ins, wrong attempts, lockouts
  and account changes. The Super Admin who receives the security emails
  (dkakaan@lobistarsfc.com) can press **Clear this list** to start it afresh;
  nothing is deleted, the full history stays in the Activity Log, and the
  clearing itself is recorded. If someone changes who receives the security
  emails, the previous person is emailed.
- **Signed in now:** everyone signed in, with device and network. **Sign
  out** one device or **Sign out everywhere** for a person.
- **Recent security events:** sign-ins, wrong attempts, lockouts, backup
  codes used, and changes to accounts, roles and these settings.

### Data backup (Settings › Data Backup, Super Admins only)
- **Automatic backups:** every night from 02:00 the website saves an
  **encrypted** copy of the database in separate storage (it takes a few
  minutes), and copies the programme files every Sunday. Backups are kept for
  **30 days**. The dashboard's **Last backup** card is green when last night's
  backup worked and red if it failed or is late; the Super Admins are also
  emailed. **Start a backup now** runs one straight away.
- **Download backup (Excel)** saves everything the website stores (fans and
  contacts, messages, newsletter, tickets, food orders, votes, predictions,
  matches, settings) in one workbook, one sheet per table. **JSON** is the
  same for the website manager. You're asked for a fresh two-step code first.
- Passwords, sign-in links, two-step login secrets and stored pictures are
  never included.
- **Restoring** (with the developer):
  1. Within the last 7 days: the developer can put the whole database back to
     any minute with Cloudflare D1 "Time Travel".
  2. Older: on Data Backup, press **Download for restoring** next to the day
     you need (a fresh two-step code is asked for). Give the file to the
     developer privately. They run
     `node scripts/restore-backup.mjs <file> > restore.sql` and then
     `npx wrangler d1 execute lobi-stars-tickets --remote --file=restore.sql`.
     Rows are put back as they were; newer rows stay. Staff passwords aren't in
     backups, so staff may need new invites.
  3. Test a restore once every 3 months on a copy (the developer), so you know
     it works.
- **A copy outside Cloudflare, every week.** The nightly backups are stored
  in the same Cloudflare account as the website, so every Monday morning the
  website emails the encrypted copy to the address under **Email the
  encrypted copy every Monday to** (dkakaan2@gmail.com); **Send one now**
  sends one straight away. A free Google script saves each one into the
  Google Drive folder "Lobi Stars website backups" (setup in
  DISASTER-RECOVERY.md, Part 1). You can also press **Download encrypted
  copy** next to a day and upload it yourself. It is
  locked with the backup key, so it is safe there; keep the key somewhere
  else (a password manager). The page shows when the last copy was kept and
  turns red after a month. If the Cloudflare account were ever lost, the
  developer rebuilds the website from this file and the key:
  **DISASTER-RECOVERY.md** has every step.
- The file contains fans' personal data: keep it somewhere private (not email
  or chat groups) and delete old copies. Every download is in the Activity Log.
- Cloudflare also keeps its own copies: the website manager can restore the
  database to an earlier point (D1 "Time Travel": the last 7 days on the free
  Cloudflare plan, 30 days on the paid plan).

### Accessibility statement (/accessibility)
The website has a public page explaining how it works for everyone (keyboard,
screen readers, large text, phones, less movement) and how to report a
problem. If someone reports a problem, pass it to the website manager.

---

## 26. Fan Match Alerts (Matchday › Fan Match Alerts)

Fans can get a **notification on their phone** (or computer) for match-day
moments. They turn it on with the **🔔 Match alerts** box on the homepage,
Fixtures, Match Centre and Commentary pages and choose what they want:
🎙️ radio show & live commentary, ⚽ kick-off / half-time / full time,
🥅 goals. No account, name, email or phone is needed, and they can turn it
off on the same box. (iPhone: the site must first be added to the Home
Screen and opened from there.)

**Automatic alerts** (each goes out **once per match**):

| Alert | Sent when |
|---|---|
| 🎙️ "Pre-match show is live" / "Live commentary has started" | Lobi Stars FC Live goes on air (it says "pre-match show" if that is before kick-off) |
| ⚽ Kick-off | **Start Match (Kick-off)** is pressed in Live Match Control |
| ⚽ Goal | The score goes up and you press **Save Match Centre** |
| ⏸️ Half-time / ▶️ Second half | The status is changed to half-time, then back to live, and saved |
| 🏁 Full time (with the score) | **Full Time** is pressed |

So **enter the score correctly before saving**: a wrong goal sends a wrong
alert that can't be called back.

**The Fan Match Alerts page** shows how many fan devices are signed up (in
total and per kind), switches to turn any automatic alert off, **Send an
alert now** and **Recent alerts** (how many devices it reached).

- **Send an alert now:** tap a ready-made one (🎙️ Pre-match show starting,
  🎙️ Commentary starting, 📋 Team line-up is out, 🎟️ Tickets on sale) or
  write your own title (up to 100 characters) and message, choose which page
  it opens and which fans get it (e.g. only fans who chose radio), then
  **Send alert**. It asks you to confirm because it can't be undone.
- Alerts go out in groups of 40 devices; with thousands of fans it can take
  a minute or two. Keep any admin page open and it carries on by itself.
- Don't over-send: a few alerts per match is right. Too many and fans turn
  them off.
- Who can use it: Super Admins, Matchday Admins and Media Editors.

## 27. Back buttons on the public website

Every page except the homepage has a bar under the menu with **← Back** and
where the fan is (e.g. *Home › The Club › Honours*). **Back** returns to the
page they came from on our site. If they arrived from Google, a shared link or
typed the address (nothing on our site to go back to), it goes up one level
(a story → News → Home; /tickets → Home), never off the site. Each part of the trail can be
clicked. The Match Centre keeps its own **← Fixtures & results** link, and the
"You're offline" screen has **← Go back**. New pages get the bar automatically;
nothing needs adding.

## 28. Match Day Programme (Matchday › Matchday Programme)

The 4-page programme for each match. Fans read it free at
**lobistarsfc.com/programme**: they sign in with their email and a 6-digit
code (no password), then **Read online** (pages scroll on the phone) or
**Download PDF**. It is the same fan account as Man of the Match and Predict &
Win. Who can use it: Super Admins, Matchday Operators and Media.

### Prepare the PDF
A4 portrait, **exactly 4 pages**, under 10 MB if possible (25 MB at most).

### Add a programme (+ New programme)
1. **Match details:** pick the fixture to fill everything in, or type the
   title (e.g. "Lobi Stars vs Enyimba"), opponent, competition, venue and
   kick-off (Nigeria time).
2. **PDF:** drop the file in the box (or click to choose it). The page checks
   it: it must have exactly 4 pages; it warns if a page is landscape or the
   file is over 10 MB (slow on mobile data). You see the four pages; press
   **Upload and continue** and watch the progress bar. Uploading again later
   replaces the files (a new version).
3. **Quick links:** small buttons above the pages, up to 8. Tap a ready-made one
   (Order food on WhatsApp, Order food to your seat, Listen to Lobi Stars Radio,
   Buy tickets, Vote Man of the Match, Predict & Win, Club shop) or type your
   own: a label of up to 40 characters and an address starting with https://.
4. **Publish:** Save as draft, **Publish now**, or **Schedule** (choose the
   time, or press "24 hours before kick-off"). Check the summary, then
   **Confirm**.

**Preview** shows the programme exactly as fans see it (drafts too; nothing
is counted). **Unpublish** hides it from fans; **Publish again** brings it
back. A draft that was never published can be deleted.

### On the website
- /programme shows the current programme (the next match; after the match the
  latest one) with its cover, and earlier programmes below. When the next one
  is scheduled, fans see "The programme drops in 3h 12m" and can register so it
  is waiting for them.
- The homepage shows a yellow "Match Day Programme" bar: **Lobi Stars FC vs
  <next opponent>** with HOME or AWAY. The opponent always comes from the next
  Lobi Stars fixture (the same match as "Upcoming Matches"), never from the
  programme's title, and it moves on by itself once a match is played (or
  marked full time, cancelled or postponed in League › Fixtures). The
  button always says **Read free →** and opens the programme page, which tells
  fans when the programme isn't out yet. Changes show within 30 seconds (straight away after
  any save in the admin). Switch **Homepage banner** off on the admin page to
  hide it; **Programme page on** switches the whole feature off.
- New fans give their first name (surname and phone optional) and can tick
  "Send me club news and match day programme alerts". It is never ticked for
  them.

### QR advert campaigns
Every QR advert has its own short link, e.g. **lobistarsfc.com/p/gate**. A fan
scans it, lands on a small fast page, enters their email, types the code (or
taps the button in the email) and the PDF downloads. Ready-made campaigns:
gate (stadium gate posters), screen (big screen), social, status (WhatsApp
status), radio, flyer and kiosk (food kiosk).

- **The table** shows each campaign's scans, sign-ins, downloads, read online,
  new fans and conversion (downloads ÷ scans) for Last 7 days, This programme
  or All time. The best channel is highlighted. **Copy** copies the short link.
- **Select** a campaign to see its funnel (scans → signed in → downloaded →
  read online, with the drop at each step) and to make adverts for it.
- **New campaign:** a name (e.g. "Sponsor flyers: Zeva"), the channel, and
  optionally a short code (3-12 lowercase letters, numbers or -). Leave the
  code empty and one is made up.
- **Codes can never be changed or deleted**, because printed QR codes must
  keep working. Switch a campaign off instead; its QR codes still work.
- **Advert generator:** choose A4 poster, square social post, WhatsApp status
  or big screen; edit the headline, subline, match and kick-off (filled in from
  the next programme), or tick **Season evergreen** for a poster that works
  all season. **Download advert (PNG)**, or **Download QR only (SVG)** for a
  designer. The guide line under the controls says how big the QR code will
  print: about 3 cm is enough for flyers, 10 cm or more for posters read from
  1-2 metres; on the big screen keep it at least 40% of the screen height and
  show it for 15 seconds or more.
- **Scan test:** shows the exact link in the QR code with **Open link**.
  Before printing in bulk, print one at the real size and scan it with at
  least three different phones.
- **Copy summary for sponsors:** totals only, e.g. "1,240 scans, 610 signed
  in, 548 downloads, 96 read online, 212 new fans". No names or contacts.
- **QR: auto-download** (switch at the top of Programmes): after signing in
  from a QR code the PDF starts downloading by itself. Switch it off to show a
  Download button instead.
- Fans who scan inside Facebook, Instagram or TikTok see a note to open the
  page in Chrome or Safari; "Read online" is the safer choice there.

### Share Hub (the Share button)
Press **Share** on a programme (or **Share this programme** after publishing).
- **Share images** are made for you from the cover: a link card (what people
  see when the link is shared), a square post and a story (with a QR code and
  "Link in bio"). Change the headline or sub-line and press **Save share
  images**. If the PDF changes, new images are made automatically.
- **One card per platform** (Telegram, Facebook, X, WhatsApp, Instagram,
  TikTok, YouTube): the caption (edit it; the counter turns red if it's too
  long; on X every link counts as 23 characters), the tracked link, and
  buttons: **Copy caption**, **Open post window**, **Download image**,
  **Share from my phone**, **Mark as posted**. Instagram and TikTok captions
  can't hold links: use the bio link (e.g. lobistarsfc.com/p/instagram) or a
  Story link sticker. Each card shows visits, sign-ins, downloads and new fans
  from that platform (totals only).
- **Post automatically:** Telegram (and Facebook once set up) can post by
  themselves: tick them and press **Post now** (it shows exactly what will be
  posted and warns if it was posted already), or choose a time (**When the
  programme goes live** / **Now + 1 hour**) and **Save schedule**.
- **Refresh previews:** if Facebook shows an old picture, open the Sharing
  Debugger and press Scrape Again.
- **Edit platforms, captions and hashtags:** the club's profile links, the
  standard captions and hashtags, and which platforms show.
- Fans can share too: the **Share** button on the programme pages shares the
  same kind of tracked link (counted as "Fan share button").

### Stats
Per programme: unique readers, opens, downloads, link clicks (per link), new
fans gained, shares, views of each page (bar chart) and where fans came from.
Sponsors may be given these totals; never names or contact details.

### Fans and privacy
**Export opted-in fans (CSV)** opens the Fan Database filtered to programme
readers who agreed to club news; press Export there (only staff allowed to
download contacts; every export is logged). "Delete my data" requests from
fans arrive in the **Inbox** ("Data deletion request"): reply to confirm, then
delete the person in the Fan Database (removes them everywhere).

## 29. Website Health (Settings › Website Health)

**Only the three Super Admins** can open it (everyone else gets "not
allowed", from the page and the server). It finds problems anywhere on the
website and says in plain English what is wrong, why it matters, how to fix
it step by step and **who should fix it**. The checks only look: they never
take payments, email fans or change data, and never show passwords or keys
(only whether they are set and work).

**Open it:** the **🩺 Website Health** button at the top of the Dashboard (its
dot is green, amber or red, with the number of problems) or Settings ›
Website Health.

**What it checks (about 55 checks, 9 groups):**
- **Pages and content:** every page in the sitemap and menu opens; broken
  links and pictures; old aesonsports.com links outside Partners;
  placeholder words ("Sample", "TODO", "Lorem", "₦0", "undefined");
  titles, descriptions and share pictures; sitemap and robots.txt; out-of-date
  fixtures and missing league results; shop products without a price or buy
  link; partners without a logo; menu items without a price or photo.
- **Fan journeys:** sign-up, login, password reset, contact, newsletter,
  Predict & Win, Man of the Match and Rewards pages and forms (tested with an
  empty form, nothing saved); the anti-spam key.
- **Payments:** Paystack keys (warns if test keys are on the live site),
  Paystack answering, payment confirmations arriving (fails if Paystack had
  payments but sent the website no confirmation), unpaid food orders not
  closing, paid food orders not delivered within an hour.
- **Email:** Resend set up and the domain verified, failed emails, the SPF /
  DKIM / DMARC / reply records, fans' messages waiting over 48 hours.
- **Matchday and broadcast:** the commentary stream (played from 2 hours
  before a match), the partner's address kept private, the next home match
  ready (commentary, squad for voting, ticket sales), Predict & Win results and
  prizes, the kitchen open on matchday.
- **Background tasks and data:** the timer job, last backup, last restore
  test, the weekly copy outside Cloudflare, scheduled jobs, the database
  (speed and size), file storage.
- **Security:** the secure connection, the domain's renewal date, two-step
  login for all staff, unused accounts, disabled accounts still signed in,
  bursts of failed sign-ins, security headers, the admin needing a login, the
  three Super Admins, the old admin code, testing switches, private files.
- **Outside services:** social media links, phone-notification keys, the
  Telegram bot.
- **Speed:** key pages' answer time and weight on a phone.

**Using the page:**
- The score card says **All systems working** (green), **X things need
  attention** (amber) or **X things are broken** (red). **Run full check now**
  takes 1 to 3 minutes and shows its progress (only one check runs at a time).
- Click a group card to see only that group. Problems come first, the worst at
  the top. Each has: **Check again** (re-checks that group), **Fix it** (only
  for the safe fixes below, asks to confirm), **Copy details for developer**
  (a summary without any secret), **Mark as acknowledged** (with a note: it
  stays on the list but no repeat alerts for 24 hours) and **History** (when
  it failed and when it was fixed, over 90 days).
- **Everything that's working** is folded away underneath.
- **Download report (PDF)** opens the print window: choose "Save as PDF" to
  share it with the developer or management.
- **Send test email** sends a test email to you.

**Safe one-click fixes** (each confirmed and recorded in the Activity Log):
check unpaid food orders with Paystack and close the expired ones; start a
backup now; email the encrypted backup copy now; mark a restore as tested;
calculate the Predict & Win result; sign out disabled accounts; run the
Rewards job, the access review or a late scheduled newsletter now; rebuild
the website (when the deploy hook is set up). Everything else is
instructions only: nothing changes code, keys, DNS or deletes data.

**Automatic checks and alerts:** a full check runs **every hour** (and a
quick check of payments, matchday and background tasks every 15 minutes on
home matchdays). When something turns **broken**, the Super Admin who
receives the security emails (dkakaan@lobistarsfc.com) is emailed and it
appears in every Super Admin's bell; the same alert is not repeated for 6
hours unless it gets worse, and a short **Resolved** email follows when it is
fixed. Things that **need attention** come in one **daily summary at
08:00**. Results are kept for 90 days; the page shows the uptime over 30 days.

**If the whole website goes down** it can't email anyone itself, so set up a
free outside monitor once (HANDOVER-TODO.md A23): UptimeRobot, address
`https://lobistarsfc.com/health/ping` (it only answers "ok"), every 5 minutes,
alerting the Super Admins.

The **Uptime** box underneath is the older 5-minute check (homepage, tickets,
programme, fixtures data, database, the stream on match days) with its
outages.



### The three AI buttons on every problem

Each problem under **Needs attention** has three big buttons:

1. **Fix it for me** (green): if the website has a safe fix for this problem
   (for example "Start a backup now" or "Rebuild the website"), it runs at
   once and the check runs again to confirm. If there is no safe fix, it
   tells you so; then use 2 or 3. This button never costs anything.
2. **Teach AI to fix this next time** (blue):
   - if the website has a safe fix, press **Yes, fix it automatically from now
     on**. Whenever the problem appears again, it is fixed by itself (at most
     every 6 hours per problem) and written in the Activity Log. Press
     **Switch off** to stop it;
   - if not, Claude explains the one-time setup that stops the problem coming
     back or makes it fix itself, and **Copy the request for the developer**
     gives you a message to send if only the developer can add an automatic
     fix.
3. **Show me how to fix it myself** (grey): numbered steps written by Claude
   for this exact problem: which menu or website, which button, who should
   do it and about how long it takes.

**Fix everything I can** (top of the page) runs button 1 for every problem
that has a safe fix, after showing you the list.

**Cost:** Claude is only asked when you press 2 or 3, with the cheapest
model. The answer is saved and reused for 30 days while the problem stays
the same (it says "no new cost"); **Write again** asks for a new one. If
Claude is not connected or the monthly AI budget is used up, you get the
standard steps instead. Claude only writes instructions: it never changes
anything on the website. "Mark restore tested" is never done by AI, because
a person has to confirm a restore was really tested.

## 30. Monthly partner reports (Partners › Monthly partner reports)

Every sponsor can get a short branded report each month: website impressions
(page views; their logo is on every page), visits to their website from ours,
views of their partner page, newsletter issues that carried their advert
(sent and clicks) and Match Day Programme reach. Totals only, no fans'
personal details.
- Choose the **month** (last month is shown first).
- Type each partner's **report emails** (comma separated) and press **Save**.
- **Open report** shows exactly what they receive: **Print or save as PDF**
  to send it yourself.
- **Send** / **Send to all partners** emails the reports (once email is set
  up). Each partner gets a month's report once; sending again asks first.
- Tick **Send last month's reports automatically on the 2nd** to let the
  website send them every month by itself (needs email and the cron Worker).
Who can use it: Super Admins and Commercial staff.

## 31. Season tickets (Commerce › Season Tickets)

One ticket for every Lobi Stars home match of the season, in a stand. Off
until you switch it on.
- **Settings:** the season (e.g. 2026/27), a price for each stand (0 = that
  stand isn't sold as a season ticket) and how many season tickets each stand
  has (0 = no limit), plus an optional note for fans (e.g. "Cup matches not
  included"). Tick **Season tickets on sale** and **Save**: they appear on
  lobistarsfc.com/season-tickets and as a banner on the Tickets page.
- Fans pay with Paystack (1 to 4 at a time) and get one QR code per season
  ticket by email and on screen.
- **At the gate** the normal Ticket Scanner reads it: it lets the person in
  **once per home match**, only on the day of a home match ("Already used for
  this match" if scanned again). A pass only works in its own season.
  Ordinary match tickets only get in on the day of their own match; a ticket
  for another fixture shows "Wrong match" and still works on its own day.
- **Season tickets sold:** every pass with its holder, stand, code and how
  many matches it has been used for; find by name, email or code. **Cancel**
  stops a lost or refunded pass at the gate (**Restore** undoes it). Refunds
  themselves are done in Paystack.
Who can use it: Super Admins and Commercial staff.

## 32. Sharing pages (Share button and Matchday › Share any page)

**On the website:** most pages have a **Share** button at the top right, next
to Back (news stories have it under the headline and at the end). Fans pick
WhatsApp, Facebook, X, Telegram, Email or Copy link; on a phone it opens the
phone's own share menu. The club only counts which page was shared and where
(for example "WhatsApp"), never who. It isn't on sign-in, account, checkout or
staff pages. The MatchDay Kitchen page (/kitchen) has it too; it always shares
the plain kitchen link, never a fan's seat from a seat QR code.

**Matchday › Share any page** (Media, Matchday Operator and Super Admin):
1. Type part of a page name (for example "tickets") and pick it, or paste any
   lobistarsfc.com address, then press **Check**.
2. The **link card preview** shows what people will see on Facebook or
   WhatsApp. The checklist is green when all is well; amber or red items say
   what to fix (for example a description that is too short, or a picture
   that is too big for WhatsApp).
3. Each platform has a ready caption you can edit (the counter shows the
   limit; X allows 280). Then:
   - **Post now** (Telegram and Facebook, once set up): posts straight away
     after you confirm. At most 3 times per page per platform per hour.
   - **Open post window** (X, WhatsApp, Facebook, Telegram): opens the
     platform with the caption filled in.
   - **Share from my phone**, **Copy caption** and **Download image**.
   - Instagram and TikTok can't have links in posts: use the club's link in
     bio, or the Link sticker on a Story.
   - After posting by hand, press **Mark as posted** so it appears in
     **Club posts**.
4. **What gets shared** shows the pages fans share most (7, 30 or 90 days),
   shares per platform, and every club post (who, when, where, link).

**Bookmark "Share to club socials":** add it once (instructions on the page).
Then, on any page of the website, tap it to open that page here ready to post.

**Old picture on Facebook?** Facebook keeps its own copy of a link card. Paste
the address into the Facebook Sharing Debugger
(developers.facebook.com/tools/debug) and press **Scrape Again**.

## 33. League: fixtures, results and the table (League menu)

The official **2026/27 NNL Conference D** season is loaded: 8 clubs, 56
matches, kick-off 4:00 PM (Nigerian time). The public **Fixtures**, **Results** and
**Table** pages, the calendar feed and every Lobi Stars match page all come
from here. Matchday Operator, Media and Super Admin staff can use it.

**How fans see a match:** every match card (homepage, Fixtures, Results)
shows **Date**, **Kick-off** and **Venue** as three separate items (the
stadium name above the town and state). The next Lobi Stars match is the
large dark card with "Next match" and a live countdown in Days, Hours,
Minutes and Seconds; it turns into a red LIVE badge at kick-off and
the final score after full time. Home matches have a red edge, away matches a
black one. Times are always Nigerian time, so no time zone label is shown.

**League Dashboard** shows the next Lobi Stars match with a countdown,
**Results due** (matches that kicked off over 2 hours ago without a result,
each with **Enter result**), data warnings, the table at a glance and the
latest changes.

**Fixtures** (tabs per matchday, with the mid-season break marked):
- Change the **date**, **time** (always Nigerian time), **venue**, **public
  note** or **status** in the row and press **Save**.
- **Postpone** asks for the reason (shown on the website). The match moves to
  **Needs a new date** at the top until you **Reschedule** it; the website
  then shows "Rescheduled from …".
- **Cancel match**, **Swap home/away** (only before it is played) and
  **Live mode** are on each row. Home matches have **Create programme**, which
  opens a new Match Day Programme with the match filled in (nothing is saved
  until you press Save there).
- **Shift a whole matchday:** choose a matchday tab, enter the days to move
  and/or one time for all, press **Preview matchday change**, check the list,
  then **Apply**. Only matches still "Not played" move.
- Lobi Stars matches update their match page, tickets, commentary and alerts
  automatically.

**Results:** choose the matchday, set each match's status (**Full time**,
**Awarded**, **Abandoned** …), type both scores and press **Save matchday**.
Attendance, referee, a match report link and a note are optional. The page
then shows **What changed in the table**. It asks before you change an old
result or one that changes who won. An **Awarded** match gets the league's
awarded score (3–0) unless you type a score.

**Live mode** (a phone beside the pitch): **Kick-off**, **+1** for either
team, **Half time**, **Second half**, **Full time**. Every tap saves at once
("Saved at 16:47"); a second tap within 3 seconds is ignored. Undo buttons ask
first. If the signal drops you see a red message and **Try again**.

**Table & Rules:**
- **Explain** on any row says why the club is in that place (e.g. "Level with
  Mighty Jets FC until goal difference: +4 to +1").
- **Points adjustments:** choose the club, the points (e.g. -3) and the reason
  (shown under the public table). They can be **voided** (with a reason) but
  never deleted.
- **Tie decisions** only appear when clubs are level on every rule: enter the
  order the league decided and the reason.
- **Rules:** points for a win, draw and defeat, the tie-break order, optional
  zones (e.g. promotion places), whether live matches count, and the awarded
  score. **Preview and save rules** shows the table before and after first.
- **Check data** lists anything that looks wrong (a finished match without a
  score, a match left "Not played" long after kick-off, …).

**Clubs & Venues:** names, short names, codes, crest addresses, colours, home
grounds and other names (used by the import). Only use a club's crest with
its permission; without one the site shows its initials in the club colour.
Use a crest file with a transparent background: crests are shown exactly as
designed, without a circle or white background behind them.

**Import & Export:** download the fixtures, the table or the empty template;
upload a revised fixture list (CSV). You see every row first (new, changed,
unchanged, error) and press **Apply changes** to confirm. Matches that
already have a result are never changed unless you tick that option.

**League History:** every change (who, when, before and after). **Undo** puts
a fixture back as it was before a change, unless it has been changed again
since (undo the later change first).

**Sensitive actions** (rules, adjustments, tie decisions, the import, undo):
if the setting `league_admin_emails` is set, only those staff can do them.
Everyone can always edit fixtures and enter results.

**Match day checklist:** check the kick-off time and venue on Fixtures;
during the match use Live Match Control (or League Live mode); after full
time check the score on Results; after the last match of the matchday enter
the other Conference D results; open the public Table to check it.

## 34. Match tickets (Commerce › Match Tickets)

Fans buy tickets for one home match or several at once on **lobistarsfc.com/tickets**:
they tick the matches (or press **Select all home matches** or **Select next 3
matches**), choose a stand and how many for each, and pay **once** with Paystack.
One email arrives with every ticket (one QR code per person per match).
Away matches are never sold here: the home club sells those.

**Nothing is on sale until you switch it on.** Open **Admin › Commerce › Match
Tickets**. Each home match has:

- **Prices** in naira for VIP Sitting, Cover Stand and Popular Stand (0 = that stand is not sold).
- **Seats** per stand. Empty = no limit. When the seats run out the stand shows "Sold out";
  the website never sells more than the number you set, even if two fans pay at the same moment.
- **On sale** tick box, plus optional **Sales open** and **Sales close** times (Nigerian time).
  Before the open time the match says "Tickets not on sale yet (from <date>)".
- **Most per order** (1 to 50; raise it for groups, e.g. 30).
- **Discounts allowed** tick box (untick to leave this match out of every discount) and
  **Discounted tickets (most)** for this match (empty = no limit). See section 34a.

Press **Save** on the match. To set the same thing for many matches at once,
use **Apply to all** at the top (leave a box empty to
keep what each match already has).

**The /tickets page** (redesigned 14 Oct 2026, same buying steps): a stadium
picture with the next home match (both crests shown whole) and a live
countdown with seconds; a 3-step progress bar
(Choose matches, Choose your stand, Pay); each home match as a ticket card
with a coloured date block (red, gold, navy, maroon and black in turn) and a
round **Select** button, "Next match" / "This week" labels, a stand
switch and a − 1 + ticket counter; stand cards (VIP Sitting, Cover Stand,
Popular Stand, with the price per ticket; picking one sets that stand on every
ticked match, and each match card can still be changed on its own);
the order and checkout on the right (a slide-up sheet with a bottom bar on
phones); MatchDay Kitchen and Matchday Programme links; and short questions
and answers. Stand descriptions and two answers (gate times, passing tickets
on) still need the club's wording (HANDOVER-TODO C20).

**What fans see:** under the homepage picture, a slim **match bar** shows the
next Lobi Stars match: both clubs on one line with the venue under them,
date, kick-off, a live countdown (days, hours, minutes and seconds) and one
main button: **Buy ticket from ₦…** for a home match on sale, **Listen live** while
the match is live, otherwise **Match Centre**. "More" holds Match Centre, Add
to calendar, Share and Listen live. The Match Day Programme line sits just
below it. Further down, "Upcoming Matches" shows the two matches after that,
each saying **Buy ticket**, **Sold out**, **Tickets not on sale yet** or
**Away fixture**. A postponed match says "Postponed – date to be confirmed".
The full list is on /fixtures, and each match's full detail on its Match
Centre page.

**Lost tickets:** a fan can get them back at **lobistarsfc.com/tickets/lookup**
with their email and the order reference (from the Paystack receipt or the email).
You can also find the order in **Orders** (search by name, email, phone or
reference) and press **Resend email**.

**Refunds:** the money is returned in the Paystack dashboard (Transactions ›
the payment › Refund). Then, in **Orders**, press **Refund** on that order and
type the reason. This cancels its unused tickets (the scanner then says "DO
NOT ADMIT"), takes them out of the sales figures and is written in the audit
log (League › Audit log, "Tickets"). Already-scanned tickets stay used.

**Sales figures:** the top of the page shows tickets sold and money taken per
match and per stand. **Export CSV** gives every order (no card details;
the website never sees them).

**Season tickets** stay in Commerce › Season Tickets (section 31). The tickets
page tells fans buying several matches how much a season ticket would save them.

**Who can use it:** Super Admin and Commercial. Matchday Operators can open the
scanner only (Admin › Matchday › Ticket Scanner).

## 34a. Ticket discounts (Commerce › Ticket Discounts)

Three discounts, all **switched off** until you turn them on at
**Admin › Commerce › Ticket Discounts** (also a **Discounts** button on Match Tickets):

- **Group discount:** one order with many tickets for the SAME match. Starting
  tiers: 10 to 19 tickets 10% off, 20 or more 15% off. Add, remove or change
  tiers (each tier needs more tickets than the one before). The buyer can add a
  group name (church, school, supporters club, company); it is on the order and
  in the email. Raise **Most per order** on the match (up to 50) so groups can buy.
- **Early bird:** tickets bought at least 7 days before kick-off (change the
  days). The match card shows "Early bird: save 10%" and "Early-bird price ends
  in X days (ends Sunday 1 November)".
- **Family bundle:** the buyer picks **Family bundle** on the match card and
  chooses adults and children (starting rule: 1 or 2 adults with 1 to 4
  children under 16, 15% off the whole bundle). Child tickets say **CHILD** in
  the email, on the confirmation page and at the gate.

For each discount: name, percent, optional **Starts** / **Ends** (Nigerian
time) and **Discounted tickets per match (most)** (e.g. early bird for the
first 200 tickets only). Press **Save** on that discount.

**Settings for all discounts:**
- **Combine discounts (stacking):** off by default, so an order gets only the
  ONE discount that saves the buyer the most (the summary says which and why).
  On: discounts add up, but never more than **Most discount in total** (25%).
- **Lowest ticket price:** no ticket is ever sold below this.
- **Group/family orders per email per match** (1): stops a fan reusing a group
  or family discount by splitting orders.

**Preview calculator:** choose a match, stand, number of tickets (or a family
bundle) and optionally a purchase date, and see exactly what the website would
charge. **Report:** per discount the orders, tickets, child tickets, discount
given and revenue after discount (paid, not refunded), with **Export CSV**.
Every change is recorded in the audit log (who, when, before and after).

**What fans see:** green badges on each home match card ("Early bird: save
10%", "Groups of 10+: save up to 15%", "Family bundle: save 15%") only while a
discount is on and still applies; in the order: subtotal, "Discount: Group
(15%)", the amount saved and the total, and a nudge such as "Add 2 more tickets
to save 10%". All prices are worked out on the server when the order is made.
If a discount ends or runs out while a fan is paying, the website shows the new
total and the fan presses Pay again: nobody is charged a price they didn't see.
Paid orders keep the discount they got, even if you change the rules later.

**At the gate:** the scanner shows **VALID: ADMIT ADULT** or **VALID: ADMIT
CHILD**. For a child ticket, staff may ask for proof of age.

## 34b. Running Lobi Stars Rewards

Lobi Stars Rewards is the free fan loyalty programme. Fans collect **Star
Points** when they buy and take part on lobistarsfc.com, and swap them for
rewards. Star Points have no cash value.

**Status: built, not launched.** Fans can't see Rewards until you switch on
**Rewards is live for fans** in **Admin › Rewards**. Until then, staff can
preview it: open **lobistarsfc.com/rewards/?preview=1** once on your phone or
computer.

Everything is in the **Rewards** section of the admin menu (CRM Manager and
Super Admins for everything; Fan Support looks up members and handles
fulfilment):

| Page | What it is for |
|---|---|
| **Lobi Stars Rewards** | Settings (every number), the live switch, find a member, adjust points, put on hold, run the points job |
| **Rewards Catalogue** | The rewards fans can get, their points, stock and limits |
| **Rewards Terms** | The Terms fans accept (change them any time) |
| **Fulfilment & Vouchers** | Check vouchers and member cards at the stadium; arrange experiences and items; give points back |
| **Rewards Reports** | Charts, checks for suspicious accounts, Excel download |

### Launching

1. Confirm the numbers in **Admin › Rewards** (points per ₦100, bonuses, tiers,
   pay with points) and each reward's points and stock in **Rewards Catalogue**.
2. In **Admin › Rewards › Fan guide**, set the real example prices used in
   "Meet David" (jersey, ticket, food) and the points expiry period.
3. Make sure Resend (emails) and the live Paystack key are set up (A-list in
   HANDOVER-TODO).
4. Tell the food stand and club shop staff how to check vouchers (below).
5. Switch on **Rewards is live for fans**. Then add Rewards to the menu,
   footer and homepage (HANDOVER-TODO C26 and C27).

### On match days: vouchers and member cards

In **Admin › Rewards › Fulfilment & Vouchers › Check a voucher** (works on a
phone):
- **A voucher code** (e.g. LSR-7KQ2-9XMA, or its QR from the fan's wallet):
  check it says *Ready to use*, give the reward, press **Mark used**. A voucher
  works once, and an expired one is refused.
- **A member card** (the QR on the fan's My Rewards page) or a **member
  number** typed in (e.g. LSR-000123): you see all of that fan's vouchers ready
  to use; press **Mark used** on the one they use. The card holds no personal
  details and can't be faked.

### Every week

- **Fulfilment & Vouchers › Waiting for the club:** experiences and items fans
  have redeemed. Contact the fan, then move it to **Confirmed**, **Done** or
  **Collected**. A note you type is shown to the fan. **Refund points** gives
  the points back (a reason is required and shown to the fan).
- **Rewards Reports › Checks:** accounts worth a look (see "Fraud" below).
- **Run the points job now** (Admin › Rewards) is only needed if you want
  ticket points of a match just played to appear straight away; the job also
  runs every 10 minutes and whenever a fan opens their points.

### Helping a fan

Find them in **Admin › Rewards › Find a member** (email or member number) to see
their points history, tier and status.
- **Points missing:** ticket points are *pending* until the match is set to
  full-time. Jumia purchases never earn points. Each order or match counts once.
- **Add or remove points:** **Adjust** with a reason (shown to the fan, and
  kept in the audit log).
- **Suspected fraud:** **Suspend** (put on hold); they stop earning and can't
  redeem.
- **Lost voucher:** it is in their wallet (lobistarsfc.com/rewards/wallet) and
  in the email they got.

### How fans earn Star Points

All numbers are in **Admin › Rewards**; the fan guide (lobistarsfc.com/rewards)
shows them automatically. Fans earn only from what the website records itself.
- **Joining:** a welcome bonus once their email is confirmed, and a bonus for
  adding their state of residence and date of birth (once). Fans join with their
  normal fan account (one click on /rewards or My account, after accepting the
  Rewards Terms), or with "Also join Lobi Stars Rewards" when they register.
  Each member gets a number such as **LSR-000123**.
- **Match tickets:** points per ₦100 paid (after discounts), pending until the
  match is set to full-time.
- **Personalised shirts, in-seat food, season tickets and membership** (plus a
  membership bonus): points per ₦100 paid, straight away.
- **Coming to a home match:** when their ticket is scanned at the gate (once per
  match), plus a bonus for 3 home matches in a row.
- **Man of the Match votes, Predict & Win** (entry, then more at full-time for a
  correct result or the exact score) and **reading the Match Day Programme**:
  limited to a monthly maximum together.
- **Referrals:** each member's invite link (on My Rewards) is
  lobistarsfc.com/fans/register/?ref=<member number>. The referrer gets points
  once the friend has confirmed their email and paid for something. Referrals
  from the same phone, the same device or the same surname at the same company
  email are held back, not paid. There is a most-per-season limit.
- **Birthday month bonus** once a year (date of birth saved 30+ days before).
- **Once per fan:** newsletter sign-up with their account email, switching on
  match alerts, and their first paid purchase (taken back if refunded).
- No points for sharing on social media (it can't be checked).
- A Paystack refund or dispute removes the points of that payment
  automatically (a balance can go below zero).

### Tiers

Red, Gold and Legend, by Star Points **earned this season** (from the season
start date in Admin › Rewards). Spending never lowers a tier. Starting levels:
Gold from 1,000, Legend from 3,000.
- **Gold:** 1.25x points on purchases and a birthday gift. **Legend:** 1.5x,
  the end-of-season fans' event and the **Legend Fans wall**
  (lobistarsfc.com/rewards/legend-fans; members choose to appear, first name and
  surname initial only).
- **Paid annual members** are at least Gold for that season (a setting).
- **New season:** fans keep last season's tier for 2 months (a setting).
- Moving up shows a celebration and sends "You've reached Gold!".
- **Early ticket access is switched off** (club decision, October 2026). To
  bring it back, enter hours for Gold or Legend in Admin › Rewards; matches with
  a **Sales open** time then open early for those members, and the benefit line
  shows again automatically.
- The top tier was called "Star" until October 2026; those members are Legend.

### Rewards and redeeming

- **Rewards Catalogue:** add or edit a reward (name, description, image,
  points, type, value, stock, most per fan, minimum age e.g. 18 for alcohol
  sponsors, Gold/Legend only, partner sponsor, start and end dates), switch it
  off or archive it. Stock 0 means not available. **No airtime or data rewards**
  (club decision, October 2026).
- Fans redeem at lobistarsfc.com/rewards/catalogue and confirm ("This can't be
  undone"). Rewards of 1,000 points or more also need a 6-digit code emailed to
  them. Points are taken once, even with a double click.
  - **Vouchers:** a code valid 90 days, used once (emailed, and in their wallet
    with a QR code).
  - **Match ticket:** the fan picks a home match and gets a normal QR ticket
    (the stand's seat limit applies).
  - **Experiences and items:** go to Fulfilment with the fan's details.
- **Pay with Star Points at checkout:** on match tickets, MatchDay Kitchen and
  personalised shirts, members see "You'll earn X Star Points", can tick **Use
  my Star Points** (1 point = ₦5 off, up to 50% of the order, at least 100
  points: Admin › Rewards › Pay with Star Points) and can use a voucher that
  fits. The points are held while the fan pays with Paystack and given back if
  the payment fails, is abandoned or is refunded. No points are earned on the
  part paid with points.

### What fans see

- **lobistarsfc.com/rewards:** the full guide (how to join, every way to earn,
  tiers, how to use points, "Meet David", rules, questions, help).
- **My Rewards** (/rewards/me): balance, pending points, expiry warning, tier
  progress, next reward, member card QR, invite link with share buttons,
  badges (just for fun), messages and email choices, recent activity.
- **My Wallet** (/rewards/wallet) and **Points History** (/rewards/history).
- Their **points balance in the site header** (a red dot means new messages).
- "Earn" and "Use my Star Points" at checkout; the Club Shop says Jumia orders
  don't earn points.

**Messages:** fans get a message on My Rewards when ticket points arrive, on
their birthday bonus, on reaching a new tier, when a reward is redeemed,
confirmed, done, collected or refunded, 7 days before a voucher expires, and
30 days before (and when) their points expire. Under **Email me about** each fan
chooses which of these also come by email (all on except "Star Points
arriving"). Emails a fan asks for directly, like a voucher code, always go.

**Points expiry:** points expire after **12 months with no activity** (a
setting). Any purchase, bonus, prediction, vote, reward used or club adjustment
resets the clock. The fan is warned 30 days before; then the points go as one
"Points expired" line in their history.

### Rewards Reports and fraud

**Rewards Reports** shows members, Star Points issued / used / expired / taken
back, the points in fans' balances and roughly what they are worth in naira,
points by month, how fans earn them, members per tier and the rewards redeemed.
**Download Excel** (needs "can export fan data"; every download is logged) has
every figure, every member with tier and balance, and all the checks. The fan
database download (Fans & Inbox) also has **Rewards Member**, **Rewards Tier**
and **Star Points** columns.

**Checks** lists accounts worth a look: several accounts made on one device,
referrals held back, many points in a week (not counting club adjustments),
points taken back after refunds, many rewards in a day, and large manual
adjustments by staff. A check is not proof of cheating: look at the account
before you put it on hold or adjust points.

### Rewards Terms

The Terms (approved by the club's legal adviser) are at /rewards/terms. Change
them in **Admin › Rewards › Rewards Terms** (simple format: "## " for a heading,
"- " for a list item, a blank line between paragraphs; Preview, Save, or "Back
to the approved text"). Saving dates them today, and new members accept that
version.

## 35. Match Checklist (Matchday › Match Checklist)

Everything the club has to do for each match, in one list: **Before**,
**During** and **After** the match. A checklist is made by itself as soon as
the next Lobi Stars match is in the fixtures (and for any other match within
the next 14 days). If kick-off moves, the due times move with it.

**Who can do what**
- **Everyone with a staff login** (except gate and kitchen helpers) can see
  the checklist, add notes, upload a file to a task, download the PDF, print
  it and email it.
- When you have finished a task, set its status to **Submitted for review**
  (open *Details, notes, file and history* under the task, choose the status
  and press **Save**).
- **Only Super Admins** tick a task as **Done** (or *Not applicable*). The
  tick boxes are greyed out for everyone else. A Super Admin who unticks a
  task must give a reason; it is kept in the task's history.
- Super Admins also choose each task's owner and can close a checklist.

**Reading the list**
- The bar at the top shows how much is finished, how many tasks are overdue
  and the time to kick-off.
- Colours: **red** = overdue, **amber** = due within 24 hours, **green** =
  done, **grey** = not applicable.
- Filter by phase, status (for example *Overdue*), owner, or search by name.
- With two matches close together, each has its own tab at the top.

**Go to task**
Most tasks have a **Go to task →** button that opens the right admin page
for that match (for example *Match stats captured* opens the stats section of
Live Match Control for this match). A blue **Checklist task** bar then shows
at the top of that page with:
- **Back to checklist** (takes you back to the same task), and
- **Mark as submitted for review** (or **Mark as done** for Super Admins).

Tasks done outside the website (travel, hotel, police, kit check and so on)
have no button. A Super Admin can add a link to a shared form or document in
Templates. Pages in the content editor (Squad & Players, News) don't show the
Checklist task bar: go back to the checklist to update those tasks.

**Ticked for review by the website:** when the website can see the work is
done, it sets the task to *Submitted for review* by itself (the history says
"Automatic" and why): programme uploaded / published, line-ups saved,
matchday squad saved, stats entered, match photos added, full-time result,
match report saved in Live Match Control. A Super Admin still ticks it done.

**PDF, print and email**
- **Download PDF**: the checklist with every task's status, owner, notes and
  who ticked it. Task titles in the PDF are clickable.
- **Print view**: the same with empty tick boxes, for a clipboard on matchday.
- **Email PDF**: type one or more addresses (separated by commas) and an
  optional message; the PDF is attached.

**Daily reminder email**
From 3 days before kick-off, everyone gets **one** email a day at 08:00
(Lagos time) listing what is overdue, due today and due in the next 3 days,
with a link to each task. On match day the subject starts with *MATCH DAY*.
No email is sent on days when nothing is outstanding.

**After the match**
Three hours after kick-off (or at full time) the checklist shows *Match over:
finish the after-match tasks*. When every task is done or not applicable it
moves to the **Archive** by itself. A Super Admin can also close it early
with **Close checklist** (with a short note).

**Super Admins: Templates and Reminder settings**
- **Templates**: the master list every new checklist is copied from.
  - Add, edit, remove or move tasks up and down.
  - For each task, set when it is due (for example *2 days before
    kick-off*), its default owner, whether it is critical, and whether it
    applies to home matches, away matches or both.
  - **Task link** chooses the admin page the *Go to task* button opens, or an
    external address (must start with https://).
  - **Test link** shows the link with the next match's details.

  Changes only affect checklists made afterwards.
- **Separate home and away templates** (optional):
  - On Templates, press **+ Separate home template** (or away). It starts as a
    copy of the shared list and is used for those matches from then on; the
    shared one is used for the rest.
  - Choose which one you are editing in **Template**.
  - **Remove this template** goes back to the shared one.
- **Reminder settings**:
  - the time of the daily email;
  - how many days before and after the match to remind;
  - who gets it (everyone, or only task owners plus Super Admins);
  - extra addresses;
  - **Send a test reminder to me**.

  The page also shows a preview of today's email. If a task link stops
  working, the Super Admins get a short "broken task links" email that day,
  even when there is no reminder.

**✍ Draft with Claude (writing tasks)**
These five tasks have it:
- *Match report published*
- *Post-match press conference / interviews*
- *Injury report*
- *Social media countdown and preview posts*
- *Thank-you post for fans and sponsors*

To use it, open **Details** under the task:
1. The match details are already filled in: teams, kick-off, score, goals and
   cards from Live Match Control, and stats.
2. Type anything else Claude should use (for interviews: the real quotes and
   who said them), then press **Write the draft with Claude**.
   - If something important is missing, Claude asks a question instead of
     guessing.
3. Check the facts and change any wording in the boxes.
4. Save it:
   - **Save as Draft in News** for news texts. They are saved as a Draft and
     never published by themselves: add a photo and publish it in the content
     editor.
   - **Mark posts as used** for social posts (copy them first).
   - **Try again** with a short note gives a different version.

The task then moves to *Submitted for review* for a Super Admin to tick.

Content editors, report roles and Super Admins can use it. Emails and phone
numbers you type are removed before anything is sent.

---

## 36. AI Fix (Settings › AI Fix)

Claude (an AI) prepares fixes for the recommendations on **Admin ›
Analytics**. **Nothing on the website changes until a Super Admin presses
Apply**, and every change can be undone.

**Who can use it**
- **Super Admins**: everything (apply, edit, undo, Fix all, AI Settings, code
  proposals).
- **Head of Media and CRM Manager** (roles with all reports) can:
  - open AI Fix;
  - ask Claude to **prepare** a fix;
  - use Ask Claude;
  - see Fix history and Fix results.

  A Super Admin then checks and applies.

**On the Analytics page** each recommendation has a button:
- **🤖 Click to fix** (Super Admins) or **Prepare fix** (others) when Claude
  can prepare it;
- **Fix with my input** when it needs a few words from you;
- no button when only a person can do it (open **How to do it** for the steps).

**The three groups on AI Fix**
- **Claude can prepare these** (for example a better Google title and
  description for a page few people click). Press **Click to fix**: you see
  the old wording crossed out and the new one with new words highlighted.
  Then choose one of:
  - **Apply** (the page updates about 2 minutes later);
  - **✎ Edit** to change the wording first;
  - **Try again with a note** (for example "shorter") for a different version;
  - **Cancel**.
- **Needs a few words from you first** (a news story using a phrase people
  search for, social media posts, a newsletter sign-up line). Type the facts
  and press **Write the draft with Claude**.
  - If something is missing, Claude asks ("Claude asks: …"): add it and try
    again.
  - Texts with facts show a yellow **check the facts** note: names, numbers
    and quotes must be right before you use them.
  - A news story is saved as a **Draft** in News. Posts and sign-up lines are
    for you to **Copy**.
- **A person needs to do these** (payments, testing on a phone, Google
  settings): follow the steps. For layout problems a Super Admin can also ask
  for a **code proposal** (see below).

**Fix all**
1. The button shows how many automatic fixes there are.
2. It first shows the fixes grouped by type, with the **estimated cost**.
   Untick any you don't want.
3. Press **Send to Claude**. It costs half price, and you get an email when the
   fixes are ready (within 24 hours).
4. In **Ready to apply**, tick the ones you have checked and press **Apply
   selected** (or **Discard selected**).

**Undo** puts things back exactly as they were. If someone changed the same
thing since, it asks first.

**Fix history** (tab) lists everything AI Fix has done, with filters (what,
fix type, who, dates, search):
- every step of every fix (prepared, edited, applied, undone, verified,
  failed);
- checklist drafts and code proposals;
- every AI email.

**Fix results** (tab) shows each applied fix's figure (for example the Google
click rate of that page) when it was applied and again after 14 and 30 days.
Each is marked **better**, **worse** or **no change**.

Each day the website also checks applied fixes:
- **verified** when Analytics no longer flags the problem;
- **failed** if the change never showed on the website, or the problem is
  still there after 30 days.

**Code proposals** (Super Admins, layout problems only)
- Claude proposes a small change to one page's code.
- It is saved on a **separate GitHub branch**, marked *AI proposal, not live*,
  for a developer to review. It never changes the website by itself.
- Use **Download** or **Email to a developer**.

**Ask Claude** (at the bottom): questions about the website figures. It only
sees totals, never fans' details, and can't change anything. Claude can make
mistakes, so check important answers against Analytics.

**AI Settings** (Super Admins)
- **This month**: what the AI has cost so far against the monthly budget
  (default $10), and the cost of each feature.
- **Test connection** checks Claude answers (costs a tiny fraction of a cent).
- **Monthly budget** and **Email the Super Admins at (%)**: you get one warning
  email. At 100%, AI work stops until next month and a red bar shows on every
  admin page, unless you raise the budget.
- **Apply low-risk fixes automatically**: only fixes that change nothing that
  is already there and contain no facts (today: re-running the Google sync).
  Page changes and texts always wait for you.
- **Weekly scan** (day and time, Lagos): once a week Claude prepares up to 20
  automatic fixes at half price, and you get a summary email with the spend.
- **Model**: keep **Cheap** (the lowest cost). The advanced model can only be
  chosen for long writing (news drafts, checklist drafts) and code proposals.
- **Prices**: enter the prices from anthropic.com/pricing so the spend shown is
  exact. Until then it is estimated on the high side.

## 37. Score verification for all conference games (League › Score Sources)

The website is getting a system that collects scores for **every** NNL
Conference D match (not only Lobi Stars) from several approved sources. A
result is only accepted when **two independent sources agree**, or when staff
mark an official or verified result. The table is always worked out from
accepted results.

Only the **Website & Data Officer** (Matchday Admin role) and the **Super
Admins** can use it.

**Score Sources** (League › Score Sources) lists where results can come from.
Each source has **Use this source** (on/off), a **priority** and a
description:
- **Official NNL**: results you take from official NNL announcements.
  Always wins.
- **Live Match Control**: our own matches, from what you enter on matchday.
- **Staff entry**: scores typed in by the Data Officer or a Super Admin.
- **Commentary Assist**: scores sent by the commentary partner (when that link
  is set up).
- **Club network**: other clubs' media officers, through their own secure
  link or PIN, or the scores email address.
- **Licensed data API**: a paid football data service. Off until the club
  buys one and adds its key; **Coverage test** checks it has our fixtures.
- **Other licensed source**: off. For a website or feed the club gets
  **written permission** or a licence to use.

**The legal rule:** the website never reads Soccerway, Sofascore, Flashscore
or similar websites by itself, because their terms don't allow it. You may
look at them yourself.
- A source like that can only be switched on after a **Super Admin** ticks
  **Licence / written permission confirmed** and writes down who gave it,
  when, and the reference.

**How sources count:**
- Two different sources count as two; so do two different approved club
  officers.
- The same staff member or club officer reporting twice counts once (their
  latest report is used).
- The licensed API counts once, however often it is checked.

**Every report is kept.** Nothing is overwritten, so you can always see who
reported what, and when.

**Unmatched team names** (League › Unmatched Team Names):
- Sources often spell team names differently ("Bida Lions", "Mighty Jets
  Feeder / Bida Lions").
- The website ignores capital letters, "FC" and punctuation, and knows each
  team's other names.
- A name it doesn't know appears on this list: choose the right team and
  press **Link**. The name is saved as one of that team's names and
  recognised automatically from then on.
- **Dismiss** removes a name that is just wrong.

### Updating other games' scores (Matchday › Other Games)

Open **Matchday › Other Games** on your phone on matchday. Every match of the
round is a card (choose another round at the top). Each card shows:
- both crests, the kick-off time and the ground;
- the **confirmed score**, or "Not confirmed";
- a light: 🟢 two sources agree, 🟡 only one source so far, 🔴 sources
  disagree;
- **Reports received**: every report, from whom and when. Faded lines are
  older reports from the same source (only the latest one counts).

To send your own report:
1. Use **−** and **+** to set the score.
2. Press the status: **Kick-off**, **Half-time**, **Full-time**,
   **Postponed** or **Abandoned**.
3. Type the minute if you know it (optional).
4. Press **Save my report**.

Your report is **one** source. It doesn't change the table by itself: a second
independent source has to agree (a club officer, the licensed API, or the
commentary partner). The page refreshes itself every minute.

### Entering official results and points deductions

**Mark as official result** (open it under the card): use it when the NNL
publishes the result.
- Enter the score, choose the status (Full time, Awarded, Postponed,
  Abandoned or Cancelled) and write **where it comes from**, e.g. "NNL
  website result, 21 Oct". The note is required.
- An official result always wins over every other source.

**Set verified result (overrides all sources)**: use it when sources disagree
and you have checked the real result yourself (for example with both clubs).
A reason is required.

Both are recorded with your name, time and note in **League History**. If you
made a mistake, press **Withdraw** on the result and give the reason; the card
goes back to what the sources say.

**Points deductions or awards** (Matchday › Points Adjustments, which opens
League › Table & Rules):
1. Choose the club and the points (e.g. **-3** for a deduction).
2. Write the reason. It is shown as a footnote under the public table.
3. Add the **official reference** if there is one (NNL letter number, date or
   link). It is shown next to the reason.
4. Press **Add**. Adjustments are never deleted; **Void** one (with a reason)
   if it is overturned.

### Adding club network submitters (Matchday › Club Network Submitters)

Submitters are trusted people at other conference clubs (usually the media
officer) who send us the score from their ground.
1. Fill in their name and club (phone, email and a note are optional) and
   press **Add and create link**.
2. A yellow box shows their **private link** and an **8-digit PIN**. They are
   shown **only once**. Press **Send on WhatsApp** (or **Copy message**) and
   send them straight away.
3. They open the link on their phone, choose the match, set the score and
   status and press **Send score**. If the link doesn't open, they can go to
   lobistarsfc.com/scores/submit/ and type the PIN.

Each submitter counts as **one** source, however many times they send. The
list shows how many reports each one sent and their **accuracy** (how often
their full-time score matched the final result).
- **New link and PIN**: if they lose theirs or it was shared. The old ones
  stop working at once.
- **Remove**: when they leave the club. Their past reports stay in the
  history.

The form is protected: wrong links or PINs are blocked after a few tries, and
there is a human check before sending.

### Score messages: emails and WhatsApp (Matchday › Score Messages)

Club officers and the commentary partner can also send scores as a message:
- **By email** to **scores@lobistarsfc.com** (once the club has switched that
  address on; see HANDOVER-TODO A32).
- **By WhatsApp** to you. Copy the message, open **Matchday › Score
  Messages**, choose **who sent it**, paste it and press **Read this
  message**.

The website reads the score itself for the usual ways of writing it, for
example "FT: Kada Warriors 2-1 Wikki Tourists", "HT ABS 0:0 Sokoto" or "Wikki
v ABS postponed". Several matches in one message are fine. Only if it can't
read a message does it ask Claude (AI), and Claude only reads; it never
decides. The original message is always kept.

A report counts straight away only when the sender is approved (a club
network submitter, the commentary partner or staff) **and** the website is
sure (both teams recognised and a status written: FT, HT, a minute,
postponed…). Everything else goes to **Waiting for you**, and you get a bell
notification and an email:
- **Approve**: check the match in the list (choose it if the names weren't
  recognised) and press **Approve**. The report then counts as one source.
- **Reject**: give the reason (e.g. "old score", "wrong match").
- A message with no score in it can be marked **Mark as dealt with**.

### How a result is accepted (the two-source rule)

For every match the website looks at the **latest** report from each
independent source and decides:
- **Confirmed**: two or more sources agree. The result goes into the table.
- **Unconfirmed**: only one source so far. It is **not** in the table and not
  shown on the website (unless you switch on **Show unconfirmed scores** in
  Score Sources › Settings; even then it doesn't count in the table).
- **Official** or **Verified**: you entered it (see above). It always wins.
- **Sources disagree**: see "Resolving score conflicts" below.

This applies to **Lobi Stars' own matches too**. Live Match Control counts as
one source. A second one is needed: the commentary partner, a club officer, or
you entering the score in **Other Games** (that counts as a second source).
Or use **Set verified result**.

A full-time or awarded result typed in **League › Results** still goes into
the table straight away: it is saved as a verified result "Entered in League
› Results".

During play, a source that hasn't updated yet is not a disagreement. For
example, two sources say 1-0 and a third still says 0-0 from earlier: the
score is confirmed at 1-0.

Every decision is written in plain English in **League History** (who, what,
which sources).

**Reminders:** if a match kicked off more than 115 minutes ago and has no
confirmed full-time result, you get a bell notification and an email. The
time can be changed in **Score Sources › Settings**.

### Resolving score conflicts

When sources give different scores, the website first waits **3 minutes**
(the grace window; one source is often a little behind). If they still
disagree:
- the match card in **Other Games** turns red with **Sources disagree:
  choose the right score**;
- you and the Super Admins get a bell notification and an email with a link
  straight to the match;
- the match is left out of the table until it is resolved.

On the card you see each source's latest score side by side. Then:
1. **Accept this score** next to the right one. It becomes the verified
   result (the reason is filled in for you).
2. Or **Enter correct score** if none of them is right: type the score and the
   reason (e.g. "Confirmed with both club media officers").
3. **Open match** opens the fixture in the League pages.

A score you accept **during play** holds until newer reports arrive; then it
counts as one more source. A **final** result you accept stays until you
withdraw it or an official result replaces it.

**Official corrections:** if the NNL later publishes a different result, use
**Mark as official result**. It replaces whatever was there, the table is
worked out again, and the Super Admins are told.

**Settings** (League › Score Sources, at the bottom): grace window, reminder
time, show unconfirmed scores, how often the licensed API is checked, and the
matchday summary email.

### The league table (public /table, homepage, Matchday Live)

The table is always worked out by the website: nobody types it in. It uses
only **confirmed, verified or official** results, the points adjustments and
the rules in **League › Table & Rules** (points for a win/draw/loss and the
tie-breaker order; the official NNL tie-breaker order still has to be checked
and entered there).
- **Postponed** and **cancelled** matches don't count. An **abandoned** match
  doesn't count until the NNL decides: enter that as an official result
  (**Awarded** with the awarded score, or the replay later).
- **Live table:** if "count live matches" is on in Table & Rules, confirmed
  scores of matches in play count as they stand. The table then says **Live
  table**, and the arrows show places gained or lost since kick-off.
- Above the table, a **mini scoreboard** shows the round being played.
- The **homepage** and **Matchday Live** show a small version of the same
  table.
- **Saved tables:** when every match of a round is over and confirmed, the
  table after that round is saved (Other Games › Saved tables, at the bottom).
  If a result changes later, a new version is saved with the reason.

### Automatic sources (licensed data API)

If the club buys a football data service (API-Football or Sportmonks), the
website can check it automatically: **every 2 minutes on matchdays** and
**every 6 hours** on other days (both adjustable in Settings). It counts as
**one** source, however often it is checked, so a second source must still
agree.

To switch it on (Super Admin):
1. Add the key and the provider's competition number in Cloudflare (see
   HANDOVER-TODO A32).
2. In **League › Score Sources › Licensed data API**, tick **Licence / written
   permission confirmed** and write the plan or contract reference.
3. Tick **Use this source** and **Save**, then press **Coverage test**: it
   shows how many of today's conference matches the service has and which
   team names it doesn't recognise (link those in Unmatched Team Names).

Each automatic source shows a **status**: 🟢 working, 🔴 not working (with
the error), 🟡 waiting for the first check, ⚪ off; plus when it was last
checked and last worked.

The website will **never** read Soccerway, Sofascore, Flashscore or similar
websites by itself. The "Other licensed source" can only be used for a feed
the club has **written permission** or a licence for, and only over a secure
(https) address.

### Matchday summary email and health checks

**Matchday summary:** on each matchday, once every conference match has a
confirmed final result (or at the latest 4 hours after the last kick-off),
the Data Officer and the Super Admins get one email: every result, how many
sources confirmed it, anything still open, and the top of the table with
Lobi Stars' position. It can be switched off in Score Sources › Settings.

**Website Health** (Settings › Website Health, Matchday section) now also
checks that:
- the every-minute score check is running;
- automatic score sources are working;
- no score conflict has been open for over 30 minutes and no report has
  waited for review for over 2 hours.

## 38. Squad & Staff Data Portal

The private portal where the media team collects every player's and staff
member's details and photos. Since 23 Oct 2026 it is the **only** source of the
Squad pages: nothing reaches the website until the club approves it. Approved
(live) profiles appear on the Squad page (public details only) and go to the
club's media partner in the Data Package.

**Statuses**

| Status | Meaning |
| --- | --- |
| Draft | Being filled in; not sent yet. |
| Awaiting approval | Sent to the club; can only be viewed until it is approved or sent back. |
| Live | On the website (the approved version). |
| Changes requested | Sent back with a note; can be edited and sent again. |
| On loan / Former / Deleted | Out on loan, left the club, or removed (these steps come with the next update). |

**Live profiles keep their live version.** A live profile can still be edited
in the portal (or by a Super Admin). The website keeps showing the approved
version, answers **and photo**, until the change is sent and approved. The
status then reads e.g. "Live · edit not sent yet" or "Live · edit awaiting
approval". Every approved version is kept (see "Versions" below).

**Web address:** fixed when a profile is first approved (e.g.
/squad/musa-adeyemi/). It changes only if the name changes; the old address
then forwards to the new one. A second person with the same name gets -2, and
an address that belonged to someone else (even a former player) is never reused.

**The link:** https://lobistarsfc.com/staff/squad-data

- It is **not linked anywhere** on the website and search engines are told to
  stay away. Send it only to the people who fill in profiles.
- To copy it: **Settings › Squad & Staff Data Portal › Copy link** (only the
  three Super Admins see this page).
- The portal has **its own login**: one shared username and password, plus
  "Your name", which is recorded with everything that person does. Portal
  users cannot open the admin, and admin logins do not open the portal.

### Settings (Super Admins: Settings › Squad & Staff Data Portal)

| Setting | What it does |
| --- | --- |
| Copy link | Copies the portal address. |
| Portal open | Off = the sign-in page says the portal is closed and everyone is signed out. |
| Username | The shared username (default `lobi-squad`). |
| Generate new password | Makes a new password and shows it **once** (Copy it straight away). Everyone using the portal is signed out. Send it by WhatsApp or say it in person; never email it. |
| Current season | The season new profiles belong to, e.g. 2026/27. |
| Keeping private details | How long after someone leaves their private details are erased (default 2 seasons). |
| Signed in now | Who is in the portal and on which device; **Sign out** one or **Sign out all**. |
| Devices | Every phone or computer used. A new one also shows on the bell. |

**Changing the username:** type the new one under **Login › Username** and
press **Save username**. Tell the media team the new username.

**Changing the password**, either way signs out everyone using the portal:
- **Generate new password:** the website makes a strong one. Press **Copy
  password** straight away (it is shown only once).
- **Or choose your own password:** type it twice (at least 12 characters,
  letters and numbers, not containing the username; tick **Show the
  password** to check it) and press **Save this password**.

Give the new password to the media team on WhatsApp or in person.

**Forgotten password:** on the portal sign-in page the person presses
**Forgot the password?**, fills in their name and WhatsApp number or email,
and presses **Ask for a new password**. They see **"Contact your admin for
your new password."**
- A new password is made straight away and **emailed only to the three Super
  Admins** (subject "Squad Data Portal: new password …"). It works from then
  on; people already signed in stay signed in.
- The bell shows "… needs the new password", and a yellow box at the top of
  this settings page shows who asked and their number. Give them the password
  on WhatsApp or in person, then press **Done**.
- If the email could not be sent, the password is **not** changed; the box
  says so, and you press **Generate new password** (or choose one) instead.
- If you don't know the person who asked, choose a new password so only your
  team has it.

Five wrong passwords lock the sign-in for 15 minutes; after three, a human
check appears. Portal sessions end after 60 minutes without activity (with a
2-minute warning) and after 12 hours in any case.

### Printable forms (paper first, then the portal)

On the portal home page, **Printable forms** has two downloads: **Players
data form (PDF)** and **Staff data form (PDF)**. Print one, give it to the player or
staff member to fill in by hand, and collect it with the documents it lists
(passport or ID copy, a photo, evidence of any international career, coaching
licences, and for under-18s the parent or guardian's signature). Then type the
answers into the portal in one sitting. The forms are made fresh each time
from the portal's questions, so they always match the online form (a changed
or removed question changes the paper form too). The forms have a "For club
use" box for who received and who entered them.

### Filling in a profile (portal users)

1. Open the link, sign in with the username, password and your own name.
2. Press **ADD A PLAYER** or **ADD A COACH / STAFF MEMBER**.
3. Answer the questions. Every answer **saves by itself** ("All changes
   saved"). If the network goes, answers are kept on the phone and sent when
   it returns ("Offline · saved on this device"). Do not clear the browser
   until the pill says "All changes saved".
4. **Names:** **Surname** (as it appears on official documents), **First
   name** and (if any) **Middle name**. Capitals are tidied automatically
   ("ADEYEMI" becomes "Adeyemi"). The website shows "First name Surname"
   (e.g. "Musa Adeyemi"); the **middle name is private** and never shown.
5. The form no longer shows which answers are public. For the club: phone,
   email, emergency and guardian contacts and the middle name are never
   published; the date of birth only from age 18 (under-18s: age only); career
   highlight and coaching philosophy go to the media partner only.
   **International career and national team** are shown only after a Super
   Admin has checked the evidence: under the international career the portal
   has an **Evidence** box (a link or description) and **Upload a photo or
   PDF** (e.g. a call-up letter or federation squad list, up to 5 MB).
   The "interesting fact" question reads "…about the player", "…about the
   coach" (coaching roles) or "…about the staff member" (other club staff).
   Name pronunciation and "Football role model" are no longer asked.
6. Countries (nationality, second nationality, national team, place of birth,
   previous clubs) are chosen from a list. Positions: choose **Goalkeeper,
   Defender, Midfielder or Forward**, then the specific position if known.
   Height in centimetres (140 to 220). Social media: Instagram, X and TikTok
   handles (a pasted link is turned into the handle).
7. **Photo:** take or choose one, face and shoulders, plain background. The
   portal crops it, removes location data and names it after the person
   (e.g. `09-musa-adeyemi.webp`). Read any quality warnings.
8. Under-18s: the guardian section appears by itself and must be completed.
9. Press **Submit for approval**. Anything missing is highlighted. The
   portal says "Submitted for approval. It will appear on the website once
   approved by the club." Until then the profile can only be viewed.
10. Live profile: change what is needed (it saves as a change, not on the
   website yet), then press **Submit for approval** again to send the change.

Only drafts can be deleted from the portal.

### Approving (only the three Super Admins: Matchday › Squad: Approvals)

Nothing from the portal reaches the website before a Super Admin approves it.
The menu item **Squad: Approvals** shows a red count, the bell says "N squad
profiles or changes waiting for your approval", and the Super Admins get an
email digest at most every 30 minutes while something new is waiting (requests
to remove someone are emailed at once), plus a reminder for anything waiting
more than 48 hours.

Each line shows the kind of request (New profile, Edit, and later Left the
club, Loan, Delete, Restore, New role), the person, who sent it and how long it
has waited. **Open** shows:
- **New profile:** a preview of the page exactly as it will look on the website.
- **Edit:** a table of what changes, before (on the website now) and after,
  with the changed answers highlighted (private answers are marked "private,
  never shown"), and the old and new photos side by side.

Buttons:
| Button | Result |
| --- | --- |
| Approve & publish / Approve changes | Live on the website within about 10 seconds (no rebuild needed). |
| Request changes | Write a note; the profile goes back to the portal with the note at the top. |
| Reject (requests) | Write why; the request is closed and the portal shows the note. |
| Approve selected new profiles | Tick several new profiles, then approve them together (you confirm first). |

Every decision is in the Activity Log in plain English, e.g. "Marvin (Super
Admin) approved Grace's change to Musa Adeyemi: shirt number 19 → 9, 22 Oct
2026, 12:40."

**How the Squad pages update:** /squad and every profile page are filled from
the approved profiles each time someone opens them (kept for 10 seconds), so an
approval shows straight away; the built pages are only a backup. The sitemap
lists the live profiles too.

### Roles (only the three Super Admins: Matchday › Squad: Roles)

"Position at the club" in the portal is a list in two groups:
- **Coaching staff** (shown on the website's Squad page, in the order set here):
  Head Coach, Assistant Coach, Goalkeeper Coach, Fitness Coach, Technical
  Adviser, Performance Analyst.
- **Club staff** (club records only, no public page): Team Manager, Team Doctor,
  Physiotherapist, Kit Manager, Media Officer, Welfare Officer, Team Secretary,
  Driver.

("Goalkeeper Trainer" became "Goalkeeper Coach"; existing profiles were moved.)

**Other:** the portal asks "Enter the role" (up to 40 letters) and "Is this a
coaching role?". When the profile is sent for approval, the role is tidied
(capital first letters, single spaces) and compared with the list ignoring
capitals, hyphens and punctuation: if it already exists, that role is used. A
new one appears in **Squad: Approvals** as a "New role" request; once approved,
everyone can pick it.

On the Roles page: ↑ ↓ to change the order, **Rename** (everyone with the role
follows), **Move to club staff / coaching staff** (people move on or off the
Squad page at once), **Switch off** (no longer offered; people keep it) and
**Merge into…** (everyone moves to the other role and this one is removed).

### Reviewing (Website & Data Officer and Super Admins: Matchday › Squad: Profile Submissions)

The Website & Data Officer sees every profile here (and the bell shows what is
waiting for a Super Admin) but cannot approve; the approve buttons are for the
Super Admins only.

The bell shows "N squad profiles waiting for review", and reviewers get an
email when one is submitted.

| Button | Result |
| --- | --- |
| Approve & publish / Approve changes | The new profile or the change goes live (a new live version); /squad updates within a few minutes (public details only; full date of birth only from 18; never the middle name). |
| Request changes | Write a note; the portal shows it and the profile can be edited again. A live profile stays live meanwhile. |
| Discard the changes | Throws away a change that is not approved; the live version stays. |
| Left the club | Off the website and the partner feed straight away (status Former). Kept in "all seasons" downloads. Private details are erased after the retention period. |
| Restore | Undoes "Left the club". |
| Remove (Super Admins) | Deletes the profile. |
| Carry over | At the start of a new season, copies last season's live profiles into the new season. They stay live (same web address); the portal asks for the season's confirmations again as a change to send. |

Filters: Awaiting approval, All current, Live, Changes requested, Drafts, On
loan, Former, Migrated – please review, Players, Staff.

**Versions (Super Admins):** open a profile to see every live version (who sent
it, who approved it, when). **Restore this version** makes an earlier version
the one waiting for approval; the website keeps the live one until it is
approved.

**Old squad files (Super Admins, once):** the box "Old squad files" lists people
still kept as hand-made files in the website (at the start: "Sample Forward",
"Sample Defender", "Sample Goalkeeper" and a "Head Coach" file, all
placeholders). Tick real people to move them into the portal (they go live,
marked "Migrated – please review": check and complete them, add a photo). Press
**Move and switch off the old files**: anything not moved disappears from the
website, and from then on the Squad page shows portal profiles only.

**Full club records** (with private details, Excel or PDF): Super Admins
only, after entering their sign-in code. Every download is logged.

### Name check, editing and bios (Super Admins, on the same page)

**Please check name order.** Profiles saved before the change had one "Full
legal name" and a "Display name". Their Surname, First name and Middle name
were filled in automatically: the Nigerian order "Surname First Middle" is used
only where the old full name clearly used it (e.g. "ADEYEMI, Musa Ibrahim",
"ADEYEMI Musa", or starting with the display name's surname); otherwise the old
display name is read as "First name Surname". Each such profile is marked
**Please check name order** here, in the portal and in a yellow box at the top
of this page, which shows the old answers and how the names were filled in.
Check against the passport or ID, correct if needed, press **Confirm**.
**Download this list (CSV)** gives the same list as a spreadsheet. The old
answers are kept (shown under "Old answers" on the profile).

**Name corrections on live profiles** go through review like any other
change: the club presses **Request changes**, the portal corrects the name,
and the profile is verified again (or a Super Admin corrects it in **Edit**).
If the web address changes (e.g. /squad/chidi-okon/ to
/squad/chidiebere-okon/), the old address **redirects** to the new one, and
news tags and match stats still count for the player.

**Edit** (open a profile › **Edit**). For any profile, in any status:
- names, **Name on website** (only for someone publicly known by a different
  name, e.g. a nickname; leave empty otherwise), shirt number, position, preferred foot, role,
  date of birth, countries, place of birth, height, joined, licence, social
  handles, interesting fact;
- the club-only details: **Lobi Stars debut** (empty = "Yet to debut"),
  **Bio headline** and **Bio** (paragraphs separated by an empty line; a line
  starting with "## " is a small heading), **Shirt shop link** (shows "Buy
  [Surname]'s shirt"), **Hide from the website** (takes them off the Squad
  pages without deleting anything);
- **International career checked (evidence seen)**: tick only after looking
  at the evidence (the box "International career" on the profile shows the
  file and note). Until then the international career and national team are
  hidden from the website, the partner feed and the Data Package. If the
  player changes them in the portal, the tick is removed automatically.
- photos: **Profile photo** (cards, 4:5), **Wide header photo** (16:9, the top
  of the profile page; at least 1600 px wide looks best) and **Action photo**.
Press **Save changes**. A shirt number given to two players this season shows
a warning (it is saved; fix one of them). A change to a live profile waits for
approval: press **Approve changes** (the website updates in about 2 minutes). Previous clubs, international career and
honours are changed in the portal (press **Request changes**).

**Draft bio with Claude.** In Edit, press **Draft bio with Claude**, add any
**Extra details** the record does not have (how they joined, a favourite
moment; no phone numbers or private details) and press **Draft now**. Claude
uses only the public facts in the profile, never invents achievements,
statistics or quotes, and lists what extra details would improve a short bio.
Read the preview (it says **check every fact**), press **Use this draft** to
put it in the Bio boxes, correct anything, then press **Save changes**.
Nothing is saved or published until you do. It counts towards the monthly AI
budget (Settings › AI Settings, "Squad bios").

### What admins fill in for each player

| What | Where | Who |
| --- | --- | --- |
| Surname, first name, middle name, date of birth, nationality, place of birth, position, height, previous clubs, international career, interesting fact, photo | Portal form | Media team |
| Shirt number | Portal form; correct in Edit | Media team / Super Admin |
| Name check (old profiles only) | Name check box | Super Admin |
| Lobi Stars debut date, bio (or Draft bio with Claude), shirt shop link, wide header photo | Edit | Super Admin |
| Minutes, goals, assists, cards per match | Live Match Control › Player stats | Website & Data Officer |

### The public Squad pages

- **/squad** "First Team Squad" with the season: Goalkeepers, Defenders,
  Midfielders, Forwards (by shirt number) and Coaching Staff (Head Coach
  first). Each card: photo on club red, big shirt number, first name small
  above the surname, position. 4 cards a row on computers, 3 on tablets, 2 on
  phones.
- **Player page** /squad/firstname-surname/ (a number is added if two people
  share a name): wide header or photo, big shirt number, quick facts
  (nationality with flag, position, age), "Buy [Surname]'s shirt" (if a link
  is set; otherwise, when shirt personalisation is switched on in the shop,
  it opens the personalisation with the SURNAME in capitals and the shirt
  number filled in), bio, interesting fact, details (official name "SURNAME,
  First name", nickname, nationality, national team, place of birth, state of
  origin, hometown, position and other positions, date of birth
  "24 April, 2007 (age 19)" for 18+, height "1.78m (5ft 10in)", debut,
  joined), tabs: **2026/27** (appearances, starts, goals, assists, clean
  sheets for goalkeepers, minutes, cards, Man of the Match, worked out from
  Live Match Control), **Before Lobi Stars** (previous clubs) and
  **International career** (hidden if empty), social links, other players,
  Share.
- **Coach page** /squad/staff/firstname-surname/: the same, with the role
  instead of position, no shirt number, Career (previous clubs and roles, and
  their playing career) and Honours tabs and "An
  interesting fact about the coach".
- Ages are worked out from the date of birth (Lagos time) every time the page
  opens. Each page has its own title, description (from the bio), share image
  (photo with name and number) and search-engine details, and is in the
  sitemap.

### Exporting the data (Super Admins only)

Only the three **Super Admins** can export player, coach and staff data:
**Matchday › Squad: Profile Submissions › Export data**. The portal and the
Website & Data Officer cannot export or download it.

1. Choose **By email** (the default) or **Download to this computer**.
2. Choose which profiles (verified / submitted / players / staff) and the season.
3. Press **PDF**, **Word**, **Excel**, **CSV**, **JSON** or **Media Partner
   Data Package (ZIP)** (or **Full records** for private details).
4. By email, the file is sent to **dkakaan@lobistarsfc.com** and to any other
   admins ticked in **Settings › Squad & Staff Data Portal › Who receives
   squad data exports** (only admin accounts can be added). Files over about
   22 MB cannot be emailed; choose fewer profiles or download instead.

Every file is checked before it is sent, and every export (who, what, to
whom) is in the export log and the Activity Log. Except the full records,
exports never contain private details.

### If something goes wrong

- **"Not saved yet · kept on this device"**: stay on the page with a
  connection; it sends by itself. Website Health (Squad portal answers reach
  the club) lists answers that were refused or kept waiting.
- **Locked sign-in**: wait 15 minutes, or a Super Admin generates a new
  password. If it happens often, Website Health warns ("No repeated wrong
  portal passwords").
- **No photo on the Squad page**: Website Health ("Squad photos are all
  there") names the profile; add the photo again in the portal.

Photos and profiles are in the nightly encrypted backup (photos are copied
weekly on Sundays). The portal password and sessions are never backed up.
Name recordings were removed on 22 Oct 2026; old recordings stay in storage
but are not used anywhere.

## 39. Data Package format

The Data Package is what the media partner's systems read. Its format is
fixed: **schemaVersion "1.2"** (since 23 Oct 2026; 1.0 had the name
pronunciation and recordings, which were removed; 1.1 had the middle name for
over-18s). Do not rename files inside
the ZIP.

**The ZIP contains:**

| File | What |
| --- | --- |
| `data.json` | Everything below, in one file. |
| `players.csv`, `staff.csv` | The same in spreadsheet form (UTF-8). |
| `career.csv`, `international.csv`, `honours.csv` | Previous clubs, international career, honours. |
| `photos/<name>.jpg` and `.webp` | 1200 px photos, e.g. `photos/09-musa-adeyemi.jpg`, `photos/09-musa-adeyemi-action.jpg`, `photos/09-musa-adeyemi-hero.jpg`, `photos/staff-headcoach-name.jpg`. |
| `team/lobi-stars-crest.png` | The club crest. |
| `schema.json` | The formal description (JSON Schema) of data.json. |
| `README.txt` | What is inside, when and by whom it was made. |

**data.json, top level:** `schemaVersion` ("1.2"), `exportedAt` (Lagos time,
e.g. 2026-10-22T11:42:00+01:00), `source` ("lobistarsfc.com"), `season`,
`filters`, `team`, `players`, `staff`.

- **team:** `id`, `name`, `shortName`, `nickname`, `crest`, `kitColours`
  (`home`, `away`), `stadium`, `city`, `state`, `competition`.
- **Everyone (players and staff):** `id`, `status` (verified, submitted,
  left_the_club), `updatedAt`, `displayName` ("First name Surname"),
  `surname`, `firstName`, `officialName` ("SURNAME, First name"), `shortName`
  (surname), `nickname`, `pronunciation` and `pronunciationAudio` (always
  null: kept for systems that expect them), `dateOfBirth` (empty for
  under-18s), `age`, `nationality`, `secondNationality` (each `code`, ISO
  e.g. "NG", and `name`), `placeOfBirth` (`town`, `country`),
  `stateOfOrigin`, `hometown`, `social` (`instagram`, `x`, `tiktok`),
  `joinedClub`, `honours` (`title`, `seasonOrYear`, `clubOrTeam`), `bio`
  (`headline`, `text`).
- **players** (by position group, position, then shirt number), also:
  `shirtNumber`, `positionGroup` (Goalkeeper, Defender, Midfielder, Forward),
  `primaryPosition`, `secondaryPositions`, `preferredFoot`, `heightCm`,
  `debut`, `nationalTeam`, `previousClubs` (`club`, `country`, `startYear`,
  `endYear`), `internationalCareer` (`level`, `caps`, `goals`,
  `tournaments`), `notes` (`careerHighlight`, `interestingFact`), `photos` (`profile`, `action`, `hero`).
- **staff** (by role), also: `role`, `licence`, `playingCareer`,
  `previousRoles` (`club`, `position`, `period`), `notes` (`philosophy`,
  `careerHighlight`, `interestingFact`), `photos` (`profile`, `hero`).

Never included: middle name, phone, email, emergency contact, guardian
details, and for under-18s the date of birth. There is no audio/ folder.

**Partner feed (for the partner's developers):** `GET
https://lobistarsfc.com/api/partner/squad` with the header
`Authorization: Bearer <key>` (or `X-API-Key: <key>`). It returns the same
data.json (verified profiles of the current season). Photo entries are links
that work for 24 hours. Add `?since=2026-10-22T00:00:00Z` to get only
profiles changed after that time. The key is the LOBI_PARTNER_API_KEY secret
in Cloudflare; a new key stops the old one working.

## 40. Using the SEO Scanner (Settings › SEO Scanner)

**Who:** only the three Super Admins (the menu item, the pages and every action
are refused for everyone else). Other staff hear about SEO work from a Super
Admin; the Media Officer gets drafts and link suggestions to add themselves.

**What it does:** checks how the website does on Google and what to fix. It
uses only Google's own tools (Search Console and PageSpeed Insights), our own
checker reading our own pages (politely: 2 pages a second, following
robots.txt) and, only if you switch it on, a paid licensed rank tracker. It
never copies Google search results.

**When it runs**
- A full scan every night at **03:00** Nigeria time (Search Console figures
  daily; speed once a week).
- A quick scan of any **new or changed page** within about 10 minutes of it
  appearing on the site (e.g. a news story).
- A page is checked again about 4 minutes after a fix (once the site has rebuilt).
- **Scan now** (whole site) and **Check again** (one page) at any time. A full
  scan takes a few minutes; you can leave the page, it carries on.

**The dashboard**
1. **Score (0–100)** with its trend over 90 days, and the number of Critical,
   High, Medium and Low issues (press a number to see those issues).
2. **Waiting for your approval:** fixes the AI prepared (by a button or an
   automation rule). Nothing changes until someone presses **Approve**.
3. **Top 5 opportunities:** what would help most now.
4. **Target keywords on Google:** position, change over 7 days, a 28-day line
   (up = better), the page Google shows and clicks. Filter by device. Without a
   rank tracker this is Search Console's **average position** (a little delayed).
5. **Issues:** filter by category, severity or status, or search. Each issue
   says the page, the problem and why it matters, with three buttons:
   - **🤖 AI Fix:** shows the change **before and after**. You can edit it, then
     **Approve** or **Cancel**. For problems in the website's code it gives a
     **VS Code instruction** instead (Copy, or Send to developer): nothing on the
     live site changes.
   - **⚙️ Set up AI to fix this next time:** opens the automation wizard for that
     kind of issue.
   - **🛠️ Fix it myself:** plain steps, the admin page to use, Google's help page
     and, for code, the VS Code instruction.
   Also **Check again**, **Page details** and **Mark as ignored** (you must say
   why; everyone sees the reason; **Stop ignoring** brings it back).
6. **History:** every fix (yours or automatic), Google's figures for the page
   28 days before and, 30 days later, after, and **↩️ Undo** (puts the file back).
7. **Download report (PDF):** print or save the dashboard as a PDF.

**What the AI can change (only after approval, or by a rule for safe types)**
Google titles and descriptions (src/data/seo.json), picture descriptions (alt
text), structured data for the club, news stories and player profiles,
redirects for broken addresses, up to 3 links from a news story to the
players it mentions, removing dead links in a story, robots.txt (shown side by
side first) and resubmitting the sitemap to Google. Changes are saved in the
website's files on GitHub and the site rebuilds in 2–3 minutes. It never edits
code, never publishes news (drafts only, for the Media Officer) and follows
Google Search Essentials: no keyword stuffing (suggestions that repeat a phrase
are thrown away), no hidden text, no fake reviews or ratings. It never mentions
an academy or a women's team.

**Automation rules (Settings & connections › Automation rules)**
For each kind of issue: **Off**, **AI prepares, a Super Admin approves**, or
**AI fixes automatically**. Automatic is only offered for safe, reversible
fixes: missing alt text, missing or repeated descriptions, structured data,
the sitemap, redirects for broken internal links. Titles, robots.txt and
content drafts always need approval. The 5-step wizard asks: the issue, what
the AI does, which pages (all / new pages / news only), the most per day, and
how to tell you (email, bell or nothing). Every automatic fix is in History
with Undo. (Picture compression can't run on the server: it is done with
`npm run optimize-images` on the computer; the scanner gives the instruction.)

**Settings & connections**
- **Connections:** Search Console, PageSpeed, rank tracker, Claude, GitHub and
  the rebuild button, each with "How to set it up". No key is ever shown.
- **Target keywords:** the searches we want to be found for, each with its
  page and priority. The first list is suggestions until you **Confirm**.
- **Competitor websites** (only used by a rank tracker).
- **Scans, alerts and reports:** scan time, extra alert addresses, the
  developer's email, the Monday report, and the AI limits (default US$1 a day
  and US$5 a month for the SEO Scanner; the site-wide AI budget also applies).

**Alerts** (email to the Super Admins and the alert list, and the bell; at most
once a day each): the site disappearing from Google (impressions down over
40%), robots.txt blocking Google, sitemap errors, the homepage not working, a
private page that Google could list, an important page set to "noindex", poor
Core Web Vitals, the homepage not indexed. Manual actions and hacking warnings
are not available through Google's API: Search Console emails its owners, so
the Super Admins should be owners of the Search Console property.

**Learn:** **SEO basics** (button at the top) explains all of this in plain
English for anyone on the media team.

## Other things you can update in the CMS

### Prediction League prize
**Site Settings & Shop → Prediction League prize.** Enter the
end-of-season prize in naira only once the club has confirmed it (0 hides it).
See the Matchday guide, section 5a.

### Homepage hero photos
The big photos at the top of the homepage (behind "LOBI STARS – Football
Club") come from **CMS → Hero Slides**. The homepage shows **all** of them,
one after another every few seconds, in their *Display Order* (lowest first).
Upload wide photos, at least 1600 pixels wide.

**On phones and tablets** (a setting on each slide): phones show the photo in
a tall, narrow box, so a wide photo loses its left and right sides.
- **Fill the screen** (the default) is right for stadium and crowd photos.
- **Show the whole photo** is for wide group or line-up photos: the whole
  photo is shown across the screen and a soft, blurred copy of it fills the
  space above and below, so nobody at the edges is cut off.

### Promo bar (thin announcement bar at the very top of every page)
**CMS → Site Settings → Promo Bar**: tick **Show the promo bar**, type a short
message (e.g. "Tickets on sale: Lobi Stars vs Kada Warriors"), optionally a
link text ("Buy now") and link (e.g. `/tickets/`), and optional **Show from /
Show until** dates (Nigerian time). Fans can close it; it stays closed until
they next open the site. Untick to remove it.

### Social links and the WhatsApp Channel
**CMS → Site Settings & Shop → Season, Homepage Stats & Footer Text → Social
links**: the Facebook, X, Instagram, YouTube, TikTok and **WhatsApp Channel**
addresses. Paste the full address starting with `https://`. These addresses
are the one list used for the footer icons, the Contact page, the Share Hub
and Website Health.
- A real address: a working link.
- Still `REPLACE_WITH_…` (address to come): **shown but not clickable yet**
  (nothing happens on click; "Coming soon" when you hover). As soon as the
  real address is pasted in and published, it becomes a working link.
- Empty: the club has no such account; not shown at all.

The WhatsApp Channel items (shown now, clickable once its address is in):
- the homepage shows the **"Join the Lobi Stars WhatsApp Channel"** card
  (just above the newsletter), with a green **Join WhatsApp Channel** button;
- the footer's WhatsApp icon (with the other accounts under **"Follow us on
  social media"**) opens the channel;
- the "Join our WhatsApp Channel" strip appears on Watch Live and at the end
  of news articles.

Until the address is in, these appear with the button not clickable.

To get the channel address: in WhatsApp, open the channel › tap its name ›
**Channel link** › **Copy link**.

There is no floating WhatsApp chat button any more (removed 19 Oct 2026). The
club management number **0903 039 9416** is shown on the Contact and Help
pages, and MatchDay Kitchen WhatsApp ordering is unchanged.

### Newsletter sign-ups
(For the weekly newsletter itself, sign-up options and sponsor adverts, see section 24.)
The footer form asks for full name, phone, email (typed twice) and consent.
If someone signs up again with the same email, their details are updated.
Every sign-up appears in **Admin → Fan database** (source: Newsletter).

### "FULL TIME" banner
For 24 hours after you press **End Match** and enter the score, the homepage
shows "FULL TIME: Lobi Stars 2–1 …" with links to the report, highlights
(when a stream link is set) and Man of the Match (when votes exist).

All of these are under **Site Settings & Shop**:

- **Season, Homepage Stats & Footer Text**: the current season (e.g.
  2026/27) and the text at the bottom of every page.
- **Club History Timeline** and **Honours / Trophy Cabinet**: entries only
  appear on the site when **Verified** is ticked (see section 20).
- **Club Values**, **Community** and **Transparency**: see section 20.
- **Stadium Information**: capacity, directions and matchday tips.
- **Supporters' Clubs**: fan clubs by city with a contact person.

Also in the CMS: **Gallery Photos**.

---

## If something goes wrong

- **A change doesn't appear:** wait 2 minutes and refresh the page. On a
  phone, pull down to refresh.
- **"That code is not correct" on the login page:** check the admin code with
  the website manager.
- **The CMS asks for a token again:** paste in the GitHub access token from
  the website manager.
- **You made a mistake:** every change is saved in the site's history, and the
  website manager can restore an earlier version.

For anything else, contact the club's website manager.
