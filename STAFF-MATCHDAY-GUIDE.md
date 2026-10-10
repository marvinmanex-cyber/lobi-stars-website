# Lobi Stars FC: Matchday Live staff guide

This guide covers everything staff do for a **Lobi Stars home game** on the
website: the stream, the squad, Kick-off and Full-time, Man of the Match
voting and Predict & Win. Away games only need the score (they can still have
live commentary on Lobi Stars FC Live).

Sign in at **https://lobistarsfc.com/admin/login** with your own staff email
and password (the owner can use the admin code). All times on the website use
the club's server clock in **Nigerian time (WAT)**, never your phone's clock.

---

## What fans get on a home game

Every home game has a **Matchday Live** page (from Fixtures, the homepage or
the Match Centre) with four tabs:

| Tab | What it does | When |
|---|---|---|
| **Watch Live** | Plays the YouTube or Facebook stream; afterwards it becomes the "Full match replay" | Stream starts at kick-off |
| **Commentary** | Plays Lobi Stars FC Live commentary right on the page (same player as lobistarsfc.com/commentary) | From the commentary start time (normally 15 min before kick-off) until 15 min after full time |
| **Vote MOTM** | Fans vote for the Lobi Stars Man of the Match | Kick-off to full time |
| **Predict & Win** | Fans predict the exact score; earliest correct prediction wins ₦10,000 | 24 hours before kick-off until kick-off |

Fans need a free fan account with a confirmed email to vote or predict.

---

## 1. Before the match (a day or more ahead)

1. **Add the match** in **Admin → Manage matches** if it isn't there. Make sure
   Lobi Stars is the home team and "Lobi Stars home game" is ticked.
2. Open **Admin → Match Centre** and choose the match.
3. **Matchday squad:** in *Matchday squad*, set each player to **Starting XI**,
   **Bench** or *Not selected*. Only these players appear in Man of the Match
   voting. Press **Save Match Centre**.
   - Players come from the Squad in the Content CMS. Add new players there first.
4. **Stream links:** in *Live stream (Watch Live)*, paste the **YouTube live
   link** and/or the **Facebook live link** for this game and press **Save**.
   Leave them empty to show links to the official channels instead.
   - Only YouTube and Facebook links are accepted.
5. **Live commentary:** in **Admin → Manage matches**, edit the match and check
   *Live commentary available for this match* is ticked. Change *Commentary
   starts* only if it shouldn't start 15 minutes before kick-off. This works
   for home **and** away games. On the day, press **Test stream** on
   **Admin → Commentary** (see STAFF-GUIDE.md, section 9).
6. Predict & Win opens automatically **24 hours before kick-off**. Fans who
   said yes to news and offers get a "Predictions are now open" email (once
   the email service is set up).

> You can update the squad and stream links right up to kick-off.

---

## 2. At kick-off

In **Admin → Match Centre**, choose the match and press
**▶ Start Match (Kick-off)**.

- The match shows as **LIVE** everywhere, with a red "LIVE NOW" banner on the homepage.
- **Man of the Match voting opens.**
- **Predict & Win closes** (it also closes by itself at the scheduled kick-off time).
- Opted-in fans get a "Kick-off! Vote for Man of the Match" email.

During the match you can add goals, cards and substitutions in the *Live
timeline* and update the score, then press **Save Match Centre**. Fans see
updates within 30 seconds.

---

## 3. At the final whistle

Press **■ End Match (Full-time)** and enter the **final score**, then
**Confirm full-time**.

- Voting closes and the **Man of the Match** is revealed to fans.
- The **Predict & Win winner** is worked out straight away and the message
  tells you if there is a winner.
- **Forgot to press End Match?** The match closes by itself **2 hours 15
  minutes after kick-off**. Then press **End Match** to enter the final score
  (this is what decides the Predict & Win winner).
- **Score entered wrongly?** Correct the score in *Status & score* and press
  **Save Match Centre**. The Predict & Win winner is recalculated.

---

## 4. Check the Predict & Win winner and pay the prize

Open **Admin → Predict & Win** and choose the match.

1. The top box shows the **final score**, the **winner's name, phone and
   email**, their prediction and the exact time it was received.
2. **Call the winner** on that phone number (they have also been emailed) and
   arrange for them to collect the ₦10,000 at the club. You may check their ID
   matches their fan account.
3. When the prize has been handed over, tick **Prize paid**. Your name and
   the date are recorded.
4. **No exact prediction?** The page says nobody has won. The prize is not
   given out and does not roll over.

**Never ask a winner for bank details, passwords or PINs through the website.**

### Disqualifying an entry
In the *Entries* list, press **Disqualify** next to an entry and give a reason
(e.g. "duplicate account"). The winner is recalculated automatically: the next
earliest correct entry wins. **Reinstate** undoes it.

### Club staff and players can't win
If an entrant is club staff, a player or a family member, press **Mark club
staff/player** next to their entry. That account can never win; the winner
is recalculated.

---

## 5. Man of the Match results

In **Admin → Match Centre**, home games have a **Man of the Match votes**
panel. Staff can see the live vote count at any time (fans only see the
total number of voters until full time). Ties give joint winners. Each
player's number of awards appears on their profile automatically.

---

## 6. Exports

| What | Where | Who |
|---|---|---|
| Man of the Match votes (CSV) | Admin → Match Centre → *Export votes (CSV)* | Any staff |
| Predictions (CSV) | Admin → Predict & Win → *Export predictions (CSV)* | Staff with "Can export fan data" |

Every export is recorded in the download log (Admin → Fan database). Keep
exported files private and delete them when you no longer need them.

---

## 7. If something goes wrong

- **Fans say they can't vote:** voting only works between Start Match and
  End Match, for fans who are logged in with a confirmed email. Each fan has
  one vote per match.
- **A player is missing from voting:** add them to the matchday squad and press Save.
- **The stream doesn't play:** check the link in Match Centre. Some Facebook
  videos can't be shown on other websites; fans can use the "Open on Facebook" link.
- **The match is stuck on LIVE:** press End Match. It also closes itself 2h15 after kick-off.
- **Reminder emails didn't go out:** the email service (Resend) must be set up
  by the website manager. Admin → Predict & Win shows whether each reminder was sent.

---

## Rules and terms (for fans)

- Man of the Match rules: https://lobistarsfc.com/motm/rules
- Predict & Win terms: https://lobistarsfc.com/predict-and-win/terms *(DRAFT until reviewed by the club's legal adviser)*
- Privacy Policy: https://lobistarsfc.com/privacy *(DRAFT until reviewed)*
- Website Terms of Use: https://lobistarsfc.com/terms *(DRAFT until reviewed)*

---

## Outstanding items for the club

1. **Email service:** add the Resend API key and sender address (e.g.
   noreply@lobistarsfc.com) so confirmation, winner and reminder emails are sent.
2. **Turnstile:** add the Cloudflare Turnstile keys for the human check on sign-up.
3. **Stream channels:** confirm the YouTube/Facebook channels for Lobi Stars
   streams (the Watch Live fallback links currently point to the partner's channels).
4. **Legal review:** Predict & Win terms (cash prize promotions may need
   regulatory approval), the Privacy Policy and the website Terms of Use, all marked DRAFT. The terms
   also include points to confirm: the prize is for the score at the end of
   normal time, and winners may be asked for ID.
5. **Players:** add the real squad with photos in the CMS (voting uses them).
6. **Lobi Stars FC Live stream:** choose the delivery option and finish the
   partner and DNS setup (see COMMENTARY-STREAM-SETUP.md), then add the stream
   address on Admin → Commentary.
