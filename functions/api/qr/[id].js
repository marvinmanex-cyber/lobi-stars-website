import { qrPngBuffer } from '../_lib/qrcode.js';

const SITE_ORIGIN = 'https://lobistarsfc.com';

// GET /api/qr/:id -- serves the ticket's QR code as a real hosted PNG.
// Ticket emails point here instead of embedding an inline SVG data URI,
// since Gmail and other clients won't render data:image/svg+xml at all.
export async function onRequestGet({ params }) {
  const id = (params.id || '').trim();
  if (!id) return new Response('Missing ticket id', { status: 400 });

  const png = await qrPngBuffer(`${SITE_ORIGIN}/verify/${id}`);
  return new Response(png, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
