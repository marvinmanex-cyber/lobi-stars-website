import { ticketAuth, ok, fail, lagosToIso, salesView } from '../../../_lib/ticketAdmin.js';
import { logLeague } from '../../../_lib/leagueDb.js';
import { loadRules, loadDiscountSettings, discountReport, SETTING_KEYS } from '../../../_lib/ticketDiscounts.js';
import { ruleProblem, ruleLive } from '../../../_lib/tickets/discounts.js';

// Admin › Tickets › Discounts.
// GET  /api/admin/tickets/discounts -> { rules, settings, report, matches }
// PUT  /api/admin/tickets/discounts { rule: { id, name, isActive, percent, validFrom, validUntil, maxPerMatch, config, tiers: [{ minTickets, percent }] } }
//      or { settings: { allowStacking, maxTotalPercent, minTicketNaira, perEmailPerMatch } }
// Percents are typed as e.g. 10 or 12.5 (stored as basis points); dates are
// Nigerian time "YYYY-MM-DDTHH:MM" ('' = no limit). Every change goes to the
// audit log with before and after.
export async function onRequestGet({ request, env }) {
  const { denied } = await ticketAuth(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const [rules, settings, report, matches] = await Promise.all([loadRules(db), loadDiscountSettings(db), discountReport(db), salesView(env)]);
    return ok({
      rules: rules.map(r => ({ ...r, liveNow: ruleLive(r, Date.now()) })), settings, report,
      matches: matches.filter(m => Date.parse(m.kickoff) > Date.now() - 3 * 3600e3).map(m => ({ id: m.id, matchday: m.matchday, homeTeam: m.homeTeam, awayTeam: m.awayTeam, kickoff: m.kickoff, state: m.state, allowDiscounts: m.allowDiscounts, discountCap: m.discountCap, tiers: m.tiers.filter(t => t.priceNaira > 0).map(t => ({ tier: t.tier, label: t.label, priceNaira: t.priceNaira })) })),
    });
  } catch (err) {
    console.error('[discounts admin] load', err);
    return fail('Could not load the discounts.', 500);
  }
}

const bp = v => (v === '' || v === null || v === undefined ? NaN : Math.round(Number(v) * 100));
const int = v => (v === '' || v === null || v === undefined ? null : Number(v));

export async function onRequestPut({ request, env }) {
  const { staff, denied } = await ticketAuth(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const b = await request.json().catch(() => ({}));
    if (b.settings) return saveSettings(db, staff, b.settings);
    const r = b.rule || {};
    const current = (await loadRules(db)).find(x => x.id === String(r.id || ''));
    if (!current) return fail('Discount not found.', 404);
    const validFrom = lagosToIso(r.validFrom), validUntil = lagosToIso(r.validUntil);
    if (Number.isNaN(validFrom) || Number.isNaN(validUntil)) return fail('Enter real dates and times.');
    const next = {
      ...current,
      name: String(r.name ?? current.name).replace(/<[^>]*>/g, '').trim().slice(0, 60),
      isActive: r.isActive === undefined ? current.isActive : !!r.isActive,
      percentBp: current.kind === 'group' ? 0 : (r.percent === undefined ? current.percentBp : bp(r.percent)),
      validFrom: validFrom === undefined ? current.validFrom : validFrom,
      validUntil: validUntil === undefined ? current.validUntil : validUntil,
      maxPerMatch: r.maxPerMatch === undefined ? current.maxPerMatch : int(r.maxPerMatch),
      config: current.kind === 'group' ? {} : current.kind === 'early_bird'
        ? { daysBefore: r.config?.daysBefore === undefined ? current.config.daysBefore : int(r.config.daysBefore) }
        : Object.fromEntries(['minAdults', 'maxAdults', 'minChildren', 'maxChildren', 'childMaxAge'].map(k => [k, r.config?.[k] === undefined ? current.config[k] : int(r.config[k])])),
      tiers: current.kind !== 'group' ? [] : (r.tiers === undefined ? current.tiers : (Array.isArray(r.tiers) ? r.tiers.slice(0, 10).map(t => ({ minTickets: int(t.minTickets), percentBp: bp(t.percent) })) : [])),
    };
    const problem = ruleProblem(next);
    if (problem) return fail(problem);
    // One rule per kind, so two active rules of the same kind can never overlap.
    const dupe = (await loadRules(db)).find(x => x.kind === next.kind && x.id !== next.id && x.isActive);
    if (dupe && next.isActive) return fail(`Another ${next.kind} discount is already on.`);
    const stmts = [db.prepare(`UPDATE league_ticket_discount_rules SET name = ?, is_active = ?, percent_bp = ?, valid_from = ?, valid_until = ?, config_json = ?, max_discounted_tickets_per_match = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .bind(next.name, next.isActive ? 1 : 0, next.percentBp, next.validFrom, next.validUntil, JSON.stringify(next.config), next.maxPerMatch, staff.email, next.id)];
    if (next.kind === 'group') {
      stmts.push(db.prepare(`DELETE FROM league_ticket_group_tiers WHERE rule_id = ?`).bind(next.id));
      for (const t of next.tiers) stmts.push(db.prepare(`INSERT INTO league_ticket_group_tiers (rule_id, min_tickets, percent_bp) VALUES (?, ?, ?)`).bind(next.id, t.minTickets, t.percentBp));
    }
    await db.batch(stmts);
    const strip = ({ updatedAt, updatedBy, ...x }) => x;
    await logLeague(db, staff, next.isActive !== current.isActive ? (next.isActive ? 'tickets.discount.on' : 'tickets.discount.off') : 'tickets.discount.edit', 'ticket_discount', next.id, strip(current), strip(next));
    return ok({ rule: (await loadRules(db)).find(x => x.id === next.id) });
  } catch (err) {
    console.error('[discounts admin] save', err);
    return fail('Could not save.', 500);
  }
}

async function saveSettings(db, staff, s) {
  const before = await loadDiscountSettings(db);
  const next = { ...before };
  if (s.allowStacking !== undefined) next.allowStacking = !!s.allowStacking;
  if (s.maxTotalPercent !== undefined) { const v = bp(s.maxTotalPercent); if (!Number.isInteger(v) || v < 0 || v > 10000) return fail('The most discount in total is between 0 and 100%.'); next.maxTotalBp = v; }
  if (s.minTicketNaira !== undefined) { const v = Number(s.minTicketNaira); if (!Number.isInteger(v) || v < 0 || v > 1_000_000) return fail('The lowest ticket price is a whole number of naira.'); next.minTicketKobo = v * 100; }
  if (s.perEmailPerMatch !== undefined) { const v = Number(s.perEmailPerMatch); if (!Number.isInteger(v) || v < 0 || v > 20) return fail('Group or family orders per email per match: 0 (no limit) to 20.'); next.perEmailPerMatch = v; }
  const vals = { allowStacking: next.allowStacking ? '1' : '0', maxTotalBp: String(next.maxTotalBp), minTicketKobo: String(next.minTicketKobo), perEmailPerMatch: String(next.perEmailPerMatch) };
  await db.batch(Object.entries(vals).map(([k, v]) => db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(SETTING_KEYS[k], v, staff.email)));
  await logLeague(db, staff, 'tickets.discount.settings', 'ticket_discount', 'settings', before, next);
  return ok({ settings: next });
}
