import { TEAM_LOGOS } from '../api/_lib/teamLogos.js';

const TIER_LABELS = { VIP: 'VIP Sitting', Premium: 'Cover Stand', Regular: 'Popular Stand' };

// GET /verify/:id -- public, read-only ticket authenticity check. This is
// what the QR code on every ticket points to, so anyone can scan it with an
// ordinary phone camera (not just gate staff in /scan) and see a real page
// confirming the ticket instead of a bare code string. Never mutates
// anything -- only /api/validate-ticket (staff-code protected) marks a
// ticket used.
export async function onRequestGet({ params, env }) {
  const id = (params.id || '').trim();

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
    ? `<img src="${src}" alt="${name}" style="width:56px;height:56px;object-fit:contain;"/>`
    : `<div style="width:56px;height:56px;border-radius:50%;background:#1e2f52;color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:22px;">${(name || '?').charAt(0)}</div>`;
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
      <div class="teams">${ticket.home_team} vs ${ticket.away_team}</div>
      <div class="meta">${new Date(ticket.event_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
      <div class="meta">${new Date(ticket.event_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} &middot; ${ticket.venue}</div>
      <div class="tier">${TIER_LABELS[ticket.tier] || ticket.tier}</div>
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
    <div class="id">${id}</div>
  </div>
</body>
</html>`;
}
