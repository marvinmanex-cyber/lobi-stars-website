import partnership from '../../data/partnership.json';

// Published so the server can look up the brochure file for /api/download-lead.
export function GET() {
  return new Response(JSON.stringify({ brochureUrl: partnership.brochureUrl || '' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
