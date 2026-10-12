import { ensureSeasonSchema, TIER_LABELS as SEASON_TIERS } from '../api/_lib/seasonTickets.js';
import { TEAM_LOGOS } from '../api/_lib/teamLogos.js';

const TIER_LABELS = { VIP: 'VIP Sitting', Premium: 'Cover Stand', Regular: 'Popular Stand' };
// Everything shown comes from the address or the database: always escaped.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// GET /verify/:id -- public, read-only ticket authenticity check. This is
// what the QR code on every ticket points to, so anyone can scan it with an
// ordinary phone camera (not just gate staff in /scan) and see a real page
// confirming the ticket instead of a bare code string. Never mutates
// anything -- only /api/validate-ticket (staff-code protected) marks a
// ticket used.
export async function onRequestGet({ params, env }) {
  const id = String(params.id || '').trim().slice(0, 64);

  // Season tickets: genuine or not, season, stand, matches used (no personal details).
  if (/^LS-SZN-/i.test(id)) {
    await ensureSeasonSchema(env.DB);
    const pass = await env.DB.prepare(`SELECT p.id, p.season, p.tier, p.status, (SELECT COUNT(*) FROM season_pass_scans s WHERE s.pass_id = p.id) AS used
      FROM season_passes p WHERE p.id = ?`).bind(id.toUpperCase()).first();
    return new Response(renderSeasonPage(id, pass), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const ticket = await env.DB.prepare(
    `SELECT t.id, t.status, t.tier, t.used_at, e.home_team, e.away_team, e.event_date, e.venue
     FROM tickets t JOIN events e ON e.id = t.event_id
     WHERE t.id = ?`
  ).bind(id).first();

  return new Response(renderPage(id, ticket), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function crest(name) {
  const src = TEAM_LOGOS[name];
  return src
    ? `<img src="${esc(src)}" alt="${esc(name)}" style="width:56px;height:56px;object-fit:contain;"/>`
    : `<div style="width:56px;height:56px;border-radius:50%;background:#1e2f52;color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:22px;">${esc((name || '?').charAt(0))}</div>`;
}

function renderPage(id, ticket) {
  const statusBlock = !ticket
    ? `<div class="status invalid">&#10060; NOT A VALID TICKET</div><p class="sub">No Lobi Stars ticket matches this code.</p>`
    : ticket.status === 'used'
    ? `<div class="status used">&#9989; VERIFIED &mdash; ALREADY USED</div><p class="sub">This ticket was scanned at the gate${ticket.used_at ? ' on ' + new Date(ticket.used_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : ''}.</p>`
    : `<div class="status valid">&#9989; VERIFIED &mdash; VALID TICKET</div><p class="sub">This is a genuine, unused Lobi Stars FC ticket.</p>`;

  const matchBlock = ticket ? `
    <div class="match">
      <div class="crests">${crest(ticket.home_team)}<span class="vs">VS</span>${crest(ticket.away_team)}</div>
      <div class="teams">${esc(ticket.home_team)} vs ${esc(ticket.away_team)}</div>
      <div class="meta">${new Date(ticket.event_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
      <div class="meta">${new Date(ticket.event_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} &middot; ${esc(ticket.venue)}</div>
      <div class="tier">${esc(TIER_LABELS[ticket.tier] || ticket.tier)}</div>
    </div>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Ticket Verification | Lobi Stars Football Club</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;600;700&display=swap" rel="stylesheet"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#0d1a33;color:#fff;font-family:'Barlow',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
  .card{max-width:420px;width:100%;background:#132248;border:2px solid #C9A227;border-radius:16px;padding:32px 26px;text-align:center;}
  .brand{font-family:'Bebas Neue',sans-serif;letter-spacing:2px;color:#C9A227;font-size:14px;margin-bottom:20px;}
  .status{font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1px;margin-bottom:6px;}
  .status.valid{color:#4CAF50;}
  .status.used{color:#FFC72C;}
  .status.invalid{color:#E31E24;}
  .sub{font-size:13px;color:rgba(255,255,255,.65);margin-bottom:24px;}
  .match{border-top:1px solid rgba(255,255,255,.15);padding-top:22px;}
  .crests{display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:12px;}
  .vs{font-family:'Bebas Neue',sans-serif;color:#C9A227;font-size:14px;}
  .teams{font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:8px;}
  .meta{font-size:13px;color:rgba(255,255,255,.75);margin-bottom:4px;}
  .tier{display:inline-block;margin-top:12px;background:#C9A227;color:#0d1a33;font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:1px;padding:5px 16px;border-radius:20px;}
  .id{font-family:ui-monospace,monospace;font-size:11px;color:rgba(255,255,255,.4);margin-top:20px;}
</style>
</head>
<body>
  <div class="card">
    <div class="brand">LOBI STARS FOOTBALL CLUB</div>
    ${statusBlock}
    ${matchBlock}
    <div class="id">${esc(id)}</div>
  </div>
</body>
</html>`;
}

function renderSeasonPage(id, pass) {
  const block = !pass
    ? `<div class="status invalid">&#10060; NOT A VALID SEASON TICKET</div><p class="sub">No Lobi Stars season ticket matches this code.</p>`
    : pass.status !== 'valid'
    ? `<div class="status invalid">&#10060; SEASON TICKET CANCELLED</div><p class="sub">This season ticket is no longer valid.</p>`
    : `<div class="status valid">&#9989; VERIFIED &mdash; VALID SEASON TICKET</div><p class="sub">Genuine Lobi Stars FC season ticket: one person, every home match of the season. Used for ${Number(pass.used) || 0} match${Number(pass.used) === 1 ? '' : 'es'} so far.</p>
       <div class="match"><div class="teams">Season ${esc(pass.season)}</div><div class="tier">${esc(SEASON_TIERS[pass.tier] || pass.tier)}</div></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><meta name="robots" content="noindex"/>
<title>Season Ticket Verification | Lobi Stars Football Club</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0d1a33;color:#fff;font-family:Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{max-width:420px;width:100%;background:#132248;border:2px solid #C9A227;border-radius:16px;padding:32px 26px;text-align:center}.brand{letter-spacing:2px;color:#C9A227;font-size:14px;font-weight:bold;margin-bottom:20px}
.status{font-size:20px;font-weight:bold;margin-bottom:6px}.valid{color:#4CAF50}.invalid{color:#ff6b6b}.sub{color:#c8d1e6;font-size:14px;margin-bottom:18px;line-height:1.5}
.teams{font-size:22px;font-weight:bold;margin:8px 0}.tier{display:inline-block;margin-top:8px;padding:6px 14px;border-radius:999px;background:#C9A227;color:#0d1a33;font-weight:bold}.id{margin-top:20px;font-family:monospace;color:#8a97b8;font-size:12px}</style></head>
<body><div class="card"><div class="brand">LOBI STARS FC</div>${block}<div class="id">${esc(id)}</div></div></body></html>`;
}
