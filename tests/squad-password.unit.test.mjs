// Squad portal passwords (no server needed): the rules for a password a Super
// Admin chooses, and the "Forgot the password?" email, which goes ONLY to the
// three Super Admins and carries the new password.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordProblem } from '../functions/api/_lib/squadPortal.js';
import { emailNewPassword } from '../functions/api/_lib/squadNotify.js';

test('a chosen password: 12+ characters, letters and numbers, not the username, not obvious', () => {
  assert.equal(passwordProblem('Golden Eagles 2026', 'lobi-squad'), null);
  assert.match(passwordProblem('Short1', 'lobi-squad'), /12 characters/);
  assert.match(passwordProblem('nonumbershere!!', 'lobi-squad'), /letters and numbers/);
  assert.match(passwordProblem('my-lobi-squad-2026', 'lobi-squad'), /username/);
  assert.match(passwordProblem('password12345', 'x'), /too easy/);
  assert.match(passwordProblem(' padded password 1', 'x'), /space/);
});

test('the new password is emailed only to the Super Admins; nothing is sent without email set up', async () => {
  const req = { name: 'Grace', contact: '0803 555 0000', device: 'Chrome on Android', at: '2026-10-22T12:00:00Z' };
  const env = { RESEND_API_KEY: 'k', SUPER_ADMIN_EMAILS: 'dkakaan@gmail.com, dkakaan@lobistarsfc.com, marvinmanex@gmail.com' };
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return new Response('{"id":"x"}', { status: 200 }); };
  try {
    const to = await emailNewPassword(env, req, 'ABCDE-FGHJK-MNPQR-STUVW', 'lobi-squad');
    assert.deepEqual(to, ['dkakaan@gmail.com', 'dkakaan@lobistarsfc.com', 'marvinmanex@gmail.com']);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].body.to, to, 'only the three Super Admins');
    assert.match(sent[0].body.html, /ABCDE-FGHJK-MNPQR-STUVW/); assert.match(sent[0].body.html, /lobi-squad/); assert.match(sent[0].body.html, /0803 555 0000/);
    assert.deepEqual(await emailNewPassword({ ...env, RESEND_API_KEY: '' }, req, 'x', 'y'), [], 'no email service: nothing sent, so the password is not changed');
    globalThis.fetch = async () => new Response('down', { status: 500 });
    await assert.rejects(emailNewPassword(env, req, 'x', 'y'), 'a failed email is reported, so the password is not changed');
  } finally { globalThis.fetch = real; }
});
