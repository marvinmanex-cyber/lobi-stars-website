// MatchDay Kitchen receipt as a picture (PNG), drawn on the device, for WhatsApp:
// WhatsApp links can only carry text, so the picture is shared with the phone's
// share menu (or downloaded on a laptop and dropped into the chat).
// Steps shown to staff: 1) Open chat with the fan  2) Share receipt picture.
import { api, esc } from './common';

type R = { ref: string; name: string; where: string; items: { name: string; qty: number; priceKobo: number }[]; totalKobo: number; pointsKobo: number; voucherKobo: number; paidAt: string; deliveredAt: string | null; channel: string; chatUrl: string | null; pdfUrl: string };
const naira = (k: number) => '₦' + (k / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 });
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '';

function img(src: string): Promise<HTMLImageElement | null> {
  return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const words = text.split(' '), lines: string[] = []; let line = '';
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (ctx.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  return lines;
}

/** The receipt picture (PNG). */
export async function receiptPng(r: R): Promise<Blob> {
  const W = 720, P = 44, c = document.createElement('canvas'), ctx = c.getContext('2d')!;
  ctx.font = '600 26px Barlow, Arial, sans-serif';
  const rows = r.items.map(i => ({ lines: wrap(ctx, `${i.qty} × ${i.name}`, W - P * 2 - 170), price: naira(i.qty * i.priceKobo) }));
  const extra = (r.pointsKobo ? 1 : 0) + (r.voucherKobo ? 1 : 0);
  const H = 470 + rows.reduce((h, x) => h + x.lines.length * 34 + 12, 0) + extra * 38 + 210;
  c.width = W; c.height = H;
  // Background and header.
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0B3D1A'; ctx.fillRect(0, 0, W, 190);
  ctx.fillStyle = '#FFC21A'; ctx.fillRect(0, 190, W, 8);
  const logo = await img('/images/matchday-kitchen/logo-160.png');
  if (logo) ctx.drawImage(logo, P, 25, 140, 140);
  ctx.fillStyle = '#fff'; ctx.font = 'italic 800 46px "Barlow Condensed", Arial Narrow, sans-serif'; ctx.fillText('MATCHDAY KITCHEN', P + 165, 88);
  ctx.fillStyle = '#FFC21A'; ctx.font = '700 24px "Barlow Condensed", Arial, sans-serif'; ctx.fillText('LOBI STARS FC · McCARTHY STADIUM', P + 168, 124);
  ctx.fillStyle = '#CFE8D5'; ctx.font = '500 22px Barlow, Arial, sans-serif'; ctx.fillText('Great Food. Every Match.', P + 168, 156);
  // Title and details.
  let y = 262;
  ctx.fillStyle = '#0A1730'; ctx.font = '800 40px "Barlow Condensed", Arial, sans-serif'; ctx.fillText('RECEIPT', P, y);
  ctx.textAlign = 'right'; ctx.font = '700 28px "Barlow Condensed", Arial, sans-serif'; ctx.fillStyle = '#C8102E'; ctx.fillText(r.ref, W - P, y); ctx.textAlign = 'left';
  y += 44; ctx.fillStyle = '#4A5260'; ctx.font = '500 24px Barlow, Arial, sans-serif';
  for (const t of [r.name && `Customer: ${r.name}`, r.where, `Paid: ${when(r.paidAt)}${r.channel === 'whatsapp' ? ' (WhatsApp order)' : ''}`].filter(Boolean) as string[]) { ctx.fillText(t, P, y); y += 34; }
  y += 6; ctx.strokeStyle = '#D9DEE6'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(W - P, y); ctx.stroke(); ctx.setLineDash([]);
  y += 42;
  // Items.
  ctx.font = '600 26px Barlow, Arial, sans-serif';
  for (const x of rows) {
    ctx.fillStyle = '#14171F'; x.lines.forEach((l, i) => ctx.fillText(l, P, y + i * 34));
    ctx.textAlign = 'right'; ctx.fillText(x.price, W - P, y); ctx.textAlign = 'left';
    y += x.lines.length * 34 + 12;
  }
  ctx.font = '500 24px Barlow, Arial, sans-serif'; ctx.fillStyle = '#1B7F3B';
  if (r.pointsKobo) { ctx.fillText('Star Points', P, y); ctx.textAlign = 'right'; ctx.fillText(`−${naira(r.pointsKobo)}`, W - P, y); ctx.textAlign = 'left'; y += 38; }
  if (r.voucherKobo) { ctx.fillText('Voucher', P, y); ctx.textAlign = 'right'; ctx.fillText(`−${naira(r.voucherKobo)}`, W - P, y); ctx.textAlign = 'left'; y += 38; }
  y += 4; ctx.strokeStyle = '#0A1730'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(W - P, y); ctx.stroke();
  y += 52; ctx.fillStyle = '#0A1730'; ctx.font = '800 36px "Barlow Condensed", Arial, sans-serif'; ctx.fillText('TOTAL PAID', P, y);
  ctx.textAlign = 'right'; ctx.fillText(naira(r.totalKobo), W - P, y); ctx.textAlign = 'left';
  // PAID stamp and footer.
  y += 30;
  ctx.save(); ctx.translate(W - 170, y + 40); ctx.rotate(-0.18); ctx.strokeStyle = '#1B7F3B'; ctx.lineWidth = 5; ctx.strokeRect(-78, -30, 156, 60);
  ctx.fillStyle = '#1B7F3B'; ctx.font = '800 40px "Barlow Condensed", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('PAID', 0, 14); ctx.restore();
  ctx.fillStyle = '#4A5260'; ctx.font = '500 22px Barlow, Arial, sans-serif'; ctx.fillText('Thank you, and enjoy the match!', P, y + 48);
  ctx.fillStyle = '#0B3D1A'; ctx.fillRect(0, H - 60, W, 60);
  ctx.fillStyle = '#fff'; ctx.font = '600 22px Barlow, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('lobistarsfc.com/kitchen · MatchDay Kitchen, Lobi Stars FC', W / 2, H - 22);
  return new Promise(res => c.toBlob(b => res(b!), 'image/png'));
}

/** The "Send receipt on WhatsApp" box: 1) open the fan's chat, 2) share (or download) the picture. */
export async function sendReceiptWhatsApp(id: string, toast: (t: string) => void) {
  let r: R;
  try { r = await api(`receipt-data?id=${encodeURIComponent(id)}`); } catch (e: any) { toast(e.message); return; }
  const blob = await receiptPng(r);
  const file = new File([blob], `MatchDay-Kitchen-receipt-${r.ref}.png`, { type: 'image/png' });
  const canShare = !!(navigator as any).canShare?.({ files: [file] });
  // A data link (the kitchen pages' security rules allow data: pictures, not blob: links).
  const url: string = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(blob); });
  const box = document.createElement('div');
  box.className = 'mk-rc';
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Send the receipt on WhatsApp');
  box.innerHTML = `<div class="mk-rc-card">
    <h2>Receipt for ${esc(r.ref)}</h2>
    <img src="${url}" alt="Receipt picture for order ${esc(r.ref)}" />
    <ol class="mk-rc-steps">
      ${r.chatUrl ? `<li><button type="button" class="mk-btn go big wide" data-s="chat">1 · Open chat with ${esc(r.name || 'the fan')}</button><small>WhatsApp opens on their number with a short message. Send it, then come back here.</small></li>` : '<li><small>This order has no phone number: download the picture and send it another way.</small></li>'}
      <li><button type="button" class="mk-btn go big wide" data-s="share">${canShare ? `${r.chatUrl ? '2 · ' : ''}Share receipt picture` : `${r.chatUrl ? '2 · ' : ''}Download receipt picture`}</button>
        <small>${canShare ? 'Choose WhatsApp, then the chat with the fan (it is at the top after step 1).' : 'Then drag the picture into the WhatsApp chat (or use the paperclip › Photos).'}</small></li>
    </ol>
    <p class="mk-rc-more"><a href="${esc(r.pdfUrl)}&download=1" target="_blank" rel="noopener">Download the PDF receipt instead</a></p>
    <button type="button" class="mk-btn wide" data-s="close">Done</button></div>`;
  document.body.append(box);
  const close = () => box.remove();
  box.addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest('[data-s]') as HTMLElement | null;
    if (!b) { if (e.target === box) close(); return; }
    const s = b.dataset.s;
    if (s === 'close') close();
    if (s === 'chat' && r.chatUrl) { window.open(r.chatUrl, 'mdk-whatsapp'); api('receipt', { method: 'POST', body: { id, via: 'whatsapp' } }).catch(() => {}); }
    if (s === 'share') {
      if (canShare) { try { await (navigator as any).share({ files: [file], title: `Receipt ${r.ref}`, text: `MatchDay Kitchen receipt – order ${r.ref}` }); } catch { /* cancelled */ } }
      else { const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.append(a); a.click(); a.remove(); toast('Picture downloaded. Drag it into the WhatsApp chat.'); }
    }
  });
}
