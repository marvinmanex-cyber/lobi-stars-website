# Lobi Stars FC website: staff guide

This guide is for club staff who update the website. You don't need any
technical knowledge: everything is done through web pages in your browser.

---

## Before you start: logging in

There are two places where you make changes:

| What you want to change | Where | How fast it appears on the site |
|---|---|---|
| Matches, scores, live updates | **Manage Matches** and **Match Centre** | Straight away |
| News, players, league table, shop, videos, club pages | **Content CMS** | About 1–2 minutes after you press Save |

1. Go to **https://lobistarsfc.com/admin/login**.
2. Sign in with **your own staff email and password** (the owner creates
   your account under **Staff**). The owner can instead use the
   **Admin code (owner)** tab. Never share your password or the code.
3. You'll see links at the top of every admin page: **Analytics**,
   **Fan database**, **Manage matches**, **Match Centre**, **Manage news**,
   **Partners** and **Content CMS** (plus **Staff** for the owner).

**The first time you open the Content CMS** on a computer or phone, it asks for
a **GitHub access token**. This is a long password-like code that the website
manager gives you once. Paste it in and the CMS remembers it on that device.

> **Tip:** Bookmark https://lobistarsfc.com/admin/login on the devices you use.

---

## 1. Add a news article

> **Published or Draft:** every story has a **Status**. **Published** stories appear on
> the website; **Draft** stories are hidden from the website, Google and search
> but stay in the CMS and on Admin → Manage news (marked "Draft"). The starter
> sample stories are all drafts, so you can use them as examples or delete them.
> The homepage news rows appear once at least **3** stories are published.


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
- **Author name / role / photo:** shown as a byline ("By Ngozi Bello, Club Media Officer"). Leave blank to show "By Lobi Stars FC".
- **Updated at:** set this when you change a story after publishing; the page then shows "Updated …".
- **Tagged players:** pick players from the squad. They appear as small chips linking to their profiles, and the story appears under "Latest news about …" on each player's profile.
- **Category → Features**, or **Series → Heritage**: long reads get a wide layout with a large photo, reading time, big pull quotes (start a paragraph with `>`) and a **Photo gallery**.
- **Category → Club:** community, partner and off-pitch stories. They get their own "Across the Club" row on the homepage.

### Publishing Team News (injury and availability update)
1. New story → **Category: Team News** and **Matchday content type: Team News**.
2. Set **Match date** to the day of the match.
3. In **Team News table**, add a row per player: pick the player (or type a name), choose **Available / Doubtful / Injured / Suspended**, and add the injury or reason and the expected return.
4. Publish. The table appears colour-coded at the top of the story, and as **Squad availability** on that match's Match Centre page.

## 2. Add or update a fixture, result or score

### Add a new match (fixture)

1. Log in and click **Manage matches**.
2. Click **+ New match** and fill in the home team, away team, competition,
   venue and **kick-off** date and time. Use Nigerian time (WAT) on a device
   set to Nigerian time.
3. Fill in the **ticket prices** in naira (for home matches) and tick
   **Visible on the site**.
4. Click **Save match**. It appears on Fixtures, Tickets and the home page
   straight away.

To change a match, click **Edit** on it. Use **Hide** if a match should
temporarily disappear from the site. A match that already has tickets sold
can't be deleted, only hidden.

> **Home games:** for Kick-off, Full-time, stream links, Man of the Match voting and Predict & Win, see **STAFF-MATCHDAY-GUIDE.md**.

### Entering player stats (for the Stats page)
After each match (home **or** away), open **Admin → Match Centre**, choose the
match and scroll to **Player stats**. Press **Fill from matchday squad** to tick
the starting XI, then tick anyone who came on, and enter goals, assists and
yellow/red cards. Press **Save Match Centre**. The **/stats** page updates
straight away:
- Top Scorers, Assists, Appearances, Yellow and Red Cards come from these entries.
- **Clean Sheets** are worked out automatically for goalkeepers who played when Lobi Stars conceded nothing.
- **Man of the Match** wins come from the fan vote.
- The **team** figures (played, won, drawn, lost, goals, home/away record, longest unbeaten run, form) come from the final scores.
Leaderboards with no data are hidden. Fans can switch seasons with the season menu.

### Fixture card buttons
Fixture cards (homepage, Fixtures page, match page) show buttons only when they lead somewhere:
- **Match Preview** – when a published story has *Matchday content type: Preview* and that match's date.
- **Buy Tickets** – home games that are on sale (a future match with at least one seat price set in Manage matches).
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

1. In **Manage matches**, click **Match Centre** on the match (or click
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

## 3. Update the league table

1. Log in and open the **Content CMS**.
2. Click **Site Settings, League Table & Shop**, then **League Table**.
3. For each club, update **Played, Won, Drawn, Lost, Goals For** and
   **Goals Against**. Points and goal difference are worked out
   automatically. Use **Points Adjustment** only for a points deduction
   (e.g. -3).
4. Set **Last Updated** to today's date in the format **YYYY-MM-DD**
   (e.g. 2026-11-02).
5. Click **Save**. The table appears on the site in 1–2 minutes. Until any
   club has played a match, the site shows "The table will appear after
   Matchday 1" instead of a table of zeros.

---

## 4. Add a player

> **Sample players:** the starter sample players are never shown on the public site.
> They still appear (marked "sample") in Admin → Match Centre's squad picker, so
> don't pick them for a real match. The squad page shows "The squad will be
> announced soon" until you add real players.


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

1. Open the **Content CMS** and click **Site Settings, League Table & Shop**,
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

---

## 6. Add a video

1. On YouTube, open the video and copy its address, e.g.
   `https://www.youtube.com/watch?v=dQw4w9WgXcQ`.
2. The **video ID** is the 11 characters after `v=`. In this example it's
   `dQw4w9WgXcQ`. For a short link like `https://youtu.be/dQw4w9WgXcQ`, it's
   the part after the last `/`.
3. Open the **Content CMS** and click **Site Settings, League Table & Shop**,
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
     instead.
   - **Website** (starting with https://), a one-line **Short Description**
     and **Partner Since** (the year).
   - **Display Order**: 1 shows first within its tier.
   - **Age restricted**: tick this for alcohol brands. The site then shows
     "18+ | Drink Responsibly" next to their logo everywhere.
4. Make sure **Active** is ticked and click **Save**. The partner appears on
   the home page, in the footer, on /partners and on their own partner page in
   about 1–2 minutes.

**To remove a partner** without deleting them, untick **Active**.

**Partnership Opportunities:** the categories you're offering to new sponsors
are under **Site Settings… › Partnership Opportunities & Benefits**. When you
add an active Official Club Partner, their category disappears from the
opportunities list automatically. The same screen holds the audience figures
for "Why partner with Lobi Stars" (empty figures are hidden) and the
partnership brochure PDF (the download button only shows once a file is added).

---

## 8. How to read the analytics dashboard and export the fan database

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

### Staff accounts (owner only)

Under **Staff**, the owner adds an account for each person (name, email,
temporary password), turns **Can export fan data** on or off, resets
passwords and deactivates people who leave. **Import existing records** (on
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
**Admin → Manage matches** → **Edit** the match:
- **Live commentary available for this match** is ticked by default (home and away games).
- **Commentary starts:** leave blank to start **15 minutes before kick-off**,
  or set an exact time.

Fans can only listen from the commentary start time until **15 minutes after
full time**. Outside that the player says "Off air" and doesn't connect.
Press **End Match** in Match Centre as usual at the final whistle; if nobody
does, commentary ends automatically 2 hours 30 minutes after kick-off.

### Test the stream (do this before every match)
**Admin → Commentary** → **Test stream**. Each line says **working ✓** or
**not working ✗**. If it's not working, contact the broadcast partner.

### Other settings
- **Public stream address:** the Lobi Stars address fans' players connect to
  (e.g. `https://stream.lobistarsfc.com/live`, or `/live/commentary`). Only
  lobistarsfc.com addresses are accepted. Leave blank to use the default.
- **Backup stream address:** optional. The player switches to it if the main
  stream fails twice.
- **Commentators:** optional names shown on the player.
- **Maximum listeners:** only for the website relay; extra listeners see "full, try again".

### Check listener numbers
**Admin → Commentary → Right now** shows **Live listeners** (updated every 30
seconds) and the **peak** for the current match. After matches, see the
**Lobi Stars FC Live** panel on **Admin → Analytics**, or download the
**Broadcast Report (CSV)**.

### White-label rule
Never put the broadcast partner's name, logo or web address on the
commentary player or the commentary pages, and never link fans to an outside
site for commentary. The partner still appears on the Partners page.

---

## Other things you can update in the CMS

### Promo bar (thin announcement bar at the very top of every page)
**CMS → Site Settings → Promo Bar**: tick **Show the promo bar**, type a short
message (e.g. "Tickets on sale: Lobi Stars vs Kada Warriors"), optionally a
link text ("Buy now") and link (e.g. `/tickets/`), and optional **Show from /
Show until** dates (Nigerian time). Fans can close it; it stays closed until
they next open the site. Untick to remove it.

### Social links and the WhatsApp Channel
**CMS → Site Settings → Season, Homepage Stats & Footer Text → Social links**:
add the Facebook, X, Instagram, YouTube, TikTok and **WhatsApp Channel** links.
Empty ones are hidden. As soon as the WhatsApp Channel link is added, a
"Join our WhatsApp Channel" block appears on the homepage, in the footer, at
the end of every news article and on Watch Live.

### Newsletter sign-ups
The footer form asks for full name, phone, email (typed twice) and consent.
If someone signs up again with the same email, their details are updated.
Every sign-up appears in **Admin → Fan database** (source: Newsletter).

### "FULL TIME" banner
For 24 hours after you press **End Match** and enter the score, the homepage
shows "FULL TIME: Lobi Stars 2–1 …" with links to the report, highlights
(when a stream link is set) and Man of the Match (when votes exist).

All of these are under **Site Settings, League Table & Shop**:

- **Season, Homepage Stats & Footer Text**: the current season (e.g.
  2026/27) and the text at the bottom of every page.
- **Club History Timeline** and **Honours / Trophy Cabinet**: entries only
  appear on the site when **Verified** is ticked.
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
