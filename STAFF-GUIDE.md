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
2. Type the **admin code** and press **Log in**. (Ask the club's website
   manager for the code. Never share it publicly.)
3. You'll see links at the top of every admin page: **Manage matches**,
   **Match Centre**, **Manage news**, **Analytics** and **Content CMS**.

**The first time you open the Content CMS** on a computer or phone, it asks for
a **GitHub access token**. This is a long password-like code that the website
manager gives you once. Paste it in and the CMS remembers it on that device.

> **Tip:** Bookmark https://lobistarsfc.com/admin/login on the devices you use.

---

## 1. Add a news article

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

Coaching staff and management are under **Club Management & Staff**. Set
**Group** to "Coaching Staff" for coaches, so they also appear on the Squad page.

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

## Other things you can update in the CMS

All of these are under **Site Settings, League Table & Shop**:

- **Season, Homepage Stats & Footer Text**: the current season (e.g.
  2026/27) and the text at the bottom of every page.
- **Club History Timeline** and **Honours / Trophy Cabinet**: entries only
  appear on the site when **Verified** is ticked.
- **Stadium Information**: capacity, directions and matchday tips.
- **Supporters' Clubs**: fan clubs by city with a contact person.

Also in the CMS: **Sponsor Logos** (the Partners section) and **Gallery Photos**.

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
