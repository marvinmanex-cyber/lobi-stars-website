// Lobi Stars Rewards badges: fun achievements with no cash value, worked out
// from the fan's points history (server-recorded events only) and tier.
// Also the member card code (QR on My Rewards; staff scan or type it in
// Admin › Rewards › Fulfilment & Vouchers to see the fan's vouchers).

const BADGES = [
  { key: 'first-ticket', name: 'First Ticket', text: 'Bought a match ticket on lobistarsfc.com' },
  { key: 'jersey-owner', name: 'Jersey Owner', text: 'Bought a shirt on lobistarsfc.com' },
  { key: 'home-5', name: '5 Home Games', text: 'Came to 5 home matches' },
  { key: 'home-10', name: '10 Home Games', text: 'Came to 10 home matches' },
  { key: 'predictor', name: 'Predictor', text: 'Made a Predict & Win prediction' },
  { key: 'motm-voter', name: 'MOTM Voter', text: 'Voted for Man of the Match' },
  { key: 'gold', name: 'Gold Member', text: 'Reached Gold this season' },
  { key: 'legend', name: 'Legend Member', text: 'Reached Legend this season' },
];

/** Every badge with earned true/false. tierRankNow: 0 Red, 1 Gold, 2 Legend. */
export async function memberBadges(db, memberId, tierRankNow = 0) {
  const { results } = await db.prepare(`SELECT source, source_ref, COUNT(*) AS n FROM rewards_ledger
    WHERE member_id = ? AND type IN ('EARN', 'BONUS') AND status != 'REVERSED' AND source IN ('ticket_order', 'shop_order', 'attendance', 'prediction', 'vote')
    GROUP BY source, (source = 'attendance' AND source_ref LIKE 'streak:%')`).bind(memberId).all();
  const count = src => results.filter(r => r.source === src && !String(r.source_ref).startsWith('streak:')).reduce((t, r) => t + Number(r.n), 0);
  const earned = {
    'first-ticket': count('ticket_order') > 0, 'jersey-owner': count('shop_order') > 0,
    'home-5': count('attendance') >= 5, 'home-10': count('attendance') >= 10,
    predictor: count('prediction') > 0, 'motm-voter': count('vote') > 0,
    gold: tierRankNow >= 1, legend: tierRankNow >= 2,
  };
  return BADGES.map(b => ({ ...b, earned: !!earned[b.key] }));
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function sign(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret || 'lobi')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))).slice(0, 12).toUpperCase();
}

/** The member card code: "LSR-CARD:LSR-000123:ABC123DEF456" (no personal data; signed so it can't be guessed). */
export async function cardCode(env, memberNo) { return `LSR-CARD:${memberNo}:${await sign(env.SESSION_SECRET, `card:${memberNo}`)}`; }

/** Checks a scanned member card code; returns the member number or null. */
export async function readCardCode(env, code) {
  const m = /^LSR-CARD:(LSR-\d{6,}):([0-9A-F]{12})$/.exec(String(code || '').trim().toUpperCase());
  if (!m) return null;
  return (await sign(env.SESSION_SECRET, `card:${m[1]}`)) === m[2] ? m[1] : null;
}
