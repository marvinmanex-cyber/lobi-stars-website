# Lobi Stars FC website: what we still need from the club

Everything below is built and live, but waits for information, accounts or
decisions from the club. Send the details in any order (batches are fine);
each item says exactly what to send. Never send passwords or secret keys by
plain email or chat: add secret keys yourself in Cloudflare (Workers & Pages
› lobi-stars-website › Settings › Variables and Secrets) and just tell the
website manager they are in.

Last checked: 11 October 2026 (site-wide scan: 79 pages on phone and
computer, no errors; 160 automated tests, all passing).

---

## A. Accounts and keys (the website manager adds these in Cloudflare)

| # | What | Why it matters | What to send / do |
|---|---|---|---|
| A1 | **Resend email account** + API key | Nothing is emailed until this is done: Inbox replies, ticket and food receipts, fan sign-up links, winner emails, staff alerts | Create the account, add the domain lobistarsfc.com, add the DNS records it shows (DKIM, SPF, MX) plus DMARC (STAFF-GUIDE section 18, Setup A). Put `RESEND_API_KEY` in Cloudflare. Confirm the sender addresses: **info@lobistarsfc.com** for Inbox replies (`INBOX_FROM_EMAIL`) and e.g. **noreply@lobistarsfc.com** for other emails (`RESEND_FROM`). |
| A2 | **Fans' replies into the Inbox** | Without it, fans' email replies don't reach the Inbox | MX record for **reply.lobistarsfc.com**, inbound webhook in Resend, and `INBOX_REPLY_DOMAIN` + `INBOX_INBOUND_KEY` in Cloudflare (section 18, Setup B). |
| A3 | **Cloudflare Turnstile** (human check) | Stops robots on sign-up, contact, sponsorship and hospitality forms | Create a Turnstile widget for lobistarsfc.com. Send the **site key** (public); put the **secret key** in Cloudflare as `TURNSTILE_SECRET_KEY`. |
| A4 | **Paystack** | Tickets, membership, shirts and food payments | Confirm the webhook URL `https://lobistarsfc.com/api/paystack-webhook` is set in Paystack; do the test run with **test** keys (section 16); then put the **live** secret key in Cloudflare as `PAYSTACK_SECRET_KEY`. |
| A5 | **Phone notifications for food orders** (VAPID keys) | Kitchen and runners get order alerts on their phones | The website manager generates them (`npx web-push generate-vapid-keys`) and adds `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. No input needed from the club except "yes, set it up". |
| A6 | **Termii** (optional) | SMS / WhatsApp order alerts | Decide yes or no. If yes: API key (`TERMII_API_KEY`) and approved sender ID (`TERMII_SENDER_ID`). |
| A7 | **Commentary stream (Option A)** | Lobi Stars FC Live at stream.lobistarsfc.com | From the commentary partner: the stream host name, port and mount (e.g. `https://host:8000/live`). Then the DNS step in COMMENTARY-STREAM-SETUP.md. |
| A8 | **Google Search Console** | See how the site appears in Google; submit the sitemap | Add the site, verify with the DNS record Google gives, submit `https://lobistarsfc.com/sitemap.xml` (section 23). |
| A9 | **Staff logins** | Personal accounts instead of the shared owner code; Inbox alerts go to the right people | For each staff member: name, email and role (Super Admin, Media, Matchday Operator, Commercial, Fan Relations, Analyst) and whether they may download contact lists. |

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
| C7 | **League table** | Update after every matchday (or send the table and the website manager updates it). |
| C8 | **Opponent crests** | Crest images for any team not yet on the site (current crests: ABS, Bichi First, Kada Warriors, Mighty Jets, Sokoto United, Wikki Tourists, Yobe Desert Stars, Kano Pillars). |
| C9 | **Gallery photos** | Matchday and club photos (the Gallery is empty). |
| C10 | **Values** | Approve or edit the DRAFT mission and five values in the CMS (Club Values), then switch on Published. |
| C11 | **Community** | Real community projects (title, description, date, photo) and/or Club news stories tagged "Community". |
| C12 | **Transparency** (optional) | Annual reports, financial or official statements (PDF) the club wants public. |
| C13 | **Partnership page** | Audience figures (followers, attendance, website visitors) and the partnership brochure PDF. |

## D. Shop, membership and commercial decisions

| # | What | What to send |
|---|---|---|
| D1 | **Shop** | For each product: price in naira and its own Jumia product link. |
| D2 | **Membership** | How fans pay (at the club, bank transfer or online with Paystack), the price per tier, and whether to switch on online payment. |
| D3 | **Shirt personalisation** | Fee, available sizes, how fans collect or receive shirts; then "switch it on". |
| D4 | **Hospitality packages** | Package names, what's included, price (or "on request"). |
| D5 | **Prediction League prize** | Is there an end-of-season prize, and how much? |
| D6 | **In-seat food** | The real menu (items, prices, photos, categories), the list of stands/blocks for seat delivery, and the alert email addresses / phone numbers for the kitchen. |

## E. Legal and translations

| # | What | What to send |
|---|---|---|
| E1 | **Legal review** | A lawyer checks the DRAFT Privacy Policy, Terms of Use and Predict & Win terms (cash prize promotions may need approval; prize for the score after normal time; ID for winners). Send the approved wording or changes. |
| E2 | **Pidgin** | A native Pidgin speaker checks the draft at https://lobistarsfc.com/?lang=pcm and sends corrections (or "approved"). |
| E3 | **Hausa and Tiv** | Native speakers translate the 83 interface texts in `src/i18n/ha.json` and `src/i18n/tiv.json` (the website manager can send them as a simple two-column list). |

## F. Checks only the club can do

- F1. Install the app on an Android phone and an iPhone and say if anything looks wrong.
- F2. After A1/A2: send a Contact form message from your own email, reply from the Inbox, reply to that email, check it comes back.
- F3. After A4: buy one low-priced test ticket and one food order with the live key, then refund them in Paystack.
- F4. Decide whether to switch off the old Formspree copy of form messages once Inbox emails work.

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
5. **Goal and kick-off alerts for fans** by phone notification (the site
   already has the technology for staff food alerts; it can be extended to
   fans who opt in).
6. **Use the Pidgin, Hausa and Tiv translations for key announcements** (ticket
   sales, match changes), not just the menus.
7. **Keep Predict & Win, Man of the Match and the Fan Awards running every
   home match**, and announce winners on social media with a link back.

**Revenue**
8. **Season tickets and match-ticket bundles** once single-match ticketing has
   run smoothly for a few matches.
9. **Sell shirts directly** (with personalisation) instead of only linking to
   Jumia, once stock and delivery are sorted: the club keeps more of each sale
   and sees who its buyers are.
10. **Partner reports**: send each sponsor the Partner Report from Analytics
    every month; it helps renewals.

**Trust, safety and reliability**
11. **Backups**: export the database (fans, tickets, orders, messages) on a
    schedule, and enable Cloudflare D1 Time Travel/point-in-time restore on
    the paid plan if available.
12. **Uptime monitoring** (e.g. a free UptimeRobot check on the homepage, the
    ticket page and the commentary stream) so problems are noticed before fans do.
13. **Personal staff logins only, and remove access when people leave.**
    Consider two-step login for Super Admins as a next step.
14. **Data protection (NDPA)**: name a data protection contact, finalise the
    Privacy Policy (E1), and answer deletion requests with the Fan Database's
    "Delete" button (it removes the person everywhere, including messages).
15. **Accessibility statement**: a short page saying the site aims to work for
    everyone and how to report problems.

**Speed**
16. The site now scores 90-97 for speed on news, match and shop pages and 74
    on the homepage in Google's lab test (accessibility, best practices and
    SEO 96-100). Keep it fast by uploading photos through the CMS (they are
    resized automatically) and avoiding very large homepage images or videos.
