// Lobi Stars Rewards Terms: the approved text (default) and the version the
// club saves in Admin › Rewards › Terms (settings 'rewards_terms'). Written in
// a very small, safe format so staff can edit it without HTML:
//   ## Heading        ### Smaller heading
//   - List item       (blank line between paragraphs)
//   [link text](/page/) or [link text](https://...)   links
// parseTerms() turns it into blocks; nothing is ever inserted as raw HTML.

export const DEFAULT_TERMS_UPDATED = '2026-10-14';
export const DEFAULT_TERMS = `Lobi Stars Rewards ("Rewards") is a free loyalty programme run by Lobi Stars Football Club ("the club", "we"). Members collect Star Points ("points") and can swap them for rewards. By joining you agree to these terms, our [Terms of Use](/terms/) and our [Privacy Policy](/privacy/).

## 1. Who can join
- Anyone with a Lobi Stars FC fan account on lobistarsfc.com whose email address has been confirmed. Fan accounts are for people aged 18 or older living in Nigeria.
- One Rewards membership per person, per verified email address and per phone number.
- Rewards linked to an alcohol sponsor are for people aged 18 or older only.
- Each member gets a member number (for example LSR-000123).

## 2. Earning Star Points
- Points are given for the activities shown on the Lobi Stars Rewards pages, for example tickets, jerseys, merchandise, matchday food and membership bought through lobistarsfc.com, coming to home matches, and taking part in matchday activities. The current rates are shown on the Rewards pages and may change.
- Points are only given when our systems record the activity: a confirmed payment, a ticket scanned at the gate, or a vote or prediction saved by us. Purchases made on other websites or shops (for example Jumia) do not earn points.
- Points are worked out on the amount actually paid in naira, after discounts and any points used, without delivery fees.
- Each order or activity can earn points only once.
- Joining and completing your profile may earn bonus points, shown on the Rewards pages.

## 3. When points can be used
- Points from match tickets are "pending" until the match has been played, then become available. If a match is cancelled and the ticket is refunded, those points are removed.
- Points from other purchases become available once the payment is confirmed.
- Jerseys and merchandise are non-refundable. Points earned on them are final, except in cases of fraud or a payment dispute.
- If a payment is reversed, disputed or refunded, the points from it are removed. Your balance can go below zero; you cannot redeem while it is below zero.

## 4. Using points
- Rewards, their points cost and how many are available are shown on the Rewards pages. Rewards are subject to availability, and we may replace a reward with one of similar value if it is no longer available.
- A redemption cannot be undone once confirmed. Larger redemptions may need a code sent to your verified email.
- Vouchers are single-use and expire on the date shown.

## 5. Points have no cash value
- Points cannot be exchanged for cash, withdrawn, transferred to another person or account, sold or bought.

## 6. Expiry
- Points expire 12 months after your last Rewards activity (earning or using points). We will try to remind you by email before points expire.

## 7. Tiers
- Members may be placed in tiers based on points earned in the current season. Tier levels and benefits are shown on the Rewards pages and may change.

## 8. Fair use and fraud
- We may refuse, remove or reverse points that were earned by mistake, by fraud, by misuse of referrals or by breaking these terms, and we may suspend or close a membership in those cases.
- Automated or bulk activity, fake accounts and self-referrals are not allowed.

## 9. Changes to the programme
- We may change these terms, the earning rates, rewards or tiers, or end the programme. We will give reasonable notice on the website or by email, except where a change is needed to stop fraud or comply with the law.

## 10. Your data
- We use your account details, your Rewards activity and the date of birth and state you choose to give us to run the programme, prevent fraud, send you Rewards messages you can manage, and understand how fans use our services, in line with the Nigeria Data Protection Act 2023 and our [Privacy Policy](/privacy/).

## 11. Leaving and contact
- You can leave Rewards at any time by contacting us; any points you have will be lost.
- Questions: [info@lobistarsfc.com](mailto:info@lobistarsfc.com) or the [Help Centre](/help/).`;

/** Splits a line into text and safe links: [{ text } | { text, href }]. Only site paths, https and mailto links. */
export function inline(line) {
  const out = [];
  const re = /\[([^\]]{1,120})\]\(((?:\/[^\s)]*)|(?:https:\/\/[^\s)]+)|(?:mailto:[^\s)]+))\)/g;
  let last = 0, m;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) });
    out.push({ text: m[1], href: m[2] });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

/** The text as blocks: { h2 | h3 | p: parts } and { ul: [parts, ...] }. */
export function parseTerms(md) {
  const blocks = [];
  let para = [], list = null;
  const flushPara = () => { if (para.length) { blocks.push({ type: 'p', parts: inline(para.join(' ')) }); para = []; } };
  const flushList = () => { if (list) { blocks.push({ type: 'ul', items: list.map(inline) }); list = null; } };
  for (const raw of String(md || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    if (h) { flushPara(); flushList(); blocks.push({ type: h[1].length === 2 ? 'h2' : 'h3', parts: inline(h[2]) }); continue; }
    const li = /^[-*]\s+(.+)$/.exec(line);
    if (li) { flushPara(); (list ||= []).push(li[1]); continue; }
    flushList(); para.push(line);
  }
  flushPara(); flushList();
  return blocks;
}

/** The saved terms, or the approved default. { body, updated, custom } */
export async function currentTerms(db) {
  try {
    const r = await db.prepare(`SELECT value FROM settings WHERE key = 'rewards_terms'`).first();
    if (r?.value) { const v = JSON.parse(r.value); if (v.body) return { body: v.body, updated: v.updated || DEFAULT_TERMS_UPDATED, custom: true, updatedBy: v.updatedBy || null }; }
  } catch { /* no settings table yet */ }
  return { body: DEFAULT_TERMS, updated: DEFAULT_TERMS_UPDATED, custom: false };
}
