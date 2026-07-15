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
  const dateStr = new Date(event.event_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = new Date(event.event_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const tierPriceKobo = order.total_kobo / order.quantity;

  // Table-based layout throughout -- flexbox/grid is unreliable in Outlook
  // and other older email clients, tables are the one thing that renders
  // consistently everywhere.
  const ticketBlocks = tickets.map((t, i) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto 18px;border-radius:12px;overflow:hidden;border:2px solid #FFC72C;">
      <tr>
        <td style="background:linear-gradient(135deg,#7a0f14,#3a0708);padding:22px;font-family:Arial,sans-serif;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="color:#FFC72C;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;padding-bottom:4px;">Lobi Stars Football Club</td>
            </tr>
            <tr><td style="color:rgba(255,255,255,.55);font-size:9px;letter-spacing:2px;text-transform:uppercase;padding-bottom:14px;">Glory to Glory</td></tr>
            <tr>
              <td style="color:#ffffff;font-size:22px;font-weight:bold;line-height:1.3;padding-bottom:12px;">
                ${event.home_team} <span style="color:#FFC72C;font-size:13px;">VS</span> ${event.away_team}
              </td>
            </tr>
            <tr><td style="color:rgba(255,255,255,.9);font-size:13px;line-height:1.8;padding-bottom:10px;">
              <strong style="color:#fff;">${dateStr}</strong><br/>
              Kick-off: <strong style="color:#fff;">${timeStr}</strong><br/>
              Venue: <strong style="color:#fff;">${event.venue}</strong>
            </td></tr>
            <tr><td style="color:rgba(255,255,255,.5);font-size:10px;letter-spacing:1px;font-family:monospace;padding-bottom:6px;">TICKET NO: ${t.id}</td></tr>
            <tr><td style="color:rgba(255,255,255,.4);font-size:10px;letter-spacing:1px;">Ticket ${i + 1} of ${tickets.length} &middot; ${order.tier} &middot; &#8358;${(tierPriceKobo / 100).toLocaleString()}</td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:rgba(0,0,0,.25);padding:20px;text-align:center;">
          <div style="color:#FFC72C;font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;font-weight:bold;margin-bottom:10px;">ADMIT ONE</div>
          <img src="${qrSvgDataUri(t.id)}" width="160" height="160" alt="QR code for ticket ${t.id}" style="background:#fff;padding:8px;border-radius:6px;"/>
        </td>
      </tr>
    </table>
  `).join('');

  return `
  <div style="max-width:520px;margin:0 auto;font-family:Arial,sans-serif;color:#111;">
    <h2 style="color:#D4202B;">Your Lobi Stars Match Tickets</h2>
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
