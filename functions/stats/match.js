// /stats/match/ is only the page template for /stats/matches/<match>/ (functions/stats/matches/[slug].js): not a page on its own.
export const onRequest = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'X-Robots-Tag': 'noindex' } });
