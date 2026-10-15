import { renderLeaguePage } from '../api/_lib/leagueRender.js';

// "/fixtures" -- fixtures from the league data, rendered on the server.
export const onRequestGet = ({ request, env, waitUntil }) => renderLeaguePage(request, env, 'fixtures', waitUntil);
