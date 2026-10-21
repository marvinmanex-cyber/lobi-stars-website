// A tiny stand-in for Cloudflare D1 over Node's built-in SQLite, so server
// code can be tested without the dev server (in memory, thrown away after).
import { DatabaseSync } from 'node:sqlite';

const fix = v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

export function d1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a.map(fix)),
    first: async col => { const r = db.prepare(sql).get(...args); return r === undefined ? null : col ? r[col] : { ...r }; },
    all: async () => ({ results: db.prepare(sql).all(...args).map(r => ({ ...r })) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return {
    prepare: sql => stmt(sql),
    batch: async list => { const out = []; for (const s of list) out.push(await s.run()); return out; },
    exec: sql => db.exec(sql),
    raw: db,
  };
}
