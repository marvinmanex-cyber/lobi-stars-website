import { getPlayers } from '../../lib/players';


// Published squad list. The server reads this (via env.ASSETS) to check that
// a matchday squad only contains real Lobi Stars players, and to store a
// snapshot of each player's name, number and photo for MOTM voting.
export async function GET() {
  const players = (await getPlayers())
    .sort((a, b) => a.data.number - b.data.number)
    .map(p => ({
      slug: p.id,
      name: p.data.name,
      number: p.data.number,
      position: p.data.position,
      photo: p.data.photo || null,
      isSample: p.data.isSample,
    }));
  return new Response(JSON.stringify(players), { headers: { 'Content-Type': 'application/json' } });
}
