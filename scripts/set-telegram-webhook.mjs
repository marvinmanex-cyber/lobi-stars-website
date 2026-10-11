// Tells Telegram where to send "✅ Accept" button presses for kitchen alerts.
// Run once (and again if the token or secret changes):
//
//   TELEGRAM_BOT_TOKEN=123:ABC TELEGRAM_WEBHOOK_SECRET=long-random-secret node scripts/set-telegram-webhook.mjs
//
// (Windows PowerShell:  $env:TELEGRAM_BOT_TOKEN="123:ABC"; $env:TELEGRAM_WEBHOOK_SECRET="..."; node scripts/set-telegram-webhook.mjs)
// The same TELEGRAM_WEBHOOK_SECRET must be set on the Cloudflare Pages project.
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const url = process.env.WEBHOOK_URL || 'https://lobistarsfc.com/api/telegram/webhook';
if (!token || !secret) {
  console.error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET first (see the comment at the top of this file).');
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  console.error('TELEGRAM_WEBHOOK_SECRET may only contain letters, numbers, _ and - (1-256 characters).');
  process.exit(1);
}
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url, secret_token: secret, allowed_updates: ['callback_query'], drop_pending_updates: true }),
});
const d = await res.json();
console.log(d.ok ? `Webhook set: ${url}` : `Failed: ${d.description}`);
const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then(r => r.json());
console.log('Telegram says:', JSON.stringify(info.result, null, 2));
process.exit(d.ok ? 0 : 1);
