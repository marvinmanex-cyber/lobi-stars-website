import { normaliseEmail, checkOrigin, requestCode, verifyCode, verifyLinkToken, getFan, jsonWithCookies, INTENTS } from '../../_lib/fanCode.js';
import { validSrc, logCampaignEvent } from '../../_lib/qr.js';
import { checkTurnstile, clientIp, normalizeNigerianPhone, ensureFanSchema } from '../../_lib/fans.js';
import { clearSessionCookie, fanHintCookie } from '../../_lib/session.js';
import { stripTags, ensureProgrammeSchema, getCurrentProgramme } from '../../_lib/programme.js';
import { captureContact } from '../../_lib/contacts.js';
import { ensureNewsletterSchema } from '../../_lib/newsletter.js';

// Fan sign-in with an emailed code (no password):
// POST /api/fan/auth/request  { email, turnstileToken, next, src?, intent? }  -> always { ok: true } (no account enumeration);
//                             the email has the code and a one-tap link (/programme/confirm/)
// POST /api/fan/auth/verify   { email, code, next, src? }      -> { ok, needsProfile, fan: { firstName } } + session cookie
// POST /api/fan/auth/verify-link { email, token, src?, intent? } -> { ok, needsProfile, intent, slug } + session cookie
// src = QR campaign code (e.g. gate), intent = download | read.
// POST /api/fan/auth/profile  { firstName, lastName?, phone?, marketingConsent }  (signed in)
// POST /api/fan/auth/logout
export async function onRequestPost({ request, env, params, waitUntil }) {
  const bad = checkOrigin(request);
  if (bad) return bad;
  try {
    const b = await request.json().catch(() => ({}));
    const action = params.action;

    if (action === 'request') {
      const email = normaliseEmail(b.email);
      if (!email) return jsonWithCookies({ error: 'Please enter a valid email address.' }, [], 400);
      if (!(await checkTurnstile(env, b.turnstileToken, clientIp(request)))) return jsonWithCookies({ error: 'Please complete the human check and try again.' }, [], 400);
      const src = validSrc(b.src), intent = INTENTS.includes(b.intent) ? b.intent : 'download';
      const r = await requestCode(env, request, waitUntil, email, { src, intent });
      if (r.error) return jsonWithCookies({ error: r.error }, [], r.status);
      if (src) logCampaignEvent(env, src, 'signin_started', { request }, waitUntil);
      return jsonWithCookies(r.devCode ? { ok: true, devCode: r.devCode, devLink: r.devLink } : { ok: true });
    }

    if (action === 'verify') {
      const email = normaliseEmail(b.email);
      const code = String(b.code || '').replace(/\s/g, '');
      if (!email) return jsonWithCookies({ error: "That code didn't work. Check it or request a new one." }, [], 400);
      // A brand-new fan who came through a programme link is credited to it.
      let programmeId = null;
      const slug = (String(b.next || '').match(/[?&]slug=([a-z0-9-]{1,120})/) || [])[1];
      if (slug) {
        await ensureProgrammeSchema(env.DB);
        programmeId = (await env.DB.prepare(`SELECT id FROM programmes WHERE slug = ?`).bind(slug).first())?.id ?? null;
      } else if (/^\/programme(\/|\?|$)/.test(String(b.next || ''))) {
        const { getCurrentProgramme } = await import('../../_lib/programme.js');
        programmeId = (await getCurrentProgramme(env.DB)).current?.id ?? null;
      }
      const src = validSrc(b.src);
      const r = await verifyCode(env, email, code, { programmeId, src });
      if (r.error) return jsonWithCookies({ error: r.error }, [], r.status);
      if (src) logCampaignEvent(env, src, 'signin_completed', { request, fanId: r.member.id }, waitUntil);
      return jsonWithCookies({ ok: true, needsProfile: r.needsProfile, fan: { firstName: r.member.first_name || '' } }, r.cookies);
    }

    if (action === 'verify-link') {
      const email = normaliseEmail(b.email);
      if (!email) return jsonWithCookies({ error: "That code didn't work. Check it or request a new one." }, [], 400);
      const src = validSrc(b.src), intent = INTENTS.includes(b.intent) ? b.intent : 'download';
      const current = (await getCurrentProgramme(env.DB)).current;
      const r = await verifyLinkToken(env, email, String(b.token || ''), { programmeId: current?.id ?? null, src });
      if (r.error) return jsonWithCookies({ error: r.error }, [], r.status);
      if (src) logCampaignEvent(env, src, 'signin_completed', { request, fanId: r.member.id }, waitUntil);
      return jsonWithCookies({ ok: true, needsProfile: r.needsProfile, intent, slug: current?.slug || null, fan: { firstName: r.member.first_name || '' } }, r.cookies);
    }

    if (action === 'profile') {
      const fan = await getFan(request, env);
      if (!fan) return jsonWithCookies({ error: 'signin_required' }, [], 401);
      const firstName = stripTags(b.firstName).slice(0, 60);
      const lastName = stripTags(b.lastName).slice(0, 60);
      const errors = {};
      if (!firstName) errors.firstName = 'Please enter your first name.';
      let phone = null;
      if (String(b.phone || '').trim()) {
        phone = normalizeNigerianPhone(b.phone);
        if (!phone) errors.phone = 'Please enter a valid Nigerian mobile number, e.g. 0803 123 4567.';
        else if (await env.DB.prepare(`SELECT 1 FROM members WHERE phone_e164 = ? AND id != ?`).bind(phone, fan.id).first()) errors.phone = 'This phone number is already linked to another account.';
      }
      if (Object.keys(errors).length) return jsonWithCookies({ errors }, [], 400);
      await ensureFanSchema(env.DB);
      const now = new Date().toISOString();
      const consent = b.marketingConsent === true;
      await env.DB.prepare(`UPDATE members SET first_name = ?, last_name = ?, phone = COALESCE(?, phone), phone_e164 = COALESCE(?, phone_e164),
          profile_completed_at = ?, marketing_opt_in = CASE WHEN ? THEN 1 ELSE marketing_opt_in END,
          marketing_consent_at = CASE WHEN ? THEN ? ELSE marketing_consent_at END WHERE id = ?`)
        .bind(firstName, lastName, phone, phone, now, consent ? 1 : 0, consent ? 1 : 0, now, fan.id).run();
      await captureContact(env, { source: 'programme', refTable: 'members', refId: fan.id, email: fan.email, phone, firstName, surname: lastName, consent });
      // One newsletter list: fans who tick the box join it (never removes anyone).
      if (consent) {
        try {
          await ensureNewsletterSchema(env.DB);
          await env.DB.prepare(`INSERT INTO newsletter_subscribers (email, source, full_name, phone_e164, consent_at, updated_at, pref_weekly, pref_matchday)
              VALUES (?, 'programme', ?, ?, ?, ?, 1, 1) ON CONFLICT(email) DO NOTHING`)
            .bind(fan.email, `${firstName} ${lastName}`.trim(), phone, now, now).run();
          await captureContact(env, { source: 'newsletter', refTable: 'newsletter_subscribers', refId: fan.email, email: fan.email, phone, firstName, surname: lastName, consent: true });
        } catch (err) { console.error('[fan] newsletter add', err); }
      }
      return jsonWithCookies({ ok: true, fan: { firstName } });
    }

    if (action === 'logout') {
      return jsonWithCookies({ ok: true }, [clearSessionCookie(), fanHintCookie(false)]);
    }
    return jsonWithCookies({ error: 'Not found' }, [], 404);
  } catch (err) {
    console.error('[fan auth]', err);
    return jsonWithCookies({ error: 'Something went wrong. Please try again.' }, [], 500);
  }
}
