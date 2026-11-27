// Statistics Center privacy rules for public output (retention & privacy brief, 27 Nov 2026).
// No imports from the other Statistics Center modules, so any of them can use it.
//  - Personal notes (coach rating notes, event notes) never leave the staff pages.
//  - A player marked youth / minor is not named in public statistics unless the club chose to publish them.

/** Slugs of youth players hidden from public statistics. */
export async function hiddenYouth(db) {
  try { return new Set((await db.prepare(`SELECT slug FROM sx_player_privacy WHERE youth = 1 AND youth_public = 0`).all()).results.map(r => r.slug)); } catch { return new Set(); }
}

const ACADEMY = 'Academy player';
/** A published match snapshot made safe for the public: no notes, youth players unnamed. */
export function redactSnapshot(snap, hidden = new Set()) {
  if (!snap) return snap;
  const hide = slug => slug && hidden.has(slug);
  const lineups = (snap.lineups || []).map(l => {
    const { ratingNote, rating_note, notes, ...rest } = l;
    return hide(l.slug || l.playerSlug) ? { ...rest, slug: null, playerSlug: null, name: ACADEMY, playerName: ACADEMY, photo: null } : rest;
  });
  const events = (snap.events || []).map(e => {
    const { notes, createdBy, updatedBy, ...rest } = e;
    const out = { ...rest };
    if (hide(e.slug || e.playerSlug)) Object.assign(out, { slug: null, playerSlug: null, name: ACADEMY, playerName: ACADEMY });
    if (hide(e.relatedSlug)) Object.assign(out, { relatedSlug: null, relatedName: ACADEMY });
    return out;
  });
  let derived = snap.derived;
  if (derived && Array.isArray(derived.players) && hidden.size) derived = { ...derived, players: derived.players.map((p, i) => (hide(p.slug) ? { ...p, key: `hidden:${i}`, slug: null, name: ACADEMY } : p)) };
  const out = { ...snap, lineups, events, derived };
  if (hidden.size) { let j = JSON.stringify(out); for (const h of hidden) { const q = JSON.stringify(h); j = j.split(q).join("null").split(JSON.stringify("s:" + h)).join('"hidden"'); } return JSON.parse(j); }
  return out;
}
