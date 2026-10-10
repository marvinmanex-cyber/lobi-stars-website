import { renderBoardPage } from '../api/_lib/ssr.js';

// "/fixtures" -- upcoming fixtures rendered on the server.
export const onRequestGet = ({ request, env }) => renderBoardPage(request, env, '/fixtures/');
