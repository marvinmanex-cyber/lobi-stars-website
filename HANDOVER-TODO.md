# Lobi Stars FC website: what we still need from the club

Everything below is built and live, but waits for information, accounts or
decisions from the club. Send the details in any order (batches are fine);
each item says exactly what to send. Never send passwords or secret keys by
plain email or chat: add secret keys yourself in Cloudflare (Workers & Pages
› lobi-stars-website › Settings › Variables and Secrets) and just tell the
website manager they are in.

Last checked: 12 October 2026 (209 automated tests, all passing).

**One action unlocks several items:** signing in to the Cloudflare account
that runs lobistarsfc.com (about 2 minutes, in a private browser window, with
the website manager) lets these be finished together: A5 push keys, A10
kitchen Telegram (the bot token is already saved locally) and cron Worker,
A11 programme file storage, A12 Telegram channel secrets, and A14.

---

## A. Accounts and keys (the website manager adds these in Cloudflare)

| # | What | Why it matters | What to send / do |
|---|---|---|---|
| A1 | **Resend email account** + API key | Nothing is emailed until this is done: Inbox replies, ticket and food receipts, fan sign-up links, winner emails, staff alerts | Create the account, add the domain lobistarsfc.com, add the DNS records it shows (DKIM, SPF, MX) plus DMARC (STAFF-GUIDE section 18, Setup A). Put `RESEND_API_KEY` in Cloudflare. Confirm the sender addresses: **info@lobistarsfc.com** for Inbox replies (`INBOX_FROM_EMAIL`) and e.g. **noreply@lobistarsfc.com** for other emails (`RESEND_FROM`). |
| A2 | **Fans' replies into the Inbox** | Without it, fans' email replies don't reach the Inbox | MX record for **reply.lobistarsfc.com**, inbound webhook in Resend, and `INBOX_REPLY_DOMAIN` + `INBOX_INBOUND_KEY` in Cloudflare (section 18, Setup B). |
| A3 | **Cloudflare Turnstile** (human check) | Stops robots on sign-up, contact, sponsorship and hospitality forms, and on **programme sign-in codes**. **Do this before or with A1**: once codes are emailed, without it a robot could make the site send code emails to strangers (rate limits slow this down but don't stop it) | Create a Turnstile widget for lobistarsfc.com. Send the **site key** (public); put the **secret key** in Cloudflare as `TURNSTILE_SECRET_KEY`. |
| A4 | **Paystack** | Tickets (one payment for one or several matches), membership, shirts and food payments | Confirm the webhook URL `https://lobistarsfc.com/api/paystack-webhook` is set in Paystack; do the test run with **test** keys (section 16); then put the **live** secret key in Cloudflare as `PAYSTACK_SECRET_KEY`. |
| A5 | **Phone notifications** (VAPID keys) | Kitchen and runners get order alerts; **fans get match alerts** (radio show, kick-off, goals, full time). Nothing is sent until these are set | The website manager generates them (`npx web-push generate-vapid-keys`) and adds `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. No input needed from the club except "yes, set it up". |
| A10 | **Kitchen alerts (Telegram + cron)** | Create a Telegram bot (@BotFather) and a kitchen group with the bot in it; send me (or add in Cloudflare) `TELEGRAM_BOT_TOKEN`, `TELEGRAM_KITCHEN_CHAT_ID`, a `TELEGRAM_WEBHOOK_SECRET`, a `CRON_SECRET`; then run the webhook script and deploy the cron Worker (DEPLOYMENT.md, "Kitchen Order Alerts"). The same cron Worker also sends fans the "radio show is live" alert and finishes big match-alert sends. Plus which phone/tablet is the kitchen device and logins (role Kitchen) for the cooks. |
| A11 | **Match Day Programme file storage** (Cloudflare R2) | Without it the programme can't be uploaded and /programme keeps showing the old single image | Sign in to the Cloudflare account that runs the site so the bucket `lobistars-programmes` can be created and the binding switched on (DEPLOYMENT.md, "Match Day Programme"). Fans' sign-in codes also need **A1 (Resend)**. Then: first real programme PDF (A4, 4 pages) and who prints the QR posters. |
| A12 | **Share Hub: Telegram channel bot** | Automatic programme posts to the club's public Telegram channel | Create a bot with @BotFather, make it an admin of the channel (Post Messages), add `TELEGRAM_PUBLIC_BOT_TOKEN` and `TELEGRAM_PUBLIC_CHANNEL` (DEPLOYMENT.md, "Share Hub"). Also the club's **profile links** for each platform (Admin › Share › Edit platforms). |
| A13 | **Share Hub: Facebook Page token** (optional) | Automatic posts to the Facebook Page (otherwise staff use the share window) | A Page admin creates a Meta app and a Page token with `pages_manage_posts` (steps in DEPLOYMENT.md, "Share Hub"); add `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_TOKEN`. |
| A14 | **Redeploy the cron Worker** | Runs every minute: kitchen repeat alerts, "radio show is live" fan alert, finishing big match-alert sends, **scheduled Share Hub posts**, **Website Health checks** and **monthly partner reports**. Nothing on a timer works until it is deployed | During the Cloudflare sign-in: `cd workers/kitchen-cron && npx wrangler deploy`, then `npx wrangler secret put CRON_SECRET` (same value as on the website). |
| A6 | **Termii** (optional) | SMS / WhatsApp order alerts | Decide yes or no. If yes: API key (`TERMII_API_KEY`) and approved sender ID (`TERMII_SENDER_ID`). |
| A7 | **Commentary stream (Option A)** | Lobi Stars FC Live at stream.lobistarsfc.com | From the commentary partner: the stream host name, port and mount (e.g. `https://host:8000/live`). Then the DNS step in COMMENTARY-STREAM-SETUP.md. |
| A8 | **Google Search Console** | See how the site appears in Google; submit the sitemap | Add the site, verify with the DNS record Google gives, submit `https://lobistarsfc.com/sitemap.xml` (section 23). |
| A9 | **Staff logins** | Personal accounts instead of the shared owner code; Inbox alerts go to the right people | For each staff member: name, email and role (Super Admin, Media, Matchday Operator, Commercial, Fan Relations, Analyst) and whether they may download contact lists. |

**Never add these in Cloudflare** (local testing only): `FANS_DEV_LINKS`, `SOCIAL_POST_FAKE`, `PAYSTACK_FAKE`. The first shows sign-in codes on screen, the second pretends to post to social media, the third skips real payments.

## B. Facts to confirm (nothing unconfirmed is shown on the site)

| # | What | What to send |
|---|---|---|
| B1 | **Honours** | Each trophy with the seasons won. The site has *unconfirmed* entries: league titles 1998/99 and 2017/18, FA Cup 2003. Confirm or correct. |
| B2 | **Year founded** | The site says 1969 (footer and history); some sources differ. Confirm the year. |
| B3 | **CAF appearances** | Which seasons (the site has 2019, unconfirmed). |
| B4 | **History timeline** | Confirm or correct the four timeline entries (1999, 2003, 2018, 2019), or send a new list. |
| B5 | **Club stats and tagline** | Confirm the footer tagline ("The Pride of Benue. Proudly representing Makurdi and Benue State since 1969."). |
| B6 | **Season start date** | First day of the 2026/27 season (used by "This season" in analytics). Currently 1 August 2026. |
| B7 | **Stadium** | McCarthy Stadium capacity, opening year, directions. |

## C. Content (sent to the website manager or added in the CMS)

| # | What | What to send |
|---|---|---|
| C1 | **First Team squad** | For every player: name, shirt number, position, photo (portrait, plain background), and optionally date of birth, state of origin, nationality, height, preferred foot, short bio. The site has only 3 sample players (hidden). |
| C2 | **News** | No real story is published yet (all 12 are drafts or samples). Publish the first real stories in the CMS (a matchday preview, team news, a report). |
| C3 | **Videos** | YouTube links for highlights, interviews and press conferences. |
| C4 | **Club YouTube / Facebook for match streams** | The club's own channels (the Watch Live fallback still points to the partner's). |
| C5 | **Social links** | YouTube, TikTok and WhatsApp Channel addresses (Facebook, X and Instagram are already set). |
| C6 | **Supporters' clubs** | For each: city, club name, contact person, optional phone and social link. |
| C7 | **League results** | The table is now worked out by the website. After each matchday someone enters the **other** Conference D results in Admin › League › Results (Lobi Stars' own score comes from Live Match Control). |
| C8 | **Opponent crests** | Crest images for any team not yet on the site (current crests: ABS, Bichi First, Kada Warriors, Mighty Jets, Sokoto United, Wikki Tourists, Yobe Desert Stars, Kano Pillars). |
| C9 | **Gallery photos** | Matchday and club photos (the Gallery is empty). |
| C10 | **Values** | Approve or edit the DRAFT mission and five values in the CMS (Club Values), then switch on Published. |
| C11 | **Community** | Real community projects (title, description, date, photo) and/or Club news stories tagged "Community". |
| C12 | **Transparency** (optional) | Annual reports, financial or official statements (PDF) the club wants public. |
| C14 | **Newsletter sponsors** | For each sponsor in the newsletter: the advert text or offer they want, the button text and the exact web link. Logo for **Play** (PNG, clear background); Zeva Premium Lager's logo is in (14 Oct 2026). Which sponsor goes at the top ("In partnership with"). |
| C15 | **Newsletter sender** | The address the newsletter comes from, e.g. **news@lobistarsfc.com** (needs to be on the Resend domain; set as `NEWSLETTER_FROM`). Which day it goes out each week, and who on the staff writes and sends it. |
| C16 | **Bio links** | Put **lobistarsfc.com/p/instagram** in the Instagram bio and **lobistarsfc.com/p/tiktok** in the TikTok bio (they always open the current programme), and send the club's profile links for each platform (or add them in Admin › Matchday Programme › Share › Edit platforms). |
| C17 | **First programme** | The first real Match Day Programme PDF (A4 portrait, exactly 4 pages, under 10 MB), and who prints the QR posters and flyers. |
| C18 | **Partner report emails** | For each partner, who should receive the monthly report (name and email of their marketing contact); add them in Admin › Partners › Monthly partner reports, or send them to the website manager. |
| C13 | **Partnership page** | Audience figures (followers, attendance, website visitors) and the partnership brochure PDF. |
| C19 | **Transparent crest files** | Club crests now show without a white circle, so a background baked into the file shows. Please send a **transparent PNG or SVG** of the **Wikki Tourists** crest (its white inside couldn't be separated from the background safely, so it still shows a white square) and, if possible, a light version of the **Bichi First** crest for dark backgrounds (its black laurels disappear on dark). Partner logos are unchanged (white cards). |
| C20 | **Tickets page wording** | The redesigned /tickets page has placeholder text to confirm: a short description for each stand (now "Seats in the VIP section / covered stand / Popular Stand"), whether a stand should be marked **Most popular** (no stand is marked now), the **gate opening time** for home matches, and the club's policy on **passing a ticket to someone else**. |
| C21 | **Official Zeva logo file** | The Zeva logo on the site is cut out from the uploaded picture (1254 px, white background removed by script). For the sharpest result, ask Zeva / Prime Beverages for their official logo as an **SVG** or a **transparent PNG at least 1600 px wide**; the web team then swaps it in (same file name, `public/images/zeva-premium-lager.png`). |

## D. Shop, membership and commercial decisions

| # | What | What to send |
|---|---|---|
| D1 | **Shop** | For each product: price in naira and its own Jumia product link. |
| D2 | **Membership** | How fans pay (at the club, bank transfer or online with Paystack), the price per tier, and whether to switch on online payment. |
| D3 | **Shirt personalisation** | Fee, available sizes, how fans collect or receive shirts; then "switch it on". |
| D4 | **Hospitality packages** | Package names, what's included, price (or "on request"). |
| D5 | **Prediction League prize** | Is there an end-of-season prize, and how much? |
| D7 | **Order on WhatsApp** | The bank account fans pay into (account name, bank, number); pickup points if fans can collect (e.g. "Main Stand Kiosk"); who answers WhatsApp orders on matchday. (Orders go to **0903 039 9416**: confirmed by the club on 11 October 2026.) |
| D8 | **Predict & Win and email-code accounts** | Fans who sign in for the programme with an emailed code get a fan account without confirming they are 18+ and without a phone number. Should Predict & Win (and Man of the Match) ask those fans to confirm 18+ and add a phone number before they can play? (Recommended: yes for Predict & Win, because winners must be contacted and the terms say 18+.) |
| D9 | **Season tickets** | Built and switched off. Decide the season-ticket price for each stand (VIP Sitting, Cover Stand, Popular Stand), how many each stand has, whether cup matches are included, then switch it on in Admin › Commerce › Season Tickets (needs A4, the live Paystack key). |
| D10 | **Match tickets at the gate** | **Done (12 Oct 2026):** you chose "only that very match". The scanner now refuses a ticket for a different match with "Wrong match: this ticket is for <match> on <date>"; the ticket stays valid for its own match day. |
| D6 | **In-seat food** | The real menu (items, prices, photos, categories), the list of stands/blocks for seat delivery, and the alert email addresses / phone numbers for the kitchen. |

## L. League (fixtures, results, table)

| # | What | What to send or do |
|---|---|---|
| L1 | **Crests** | **Done (13 Oct 2026):** the club confirmed it may use the seven opponents' crests already on the site. New crests can be set in League › Clubs & Venues. |
| L2 | **Rules to confirm** | **Done (13 Oct 2026):** the club confirmed the NNL rules (3 points for a win, 1 for a draw; goal difference, goals scored, wins, then head-to-head). Zones can be added later in League › Table & Rules. |
| L3 | **Who may change rules** | Optional: the staff emails allowed to change rules, adjustments, tie decisions, the import and undo (setting `league_admin_emails`); otherwise every League user can. |
| L4 | **First real results** | From Matchday 1 (Sat 7 / Sun 8 Nov 2026), enter all four results after each matchday. |
| L5 | **The 23 October match** | **Done (13 Oct 2026):** its orders were test purchases, so the trial match is hidden. |
| L6 | **Ticket prices** | **Done (13 Oct 2026):** every 2026/27 home league match is on sale at VIP Sitting ₦5,000, Cover Stand ₦2,000, Popular Stand ₦1,000 (change any match in Commerce › Match Tickets). Online payment needs the live Paystack key (A4). |
| L7 | **Seats per stand** | How many VIP Sitting, Cover Stand and Popular Stand seats can be sold for each home match (until set, there is no limit). Enter them in Commerce › Match Tickets (one form sets all matches) or send them to the website manager. |

## E. Legal

| # | What | What to send |
|---|---|---|
| E1 | **Legal review** | A lawyer checks the DRAFT Privacy Policy, Terms of Use and Predict & Win terms (cash prize promotions may need approval; prize for the score after normal time; ID for winners). Send the approved wording or changes. |

## F. Checks only the club can do

- F1. Install the app on an Android phone and an iPhone and say if anything looks wrong.
- F2. After A1/A2: send a Contact form message from your own email, reply from the Inbox, reply to that email, check it comes back.
- F3. After A4: buy one low-priced test ticket and one food order with the live key, then refund them in Paystack.
- F4. Decide whether to switch off the old Formspree copy of form messages once Inbox emails work.
- F5. QR adverts: print one advert at its real size and scan it with at least three phones (an Android, an iPhone, an older phone), also from inside Instagram or Facebook, before printing in bulk.
- F6. Share Hub: share a programme link in WhatsApp, Facebook and X and check the preview card (picture, title) appears; test "Post now" to Telegram once A12 is done.
- F7. Match alerts and kitchen alerts: after A5/A10, turn on 🔔 Match alerts on a phone and on the Kitchen Screen, and check a test alert arrives.
- F8. Share button: on a real Android phone and an iPhone, press Share on a news story, a match page and a partner page; check the phone's share menu opens, and that the link pasted into WhatsApp shows the picture and title. On a computer, check the menu and Copy link.
- F9. Admin › Share any page: add the "Share to club socials" bookmark on a computer and on a phone and try it once. After A12/A13, post one page with Post now (until then use Open post window and Mark as posted).

---

# Recommendations (best practice for football club websites)

**Content and matchday rhythm (biggest impact)**
1. **Publish to a fixed matchday rhythm**, the way top clubs do: preview (2 days
   before), team news (1 day before), line-ups (1 hour before kick-off, from
   Live Match Control), live updates, full-time report within an hour,
   highlights within 24 hours. The site's matchday checklist already tracks
   this; it only works if someone owns it each match.
2. **Real squad and staff profiles with good photos.** Player pages are among
   the most visited pages on club sites; they also feed Man of the Match and
   Fan Awards voting.
3. **Short video every week** (goals, training, interviews) on YouTube, shown
   on the site. Video drives return visits more than text.
4. **Weekly newsletter** to the fans who signed up (after A1), with the next
   match, ticket link and one story.

**Fans and engagement**
5. **Goal and kick-off alerts for fans** ✅ *built:* fans turn on 🔔 Match
   alerts (radio show, kick-off, goals, half/full time); staff manage them in
   Matchday › Fan Match Alerts. Works once the VAPID keys (A5) are set.
6. **English only:** the Pidgin, Hausa and Tiv versions were removed (13 Oct
   2026) at the club's request.
7. **Keep Predict & Win, Man of the Match and the Fan Awards running every
   home match**, and announce winners on social media with a link back.

**Revenue**
8. **Season tickets and match-ticket bundles** once single-match ticketing has
   run smoothly for a few matches.
9. **Sell shirts directly** (with personalisation) instead of only linking to
   Jumia, once stock and delivery are sorted: the club keeps more of each sale
   and sees who its buyers are.
10. **Partner reports** ✅ *built:* Partners › Monthly partner reports makes a
    branded report per sponsor (print / PDF now; email and automatic monthly
    sending once A1 Resend and A14 cron are done). Needs each partner's report
    email address (C18).

**Trust, safety and reliability**
11. **Backups** ✅ *done:* Settings › Data Backup downloads everything (Super
    Admins); the dashboard reminds after 30 days. Cloudflare D1 Time Travel
    also allows restoring to an earlier point (7 days on the free plan, 30 on paid).
12. **Uptime monitoring** ✅ *built:* Settings › Website Health checks the
    key pages, database and match-day stream every 5 minutes, with bell alerts
    and emails (needs A14 for automatic checks). Optional: add a free
    UptimeRobot monitor for https://lobistarsfc.com/api/health.
13. **Personal staff logins only, and remove access when people leave.**
    ✅ *Two-step login is built* (My account); turn it on for every Super Admin
    and anyone who can download contacts.
14. **Data protection (NDPA)**: name a data protection contact, finalise the
    Privacy Policy (E1), and answer deletion requests with the Fan Database's
    "Delete" button (it removes the person everywhere, including messages).
15. **Accessibility statement** ✅ *done:* /accessibility, linked in the footer.

**Speed**
16. The site now scores 90-97 for speed on news, match and shop pages and 74
    on the homepage in Google's lab test (accessibility, best practices and
    SEO 96-100). Keep it fast by uploading photos through the CMS (they are
    resized automatically) and avoiding very large homepage images or videos.
