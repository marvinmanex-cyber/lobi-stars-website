// One-time export of the site's own (legacy) ticket orders, in the shared contract's shape
// (docs/INTEGRATION_CONTRACT.md C3.3 / C3.4), for the ticketing engine to import as
// `legacy_import`. READ ONLY: it never changes the database.
//
//   node scripts/ticketing-legacy-export.mjs                 dry run: counts and the skip report only
//   node scripts/ticketing-legacy-export.mjs --out ticketing-export.json --report ticketing-report.json
//   options: --local (the local test database instead of the live one), --all (past matches too;
//            default: matches from today on), --db <name> (default lobi-stars-tickets)
//
// The export holds buyers' names, emails and phones: keep it private, send it only to the
// engine operator over a secure channel, and delete it after the import (*.export.json files
// are git-ignored). Old LS-TIX numbers keep scanning here until a Super Admin ticks
// "Old tickets have been imported" (Admin › Tickets); then the engine checks them, with the
// LS-TIX number itself as the token.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const has = n => args.includes(n);
const DB = opt('--db') || 'lobi-stars-tickets';
const out = opt('--out'), reportFile = opt('--report');
const TIER_LABELS = { VIP: 'VIP Sitting', Premium: 'Grand Stand', Regular: 'Popular Stand' };

// Wrangler is run through Node directly (no shell), so the SQL reaches it as one argument on every system.
const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
function query(sql) {
  const cli = [WRANGLER, 'd1', 'execute', DB, has('--local') ? '--local' : '--remote', '--json', '--command', sql.replace(/\s+/g, ' ')];
  const raw = execFileSync(process.execPath, cli, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const j = JSON.parse(raw.slice(raw.indexOf('[')));
  return j[0].results;
}
const intlPhone = p => { const d = String(p || '').replace(/\D/g, ''); return /^234\d{10}$/.test(d) ? `+${d}` : /^0\d{10}$/.test(d) ? `+234${d.slice(1)}` : /^\d{10}$/.test(d) ? `+234${d}` : ''; };
const iso = s => (s ? (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? new Date(s) : new Date(`${String(s).replace(' ', 'T')}Z`)).toISOString() : null);
const STATUS = { valid: 'valid', used: 'scanned', void: 'void' };

const since = has('--all') ? '1970-01-01' : new Date(Date.now() - 6 * 3600e3).toISOString();
console.log(`Reading ${has('--local') ? 'the LOCAL' : 'the LIVE'} database (read only)…`);
const lines = query(`SELECT o.id, o.basket_id, o.event_id, o.tier, o.quantity, o.unit_price_kobo, o.total_kobo, o.discount_kobo, o.buyer_name, o.buyer_email, o.buyer_phone,
    o.payment_status, o.paid_at, o.refunded_at, o.paystack_reference, e.home_team, e.away_team, e.event_date, e.venue,
    b.reference AS basket_ref, COALESCE(b.backend, 'legacy') AS backend
  FROM orders o JOIN events e ON e.id = o.event_id LEFT JOIN league_ticket_orders b ON b.id = o.basket_id
  WHERE e.event_date >= '${since}' ORDER BY o.created_at`);
const tickets = query(`SELECT t.id, t.order_id, t.status, t.ticket_type, t.used_at FROM tickets t JOIN orders o ON o.id = t.order_id JOIN events e ON e.id = t.event_id WHERE e.event_date >= '${since}'`);
const byOrder = new Map();
for (const t of tickets) { if (!byOrder.has(t.order_id)) byOrder.set(t.order_id, []); byOrder.get(t.order_id).push(t); }

const orders = new Map(), skipped = [];
for (const l of lines) {
  const ref = l.basket_ref || l.paystack_reference || l.id;
  const why = l.backend === 'engine' ? 'already sold by the ticket system'
    : l.payment_status !== 'paid' ? `not paid (${l.payment_status})`
    : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(l.buyer_email || '') ? 'buyer email missing or invalid'
    : !intlPhone(l.buyer_phone) ? 'buyer phone missing or invalid'
    : !(byOrder.get(l.id) || []).length ? 'paid but no tickets issued' : null;
  if (why) { skipped.push({ reference: ref, line: l.id, match: `${l.home_team} vs ${l.away_team}`, reason: why }); continue; }
  const o = orders.get(ref) || { client_reference: ref, legacy_import: true, status: l.refunded_at ? 'refunded' : 'paid', currency: 'NGN', amount_total_kobo: 0, paid_at: iso(l.paid_at),
    buyer: { name: l.buyer_name, email: String(l.buyer_email).toLowerCase(), phone: intlPhone(l.buyer_phone) }, lines: [], tickets: [] };
  o.amount_total_kobo += Number(l.total_kobo) || 0;
  o.lines.push({ event_id: l.event_id, stand_id: l.tier, stand_name: TIER_LABELS[l.tier] || l.tier, quantity: l.quantity, unit_price_kobo: l.unit_price_kobo, line_total_kobo: l.total_kobo,
    discount_kobo: Number(l.discount_kobo) || 0 });
  for (const t of byOrder.get(l.id)) {
    o.tickets.push({ ticket_id: t.id, token: t.id, order_id: ref, event_id: l.event_id, event_name: `${l.home_team} vs ${l.away_team}`, kickoff_at: iso(l.event_date), venue: l.venue,
      stand_id: l.tier, stand_name: TIER_LABELS[l.tier] || l.tier, status: STATUS[t.status] || 'valid', ticket_type: t.ticket_type || 'adult', ...(t.used_at ? { scanned_at: iso(t.used_at) } : {}) });
  }
  orders.set(ref, o);
}
const list = [...orders.values()];
const summary = {
  database: has('--local') ? 'local' : 'live', matchesFrom: has('--all') ? 'all' : since.slice(0, 10), orders: list.length,
  tickets: list.reduce((n, o) => n + o.tickets.length, 0), childTickets: list.reduce((n, o) => n + o.tickets.filter(t => t.ticket_type === 'child').length, 0),
  alreadyScanned: list.reduce((n, o) => n + o.tickets.filter(t => t.status === 'scanned').length, 0), skipped: skipped.length,
  note: 'Season tickets (LS-SZN-…) are not exported: they stay on the club system.',
};
console.log(JSON.stringify(summary, null, 2));
if (skipped.length) { console.log('Skipped:'); for (const s of skipped.slice(0, 50)) console.log(`  ${s.reference} (${s.match}): ${s.reason}`); if (skipped.length > 50) console.log(`  … and ${skipped.length - 50} more (see --report)`); }
if (reportFile) { fs.writeFileSync(reportFile, JSON.stringify({ summary, skipped }, null, 2)); console.log(`Report written to ${reportFile}`); }
if (out) { fs.writeFileSync(out, JSON.stringify({ format: 'legacy_import', exported_at: new Date().toISOString(), orders: list }, null, 2)); console.log(`Export written to ${out} (personal data: keep it private).`); }
else console.log('Dry run: nothing written. Add --out <file> to write the export.');
