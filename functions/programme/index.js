import { renderPage } from '../api/_lib/ssr.js';
import { onSaleEvents } from '../api/_lib/onSale.js';

// "/programme" -- the next match is embedded so the page doesn't show "Loading…".
export async function onRequestGet({ request, env }) {
  let events = [];
  try { events = await onSaleEvents(env.DB); } catch {}
  return renderPage(request, env, '/programme/', [], { 'ssr-events': { events } });
}
