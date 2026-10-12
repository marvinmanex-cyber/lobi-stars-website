// /p (no code) -> the scan page, so a mistyped short link is never a dead end.
export function onRequest({ request }) {
  return new Response(null, { status: 302, headers: { Location: new URL('/programme/scan/', request.url).href, 'Cache-Control': 'no-store' } });
}
