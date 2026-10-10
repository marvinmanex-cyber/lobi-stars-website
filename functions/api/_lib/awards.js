// Fan awards: Goal of the Month, Player of the Month, Player of the Season.
// Same rules as Man of the Match voting, enforced on the server clock:
// - only signed-in fans with a confirmed email can vote;
// - voting is open between the award's open and close times;
// - one vote per fan per award (UNIQUE (award_id, member_id)), never changed;
// - results stay hidden until voting closes, then the winner(s) are shown
//   (joint winners on a tie).
// Each award can have a sponsor (a partner), shown only when one is assigned.

export const AWARD_TYPES = {
  gotm: 'Goal of the Month',
  potm: 'Player of the Month',
  pots: 'Player of the Season',
};

let ready = false;
export async function ensureAwardsSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS awards (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,              -- gotm / potm / pots
      period TEXT NOT NULL,            -- e.g. "October 2026" or "2026/27"
      opens_at TEXT NOT NULL,          -- ISO (server time)
      closes_at TEXT NOT NULL,
      sponsor_slug TEXT,               -- partner, optional
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS award_nominees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      award_id TEXT NOT NULL,
      label TEXT NOT NULL,             -- player name, or a short goal description
      player_slug TEXT,
      youtube_id TEXT,                 -- goal clip (Goal of the Month)
      sort INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS award_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      award_id TEXT NOT NULL,
      member_id TEXT NOT NULL,         -- becomes 'deleted-<id>' if the fan asks to be erased
      nominee_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (award_id, member_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_award_nominees ON award_nominees(award_id)`),
  ]);
  ready = true;
}

/** 'upcoming' | 'open' | 'closed' at server time `now`. */
export function awardState(a, now = Date.now()) {
  if (now < Date.parse(a.opens_at)) return 'upcoming';
  if (now < Date.parse(a.closes_at)) return 'open';
  return 'closed';
}

const YT = /^[A-Za-z0-9_-]{11}$/;
/** Accepts an 11-character YouTube id or a YouTube link. */
export function youtubeIdOf(v) {
  const s = String(v || '').trim();
  if (YT.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^(www|m)\./, '');
    const id = host === 'youtu.be' ? u.pathname.slice(1).split('/')[0]
      : u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/) || [])[1];
    return id && YT.test(id) ? id : null;
  } catch { return null; }
}

/** Validates an award from the admin form. Returns { value } or { error }. */
export function parseAward(b, roster) {
  const type = AWARD_TYPES[b?.type] ? b.type : null;
  if (!type) return { error: 'Choose the award type.' };
  const period = String(b.period || '').trim().slice(0, 40);
  if (!period) return { error: 'Enter the month or season (e.g. October 2026 or 2026/27).' };
  const opens = new Date(b.opens_at), closes = new Date(b.closes_at);
  if (Number.isNaN(opens.getTime()) || Number.isNaN(closes.getTime())) return { error: 'Enter valid opening and closing times.' };
  if (closes <= opens) return { error: 'Voting must close after it opens.' };
  const bySlug = new Map((roster || []).map(p => [p.slug, p]));
  const nominees = (Array.isArray(b.nominees) ? b.nominees : []).map((n, i) => {
    const p = bySlug.get(String(n?.player || ''));
    const yt = type === 'gotm' ? youtubeIdOf(n?.youtube) : null;
    const label = String(n?.label || '').trim().slice(0, 120) || (p ? p.name : '');
    return { label, player_slug: p ? p.slug : null, youtube_id: yt, sort: i, badClip: type === 'gotm' && !yt };
  }).filter(n => n.label || n.youtube_id);
  if (type === 'gotm') {
    if (nominees.some(n => n.badClip)) return { error: 'Each goal needs a valid YouTube link or 11-character video id.' };
    if (nominees.length < 3 || nominees.length > 5) return { error: 'Goal of the Month needs 3 to 5 goal clips.' };
  } else if (nominees.length < 2) return { error: 'Add at least 2 players to the shortlist.' };
  return { value: {
    type, period, opens_at: opens.toISOString(), closes_at: closes.toISOString(),
    sponsor_slug: String(b.sponsor || '').trim().slice(0, 80) || null,
    nominees: nominees.map(({ badClip, ...n }) => n),
  } };
}

/** Results for a closed award: rows with votes and %, winners (joint on a tie). */
export async function awardResults(db, award, nominees) {
  const { results } = await db.prepare(`SELECT nominee_id, COUNT(*) AS n FROM award_votes WHERE award_id = ? GROUP BY nominee_id`).bind(award.id).all();
  const total = results.reduce((s, r) => s + r.n, 0);
  const rows = nominees.map(n => ({ id: n.id, votes: results.find(r => r.nominee_id === n.id)?.n || 0 }))
    .map(r => ({ ...r, pct: total ? Math.round((r.votes / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.votes - a.votes);
  const top = rows[0]?.votes || 0;
  return { total, rows, winners: top > 0 ? rows.filter(r => r.votes === top).map(r => r.id) : [] };
}

export async function listAwards(db) {
  await ensureAwardsSchema(db);
  const { results: awards } = await db.prepare(`SELECT * FROM awards ORDER BY opens_at DESC`).all();
  const { results: noms } = await db.prepare(`SELECT * FROM award_nominees ORDER BY award_id, sort, id`).all();
  return awards.map(a => ({ ...a, nominees: noms.filter(n => n.award_id === a.id) }));
}

/** "Zeva Lager Goal of the Month" when a sponsor (active partner) is set, else "Goal of the Month". */
export function awardTitle(a, sponsor) {
  return sponsor ? `${sponsor.name} ${AWARD_TYPES[a.type]}` : AWARD_TYPES[a.type];
}

/**
 * Everything the public /awards page shows. Vote counts are only included
 * once an award has closed. partners: /data/partners.json; roster: /data/players.json.
 */
export async function publicAwards(db, { partners = [], roster = [], now = Date.now() } = {}) {
  const all = await listAwards(db);
  const bySlug = new Map(roster.map(p => [p.slug, p]));
  const partner = new Map(partners.map(p => [p.slug, p]));
  const out = [];
  for (const a of all) {
    const state = awardState(a, now);
    const sp = a.sponsor_slug ? partner.get(a.sponsor_slug) : null;
    const sponsor = sp ? { name: sp.name, logo: sp.logo || null } : null;
    const nominees = a.nominees.map(n => {
      const p = n.player_slug ? bySlug.get(n.player_slug) : null;
      return { id: n.id, label: n.label, player: p ? { slug: p.slug, name: p.name, number: p.number ?? null, position: p.position || '', photo: p.photo || null } : null, youtube: n.youtube_id || null };
    });
    const item = { id: a.id, type: a.type, typeLabel: AWARD_TYPES[a.type], title: awardTitle(a, sponsor), period: a.period, opensAt: a.opens_at, closesAt: a.closes_at, state, sponsor, nominees, results: null };
    if (state === 'closed') item.results = await awardResults(db, a, a.nominees);
    out.push(item);
  }
  return out;
}

/** Number of fans who have voted in an award. */
export async function totalAwardVoters(db, awardId) {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM award_votes WHERE award_id = ?`).bind(awardId).first()).n || 0;
}
