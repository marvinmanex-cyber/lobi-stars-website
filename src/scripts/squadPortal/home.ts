// Squad & Staff Data Portal: the home screen (Phase 1: a placeholder until the
// profile screens are added).
import { state, $, esc } from './api';

export async function showHome() {
  $('main').innerHTML = `<p class="sp-kicker">${esc(state.season)} SEASON</p><h1 class="sp-h2">SQUAD &amp; STAFF PROFILES</h1>
    <p class="sp-muted">Signed in. The profile screens open here.</p>`;
}
