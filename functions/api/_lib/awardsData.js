// Built JSON the awards need: the squad list and the partner list.
export async function awardsAssets(env, request) {
  const get = async path => { try { const r = await env.ASSETS.fetch(new URL(path, request.url)); return r.ok ? await r.json() : []; } catch { return []; } };
  const [roster, partners] = await Promise.all([get('/data/players.json'), get('/data/partners.json')]);
  return { roster: Array.isArray(roster) ? roster : [], partners: Array.isArray(partners) ? partners : [] };
}
