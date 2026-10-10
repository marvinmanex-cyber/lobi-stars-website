import { renderBoardPage } from './api/_lib/ssr.js';

// "/results" -- results rendered on the server.
export const onRequestGet = ({ request, env }) => renderBoardPage(request, env, '/results/');
