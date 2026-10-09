import site from '../../data/site.json';

// Season settings for the server (analytics "This season" filter).
export function GET() {
  return new Response(JSON.stringify({ currentSeason: site.currentSeason, seasonStart: (site as any).seasonStart || '' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
