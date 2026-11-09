// MatchDay Kitchen "Pay by bank transfer": Paystack's Pay with Transfer. The fan gets a one-time account
// number from Paystack, sends the money from any bank app, and Paystack confirms it to us automatically
// (the same webhook as card payments), so staff never check transfers by hand. Off until a supervisor
// or Super Admin switches it on in MatchDay Kitchen › Menu and prices (after Paystack has enabled
// "Transfer" on the account that receives food payments).
const KEY = 'payByTransfer';
export async function payTransferOn(db) {
  const v = (await db.prepare(`SELECT value FROM food_settings WHERE key = ?`).bind(KEY).first().catch(() => null))?.value;
  return v === '1';
}
export async function savePayTransfer(db, on, by) {
  await db.prepare(`INSERT INTO food_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(KEY, on ? '1' : '0', new Date().toISOString(), by || null).run();
  return { ok: true, on: !!on };
}
