import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { isSeoAdmin, ensureSeoSchema, getSeoSettings, setSeoSetting, SETTING_DEFAULTS, listKeywords, saveKeyword, deleteKeyword, listCompetitors, saveCompetitor, deleteCompetitor, parse } from '../_lib/seoStore.js';
import { connections } from '../_lib/seoGoogle.js';
import { startScan, stepScan, progressOf } from '../_lib/seoRun.js';
import { reportData, rankTable, issueList, scoreTrend } from '../_lib/seoReport.js';
import { opportunities } from '../_lib/seoAnalyse.js';
import { CATEGORIES, SEVERITY_LABEL, ISSUES, info, autoAllowed } from '../_lib/seoChecks.js';
import { guideFor, vscodeInstruction } from '../_lib/seoGuides.js';
import { prepareFix, applyFix, cancelFix, undoFix, fixRow, fixHistory, seoSpend, sendToDeveloper, listRules, saveRule, ignoreIssue, RULE_SCOPES } from '../_lib/seoFix.js';
import { rowOf } from '../_lib/seoReport.js';

// SEO Scanner (only the Super Admins: checked here on every request, and by the
// route rules). Secrets are never sent: connections show only "connected" and
// the service account's email address.
// GET  /api/admin/seo                     -- dashboard: score, trend, rankings, top 5, issues, scan in progress, alerts, AI use
// GET  /api/admin/seo?view=settings       -- connections (with what is missing), keywords, competitors, settings, rules
// GET  /api/admin/seo?view=page&path=/x/  -- one page: its issues, facts, speed, keyword positions, fixes
// GET  /api/admin/seo?view=history        -- fixes with Google figures before and after
// GET  /api/admin/seo?view=issue&id=      -- one issue with its guide, VS Code instruction and fixes
// GET  /api/admin/seo?view=ranks&device=  -- the rankings table for a device
// GET  /api/admin/seo?scan=<id>           -- progress of a scan
// POST { action: 'scan', kind: 'full'|'quick', paths?, speed? }   -- "Scan now" / "Check again"
// POST { action: 'step', id }                                     -- the next step (the page calls until done)
// POST { action: 'prepare', issueId, note? }                      -- AI Fix: preview (nothing changes)
// POST { action: 'apply', fixId, edited? }                        -- Approve (with the Super Admin's edits)
// POST { action: 'cancel', fixId } | { action: 'undo', fixId }
// POST { action: 'ignore', issueId, reason } | { action: 'unignore', issueId }
// POST { action: 'developer', issueId }                           -- "Send to developer" (email)
// POST { action: 'rule', type, mode, scope, daily_max, notify }   -- automation rule (wizard)
// POST { action: 'keyword', id?, keyword, target_path, priority, confirmed } | { action: 'keyword_delete', id } | { action: 'keywords_confirm' }
// POST { action: 'competitor', domain, note } | { action: 'competitor_delete', domain }
// POST { action: 'settings', values }                             -- scan hour, alert emails, developer email, AI limits, rank tracker
// POST { action: 'report' }                                       -- records a PDF download in the Activity Log
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });

async function guard(request, env) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return { denied };
  if (!isSeoAdmin(admin) || !admin.permissions?.includes('seo.scanner')) return { denied: json({ error: 'Only the Super Admins can use the SEO Scanner.' }, 403) };
  await ensureSeoSchema(env.DB);
  return { admin };
}
const cleanPath = p => { try { const u = new URL(String(p || ''), 'https://lobistarsfc.com'); return u.pathname; } catch { return null; } };

export async function onRequestGet({ request, env }) {
  const { denied } = await guard(request, env);
  if (denied) return denied;
  const db = env.DB, u = new URL(request.url), view = u.searchParams.get('view');
  if (u.searchParams.get('scan')) {
    const r = await db.prepare(`SELECT * FROM seo_scans WHERE id = ?`).bind(u.searchParams.get('scan')).first();
    return r ? json({ scan: progressOf(r) }) : json({ error: 'Not found' }, 404);
  }
  if (view === 'settings') {
    const s = await getSeoSettings(db);
    const settings = Object.fromEntries(Object.keys(SETTING_DEFAULTS).map(k => [k, s[k]]));
    const rules = await listRules(db);
    const types = Object.entries(ISSUES).filter(([, i]) => i.ai && i.ai !== 'vscode').map(([type, i]) => ({ type, name: i.name, category: i.category, severity: i.severity, autoAllowed: autoAllowed(type), rule: rules.find(r => r.type === type) || null }));
    return json({ connections: await connections(env), keywords: await listKeywords(db), competitors: await listCompetitors(db), settings, rules, types, scopes: RULE_SCOPES, usage: await seoSpend(db) });
  }
  if (view === 'ranks') return json(await rankTable(env, u.searchParams.get('device') || 'all'));
  if (view === 'history') return json({ fixes: await fixHistory(env) });
  if (view === 'issue') {
    const r = await db.prepare(`SELECT * FROM seo_issues WHERE id = ?`).bind(u.searchParams.get('id') || '').first();
    if (!r) return json({ error: 'Not found' }, 404);
    const issue = rowOf(r);
    const fixes = (await db.prepare(`SELECT id FROM seo_fixes WHERE issue_id = ? ORDER BY created_at DESC LIMIT 5`).bind(issue.id).all()).results;
    return json({ issue, guide: guideFor(issue.type), vscode: issue.actions.code ? vscodeInstruction(issue) : null, fixes: await Promise.all(fixes.map(f => fixRow(db, f.id))) });
  }
  if (view === 'page') {
    const path = cleanPath(u.searchParams.get('path'));
    if (!path) return json({ error: 'Bad address' }, 400);
    const p = await db.prepare(`SELECT * FROM seo_pages WHERE path = ?`).bind(path).first();
    const issues = (await db.prepare(`SELECT * FROM seo_issues WHERE path = ? AND status IN ('open', 'ignored')`).bind(path).all()).results.map(rowOf);
    const speed = (await db.prepare(`SELECT * FROM seo_speed WHERE path = ? ORDER BY date DESC LIMIT 6`).bind(path).all()).results;
    const ranks = (await rankTable(env)).rows.filter(r => r.target === path || r.page === path);
    const gsc = await db.prepare(`SELECT SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS pw FROM gsc_daily WHERE dim = 'page' AND (value = ? OR value = ?) AND date >= ?`)
      .bind(`https://lobistarsfc.com${path}`, path, new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)).first().catch(() => null);
    const fixes = (await db.prepare(`SELECT id FROM seo_fixes WHERE path = ? ORDER BY created_at DESC LIMIT 10`).bind(path).all()).results;
    const d = p ? parse(p.data, {}) : null;
    if (d) { delete d.fp; delete d.textSample; }
    return json({ path, page: p ? { status: p.status, scannedAt: p.scanned_at, inSitemap: !!p.in_sitemap, lastmod: p.lastmod, data: d } : null, issues, speed, ranks,
      google: gsc?.impressions ? { clicks: gsc.clicks, impressions: gsc.impressions, ctr: gsc.clicks / gsc.impressions, position: gsc.pw / gsc.impressions } : null, fixes: await Promise.all(fixes.map(f => fixRow(db, f.id))) });
  }
  // The dashboard.
  const [rep, issues, ignored, running, waiting, alerts, lastScan] = [
    await reportData(env), await issueList(db), await issueList(db, { status: 'ignored' }),
    await db.prepare(`SELECT * FROM seo_scans WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1`).first(),
    (await db.prepare(`SELECT id FROM seo_fixes WHERE status = 'proposed' ORDER BY created_at DESC LIMIT 20`).all()).results,
    (await db.prepare(`SELECT * FROM seo_alerts ORDER BY id DESC LIMIT 10`).all()).results,
    await db.prepare(`SELECT * FROM seo_scans WHERE finished_at IS NOT NULL AND (summary IS NULL OR summary NOT LIKE '%abandoned%') ORDER BY finished_at DESC LIMIT 1`).first(),
  ];
  const fixesFor = new Map();
  for (const r of (await db.prepare(`SELECT issue_id, id, status, applied_at FROM seo_fixes WHERE status IN ('proposed', 'applied') AND created_at >= ? ORDER BY created_at DESC`).bind(new Date(Date.now() - 14 * 864e5).toISOString()).all()).results) if (!fixesFor.has(r.issue_id)) fixesFor.set(r.issue_id, r);
  return json({
    ...rep, top: opportunities(issues, 5), issues: issues.map(i => ({ ...i, fix: fixesFor.get(i.id) || null })), ignored,
    categories: CATEGORIES, severities: SEVERITY_LABEL, running: running ? progressOf(running) : null, lastScan: lastScan ? progressOf(lastScan) : null,
    waiting: await Promise.all(waiting.map(w => fixRow(db, w.id))), alerts, usage: await seoSpend(db), connections: await connections(env),
  });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await guard(request, env);
  if (denied) return denied;
  const db = env.DB, b = await request.json().catch(() => ({})), origin = new URL(request.url).origin;
  const out = r => json(r, r.error ? r.status || 400 : 200);
  switch (b.action) {
    case 'scan': {
      const kind = b.kind === 'quick' ? 'quick' : 'full';
      const r = await startScan(env, { kind, trigger: 'manual', by: admin.name, paths: Array.isArray(b.paths) ? b.paths.map(cleanPath) : [], speed: b.speed === true ? true : null });
      if (!r.error && !r.already) await logAdminAction(db, admin, 'seo_scan', kind === 'full' ? 'SEO Scanner: full scan started' : `SEO Scanner: checked again (${(b.paths || []).slice(0, 3).join(', ')})`);
      return out(r);
    }
    case 'step': return out(await stepScan(env, origin, String(b.id || '')));
    case 'prepare': return out(await prepareFix(env, admin, String(b.issueId || ''), { note: b.note ? String(b.note).slice(0, 300) : '' }));
    case 'apply': return out(await applyFix(env, admin, String(b.fixId || ''), { edited: b.edited || null }));
    case 'cancel': return out(await cancelFix(env, admin, String(b.fixId || '')));
    case 'undo': return out(await undoFix(env, admin, String(b.fixId || '')));
    case 'ignore': return out(await ignoreIssue(db, admin, String(b.issueId || ''), b.reason));
    case 'unignore': return out(await ignoreIssue(db, admin, String(b.issueId || ''), '', true));
    case 'developer': return out(await sendToDeveloper(env, admin, String(b.issueId || '')));
    case 'rule': return out(await saveRule(db, admin, b));
    case 'keyword': return out(await saveKeyword(db, admin, b));
    case 'keyword_delete': return out(await deleteKeyword(db, admin, b.id));
    case 'keywords_confirm': {
      await db.prepare(`UPDATE seo_keywords SET confirmed = 1`).run();
      await logAdminAction(db, admin, 'seo_keyword', 'SEO Scanner: confirmed the whole target keyword list');
      return json({ ok: true });
    }
    case 'competitor': return out(await saveCompetitor(db, admin, b));
    case 'competitor_delete': return out(await deleteCompetitor(db, admin, String(b.domain || '')));
    case 'settings': {
      const v = b.values || {}, changed = [];
      const emails = s => String(s || '').split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
      const okEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
      if ('scan_hour' in v) { const h = Math.round(Number(v.scan_hour)); if (!(h >= 0 && h <= 23)) return json({ error: 'Choose an hour between 0 and 23.' }, 400); await setSeoSetting(db, 'scan_hour', h, admin.name); changed.push(`scan at ${h}:00`); }
      for (const k of ['ai_daily_limit_usd', 'ai_monthly_limit_usd']) if (k in v) { const n = Number(v[k]); if (!(n >= 0 && n <= 200)) return json({ error: 'AI limits are between $0 and $200.' }, 400); await setSeoSetting(db, k, n, admin.name); changed.push(`${k === 'ai_daily_limit_usd' ? 'daily' : 'monthly'} AI limit $${n}`); }
      if ('alert_emails' in v) { const list = emails(v.alert_emails); if (list.some(e => !okEmail(e))) return json({ error: 'One of the alert email addresses is not valid.' }, 400); await setSeoSetting(db, 'alert_emails', list.join(', '), admin.name); changed.push('alert emails'); }
      if ('developer_email' in v) { const e = String(v.developer_email || '').trim().toLowerCase(); if (e && !okEmail(e)) return json({ error: 'The developer email address is not valid.' }, 400); await setSeoSetting(db, 'developer_email', e, admin.name); changed.push('developer email'); }
      if ('weekly_report' in v) { await setSeoSetting(db, 'weekly_report', v.weekly_report ? '1' : '0', admin.name); changed.push(`weekly report ${v.weekly_report ? 'on' : 'off'}`); }
      if ('rank_provider' in v) { if (!['off', 'serpapi', 'dataforseo'].includes(v.rank_provider)) return json({ error: 'Unknown rank tracker.' }, 400); await setSeoSetting(db, 'rank_provider', v.rank_provider, admin.name); changed.push(`rank tracker ${v.rank_provider}`); }
      if (changed.length) await logAdminAction(db, admin, 'seo_settings', `SEO Scanner settings: ${changed.join(', ')}`);
      return json({ ok: true });
    }
    case 'report': await logAdminAction(db, admin, 'seo_report', 'SEO Scanner report downloaded (PDF)'); return json({ ok: true });
    default: return json({ error: 'Unknown action' }, 400);
  }
}
export { info, scoreTrend };
