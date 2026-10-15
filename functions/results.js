import { renderLeaguePage } from './api/_lib/leagueRender.js';

// "/results" -- finished matches from the league data, rendered on the server.
export const onRequestGet = ({ request, env, waitUntil }) => renderLeaguePage(request, env, 'results', waitUntil);
