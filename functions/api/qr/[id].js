import { qrPngBuffer } from '../_lib/qrcode.js';
import { qrTextFor } from '../_lib/ticketing/engineStore.js';

const SITE_ORIGIN = 'https://lobistarsfc.com';

// GET /api/qr/:id -- serves the ticket's QR code as a real hosted PNG.
// Ticket emails point here instead of embedding an inline SVG data URI,
// since Gmail and other clients won't render data:image/svg+xml at all.
export async function onRequestGet({ params }) {
  const id = (params.id || '').trim();
  if (!id) return new Response('Missing ticket id', { status: 400 });

  // Engine tickets: the QR holds the token and nothing else; older tickets: the verify link.
  const png = await qrPngBuffer(qrTextFor(id, SITE_ORIGIN));
  return new Response(png, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
