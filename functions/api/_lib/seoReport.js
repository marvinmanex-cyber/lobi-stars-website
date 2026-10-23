// SEO Scanner: the figures for the dashboard, the weekly email report and the
// PDF. Reads only small, indexed tables (scores per scan, keyword positions,
// open issues, recent fixes) so the dashboard stays cheap to open.
import { ensureSeoSchema, getSeoSettings, listKeywords, parse } from './seoStore.js';
import { info, SEVERITY_LABEL, CATEGORIES, actionsFor } from './seoChecks.js';
import { opportunities } from './seoAnalyse.js';
import { connections } from './seoGoogle.js';
import { escapeHtml } from './seoRun.js';

const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/** Keyword table: position now, a week ago, the page Google shows, clicks; 28 days of positions for the sparkline. */
export async function rankTable(env, device = 'all') {
  const db = env.DB;
  const s = await getSeoSettings(db);
  const conn = await connections(env);
  const source = conn.rank.connected ? s.rank_provider : 'gsc';
  const dev = source === 'gsc' ? (['all', 'mobile', 'desktop', 'tablet'].includes(device) ? device : 'all') : (device === 'desktop' ? 'desktop' : 'mobile');
  const rows = (await db.prepare(`SELECT date, keyword, page, position, clicks, impressions FROM seo_ranks WHERE source = ? AND device = ? AND date >= ? ORDER BY date`).bind(source, dev, day(35)).all()).results;
  const by = new Map();
  for (const r of rows) (by.get(r.keyword) || by.set(r.keyword, []).get(r.keyword)).push(r);
  const kws = await listKeywords(db);
  const avg = a => a.length ? a.reduce((x, r) => x + r.position, 0) / a.length : null;
  return {
    source, device: dev,
    label: source === 'gsc' ? 'Google Search Console average position (the average place our page appeared in Google for that search; not a live rank check)' : `Rank tracker (${source === 'serpapi' ? 'SerpApi' : 'DataForSEO'}), Nigeria, English, ${dev}`,
    rows: kws.map(k => {
      const r = (by.get(k.keyword) || []).filter(x => x.position);
      const last = r.slice(-3), prev = r.slice(-10, -7);
      const now = avg(last), before = avg(prev);
      return { id: k.id, keyword: k.keyword, target: k.target_path, priority: k.priority, confirmed: !!k.confirmed,
        position: now === null ? null : Math.round(now * 10) / 10, change: now !== null && before !== null ? Math.round((before - now) * 10) / 10 : null,
        page: r.length ? r[r.length - 1].page : null, clicks: r.slice(-28).reduce((x, y) => x + (y.clicks || 0), 0), impressions: r.slice(-28).reduce((x, y) => x + (y.impressions || 0), 0),
        spark: r.slice(-28).map(x => Math.round(x.position * 10) / 10) };
    }),
  };
}

export async function scoreTrend(db) {
  const rows = (await db.prepare(`SELECT started_at, finished_at, score, counts FROM seo_scans WHERE kind = 'full' AND finished_at IS NOT NULL AND score IS NOT NULL AND started_at >= ? ORDER BY started_at`).bind(day(90)).all()).results;
  return rows.map(r => ({ day: r.started_at.slice(0, 10), score: r.score }));
}

const rowOf = r => {
  const d = parse(r.detail, {});
  const i = info(r.type);
  return { id: r.id, type: r.type, name: i.name, category: r.category, severity: r.severity, severityLabel: SEVERITY_LABEL[r.severity], path: r.path, impact: r.impact, status: r.status,
    urls: d.urls || [], problem: d.problem || i.name, why: i.why, data: d.data || null, firstSeen: r.first_seen, lastSeen: r.last_seen, fixedAt: r.fixed_at, ignoredReason: r.ignored_reason, ignoredBy: r.ignored_by, actions: actionsFor(r.type) };
};
export async function issueList(db, { status = 'open' } = {}) {
  const rows = (await db.prepare(`SELECT * FROM seo_issues WHERE status ${status === 'all' ? "IN ('open', 'ignored')" : '= ?'} ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, impact DESC LIMIT 600`)
    .bind(...(status === 'all' ? [] : [status])).all()).results;
  return rows.map(rowOf);
}
export { rowOf };

/** Everything the weekly report needs. */
export async function reportData(env) {
  const db = env.DB;
  await ensureSeoSchema(db);
  const trend = await scoreTrend(db);
  const latest = trend[trend.length - 1] || null, weekAgo = [...trend].reverse().find(t => t.day <= day(7)) || null;
  const issues = await issueList(db);
  const fixes = (await db.prepare(`SELECT id, type, path, status, auto, applied_at, note FROM seo_fixes WHERE applied_at >= ? ORDER BY applied_at DESC LIMIT 30`).bind(day(7)).all()).results;
  const fixedIssues = (await db.prepare(`SELECT COUNT(*) AS n FROM seo_issues WHERE status = 'fixed' AND fixed_at >= ?`).bind(day(7)).first()).n || 0;
  const ranks = await rankTable(env);
  return {
    score: latest?.score ?? null, change: latest && weekAgo ? latest.score - weekAgo.score : null, trend,
    counts: Object.fromEntries(['critical', 'high', 'medium', 'low'].map(s => [s, issues.filter(i => i.severity === s).length])),
    byCategory: CATEGORIES.map(c => ({ ...c, open: issues.filter(i => i.category === c.key).length })),
    top: opportunities(issues, 5), fixes, fixedIssues, ranks,
    newThisWeek: issues.filter(i => i.firstSeen >= day(7)).length,
  };
}

export function reportHtml(d) {
  const cell = 'padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left;font-size:13px';
  const rk = d.ranks.rows.filter(r => r.position !== null).slice(0, 12);
  return `<div style="font-family:Arial,sans-serif;max-width:640px;color:#0f172a">
  <h2 style="color:#1C3F7A;margin:0 0 4px">SEO weekly report</h2>
  <p style="margin:0 0 14px;color:#475569">Lobi Stars FC website · week to ${new Date().toISOString().slice(0, 10)}</p>
  <p style="font-size:28px;font-weight:bold;margin:0;color:${(d.score ?? 0) >= 80 ? '#15803d' : (d.score ?? 0) >= 60 ? '#b45309' : '#C8102E'}">${d.score ?? '–'}/100 <span style="font-size:15px;color:#475569">${d.change === null ? '' : `${d.change > 0 ? '▲ +' : d.change < 0 ? '▼ ' : '± '}${d.change} since last week`}</span></p>
  <p>Open issues: <b>${d.counts.critical}</b> critical, <b>${d.counts.high}</b> high, <b>${d.counts.medium}</b> medium, <b>${d.counts.low}</b> low. ${d.newThisWeek} new this week; ${d.fixedIssues} fixed this week.</p>
  <h3 style="color:#1C3F7A">Top opportunities</h3>
  <ol>${d.top.map(i => `<li><b>${escapeHtml(i.name)}</b> (${i.severityLabel}): ${escapeHtml(i.problem)}</li>`).join('') || '<li>None: well done.</li>'}</ol>
  <h3 style="color:#1C3F7A">Target keywords</h3>
  <p style="font-size:12px;color:#64748b">${escapeHtml(d.ranks.label)}.</p>
  <table style="border-collapse:collapse;width:100%"><tr><th style="${cell}">Search phrase</th><th style="${cell}">Position</th><th style="${cell}">Change</th><th style="${cell}">Clicks (28 days)</th></tr>
  ${rk.map(r => `<tr><td style="${cell}">${escapeHtml(r.keyword)}</td><td style="${cell}">${r.position}</td><td style="${cell}">${r.change === null ? '' : r.change > 0 ? `▲ ${r.change}` : r.change < 0 ? `▼ ${-r.change}` : '–'}</td><td style="${cell}">${r.clicks}</td></tr>`).join('') || `<tr><td style="${cell}" colspan="4">No Search Console figures yet.</td></tr>`}</table>
  <h3 style="color:#1C3F7A">Fixes this week</h3>
  <ul>${d.fixes.map(f => `<li>${escapeHtml(info(f.type).name || f.type)}${f.path ? ` on ${escapeHtml(f.path)}` : ''}${f.auto ? ' (automatic)' : ''}${f.status === 'undone' ? ' (undone)' : ''}</li>`).join('') || '<li>None.</li>'}</ul>
  <p><a href="https://lobistarsfc.com/admin/seo/" style="color:#C8102E">Open the SEO Scanner</a></p>
  <p style="font-size:12px;color:#64748b">Sent every Monday to the Super Admins (Admin › SEO Scanner › Settings › Alerts and reports to change it).</p></div>`;
}
