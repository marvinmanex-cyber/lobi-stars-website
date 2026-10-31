// Media Centre: the every-minute job (run from /api/internal/newsletter-run).
//  - publishes approved items whose scheduled time has come;
//  - later phases add the newsletter reminders and expired accreditations.
import { publishDue } from './mediaApprovals.js';

export const TICKS = [];
export async function mediaCentreTick(env) {
  const out = { scheduled: await publishDue(env) };
  for (const t of TICKS) {
    try { Object.assign(out, await t(env)); } catch (e) { console.error('[media centre] tick', e); out[`error_${t.name}`] = String(e?.message || e).slice(0, 200); }
  }
  return out;
}
