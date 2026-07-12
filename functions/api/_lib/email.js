// Sends transactional email via Resend (https://resend.com) using plain
// fetch -- no SDK needed. Requires RESEND_API_KEY and RESEND_FROM secrets.

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
  const ticketBlocks = tickets.map((t, i) => `
    <div style="border:2px solid #D4202B;border-radius:10px;padding:20px;margin-bottom:16px;text-align:center;font-family:Arial,sans-serif;">
      <div style="font-size:12px;letter-spacing:2px;color:#888;text-transform:uppercase;">Ticket ${i + 1} of ${tickets.length} &middot; ${order.tier}</div>
      <img src="${qrSvgDataUri(t.id)}" width="200" height="200" alt="QR code for ticket ${t.id}" style="margin:12px 0;"/>
      <div style="font-family:monospace;font-size:16px;letter-spacing:1px;color:#111;">${t.id}</div>
    </div>
  `).join('');

  return `
  <div style="max-width:520px;margin:0 auto;font-family:Arial,sans-serif;color:#111;">
    <h2 style="color:#D4202B;">Lobi Stars FC &mdash; Your Match Tickets</h2>
    <p>Hi ${order.buyer_name},</p>
    <p>Your booking for <strong>${event.home_team} vs ${event.away_team}</strong> (${event.competition}) is confirmed.</p>
    <p>
      <strong>Date:</strong> ${new Date(event.event_date).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}<br/>
      <strong>Venue:</strong> ${event.venue}<br/>
      <strong>Order Reference:</strong> ${order.id}
    </p>
    <p>Present each QR code below at the gate &mdash; one scan per ticket. Screenshots work fine.</p>
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
