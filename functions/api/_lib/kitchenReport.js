// MatchDay Kitchen: the match-day food report, emailed to management once after each home
// match (4 hours after kick-off, on the every-minute timer, or by hand). It has totals only:
// no customer names, phone numbers or emails. Figures come from matchReportData (kitchenData.js).
import { sendEmail } from './email.js';
import { matchReportData } from './kitchenData.js';
import { ensureKitchenSchema, kitchenSettings, mkLog } from './matchdayKitchen.js';
import { todaysHomeMatch } from './seasonTickets.js';
import { saveMatchDayReports } from './kitchenSalesReports.js';

const nowIso = () => new Date().toISOString();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normEmail = e => { const s = String(e || '').trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : ''; };
const lagosDayOf = iso => new Date(Date.parse(iso) + 3600e3).toISOString().slice(0, 10);
const sentKey = m => `report_sent_${m.id}`;
const DUE_MS = 4 * 3600e3;

async function getSetting(db, key) {
  return (await db.prepare(`SELECT value FROM mk_settings WHERE key = ?`).bind(key).first())?.value ?? null;
}
async function putSetting(db, key, value, by) {
  await db.prepare(`INSERT INTO mk_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(key, String(value), nowIso(), by || null).run();
}
/** Who gets the report: the saved list, or the Super Admins until one is saved. */
export async function reportEmails(env) {
  await ensureKitchenSchema(env.DB);
  const saved = (await getSetting(env.DB, 'report_emails') || '').split(',').filter(Boolean);
  if (saved.length) return saved;
  return [...new Set(String(env.SUPER_ADMIN_EMAILS || '').split(/[\s,;]+/).map(normEmail).filter(Boolean))];
}
export async function saveReportEmails(db, by, text) {
  await ensureKitchenSchema(db);
  const raw = String(Array.isArray(text) ? text.join(',') : text || '').split(/[\s,;]+/).filter(Boolean);
  const bad = raw.find(e => !normEmail(e));
  if (bad) return { error: `"${bad.slice(0, 60)}" is not an email address.` };
  const list = [...new Set(raw.map(normEmail))].slice(0, 20);
  if (!list.length) return { error: 'Add at least one email address.' };
  await putSetting(db, 'report_emails', list.join(','), by);
  return { ok: true, emails: list };
}

export function reportHtml(r, match) {
  const th = 'style="text-align:left;padding:6px 8px;border-bottom:2px solid #0E7A26;font-size:12px;text-transform:uppercase;color:#07471A"';
  const td = 'style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:14px"';
  const table = (head, rows) => rows.length ? `<table style="border-collapse:collapse;width:100%;margin:6px 0 18px"><tr>${head.map(h => `<th ${th}>${esc(h)}</th>`).join('')}</tr>${rows.map(row => `<tr>${row.map(c => `<td ${td}>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>` : '<p style="color:#6b7280;margin:4px 0 18px">None.</p>';
  const h = t => `<h2 style="font:700 18px Arial,sans-serif;color:#07471A;margin:22px 0 4px">${esc(t)}</h2>`;
  const big = (n, label, colour) => `<td style="padding:10px;text-align:center;border:1px solid #e5e7eb"><div style="font:700 28px Arial,sans-serif;color:${colour}">${esc(n)}</div><div style="font-size:12px;color:#6b7280">${esc(label)}</div></td>`;
  const when = match ? new Date(match.event_date).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : r.day;
  return `<div style="font-family:Arial,sans-serif;color:#111827;max-width:720px;margin:0 auto">
    <div style="background:#07471A;color:#fff;padding:18px 20px;border-bottom:4px solid #FFC72C"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#FFC72C">MatchDay Kitchen · Match-day food report</div>
    <div style="font:700 24px Arial,sans-serif;margin-top:4px">${esc(match ? `${match.home_team} vs ${match.away_team}` : `Food report ${r.day}`)}</div><div style="font-size:14px;opacity:.9">${esc(when)}</div></div>
    <table style="width:100%;border-collapse:separate;border-spacing:6px;margin:12px 0"><tr>${big(r.sales, 'food sales', '#0B7A2E')}${big(r.orders, 'paid orders', '#111827')}${big(r.average, 'average order', '#111827')}${big(r.late, 'late orders', '#C11A1F')}</tr></table>
    <p style="font-size:14px;margin:0 0 4px">${r.delivered} delivered${r.avgMinutes !== null ? `, on average in ${r.avgMinutes} minutes` : ''}. "Late" means delivered more than ${r.lateMinutes} minutes after payment (or after the kick-off or half-time it was ordered for). ${r.cancelled} cancelled or refunded. ${r.unpaid} placed but never paid.${r.notFinished ? ` <b>${r.notFinished} paid order${r.notFinished === 1 ? ' was' : 's were'} never marked delivered.</b>` : ''}</p>
    ${h('Top dishes')}${table(['Dish', 'Sold'], r.topDishes.map(d => [d.name, d.qty]))}
    ${h('Hour by hour')}${table(['Hour', 'Orders', 'Average minutes to deliver'], r.byHour.map(x => [`${String(x.hour).padStart(2, '0')}:00`, x.orders, x.avgMinutes ?? '–']))}
    ${r.slowestHour !== null ? `<p style="font-size:14px;margin:-8px 0 12px">Slowest hour: <b>${String(r.slowestHour).padStart(2, '0')}:00</b>. Busiest hour: <b>${String(r.busiestHour).padStart(2, '0')}:00</b>.</p>` : ''}
    ${h('By stand')}${table(['Stand or pickup point', 'Orders', 'Sales'], r.byStand.map(s => [s.name, s.orders, s.sales]))}
    ${h('How fans ordered')}${table(['Way', 'Orders', 'Sales'], r.byChannel.map(s => [s.name, s.orders, s.sales]))}
    <p style="font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:10px">Sent automatically by MatchDay Kitchen (lobistarsfc.com). It has no customer details.</p></div>`;
}

/** The day this report is for: today's home match, or today. */
export async function buildReport(env, match = undefined) {
  const db = env.DB;
  await ensureKitchenSchema(db);
  const m = match === undefined ? await todaysHomeMatch(db).catch(() => null) : match;
  const settings = await kitchenSettings(db);
  const data = await matchReportData(db, m ? lagosDayOf(m.event_date) : '', settings.lateMinutes);
  return { data, match: m, html: reportHtml(data, m) };
}
export async function sendReport(env, { match = undefined, by = 'Automatic', actor = null, request = null } = {}) {
  const db = env.DB;
  const { data, match: m, html } = await buildReport(env, match);
  const to = await reportEmails(env);
  if (!to.length) return { error: 'Nobody to send it to: add the email addresses first.' };
  if (!env.RESEND_API_KEY) return { error: 'Email is not set up on this website yet, so the report could not be sent.' };
  await sendEmail(env, { to, subject: `Match-day food report: ${m ? `${m.home_team} vs ${m.away_team}` : data.day} (${data.sales}, ${data.orders} orders)`, html });
  if (m) await putSetting(db, sentKey(m), nowIso(), by);
  await mkLog(db, actor || { kind: 'system', name: by, code: '' }, 'Sent the match-day food report', { kind: 'settings', details: to.join(', '), request });
  return { ok: true, to };
}
/** Every minute (timer): once, 4 hours after kick-off of today's home match. */
export async function kitchenReportTick(env) {
  const db = env.DB;
  const match = await todaysHomeMatch(db).catch(() => null);
  if (!match) return { idle: 'no home match today' };
  if (Date.now() < Date.parse(match.event_date) + DUE_MS) return { idle: 'not yet' };
  await ensureKitchenSchema(db);
  // The saved sales report for this match day (once), whether or not the email below can go.
  const savedKey = `sales_report_saved_${match.id}`;
  if (!(await getSetting(db, savedKey))) {
    try {
      const saved = await saveMatchDayReports(db, lagosDayOf(match.event_date));
      await putSetting(db, savedKey, `${nowIso()} ${saved.join(',')}`, 'Automatic');
    } catch (e) { console.error('[kitchen sales report]', e); } // tries again next minute; the email still goes
  }
  if (await getSetting(db, sentKey(match))) return { idle: 'sent' };
  const { data } = await buildReport(env, match);
  if (!data.orders && !data.unpaid) { await putSetting(db, sentKey(match), `${nowIso()} no orders`, 'Automatic'); return { idle: 'no orders' }; }
  return sendReport(env, { match });
}
