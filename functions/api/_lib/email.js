// Sends transactional email via Resend (https://resend.com) using plain
// fetch -- no SDK needed. Requires RESEND_API_KEY and RESEND_FROM secrets.

import { TEAM_LOGOS } from './teamLogos.js';

const TIER_LABELS = { VIP: 'VIP Sitting', Premium: 'Cover Stand', Regular: 'Popular Stand' };
const TIER_BADGES = { VIP: '/images/vip-siting.jpg', Premium: '/images/cover-stand.jpg', Regular: '/images/popular-stand.jpg' };
const SITE_ORIGIN = 'https://lobistarsfc.com';

export async function sendEmail(env, { to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM || 'Lobi Stars FC <tickets@lobistarsfc.com>',
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
  return res.json();
}

export function ticketEmailHtml({ order, event, tickets, qrSvgDataUri }) {
  const dateStr = new Date(event.event_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = new Date(event.event_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const tierLabel = TIER_LABELS[order.tier] || order.tier;
  const tierBadge = TIER_BADGES[order.tier];
  const tierPriceKobo = order.total_kobo / order.quantity;
  const homeCrest = TEAM_LOGOS[event.home_team];
  const awayCrest = TEAM_LOGOS[event.away_team];
  const crestCell = (name, src) => src
    ? `<img src="${SITE_ORIGIN}${src}" width="48" height="48" alt="${name}" style="border-radius:50%;background:#fff;padding:4px;"/>`
    : `<span style="display:inline-block;width:48px;height:48px;line-height:48px;border-radius:50%;background:#1e2f52;color:#fff;font-size:18px;font-weight:bold;">${name.charAt(0)}</span>`;

  // Table-based layout throughout -- flexbox/grid is unreliable in Outlook
  // and other older email clients, tables are the one thing that renders
  // consistently everywhere.
  const ticketBlocks = tickets.map((t, i) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto 18px;border-radius:12px;overflow:hidden;border:2px solid #C9A227;">
      <tr>
        <td style="background:linear-gradient(160deg,#0d1a33,#0a1226);padding:22px;font-family:Arial,sans-serif;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="color:rgba(255,255,255,.55);font-size:9px;letter-spacing:2px;text-transform:uppercase;padding-bottom:4px;">Nigeria Professional Football League</td></tr>
            <tr><td align="center" style="color:#C9A227;font-size:15px;letter-spacing:2px;font-weight:bold;padding-bottom:16px;">OFFICIAL MATCH TICKET</td></tr>
            <tr>
              <td align="center" style="padding-bottom:10px;">
                <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                  <td>${crestCell(event.home_team, homeCrest)}</td>
                  <td style="color:#C9A227;font-size:13px;font-weight:bold;padding:0 14px;">VS</td>
                  <td>${crestCell(event.away_team, awayCrest)}</td>
                </tr></table>
              </td>
            </tr>
            <tr>
              <td align="center" style="color:#ffffff;font-size:19px;font-weight:bold;line-height:1.3;padding-bottom:14px;">
                ${event.home_team} <span style="color:#C9A227;font-size:12px;">VS</span> ${event.away_team}
              </td>
            </tr>
            <tr>
              <td style="background:rgba(255,255,255,.92);border-radius:8px;padding:12px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                  <td align="center" style="color:#0d1a33;font-size:11px;font-weight:bold;">${dateStr}<br/><span style="font-weight:normal;color:#5a6270;">Kick-off ${timeStr}</span></td>
                  <td align="center" style="color:#0d1a33;font-size:11px;font-weight:bold;">${event.venue}</td>
                </tr></table>
              </td>
            </tr>
            <tr><td align="center" style="color:rgba(255,255,255,.5);font-size:10px;letter-spacing:1px;font-family:monospace;padding-top:10px;">TICKET NO: ${t.id}</td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:rgba(255,255,255,.94);padding:20px;text-align:center;">
          <div style="color:#0d1a33;font-family:Arial,sans-serif;font-size:12px;letter-spacing:2px;font-weight:bold;margin-bottom:10px;">MATCH TICKET</div>
          <img src="${qrSvgDataUri(`${SITE_ORIGIN}/verify/${t.id}`)}" width="150" height="150" alt="QR code for ticket ${t.id}" style="background:#fff;border:1px solid #e2e6ed;padding:6px;border-radius:6px;"/>
          <div style="color:#5a6270;font-size:10px;line-height:1.5;margin:10px 0;">
            <strong style="display:block;color:#0d1a33;font-size:10px;letter-spacing:1px;text-transform:uppercase;">&#128274; Verify Ticket</strong>
            Scan the QR code to confirm this ticket is genuine.
          </div>
          ${tierBadge ? `<img src="${SITE_ORIGIN}${tierBadge}" width="40" height="40" alt="${tierLabel}" style="margin-bottom:4px;"/><br/>` : ''}
          <span style="color:#0d1a33;font-size:12px;font-weight:bold;text-transform:uppercase;">${tierLabel}</span><br/>
          <span style="color:#0d1a33;font-size:16px;font-weight:bold;">&#8358;${(tierPriceKobo / 100).toLocaleString()}</span>
          <div style="color:#5a6270;font-size:9px;margin-top:12px;">Ticket ${i + 1} of ${tickets.length}</div>
        </td>
      </tr>
    </table>
  `).join('');

  return `
  <div style="max-width:520px;margin:0 auto;font-family:Arial,sans-serif;color:#111;">
    <h2 style="color:#0d1a33;">Your Lobi Stars Match Tickets</h2>
    <p>Hi ${order.buyer_name},</p>
    <p>Your booking for <strong>${event.home_team} vs ${event.away_team}</strong> (${event.competition}) is confirmed. Order reference: <strong>${order.id}</strong>.</p>
    <p>Present each QR code below at the gate &mdash; one scan per ticket. Screenshots work fine, or download the ticket image from your confirmation page on the website.</p>
    ${ticketBlocks}
    <p style="font-size:12px;color:#888;">Pride of Benue &middot; Lobi Stars Football Club</p>
  </div>`;
}

export function foodOrderEmailHtml({ order, items }) {
  const itemRows = items.map(i => `
    <tr>
      <td style="padding:6px 0;">${i.name} &times; ${i.qty}</td>
      <td style="padding:6px 0;text-align:right;">&#8358;${((i.priceKobo * i.qty) / 100).toLocaleString()}</td>
    </tr>
  `).join('');

  return `
  <div style="max-width:520px;margin:0 auto;font-family:Arial,sans-serif;color:#111;">
    <h2 style="color:#D4202B;">Lobi Stars FC &mdash; Food Order Confirmed</h2>
    <p>Your in-seat order has been received and will be delivered within 15 minutes.</p>
    <p>
      <strong>Seat:</strong> ${order.seat}${order.stand ? ' &middot; ' + order.stand : ''}<br/>
      <strong>Order Reference:</strong> ${order.id}
    </p>
    <table style="width:100%;border-collapse:collapse;margin-top:12px;">
      ${itemRows}
      <tr style="border-top:1px solid #ddd;font-weight:bold;">
        <td style="padding:8px 0;">Total</td>
        <td style="padding:8px 0;text-align:right;">&#8358;${(order.total_kobo / 100).toLocaleString()}</td>
      </tr>
    </table>
    <p style="font-size:12px;color:#888;margin-top:20px;">Pride of Benue &middot; Lobi Stars Football Club</p>
  </div>`;
}
