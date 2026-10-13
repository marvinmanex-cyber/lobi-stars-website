import { leagueAuth, ok, fail } from '../../_lib/leagueAdmin.js';
import { loadLeague } from '../../_lib/leagueDb.js';
import { formatShortDate } from '../../_lib/league/time.js';

// GET /api/admin/league/check?competition= -- data warnings: finished matches
// without scores, scores on unplayed matches, old kick-offs still 'scheduled',
// duplicate match numbers, clubs without a crest, pairings that don't meet
// twice, fixtures without a venue.
export async function onRequestGet({ request, env }) {
  const { denied } = await leagueAuth(request, env);
  if (denied) return denied;
  try {
    const slug = new URL(request.url).searchParams.get('competition');
    const league = await loadLeague(env, { slug: slug && /^[a-z0-9-]{1,80}$/.test(slug) ? slug : null, publishedOnly: false });
    if (!league) return fail('No competition found.', 404);
    const w = [];
    const add = (level, text, fixtureId = null) => w.push({ level, text, fixtureId });
    const name = f => `Match ${f.match_no} (${f.home?.name} vs ${f.away?.name}${f.kickoff_at ? `, ${formatShortDate(f.kickoff_at)}` : ''})`;
    const int = Number.isInteger;
    const now = Date.now();
    for (const f of league.fixtures) {
      if (['full_time', 'awarded'].includes(f.status) && (!int(f.home_goals) || !int(f.away_goals))) add('bad', `${name(f)} is finished but has no score.`, f.id);
      if (['scheduled', 'postponed', 'cancelled'].includes(f.status) && (int(f.home_goals) || int(f.away_goals))) add('bad', `${name(f)} is ${f.status} but has a score.`, f.id);
      if (['scheduled', 'live', 'half_time'].includes(f.status) && f.kickoff_at && Date.parse(f.kickoff_at) < now - 3 * 3600e3) add('warn', `${name(f)} kicked off over 3 hours ago and is still "${f.status.replace('_', ' ')}": enter the result.`, f.id);
      if (!f.venue_id) add('warn', `${name(f)} has no venue.`, f.id);
      if (f.status === 'postponed' && !f.kickoff_at) add('info', `${name(f)} is postponed and needs a new date.`, f.id);
    }
    const nos = new Map();
    for (const f of league.fixtures) nos.set(f.match_no, (nos.get(f.match_no) || 0) + 1);
    for (const [no, n] of nos) if (n > 1) add('bad', `Match number ${no} is used ${n} times.`);
    for (const t of league.teams) if (!t.crest_url) add('info', `${t.name} has no crest: a badge with its initials is shown.`);
    if (league.competition.type === 'league') {
      for (const a of league.teams) for (const b of league.teams) {
        if (a.id >= b.id) continue;
        const meet = league.fixtures.filter(f => f.status !== 'cancelled' && ((f.home_team_id === a.id && f.away_team_id === b.id) || (f.home_team_id === b.id && f.away_team_id === a.id)));
        if (meet.length !== 2) add('warn', `${a.name} and ${b.name} meet ${meet.length} time${meet.length === 1 ? '' : 's'}, not twice.`);
      }
    }
    return ok({ warnings: w, checkedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[league admin] check', err);
    return fail('Could not check the data.', 500);
  }
}
