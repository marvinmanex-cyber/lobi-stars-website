// Season settings from the built /data/site.json (CMS): current season and the month it starts.
export async function seasonConfig(env, request) {
  let site = {};
  try { site = await (await env.ASSETS.fetch(new URL('/data/site.json', request.url))).json(); } catch {}
  const startMonth = /^\d{4}-(\d{2})-\d{2}$/.test(site.seasonStart || '') ? Number(site.seasonStart.slice(5, 7)) : 8;
  return { currentSeason: site.currentSeason || '', startMonth };
}
