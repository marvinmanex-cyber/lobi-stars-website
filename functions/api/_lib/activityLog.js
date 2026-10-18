// The Activity Log: who did what, when and from where (the device and rough
// location come from the person's sign-in). Entries can't be changed or
// deleted (database triggers), and are kept for at least 12 months.
// Some entries are also security alerts: they go to the Super Admins by email
// (sent by the every-minute security job) and appear in the admin bell.

/** The groups shown as filters on the Activity Log. */
export const CATEGORIES = {
  security: 'Sign-ins and security', staff: 'Staff and roles', approvals: 'Approvals', exports: 'Downloads and backups',
  matchday: 'Matchday and league', commerce: 'Tickets, food, shop and Rewards', fans: 'Fans, Inbox and newsletter', partners: 'Partners', settings: 'Settings', other: 'Other',
};
export function categoryOf(action) {
  const a = String(action || '');
  if (/^(login|logout|account_|owner_code|backup_code|sessions_revoked|password_|invite_accepted|helper_login|gmail_notice|security_settings|service_key|login_)/.test(a)) return 'security';
  if (/^(staff_|role_|super_admin|helper_|access_review)/.test(a)) return 'staff';
  if (/^approval/.test(a)) return 'approvals';
  if (/^(export_|backup_download)/.test(a)) return 'exports';
  if (/^(match_|prediction|prize_|motm|league\.|fan_alert|commentary|programme_|share_|qr_)/.test(a)) return 'matchday';
  if (/^(food_|kitchen_|shirt_|season_|ticket|tickets\.|rewards\.|order)/.test(a)) return 'commerce';
  if (/^partner|^newsletter_sponsor/.test(a)) return 'partners';
  if (/^(inbox_|membership_|member_|fan_|newsletter_|contact_source)/.test(a)) return 'fans';
  if (/_settings$|^health_check/.test(a)) return 'settings';
  return 'other';
}

// Downloads that contain fans' personal data.
const FAN_EXPORTS = /^(export_(xlsx|filtered_xlsx|marketing_xlsx|sources_csv|food_customers|food_orders|predictions_csv|motm_csv|rewards_xlsx)|backup_download)$/;

let ready = false;
export async function ensureActivitySchema(db) {
  if (ready) return;
  const cols = new Set((await db.prepare(`PRAGMA table_info(admin_log)`).all()).results.map(r => r.name));
  for (const [name, type] of [['session_id', 'TEXT'], ['category', 'TEXT']]) {
    if (!cols.has(name)) {
      try { await db.prepare(`ALTER TABLE admin_log ADD COLUMN ${name} ${type}`).run(); }
      catch (err) { if (!/duplicate column/i.test(String(err))) throw err; }
    }
  }
  await db.batch([
    db.prepare(`CREATE INDEX IF NOT EXISTS admin_log_ts ON admin_log (ts)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS admin_log_staff ON admin_log (staff_id, ts)`),
    // Append-only: nobody can change an entry, or delete one younger than 13 months.
    db.prepare(`CREATE TRIGGER IF NOT EXISTS admin_log_no_update BEFORE UPDATE ON admin_log BEGIN SELECT RAISE(ABORT, 'The Activity Log cannot be changed'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS admin_log_no_delete BEFORE DELETE ON admin_log WHEN old.ts > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-400 days') BEGIN SELECT RAISE(ABORT, 'Activity Log entries are kept for at least 12 months'); END`),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT, email_pending INTEGER NOT NULL DEFAULT 1
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS admin_alerts_ts ON admin_alerts (ts)`),
  ]);
  ready = true;
}

/**
 * Is this log entry a security alert? Returns { kind, title, email } or null.
 * email = false when the Super Admins are already emailed directly elsewhere.
 */
function alertFor(action, detail, admin) {
  if (FAN_EXPORTS.test(action)) return { kind: 'export', title: `Fan data downloaded by ${admin.name}`, email: true };
  if (action === 'role_changed') return { kind: 'permissions', title: `Role permissions changed by ${admin.name}`, email: true };
  if (action === 'role_assigned') return { kind: 'role', title: `Role changed by ${admin.name}`, email: false };
  if (action === 'owner_code_login' || action === 'owner_code_refused') return { kind: 'emergency', title: action === 'owner_code_login' ? 'The emergency admin code was used' : 'Someone tried the old admin code', email: false };
  if (action === 'account_locked') return { kind: 'lockout', title: `${admin.name}'s account was locked`, email: false };
  if (action === 'staff_updated' && /two-step login reset/.test(detail)) return { kind: '2fa_reset', title: 'Two-step login reset', email: false };
  if (action === 'login' && /new device/.test(detail) && ['super_admin', 'crm_manager'].includes(admin.role)) return { kind: 'new_device', title: `${admin.name} signed in from a new device`, email: false };
  if (action === 'service_key_changed') return { kind: 'keys', title: 'A payment or email key was changed', email: false };
  if (action === 'super_admin_list_changed') return { kind: 'super_admins', title: 'The Super Admin list was changed', email: false };
  return null;
}

/** Writes one entry (and its alert, if it is one). */
export async function writeLog(db, admin, action, detail = '') {
  await ensureActivitySchema(db);
  const text = String(detail).slice(0, 500);
  await db.prepare(`INSERT INTO admin_log (staff_id, staff_name, action, detail, session_id, category) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(admin.id, admin.name, action, text, admin.sessionId || null, categoryOf(action)).run();
  const alert = alertFor(action, text, admin);
  if (alert) await db.prepare(`INSERT INTO admin_alerts (kind, title, detail, email_pending) VALUES (?, ?, ?, ?)`).bind(alert.kind, alert.title, text, alert.email ? 1 : 0).run();
  // More than 10 failed sign-ins on the whole site in 10 minutes (alerted at most once an hour).
  if (action === 'login_failed') {
    const n = (await db.prepare(`SELECT COUNT(*) AS n FROM admin_log WHERE action = 'login_failed' AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')`).first()).n;
    if (n > 10 && !(await db.prepare(`SELECT 1 FROM admin_alerts WHERE kind = 'failed_burst' AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 minutes')`).first())) {
      await db.prepare(`INSERT INTO admin_alerts (kind, title, detail) VALUES ('failed_burst', ?, ?)`).bind(`${n} failed sign-ins in 10 minutes`, 'Someone may be guessing passwords. Check Settings › Login & Security › Recent security events.').run();
    }
  }
}

/** Alerts from the last day (the admin bell, for Super Admins). */
export async function recentAlerts(db, hours = 24) {
  await ensureActivitySchema(db);
  return (await db.prepare(`SELECT id, ts, kind, title, detail FROM admin_alerts WHERE ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) ORDER BY id DESC LIMIT 20`).bind(`-${hours} hours`).all()).results;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Emails the Super Admins the alerts waiting (called every minute by the security job). */
export async function deliverAlerts(env, origin, to, send) {
  const db = env.DB;
  await ensureActivitySchema(db);
  const { results } = await db.prepare(`SELECT id, ts, kind, title, detail FROM admin_alerts WHERE email_pending = 1 ORDER BY id LIMIT 20`).all();
  if (!results.length) return 0;
  // Mark them first (alerts are separate from the log, so they can be marked), then send one email.
  await db.prepare(`UPDATE admin_alerts SET email_pending = 0 WHERE id IN (${results.map(() => '?').join(',')})`).bind(...results.map(r => r.id)).run();
  if (!to.length) return 0;
  const lines = results.map(r => `<strong>${esc(r.title)}</strong><br><span style="color:#5b6470">${esc(new Date(r.ts).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}: ${esc(r.detail)}</span>`);
  await send(to, results.length === 1 ? `Lobi Stars admin alert: ${results[0].title}` : `Lobi Stars admin: ${results.length} security alerts`, [...lines, `<a href="${origin}/admin/activity/">Open the Activity Log</a>`]);
  return results.length;
}

/** The weekly security summary (Mondays from 08:00 Nigeria time, once a week). */
export async function weeklySummary(db) {
  await ensureActivitySchema(db);
  const since = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')`;
  const q = async sql => (await db.prepare(sql).all()).results;
  const logins = await q(`SELECT staff_name, COUNT(*) AS n FROM admin_log WHERE action IN ('login', 'owner_code_login', 'helper_login') AND ts >= ${since} GROUP BY staff_name ORDER BY n DESC`);
  const count = async where => (await db.prepare(`SELECT COUNT(*) AS n FROM admin_log WHERE ${where} AND ts >= ${since}`).first()).n || 0;
  return {
    logins,
    exports: await q(`SELECT ts, staff_name, action, detail FROM admin_log WHERE (action LIKE 'export_%' OR action = 'backup_download') AND ts >= ${since} ORDER BY id DESC LIMIT 30`),
    approvals: await count(`action IN ('approval_approved', 'approval_rejected')`),
    approvalRequests: await count(`action = 'approval_requested'`),
    lockouts: await count(`action = 'account_locked'`),
    failed: await count(`action = 'login_failed'`),
    emergency: await count(`action IN ('owner_code_login', 'owner_code_refused')`),
    newDevices: await count(`action = 'login' AND detail LIKE '%new device%'`),
    roleChanges: await count(`action IN ('role_assigned', 'role_changed')`),
    alerts: await q(`SELECT ts, title FROM admin_alerts WHERE ts >= ${since} ORDER BY id DESC LIMIT 20`),
  };
}
export function weeklySummaryHtml(w, origin) {
  const row = (label, n, warn) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${label}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:700;color:${warn && n ? '#A3161B' : '#14171c'}">${n}</td></tr>`;
  const unusual = [];
  if (w.emergency) unusual.push(`The emergency admin code was used or tried ${w.emergency} time(s).`);
  if (w.lockouts) unusual.push(`${w.lockouts} account lockout(s) after wrong attempts.`);
  if (w.failed > 20) unusual.push(`${w.failed} failed sign-ins (more than usual).`);
  return [
    'Here is the last 7 days on the Lobi Stars admin.',
    `<table style="border-collapse:collapse;font-size:14px">${row('Sign-ins', w.logins.reduce((a, b) => a + b.n, 0))}${row('Fan data downloads and backups', w.exports.length)}${row('Approval requests / decisions', `${w.approvalRequests} / ${w.approvals}`)}${row('Role changes', w.roleChanges)}${row('Sign-ins from new devices', w.newDevices)}${row('Failed sign-ins', w.failed, w.failed > 20)}${row('Lockouts', w.lockouts, true)}${row('Emergency code used or tried', w.emergency, true)}</table>`,
    w.logins.length ? `<strong>Sign-ins per person:</strong><br>${w.logins.map(l => `${esc(l.staff_name)}: ${l.n}`).join('<br>')}` : 'Nobody signed in.',
    w.exports.length ? `<strong>Downloads:</strong><br>${w.exports.map(e => `${esc(new Date(e.ts).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short' }))} · ${esc(e.staff_name)} · ${esc(e.detail)}`).join('<br>')}` : '',
    unusual.length ? `<strong style="color:#A3161B">Worth a look:</strong><br>${unusual.map(esc).join('<br>')}` : 'Nothing unusual.',
    `<a href="${origin}/admin/activity/">Open the Activity Log</a>`,
  ].filter(Boolean);
}
