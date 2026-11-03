// Readable names for where ticket buyers came from (no other imports, so tests can load it).
const SOURCE_NAMES = [
  [/instagram|^ig$/i, 'Instagram'], [/facebook|^fb$|fb\.com|fb\.me/i, 'Facebook'], [/whatsapp|wa\.me/i, 'WhatsApp'],
  [/twitter|^x$|t\.co$|x\.com/i, 'X (Twitter)'], [/tiktok/i, 'TikTok'], [/telegram|t\.me/i, 'Telegram'], [/youtube|youtu\.be/i, 'YouTube'],
  [/google/i, 'Google'], [/bing|yahoo|duckduckgo/i, 'Other search'], [/ticket_email|email|newsletter|mail/i, 'Email'],
  [/poster|qr|scan/i, 'QR code / poster'],
];
const PAGE_NAMES = [[/^\/$/, 'Home page'], [/^\/fixtures/, 'Fixtures page'], [/^\/(matches|match-centre)/, 'Match page'], [/^\/news/, 'News'], [/^\/kitchen|^\/food/, 'MatchDay Kitchen'], [/^\/season-tickets/, 'Season tickets page']];
/** One readable source: social / search / email / QR (first touch), else the page on this site, else "Direct". */
export function sourceLabel(src = {}) {
  const pick = raw => { const v = String(raw || '').replace(/^(utm|ref):/, ''); if (!v) return ''; const hit = SOURCE_NAMES.find(([re]) => re.test(v)); return hit ? hit[1] : /lobistarsfc/i.test(v) ? '' : (raw.startsWith('ref:') ? `Other website (${v.replace(/^www\./, '').slice(0, 40)})` : v.slice(0, 30)); };
  const first = pick(src.first);
  if (first) return first;
  const via = String(src.via || '');
  if (via.startsWith('ref:')) return pick(via) || 'Direct';
  if (via) { const p = PAGE_NAMES.find(([re]) => re.test(via)); return `Website: ${p ? p[1] : 'other page'}`; }
  return 'Direct (typed or bookmark)';
}
export function deviceOf(ua = '') { return /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'Phone' : 'Computer'; }
