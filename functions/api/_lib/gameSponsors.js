// Sponsors of the Matchday Live fan games, set by the Super Admins:
//   motm    -> settings record "motm_sponsor"    (Man of the Match: Mr. Moses Orkuma)
//   predict -> settings record "predict_sponsor" (Predict & Win: Prime Beverages & Logistics Ltd)
// Each: { show, name, line, photoUrl }. With no photo or logo, only the name is shown; with
// "Show sponsor" off, the sponsor is hidden everywhere.
export const GAMES = {
  motm: { key: 'motm_sponsor', label: 'Man of the Match', defaults: { show: true, name: 'Mr. Moses Orkuma', line: 'Proudly sponsored by Mr. Moses Orkuma', photoUrl: null } },
  predict: { key: 'predict_sponsor', label: 'Predict & Win', defaults: { show: true, name: 'Prime Beverages & Logistics Ltd', line: 'Proudly sponsored by Prime Beverages & Logistics Ltd', photoUrl: null } },
};

let ready = false;
async function ensure(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT)`).run();
  ready = true;
}

/** The saved sponsor (with defaults), for the admin page. */
export async function getGameSponsor(db, game) {
  const g = GAMES[game];
  if (!g) throw new Error(`Unknown game: ${game}`);
  await ensure(db);
  const row = await db.prepare(`SELECT value, updated_at, updated_by FROM settings WHERE key = ?`).bind(g.key).first();
  let v = {};
  try { v = JSON.parse(row?.value || '{}'); } catch { /* defaults */ }
  return { ...g.defaults, ...v, updatedAt: row?.updated_at || null, updatedBy: row?.updated_by || null };
}

export async function saveGameSponsor(db, game, patch, by) {
  const g = GAMES[game];
  const cur = await getGameSponsor(db, game);
  const clean = (v, max, d) => String(v).replace(/\s+/g, ' ').trim().slice(0, max) || d;
  const next = {
    show: patch.show !== undefined ? !!patch.show : cur.show,
    name: patch.name !== undefined ? clean(patch.name, 80, g.defaults.name) : cur.name,
    line: patch.line !== undefined ? clean(patch.line, 160, g.defaults.line) : cur.line,
    photoUrl: patch.photoUrl !== undefined ? (patch.photoUrl || null) : cur.photoUrl,
  };
  await db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(g.key, JSON.stringify(next), by || null).run();
  return { before: cur, after: next };
}

/** The sponsor as fans see it, or null when hidden. */
export function publicSponsor(saved) {
  if (!saved || !saved.show) return null;
  return { name: saved.name, line: saved.line, photoUrl: saved.photoUrl || null };
}
