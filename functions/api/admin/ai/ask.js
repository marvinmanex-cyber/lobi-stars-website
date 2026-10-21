import { aiGuard, json } from '../../_lib/aiApi.js';
import { callClaude, getAiSettings, cleanText, scrubPersonal } from '../../_lib/claude.js';
import { currentInsights } from '../../_lib/analyticsInsights.js';

// POST /api/admin/ai/ask { messages: [{ role, content }] } -- "Ask Claude" on the AI Fix page.
// Only the last 6 messages are sent, with the current findings (totals only); emails and
// phone numbers typed in are removed first. Read-only: Claude has no tools and changes nothing.
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await aiGuard(request, env, { write: true });
  if (denied) return denied;
  const s = await getAiSettings(env.DB);
  if (s.ask_claude_enabled !== '1') return json({ error: 'Ask Claude is switched off in AI Settings.' }, 403);
  const b = await request.json().catch(() => ({}));
  const msgs = (Array.isArray(b.messages) ? b.messages : []).slice(-6)
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: scrubPersonal(cleanText(m.content, { multiline: true })).slice(0, 1500) }))
    .filter(m => m.content);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return json({ error: 'Type a question first.' }, 400);
  const { out } = await currentInsights(env);
  const context = { atAGlance: out.glance, recommendations: out.recs.map(r => r.title) };
  const r = await callClaude(env, {
    feature: 'ask_claude', maxTokens: 600, adminId: admin.id, messages: msgs,
    system: `You help the staff of Lobi Stars FC (Nigerian football club, lobistarsfc.com) understand their website figures and what to do next. Answer briefly (under 150 words) in plain English for non-technical readers. Use only these figures; say so if something isn't in them. You cannot change the website yourself. Plain text, no Markdown.\nCurrent figures (last 28 days): ${JSON.stringify(context)}`,
  });
  return r.ok ? json({ reply: r.text }) : json({ error: r.error }, 400);
}
