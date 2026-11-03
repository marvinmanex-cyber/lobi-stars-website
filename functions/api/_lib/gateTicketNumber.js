// Gate Control: reads a scanned QR code or a typed ticket number (kept apart from
// gateCheck.js so it can be tested on its own). Ticket numbers are LS-TIX- (match)
// or LS-SZN- (season) followed by 12 letters and numbers, never O, I, 0 or 1.
const ID_RE = /^LS-(TIX|SZN)-[A-HJ-NP-Z2-9]{12}$/;
const OUR_HOSTS = /(^|\.)lobistarsfc\.com$|^localhost$|^127\.0\.0\.1$|\.lobi-stars-website\.pages\.dev$/i;

/** A scanned code or typed number -> { id } (a ticket number to look up) or { code, reason } (refused before the database). */
export function parseTicketInput(raw) {
  let s = String(raw || '').trim();
  if (!s) return { code: 'bad_number', reason: 'Enter or scan a ticket number.' };
  if (/^https?:\/\//i.test(s)) {
    let u;
    try { u = new URL(s); } catch { return { code: 'not_lobi', reason: 'This QR code is not a Lobi Stars FC ticket.' }; }
    const m = /^\/verify\/([^/?#]+)\/?$/.exec(u.pathname);
    if (!OUR_HOSTS.test(u.hostname) || !m) return { code: 'not_lobi', reason: `This QR code is not a Lobi Stars FC ticket (it points to ${u.hostname}).` };
    s = decodeURIComponent(m[1]);
  }
  let id = s.toUpperCase().replace(/[\s_.]+/g, '').replace(/—|–/g, '-');
  // Typed without the start: "ABCD2345EFGH" -> LS-TIX-ABCD2345EFGH.
  if (/^[A-Z0-9]{12}$/.test(id)) id = `LS-TIX-${id}`;
  if (/^LS(TIX|SZN)[A-Z0-9]{12}$/.test(id)) id = `LS-${id.slice(2, 5)}-${id.slice(5)}`;
  if (ID_RE.test(id)) return { id };
  const tail = id.replace(/^LS-(TIX|SZN)-?/, '');
  if (/^LS-(TIX|SZN)-?/.test(id) && tail.length === 12 && /[01IO]/.test(tail)) {
    return { code: 'bad_number', reason: 'Check the number: ticket numbers never use the letters O or I, or the numbers 0 or 1.' };
  }
  if (/^LS-(TIX|SZN)-?/.test(id)) return { code: 'bad_number', reason: `A ticket number is LS-TIX- followed by 12 letters and numbers (this one has ${tail.length}). Check the number.` };
  return { code: 'not_lobi', reason: 'This is not a Lobi Stars FC ticket number.' };
}
