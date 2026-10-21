// AI Fix results: the figure each recommendation is about, measured from the
// same 28-day numbers the Analytics rules use (no AI). Saved when a fix is
// applied, measured again after 14 and 30 days (Fix results page), so the club
// can see whether the change helped.
const r1 = n => Math.round(Number(n || 0) * 10) / 10;
const pct = (a, b) => (b ? r1((a / b) * 100) : 0);

/**
 * { metric, label, value, better: 'up'|'down', detail } for one recommendation id,
 * or null when there is nothing to measure.
 */
export function metricFor(recId, f) {
  const [type, ...rest] = String(recId).split(':');
  const key = rest.join(':');
  if (type === 'ctr' || type === 'index') {
    const p = f.gsc.pages.find(x => x.path === key) || { clicks: 0, impressions: 0, position: 0 };
    return type === 'ctr'
      ? { metric: 'ctr', label: `Google click rate for ${key}`, value: pct(p.clicks, p.impressions), unit: '%', better: 'up', detail: { clicks: p.clicks, impressions: p.impressions, position: r1(p.position) } }
      : { metric: 'impressions', label: `Google appearances for ${key}`, value: p.impressions || 0, unit: '', better: 'up', detail: { clicks: p.clicks } };
  }
  if (type === 'rank') {
    const q = f.gsc.queries.find(x => x.value === key) || { position: 0, impressions: 0, clicks: 0 };
    return { metric: 'position', label: `Google position for "${key}"`, value: r1(q.position), unit: '', better: 'down', detail: { clicks: q.clicks, impressions: q.impressions } };
  }
  if (type === 'trend') return { metric: 'clicks', label: 'Google clicks (28 days)', value: f.gsc.now.clicks || 0, unit: '', better: 'up', detail: { before: f.gsc.prev.clicks || 0 } };
  if (type === 'eng') {
    const p = f.ga4.pages.find(x => x.path === key) || { sessions: 0, engagement: 0 };
    return { metric: 'engagement', label: `Engaged visits on ${key}`, value: r1((p.engagement || 0) * 100), unit: '%', better: 'up', detail: { sessions: p.sessions } };
  }
  if (type === 'ux') {
    const m = f.ga4.devices.find(d => d.device === 'mobile') || { engagement: 0, sessions: 0 };
    return { metric: 'engagement', label: 'Engaged visits on phones', value: r1((m.engagement || 0) * 100), unit: '%', better: 'up', detail: { sessions: m.sessions } };
  }
  if (type === 'funnel') {
    const done = key.replace('_start', '_complete'), E = { ...f.own.events, ...f.ga4.events };
    return { metric: 'completion', label: 'Checkouts finished', value: pct(E[done] || 0, E[key] || 0), unit: '%', better: 'up', detail: { started: E[key] || 0, finished: E[done] || 0 } };
  }
  if (recId === 'grow:newsletter') {
    const E = { ...f.own.events, ...f.ga4.events }, visits = f.ga4.now.sessions || f.own.now;
    return { metric: 'signups', label: 'Newsletter sign-ups (28 days)', value: E.newsletter_signup || 0, unit: '', better: 'up', detail: { visits } };
  }
  if (recId === 'grow:social') {
    const s = f.own.sources, social = (s.Facebook || 0) + (s.Instagram || 0) + (s.X || 0) + (s.WhatsApp || 0);
    return { metric: 'social_share', label: 'Page views from WhatsApp and social media', value: pct(social, f.own.now), unit: '%', better: 'up', detail: { social, total: f.own.now } };
  }
  if (recId === 'grow:diaspora') {
    const all = f.gsc.countries.reduce((n, c) => n + c.impressions, 0), abroad = f.gsc.countries.filter(c => c.value !== 'nga').reduce((n, c) => n + c.impressions, 0);
    return { metric: 'abroad', label: 'Google appearances outside Nigeria', value: abroad, unit: '', better: 'up', detail: { share: pct(abroad, all) } };
  }
  if (recId === 'setup:stale' || recId === 'setup:gsc') return { metric: 'latest', label: 'Latest Google figures', value: f.latest.gsc || 'none', unit: '', better: 'up', detail: {} };
  return null;
}

/** "better", "worse" or "no change" for a before/after pair. */
export function verdict(before, after) {
  if (!before || !after || typeof before.value !== 'number' || typeof after.value !== 'number') return null;
  if (after.value === before.value) return 'no change';
  const up = after.value > before.value;
  return (before.better === 'down' ? !up : up) ? 'better' : 'worse';
}
