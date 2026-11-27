import { sharedAnalysis, METRICS } from '../../../api/_lib/statsBst.js';
import { keyMoments } from '../../../api/_lib/statsPhase2.js';

// /staff/statistics-center/share/<token>/ -- the head coach's read-only copy of a match analysis (Add-on 2). Opened
// from a link a statistician or Super Admin made (1–30 days, switched off at any time). No sign-in, no editing, no
// scripts, never indexed or cached. Staff notes only when the link was made with "include staff notes".
const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PN = { '1H': '1st half', '2H': '2nd half', ET1: 'Extra time 1', ET2: 'Extra time 2' };
const page = (title, body) => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)} | Lobi Stars FC</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Barlow+Condensed:wght@700&display=swap" rel="stylesheet">
<style>:root{--navy:#1C3F7A;--navy-l:#E8EEF8;--red:#C8102E;--ink:#16181D;--muted:#4A505C;--line:#E2E4E9}*{box-sizing:border-box}body{margin:0;background:#F3F4F6;color:var(--ink);font:400 16px/1.5 Barlow,system-ui,sans-serif}
header{background:var(--navy);border-bottom:4px solid var(--red);color:#fff;padding:12px 16px;display:flex;gap:12px;align-items:center}header img{width:44px;height:44px;border-radius:50%;background:#fff;padding:3px}header b{font:700 18px 'Barlow Condensed',sans-serif;letter-spacing:.05em;display:block}header small{opacity:.9}
main{max-width:1100px;margin:0 auto;padding:16px}h1,h2{font-family:'Barlow Condensed',sans-serif;margin:0 0 10px}h1{font-size:28px}h2{font-size:22px}.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;margin:0 0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{border-top:1px solid var(--line);padding:6px 8px;text-align:left}th{font-size:12px;color:var(--muted);text-transform:uppercase}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}.ro{color:var(--muted)}.muted{color:var(--muted);font-size:14px}.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}.kpi{border:1px solid var(--line);border-radius:12px;padding:10px}.kpi b{display:block;font:700 28px 'Barlow Condensed',sans-serif;color:var(--navy)}
.scroll{overflow-x:auto}.blocks td,.blocks th{border:1px solid var(--line);padding:3px 5px;text-align:center;font-size:12px}.blocks th:first-child,.blocks td:first-child{text-align:left;white-space:nowrap}.fx{display:grid;justify-items:center;text-align:center;line-height:1.15}.fx span{white-space:nowrap}.fx .fx-mid{color:var(--red)}footer{color:var(--muted);font-size:13px;text-align:center;padding:16px}</style></head>
<body><header><img src="/images/lobi-stars-badge.webp" alt=""><div><b>Lobi Stars FC · Match analysis</b><small>Read-only copy for the coaching staff</small></div></header><main>${body}</main><footer>Lobi Stars Statistics Center · this link is private: please do not share it.</footer></body></html>`;

export async function onRequestGet({ env, params }) {
  let d = null;
  try { d = await sharedAnalysis(env.DB, params.token); } catch (err) { console.error('[stats share]', err); }
  if (!d) return new Response(page('Link not available', '<div class="card"><h1>This link is not available</h1><p>It has expired or was switched off. Ask the club\'s statistician for a new one.</p></div>'), { status: 404, headers: HEADERS });
  const m = d.match, lobiSide = m.lobiHome ? 'home' : 'away';
  const name = s => ((s === 'lobi') === (lobiSide === 'home') ? m.home : m.away);
  const hasOpp = METRICS.some(mt => d.totals.opponent[mt.key].full) || d.lineups.some(l => l.side !== lobiSide);
  const sides = hasOpp ? ['lobi', 'opponent'] : ['lobi'];
  const lu = s => { const list = d.lineups.filter(l => (l.side === lobiSide) === (s === 'lobi')); if (!list.length) return '<p class="muted">Not recorded.</p>';
    const row = (l, i) => `<tr><td class="n">${i}</td><td class="n">${esc(l.number ?? '')}</td><td>${esc(l.name)}</td><td>${esc(l.position || '')}</td></tr>`;
    return `<table><thead><tr><th class="n">#</th><th class="n">No.</th><th>Player</th><th>Pos</th></tr></thead><tbody>${list.filter(l => l.starter).map((l, i) => row(l, i + 1)).join('')}<tr><th colspan="4">Reserves</th></tr>${list.filter(l => !l.starter).map((l, i) => row(l, i + 12)).join('')}</tbody></table>`; };
  const f = (h, a) => (lobiSide === 'home' ? h : a);
  const totals = `<table><thead><tr><th>Metric</th>${sides.map(s => d.cols.map(c => `<th class="n">${esc(name(s))} ${c.period}</th>`).join('') + `<th class="n">${esc(name(s))} match</th>`).join('')}</tr></thead><tbody>
    ${METRICS.map(mt => `<tr class="${mt.kind === 'calc' || mt.kind === 'derived' ? 'ro' : ''}"><td>${esc(mt.label)}</td>${sides.map(s => d.cols.map(c => `<td class="n">${d.totals[s][mt.key][c.period]}</td>`).join('') + `<td class="n"><b>${d.totals[s][mt.key].full}</b></td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const blocks = sides.map(s => d.cols.map(c => `<h2 style="font-size:17px;margin-top:12px">${esc(name(s))} · ${PN[c.period]}</h2><div class="scroll"><table class="blocks"><thead><tr><th>Metric</th>${c.blocks.map(b => `<th>${esc(b)}'</th>`).join('')}</tr></thead><tbody>
    ${METRICS.map(mt => `<tr class="${mt.kind === 'calc' || mt.kind === 'derived' ? 'ro' : ''}"><td>${esc(mt.label)}</td>${c.blocks.map(b => { const v = d.grid[s][mt.key][c.period][b]; return `<td>${v ? (mt.kind === 'decimal' ? Number(v).toFixed(2) : v) : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`).join('')).join('');
  const key = d.events.filter(e => ['goal', 'yellow_card', 'red_card', 'substitution'].includes(e.type));
  const clips = d.includeVideo ? new Map(keyMoments({ match: d.match, events: d.events }).filter(k => k.clip).map(k => [k.id, k.clip])) : new Map();
  const body = `<div class="card"><h1 class="fx"><span>${esc(m.home)}</span><span class="fx-mid">${m.homeScore}–${m.awayScore}</span><span>${esc(m.away)}</span></h1><p class="muted">${esc(m.competition)} · ${esc(new Date(m.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }))}${m.kickoff ? ` · ${esc(m.kickoff)}` : ''}${m.venue ? ` · ${esc(m.venue)}` : ''} · ${d.analysis.status === 'final' ? 'Final' : 'Draft'} · Prepared by ${esc(d.analysis.preparedBy || '')} · Link valid until ${esc(new Date(d.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' }))}</p>
    <div class="kpis"><div class="kpi"><b>${d.totals.lobi.goal_attempt.full}</b>Goal attempts</div><div class="kpi"><b>${d.totals.lobi.shot_on.full}</b>On target</div><div class="kpi"><b>${d.accuracy.lobi === null ? '—' : `${d.accuracy.lobi}%`}</b>Shot accuracy</div><div class="kpi"><b>${d.totals.lobi.corner.full}</b>Corners</div><div class="kpi"><b>${Number(d.totals.lobi.xg.full).toFixed(2)}</b>xG</div></div></div>
    ${d.analysis.overview ? `<div class="card"><h2>Game overview</h2><p>${esc(d.analysis.overview).replace(/\n/g, '<br>')}</p>${d.analysis.half1Note ? `<h2 style="font-size:17px">1st half</h2><p>${esc(d.analysis.half1Note).replace(/\n/g, '<br>')}</p>` : ''}${d.analysis.half2Note ? `<h2 style="font-size:17px">2nd half</h2><p>${esc(d.analysis.half2Note).replace(/\n/g, '<br>')}</p>` : ''}</div>` : ''}
    <div class="grid">${sides.map(s => `<div class="card"><h2>${esc(name(s))}</h2><p class="muted">Formation: ${esc(s === 'lobi' ? f(m.formationHome, m.formationAway) || '—' : f(m.formationAway, m.formationHome) || '—')} → ${esc(s === 'lobi' ? f(m.formationHomeFinish, m.formationAwayFinish) || '—' : f(m.formationAwayFinish, m.formationHomeFinish) || '—')}</p>${lu(s)}</div>`).join('')}</div>
    <div class="card scroll"><h2>Totals</h2>${totals}</div>
    ${key.length ? `<div class="card"><h2>Key moments</h2><table><tbody>${key.map(e => `<tr><td class="n">${e.minute}${e.stoppage ? `+${e.stoppage}` : ''}'</td><td>${esc({ goal: 'Goal', yellow_card: 'Yellow card', red_card: 'Red card', substitution: 'Substitution' }[e.type])}</td><td>${esc(e.side === 'home' ? m.home : m.away)}</td><td>${esc(e.type === 'substitution' ? `${e.relatedName || '?'} on for ${e.name || '?'}` : e.name || '')}</td><td>${clips.get(e.id) ? `<a href="${esc(clips.get(e.id))}" target="_blank" rel="noopener">Watch clip</a>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="card"><h2>Match data collection (2-minute blocks)</h2>${blocks}</div>`;
  return new Response(page(`${m.home} vs ${m.away}: analysis`, body), { headers: HEADERS });
}
