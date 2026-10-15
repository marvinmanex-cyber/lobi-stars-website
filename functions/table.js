import { renderLeaguePage } from './api/_lib/leagueRender.js';

// "/table" -- the league table, worked out from the results and rendered on the server.
export const onRequestGet = ({ request, env, waitUntil }) => renderLeaguePage(request, env, 'table', waitUntil);
