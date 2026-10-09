// Optional matchday reminder emails (home games only), sent once per match:
//   predictions_open -- when the Predict & Win window opens (24h before kick-off)
//   kickoff          -- when staff press Start Match (MOTM voting opens)
// Only fans with a confirmed email who said yes to news and offers, and who
// haven't unsubscribed, receive them. Each email has an unsubscribe link.
//
// Pages Functions have no scheduler, so "predictions_open" is triggered the
// first time anyone loads match data after the window opens (the homepage
// and fixtures pages do this). A table row per match+kind makes sure each
// reminder only ever goes out once.
import { isHomeGame } from './matchCentre.js';
import { matchSlug } from './matchSlug.js';
import { ensureFanSchema, matchdayReminderEmail } from './fans.js';
import { ensureContactsSchema, unsubscribeUrl } from './contacts.js';
import { predictionWindow } from './predict.js';

const SITE = 'https://lobistarsfc.com';

let ready = false;
// Reminders already claimed by this worker, so busy pages don't write to the database on every request.
const claimed = new Set();
async function ensureNotifySchema(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS matchday_notifications (
    event_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    status TEXT NOT NULL,           -- sending / sent / dev / no-email-service / failed
    recipients INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, kind)
  )`).run();
  ready = true;
}

/** Fans who should get marketing reminders, with their unsubscribe links. */
async function recipients(db) {
  await ensureFanSchema(db);
  await ensureContactsSchema(db);
  const { results } = await db.prepare(
    `SELECT m.first_name, m.email, c.unsub_token
     FROM members m JOIN contacts c ON c.email = LOWER(m.email)
     WHERE m.email_verified = 1 AND m.marketing_opt_in = 1 AND c.marketing_consent = 1 AND c.unsub_token IS NOT NULL`
  ).all();
  return results;
}

/** Sends one reminder for one match, at most once. Never throws. */
export async function notifyFans(env, event, kind) {
  try {
    if (!isHomeGame(event) || claimed.has(`${event.id}:${kind}`)) return null;
    claimed.add(`${event.id}:${kind}`);
    const db = env.DB;
    await ensureNotifySchema(db);
    // Claim this match+kind first, so two requests can't both send it.
    const claim = await db.prepare(`INSERT OR IGNORE INTO matchday_notifications (event_id, kind, status) VALUES (?, ?, 'sending')`).bind(event.id, kind).run();
    if (!claim.meta?.changes) return null;

    const list = await recipients(db);
    const finish = (status, n) => db.prepare(`UPDATE matchday_notifications SET status = ?, recipients = ? WHERE event_id = ? AND kind = ?`).bind(status, n, event.id, kind).run();
    if (!env.RESEND_API_KEY) {
      // Local testing records who would have been emailed; production without an email service sends nothing.
      await finish(String(env.FANS_DEV_LINKS) === '1' ? 'dev' : 'no-email-service', list.length);
      return { status: 'skipped', recipients: list.length };
    }
    const url = `${SITE}/matches/${matchSlug(event)}/live/#${kind === 'kickoff' ? 'vote' : 'predict'}`;
    const from = env.FAN_EMAIL_FROM || env.RESEND_FROM || 'Lobi Stars FC <tickets@lobistarsfc.com>';
    let sent = 0;
    for (let i = 0; i < list.length; i += 100) {
      const batch = list.slice(i, i + 100).map(f => {
        const { subject, html } = matchdayReminderEmail({ firstName: f.first_name, kind, match: event, url, unsubUrl: unsubscribeUrl({ unsub_token: f.unsub_token }) });
        return { from, to: f.email, subject, html };
      });
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(batch),
      });
      if (res.ok) sent += batch.length; else console.error('[notify] batch failed', res.status, await res.text());
    }
    await finish(sent === list.length ? 'sent' : 'failed', sent);
    return { status: 'sent', recipients: sent };
  } catch (err) {
    console.error('[notify] failed', err);
    return null;
  }
}

/** For every home game whose prediction window is open now, send "Predictions are now open" once. */
export async function notifyOpenPredictions(env, rows, now = Date.now()) {
  for (const r of rows) {
    if (!isHomeGame(r) || (r.status && r.status !== 'scheduled')) continue;
    const { opensAt, closesAt } = predictionWindow(r);
    if (now >= opensAt && now < closesAt) await notifyFans(env, r, 'predictions_open');
  }
}
