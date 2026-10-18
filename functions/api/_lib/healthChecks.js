// Website Health: the checks. Each check is READ-ONLY and safe: no payments, no
// emails to fans, no data changes. Secret values are never put in a result,
// only whether they are set and work.
//
// A full check runs in steps (healthRun.js) because Cloudflare limits how many
// outside requests and database queries one request may make. Each step here
// returns a list of results:
//   { id, category, name, status: PASS | WARNING | FAIL | SKIPPED, problem, why,
//     fix: [steps], who, fixId (a safe one-click fix, healthFixes.js), details, checkedAt }

export const CATEGORIES = [
  { key: 'pages', label: 'Pages and content', icon: '📄' },
  { key: 'fans', label: 'Fan journeys', icon: '🙋' },
  { key: 'payments', label: 'Payments', icon: '💳' },
  { key: 'email', label: 'Email', icon: '✉️' },
  { key: 'matchday', label: 'Matchday and broadcast', icon: '🏟️' },
  { key: 'tasks', label: 'Background tasks and data', icon: '⚙️' },
  { key: 'security', label: 'Security', icon: '🔐' },
  { key: 'outside', label: 'Outside services', icon: '🔗' },
  { key: 'speed', label: 'Speed (mobile)', icon: '⚡' },
];

const DEV = 'Developer';
const SA = 'Super Admin';

/** What each check is, why it matters and the usual fix (problem text comes from the check). */
export const INFO = {
  // ── Pages and content ──
  pages_status: { category: 'pages', name: 'Every public page opens', who: DEV,
    why: 'A page that shows an error or takes too long loses fans and looks broken to sponsors.',
    fix: ['Open the pages listed in the details on your phone to see the error.', 'If a page was deleted on purpose, remove it from the menu and the sitemap.', 'If it still fails, send the details to the developer.'] },
  broken_links: { category: 'pages', name: 'No broken links or images', who: 'Media team',
    why: 'Links that lead nowhere and missing pictures make the site look unfinished.',
    fix: ['Open the page named in the details.', 'In the Content CMS, find the link or picture and correct it (or remove it).', 'Save, wait 2 minutes for the site to update, then press "Check again".'] },
  aeson_links: { category: 'pages', name: 'No old aesonsports.com links outside Partners', who: 'Media team',
    why: 'Links to the old aesonsports.com address should only appear on the Partners pages.',
    fix: ['Open the page named in the details.', 'In the Content CMS, change the link to the right lobistarsfc.com page.', 'Save, then press "Check again".'] },
  placeholder_text: { category: 'pages', name: 'No placeholder text on public pages', who: 'Media team',
    why: 'Words like "Sample", "TODO", "Lorem" or "₦0" tell fans the page is not finished.',
    fix: ['Open the page named in the details and find the words shown.', 'Replace them with the real text in the Content CMS (or ask the developer if it is not in the CMS).', 'Save, then press "Check again".'] },
  seo_meta: { category: 'pages', name: 'Page titles, descriptions and share pictures', who: 'Media team',
    why: 'Without a title, a description and a share picture, Google results and WhatsApp/Facebook previews look poor.',
    fix: ['Open the page in the Content CMS.', 'Fill in the title, the short description (summary) and the main picture.', 'Save, then press "Check again".'] },
  sitemap_robots: { category: 'pages', name: 'Sitemap and robots.txt; admin hidden from Google', who: DEV,
    why: 'Google uses the sitemap to find every page; the admin area must never appear in search results.',
    fix: ['Open lobistarsfc.com/sitemap.xml and lobistarsfc.com/robots.txt to check they load.', 'Send the details to the developer.'] },
  fixtures_upcoming: { category: 'pages', name: 'Fixtures are up to date', who: 'Matchday Ops Manager',
    why: 'Fans plan their week from the fixtures; an old match still shown as "next" or no fixtures at all looks neglected.',
    fix: ['Go to Admin › Matchday › Match Tickets & Settings (or League › Fixtures).', 'Mark finished matches as full-time and add the next fixtures.', 'Press "Check again".'] },
  league_results: { category: 'pages', name: 'League results entered', who: 'Matchday Ops Manager',
    why: 'The league table is only right when every played match has its result.',
    fix: ['Go to Admin › League › Results.', 'Enter the score of each match listed in the details.', 'Press "Check again".'] },
  shop_products: { category: 'pages', name: 'Shop products have a price and a buy link', who: 'Commercial Manager',
    why: 'A product without a price or a way to buy it frustrates fans who want to spend money with the club.',
    fix: ['Open the Content CMS › Shop.', 'Add the price and the Jumia (buy) link for each product listed in the details, or mark it out of stock.', 'Save, then press "Check again" after about 2 minutes.'] },
  partner_logos: { category: 'pages', name: 'Partners have logos', who: 'Commercial Manager',
    why: 'Sponsors expect to see their logo; a missing logo can upset a partner.',
    fix: ['Open the Content CMS › Partners.', 'Upload the logo for each partner listed in the details.', 'Save, then press "Check again" after about 2 minutes.'] },
  menu_items: { category: 'pages', name: 'Kitchen menu items have prices and photos', who: 'Matchday Ops Manager',
    why: 'Fans order by looking at the photo and the price.',
    fix: ['Go to Admin › Food › Menu.', 'Add a price and a photo (or an emoji) to each item listed in the details.', 'Press "Check again".'] },

  // ── Fan journeys ──
  fan_pages: { category: 'fans', name: 'Sign-up, login and password reset pages', who: DEV,
    why: 'If fans cannot register or sign in, they cannot buy tickets, predict or earn Rewards.',
    fix: ['Open the page listed in the details on your phone.', 'If it shows an error, send the details to the developer.'] },
  fan_endpoints: { category: 'fans', name: 'Forms answer (contact, newsletter, sign-up, login)', who: DEV,
    why: 'A form that errors loses messages, sign-ups and sales.',
    fix: ['Try the form listed in the details yourself.', 'If it shows an error, send the details to the developer.'] },
  feature_pages: { category: 'fans', name: 'Predict & Win, Man of the Match and Rewards pages', who: DEV,
    why: 'These pages keep fans coming back every matchday.',
    fix: ['Open the page listed in the details.', 'If it shows an error, send the details to the developer.'] },
  turnstile: { category: 'fans', name: 'Anti-spam check (Turnstile) set up', who: SA,
    why: 'Without it, robots can flood the forms with fake sign-ups and messages.',
    fix: ['Cloudflare › Turnstile › the "Lobi Stars website" widget.', 'Make sure the secret key is saved as TURNSTILE_SECRET_KEY (Workers & Pages › lobi-stars-website › Settings › Variables and Secrets).', 'Press "Check again".'] },

  // ── Payments ──
  paystack_keys: { category: 'payments', name: 'Paystack keys set (live on the live site)', who: SA,
    why: 'Without the live key no real payment can be taken; test keys on the live site mean fans "pay" with no money arriving.',
    fix: ['Log in to dashboard.paystack.com › Settings › API Keys & Webhooks.', 'Copy the LIVE secret key.', 'In Cloudflare › Workers & Pages › lobi-stars-website › Settings › Variables and Secrets, set PAYSTACK_SECRET_KEY to it.', 'Press "Check again".'] },
  paystack_api: { category: 'payments', name: 'Paystack answers', who: 'Paystack',
    why: 'The website asks Paystack to confirm every payment.',
    fix: ['Check status.paystack.com for an outage.', 'If Paystack is fine, check the secret key (the check above).', 'Press "Check again" later.'] },
  paystack_webhook: { category: 'payments', name: 'Paystack sends payment confirmations', who: SA,
    why: 'Paystack is not sending payment confirmations to the website. Fans\' paid orders may stay "Awaiting payment".',
    fix: ['Log in to dashboard.paystack.com.', 'Go to Settings › API Keys & Webhooks.', 'Make sure the Live Webhook URL is exactly https://lobistarsfc.com/api/paystack-webhook.', 'Save, then press "Check again". If it still fails, send the technical details to the developer.'] },
  food_expiry: { category: 'payments', name: 'Unpaid food orders expire on time', who: DEV,
    why: 'Old unpaid orders should close by themselves so the kitchen board stays clean.',
    fix: ['Press "Fix it" to close the unpaid orders past their time limit.', 'If it keeps happening, tell the developer.'] },
  food_delivery: { category: 'payments', name: 'Paid food orders delivered within an hour', who: 'Matchday Ops Manager',
    why: 'A fan who paid and waited over an hour will complain and may ask for a refund.',
    fix: ['Open the Live Order Board (Admin › Food).', 'Check the orders listed in the details with the kitchen and mark them delivered or refund them.'] },

  // ── Email ──
  email_service: { category: 'email', name: 'Email service (Resend) set up and answering', who: 'Email provider',
    why: 'Tickets, receipts, sign-in links and alerts are sent by email.',
    fix: ['Log in to resend.com › API Keys and check the "Lobi Stars website" key is active (Full access).', 'Check the domain lobistarsfc.com shows Verified under Domains.', 'If you made a new key, save it in Cloudflare as RESEND_API_KEY, then press "Check again".'] },
  email_failures: { category: 'email', name: 'Few failed emails (last 7 days)', who: 'Email provider',
    why: 'Many failed emails can get the club\'s address marked as spam.',
    fix: ['Open resend.com › Emails and look at the failed ones.', 'Remove addresses that keep bouncing from the newsletter list.', 'If many fail, send the details to the developer.'] },
  email_dns: { category: 'email', name: 'Email DNS records (SPF, DKIM, DMARC, replies)', who: SA,
    why: 'Without these records, Gmail and Yahoo put the club\'s emails in spam, and fans\' replies don\'t reach the Inbox.',
    fix: ['Log in to resend.com › Domains › lobistarsfc.com and note the records it shows.', 'In Cloudflare › lobistarsfc.com › DNS, add or correct the missing record from the details.', 'Wait 10 minutes, then press "Check again".'] },
  inbox_waiting: { category: 'email', name: 'Fans\' messages answered within 48 hours', who: 'Fan Support',
    why: 'Fans who wait days for an answer lose trust in the club.',
    fix: ['Open Admin › Inbox.', 'Answer the oldest messages first (listed in the details).'] },

  // ── Matchday and broadcast ──
  stream: { category: 'matchday', name: 'Commentary stream set up (tested around match time)', who: 'Broadcast Operator',
    why: 'Fans who cannot get to the stadium listen to the live commentary.',
    fix: ['Go to Admin › Matchday › Live Commentary.', 'Check the stream address is set and the partner\'s stream is running.', 'Press "Check again".'] },
  stream_hidden: { category: 'matchday', name: 'Partner stream address not shown publicly', who: DEV,
    why: 'The partner\'s own stream address must stay private so the stream goes through the club\'s site.',
    fix: ['Send the details to the developer straight away.'] },
  next_home_match: { category: 'matchday', name: 'Next home match is ready (within 48 hours)', who: 'Matchday Ops Manager',
    why: 'Commentary, the matchday squad for Man of the Match voting and ticket sales should be ready before the match.',
    fix: ['Go to Admin › Matchday › Match Tickets & Settings and Live Match Control.', 'Fix each item listed in the details (commentary on, squad added, ticket sales open).', 'Press "Check again".'] },
  predict_result: { category: 'matchday', name: 'Predict & Win result calculated', who: SA,
    why: 'Fans wait for the winner of each home match; a missing result looks unfair.',
    fix: ['Press "Fix it" to calculate the result of the match in the details.', 'Or open Admin › Matchday › Predict & Win.'] },
  predict_prizes: { category: 'matchday', name: 'Predict & Win prizes paid within 7 days', who: SA,
    why: 'Paying winners quickly keeps the competition trusted.',
    fix: ['Open Admin › Matchday › Predict & Win.', 'Pay the winners listed in the details and press "Mark paid".'] },
  kitchen: { category: 'matchday', name: 'MatchDay Kitchen ready on matchday', who: 'Matchday Ops Manager',
    why: 'On matchday fans expect to order food to their seat.',
    fix: ['Open Admin › Food › Kitchen settings.', 'Set ordering to "Open" or "Automatic" and make sure menu items are available.', 'Press "Check again".'] },

  // ── Background tasks and data ──
  timer_job: { category: 'tasks', name: 'The timer job runs (every minute)', who: DEV,
    why: 'Backups, kitchen alerts, scheduled newsletters, Rewards and these health checks all depend on it.',
    fix: ['Cloudflare › Workers & Pages › lobistars-kitchen-cron › check it is deployed and its Cron Trigger is "* * * * *".', 'Check its CRON_SECRET matches the website\'s.', 'Send the details to the developer if it still fails.'] },
  backup_recent: { category: 'tasks', name: 'Last backup within 24 hours', who: SA,
    why: 'Without a recent backup, data lost by mistake can\'t be fully restored.',
    fix: ['Press "Fix it" to start a backup now.', 'If the dashboard says the backup failed, send the details to the developer.'] },
  restore_test: { category: 'tasks', name: 'A restore tested within 90 days', who: DEV,
    why: 'A backup is only useful if restoring it works.',
    fix: ['Ask the developer to test a restore on a copy (DISASTER-RECOVERY.md).', 'When done, press "Mark restore tested" on this page.'] },
  offsite_copy: { category: 'tasks', name: 'A backup copy kept outside Cloudflare (weekly)', who: SA,
    why: 'If the Cloudflare account were ever lost, this copy is the only way to rebuild the website\'s data.',
    fix: ['Settings › Data Backup › check "Email the encrypted copy every Monday to" is set.', 'Press "Send one now" or "Download encrypted copy".'] },
  jobs_recent: { category: 'tasks', name: 'Scheduled jobs ran on time', who: DEV,
    why: 'Rewards points, scheduled newsletters and the monthly access review run by themselves.',
    fix: ['Press "Fix it" to run the late job now.', 'If it keeps happening, send the details to the developer.'] },
  database: { category: 'tasks', name: 'Database answers quickly and has room', who: 'Hosting provider',
    why: 'Everything fans do is saved in the database.',
    fix: ['Check status.cloudflare.com for a D1 outage.', 'If the database is nearly full, tell the developer (old test data or logs can be archived, or the plan upgraded).'] },
  storage: { category: 'tasks', name: 'File storage reachable (programmes, backups)', who: 'Hosting provider',
    why: 'Match Day Programmes and backups are kept in Cloudflare R2 storage.',
    fix: ['Check status.cloudflare.com for an R2 outage.', 'Send the details to the developer.'] },
  error_log: { category: 'tasks', name: 'Application errors (last 24 hours)', who: DEV,
    why: 'Repeated errors point to a broken feature.',
    fix: ['Cloudflare › Workers & Pages › lobi-stars-website › Functions › Real-time logs (or Observability).', 'Send anything repeated to the developer.'] },

  // ── Security ──
  ssl: { category: 'security', name: 'Secure connection (SSL certificate)', who: 'Hosting provider',
    why: 'Without a valid certificate browsers show a scary warning and payments stop.',
    fix: ['Cloudflare › lobistarsfc.com › SSL/TLS › Edge Certificates: check the certificate is Active.', 'Cloudflare renews it automatically; if not, contact Cloudflare support.'] },
  domain_expiry: { category: 'security', name: 'Domain registration not expiring soon', who: SA,
    why: 'If lobistarsfc.com expires, the whole website and the club\'s email stop working.',
    fix: ['Log in to the company where lobistarsfc.com is registered.', 'Renew it (turn on auto-renew) and check the payment card is valid.'] },
  staff_twostep: { category: 'security', name: 'Every staff account uses two-step login', who: SA,
    why: 'Staff accounts can see fans\' personal data; a password alone is not enough.',
    fix: ['Settings › Login & Security › check "Require two-step login" is on.', 'Ask the people listed in the details to set it up in My account.'] },
  staff_inactive: { category: 'security', name: 'No unused staff accounts (30+ days)', who: SA,
    why: 'Unused accounts are a way in for someone else.',
    fix: ['Settings › Staff Users & Roles.', 'Disable the accounts listed in the details if the person no longer helps the club.'] },
  disabled_sessions: { category: 'security', name: 'Disabled accounts are signed out', who: SA,
    why: 'A disabled account must not still be signed in somewhere.',
    fix: ['Press "Fix it" to sign them out everywhere.'] },
  failed_logins: { category: 'security', name: 'No burst of failed sign-ins (24 hours)', who: SA,
    why: 'Many failed sign-ins can mean someone is guessing passwords.',
    fix: ['Settings › Login & Security › Recent security events: look at the addresses tried.', 'If one staff account is targeted, ask that person to change their password.'] },
  headers: { category: 'security', name: 'Security headers', who: DEV,
    why: 'These tell browsers to block common attacks.',
    fix: ['Send the details to the developer.'] },
  admin_login: { category: 'security', name: 'The admin area needs a login', who: DEV,
    why: 'Nobody should open the admin without signing in.',
    fix: ['Send the details to the developer straight away.'] },
  super_admins: { category: 'security', name: 'Exactly three Super Admins, all with two-step login', who: SA,
    why: 'Only the three agreed people may have full control.',
    fix: ['Settings › Login & Security › The three Super Admins.', 'Ask anyone listed in the details to finish setting up two-step login.', 'The list itself is changed only in Cloudflare (SUPER_ADMIN_EMAILS).'] },
  admin_code: { category: 'security', name: 'Old shared admin code switched off', who: SA,
    why: 'A shared code has no name attached; personal logins are safer.',
    fix: ['Settings › Login & Security › "Switch off the admin code".'] },
  test_switches: { category: 'security', name: 'Testing switches are off on the live site', who: DEV,
    why: 'Testing switches skip payments or show sign-in codes on screen; they must never be on the live site.',
    fix: ['Cloudflare › Workers & Pages › lobi-stars-website › Settings › Variables and Secrets.', 'Delete the variables named in the details.', 'Press "Check again".'] },
  private_files: { category: 'security', name: 'No private files reachable', who: DEV,
    why: 'Configuration files can contain secrets.',
    fix: ['Send the details to the developer straight away.'] },
  dependencies: { category: 'security', name: 'Software libraries without known critical problems', who: DEV,
    why: 'Old libraries can have known security holes.',
    fix: ['The developer runs "npm audit" in the code folder and updates what it reports.'] },

  // ── Outside services ──
  vtu: { category: 'outside', name: 'Airtime/data provider balance', who: 'Commercial Manager',
    why: 'Rewards airtime is only sent when the provider wallet has money.',
    fix: ['No provider is connected: staff send airtime rewards by hand from the Rewards fulfilment queue.'] },
  social_links: { category: 'outside', name: 'Social media links work', who: 'Media team',
    why: 'Fans follow the club from the website\'s social links.',
    fix: ['Admin › Share › Edit platforms.', 'Correct the profile address of each platform listed in the details.', 'Press "Check again".'] },
  push_keys: { category: 'outside', name: 'Phone notification keys set', who: DEV,
    why: 'Match alerts and kitchen order alerts use phone notifications.',
    fix: ['Send the details to the developer (VAPID keys, HANDOVER-TODO.md A5).'] },
  telegram: { category: 'outside', name: 'Telegram kitchen bot answers', who: SA,
    why: 'The kitchen is alerted about new paid orders on Telegram.',
    fix: ['Check the bot in Telegram (@BotFather › your bot).', 'If you made a new token, save it in Cloudflare as TELEGRAM_BOT_TOKEN.'] },

  // ── Speed ──
  speed: { category: 'speed', name: 'Key pages load fast on a phone', who: DEV,
    why: 'Most fans use mobile data; slow pages are abandoned.',
    fix: ['Send the details to the developer (large pictures are the usual cause).'] },
};

export function result(id, status, extra = {}) {
  const i = INFO[id] || { category: 'tasks', name: id, who: DEV, why: '', fix: [] };
  return {
    id, category: i.category, name: i.name, status,
    problem: extra.problem || (status === 'PASS' ? 'Working.' : status === 'SKIPPED' ? 'Not checked.' : ''),
    why: i.why, fix: status === 'PASS' || status === 'SKIPPED' ? [] : (extra.fix || i.fix), who: extra.who || i.who,
    fixId: status === 'PASS' || status === 'SKIPPED' ? null : (extra.fixId || null),
    details: extra.details ?? null, checkedAt: new Date().toISOString(),
  };
}

// ── Helpers ──

export const TIMEOUT_MS = 10000;
const UA = 'LobiStarsFC-WebsiteHealth/1.0';

/** fetch with a time limit. Never throws: { res, ms, error }. */
export async function timedFetch(url, opts = {}, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: 'manual', ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: ctrl.signal });
    return { res, ms: Date.now() - started };
  } catch (err) {
    return { res: null, ms: Date.now() - started, error: err?.name === 'AbortError' ? `No answer within ${ms / 1000} seconds` : String(err?.message || err).slice(0, 200) };
  } finally { clearTimeout(t); }
}
const drain = async res => { try { await res?.body?.cancel(); } catch {} };

/** A promise with a time limit (database work etc.). */
export function withTimeout(p, ms = TIMEOUT_MS, what = 'The check') {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took longer than ${ms / 1000} seconds`)), ms))]);
}

const nowIso = () => new Date().toISOString();
const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
const sqlAgo = h => new Date(Date.now() - h * 3600e3).toISOString().replace('T', ' ').slice(0, 19); // datetime('now') format
const lagosDay = (t = Date.now()) => new Date(t + 3600e3).toISOString().slice(0, 10);
const list = (arr, n = 8) => arr.slice(0, n).join(', ') + (arr.length > n ? ` and ${arr.length - n} more` : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const secs = ms => (ms < 100 ? 'under 0.1 s' : `${(ms / 1000).toFixed(1)} s`);
async function safeAll(db, sql, ...binds) { try { return (await db.prepare(sql).bind(...binds).all()).results || []; } catch { return null; } }
async function safeFirst(db, sql, ...binds) { try { return await db.prepare(sql).bind(...binds).first(); } catch { return null; } }
async function dohRecords(name, type) {
  const { res, error } = await timedFetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { Accept: 'application/dns-json' } }, 6000);
  if (!res || !res.ok) return { error: error || `DNS lookup failed (${res?.status})` };
  const d = await res.json().catch(() => ({}));
  return { records: (d.Answer || []).filter(a => a.type === (type === 'TXT' ? 16 : type === 'MX' ? 15 : type === 'CNAME' ? 5 : a.type)).map(a => String(a.data).replace(/^"|"$/g, '').replace(/" "/g, '')) };
}

// ── PAGES: crawl in chunks ──

const PLACEHOLDERS = [
  { re: /\bLorem ipsum\b/i, label: 'Lorem ipsum' },
  { re: /\bTODO\b/, label: 'TODO' },
  { re: /\bSample\b/, label: 'Sample' },
  { re: /₦\s?0(?![\d.,])/, label: '₦0' },
  { re: /\bundefined\b/, label: 'undefined' },
  { re: /(^|[\s>])null([\s<]|$)/, label: 'null' },
];
// Cart totals that start at "₦0" and are filled in by the page (an element with an id holding only "₦0") are fine.
const withoutLiveTotals = html => html.replace(/<(\w+)\b[^>]*\sid=["'][^"']+["'][^>]*>\s*(Total\s*)?₦\s?0\s*<\/\1>/gi, '');
const textOf = html => withoutLiveTotals(html).replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')) || [])[2] ?? (tag.match(new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, 'i')) || [])[1] ?? null;

/** Step 'site': the list of pages from the sitemap and the main menu, plus robots.txt. */
export async function stepSite(ctx) {
  const { origin } = ctx;
  const urls = new Set(['/']);
  const notes = [];
  const sm = await timedFetch(`${origin}/sitemap.xml`);
  let sitemapOk = false, sitemapCount = 0;
  if (sm.res && sm.res.ok) {
    const xml = await sm.res.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
    sitemapOk = /<urlset/i.test(xml) && locs.length > 0;
    sitemapCount = locs.length;
    for (const l of locs) { try { urls.add(new URL(l).pathname); } catch {} }
  } else { await drain(sm.res); notes.push(`sitemap.xml: ${sm.error || `HTTP ${sm.res?.status}`}`); }
  // The main menu (header and footer links on the homepage).
  const home = await timedFetch(`${origin}/`);
  if (home.res && home.res.ok) {
    const html = (await home.res.text()).replace(/<(script|template)[\s\S]*?<\/\1>/gi, '');
    for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
      const href = attr(m[0], 'href');
      if (!href || /^(mailto:|tel:|#|javascript:|https?:\/\/(?!(www\.)?lobistarsfc\.com))/i.test(href)) continue;
      try { const u = new URL(href, origin); if (u.origin === new URL(origin).origin && !/^\/(api|admin|scan|helper|kitchen)\b/.test(u.pathname) && !/\.(pdf|ics|xml|json|jpg|png|webp)$/i.test(u.pathname)) urls.add(u.pathname); } catch {}
    }
  } else await drain(home.res);
  const rb = await timedFetch(`${origin}/robots.txt`);
  let robots = '';
  if (rb.res && rb.res.ok) robots = await rb.res.text(); else { await drain(rb.res); notes.push(`robots.txt: ${rb.error || `HTTP ${rb.res?.status}`}`); }
  // The admin must not be indexed: a robots rule and a noindex/login wall on an admin page.
  const ad = await timedFetch(`${origin}/admin/`);
  const adminHidden = ad.res ? ([301, 302, 303, 307, 308, 401, 403].includes(ad.res.status) || /noindex/i.test(ad.res.headers.get('X-Robots-Tag') || '')) : false;
  await drain(ad.res);
  const problems = [];
  if (!sitemapOk) problems.push('sitemap.xml is missing or empty');
  if (!robots) problems.push('robots.txt is missing');
  else { if (!/Disallow:\s*\/admin/i.test(robots)) problems.push('robots.txt does not block /admin'); if (!/Sitemap:/i.test(robots)) problems.push('robots.txt does not point to the sitemap'); }
  if (!adminHidden) problems.push('an admin page opened without signing in or without "noindex"');
  ctx.state.urls = [...urls].slice(0, 150);
  ctx.state.found = { links: {}, images: {} };
  ctx.state.pages = {};
  return [result('sitemap_robots', problems.length ? (adminHidden ? 'WARNING' : 'FAIL') : 'PASS', {
    problem: problems.length ? `${problems.join('; ')}.` : `Sitemap lists ${sitemapCount} pages; robots.txt blocks the admin.`,
    details: { sitemapPages: sitemapCount, pagesToCheck: urls.size, notes },
    fixId: problems.length && ctx.env.PAGES_DEPLOY_HOOK ? 'rebuild_site' : null,
  })];
}

/** Step 'pages:<n>': fetch up to 8 pages, note status, speed, links, images, text problems, titles. */
export async function stepPages(ctx, chunk) {
  const { origin, state } = ctx;
  const batch = state.urls.slice(chunk * 8, chunk * 8 + 8);
  await Promise.all(batch.map(async path => {
    const f = await timedFetch(`${origin}${path}`, { redirect: 'follow' });
    const p = { status: f.res?.status || 0, ms: f.ms, error: f.error || null };
    if (f.res && f.res.ok && /html/i.test(f.res.headers.get('Content-Type') || '')) {
      const html = await f.res.text();
      p.kb = Math.round(html.length / 1024);
      const head = html.slice(0, html.search(/<\/head>/i) + 1 || 20000);
      p.title = !!(head.match(/<title>([^<]{3,})<\/title>/i));
      p.desc = /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{10,}/i.test(head) || /<meta[^>]+content=["'][^"']{10,}["'][^>]+name=["']description["']/i.test(head);
      p.og = /<meta[^>]+property=["']og:image["']/i.test(head);
      const text = textOf(html);
      p.words = PLACEHOLDERS.filter(x => x.re.test(text)).map(x => x.label);
      p.aeson = !/^\/partners\b/.test(path) && /aesonsports\.com/i.test(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ''));
      // Links and pictures in the page itself (not inside scripts, which build links in code).
      const markup = html.replace(/<(script|template)[\s\S]*?<\/\1>/gi, '');
      for (const m of markup.matchAll(/<a\b[^>]*>/gi)) {
        const href = attr(m[0], 'href');
        if (!href || /^(mailto:|tel:|#|javascript:|data:)/i.test(href)) continue;
        try { const u = new URL(href, origin + path); if (u.origin === new URL(origin).origin && !/^\/(api|admin)\b/.test(u.pathname)) { const k = u.pathname; if (!state.found.links[k] && !state.urls.includes(k)) state.found.links[k] = path; } } catch {}
      }
      for (const m of markup.matchAll(/<img\b[^>]*>/gi)) {
        const src = attr(m[0], 'src');
        if (!src || /^data:/i.test(src)) continue;
        try { const u = new URL(src, origin + path); if (u.origin === new URL(origin).origin) { const k = u.pathname + u.search; if (!state.found.images[k]) state.found.images[k] = path; } } catch {}
      }
    } else await drain(f.res);
    state.pages[path] = p;
  }));
  return [];
}

/** Step 'links:<n>': check up to 40 internal links/images found on the pages. */
export async function stepLinks(ctx, chunk) {
  const { origin, state } = ctx;
  const all = [...Object.keys(state.found.links).map(k => ['link', k]), ...Object.keys(state.found.images).map(k => ['image', k])];
  const batch = all.slice(chunk * 40, chunk * 40 + 40);
  state.linkStatus ||= {};
  await Promise.all(batch.map(async ([, k]) => {
    // A normal GET (some pages are made on request and don't answer HEAD); the body is not read.
    const f = await timedFetch(`${origin}${k}`, {}, 8000);
    state.linkStatus[k] = f.res ? f.res.status : 0;
    await drain(f.res);
  }));
  return [];
}
const MAX_LINKS = 600; // per run, so a site with thousands of match pages stays quick
export const linkChunks = state => Math.ceil(Math.min(MAX_LINKS, Object.keys(state.found?.links || {}).length + Object.keys(state.found?.images || {}).length) / 40);

/** Step 'pages_final': the page results. */
export async function stepPagesFinal(ctx) {
  const { state } = ctx;
  const pages = Object.entries(state.pages || {});
  const out = [];
  const bad = pages.filter(([, p]) => !p.status || p.status >= 400);
  const slow = pages.filter(([, p]) => p.status && p.status < 400 && p.ms > 5000);
  out.push(result('pages_status', bad.length ? 'FAIL' : slow.length ? 'WARNING' : 'PASS', {
    problem: bad.length ? `${plural(bad.length, 'page')} did not open: ${list(bad.map(([u, p]) => `${u} (${p.error || `error ${p.status}`})`))}.`
      : slow.length ? `${plural(slow.length, 'page')} took more than 5 seconds: ${list(slow.map(([u, p]) => `${u} (${(p.ms / 1000).toFixed(1)} s)`))}.`
      : `All ${pages.length} pages opened.`,
    details: { checked: pages.length, failed: bad.map(([u, p]) => ({ page: u, status: p.status, error: p.error })), slow: slow.map(([u, p]) => ({ page: u, ms: p.ms })) },
  }));
  const ls = state.linkStatus || {};
  const broken = [...Object.entries(state.found?.links || {}).map(([k, from]) => ({ kind: 'link', url: k, from })), ...Object.entries(state.found?.images || {}).map(([k, from]) => ({ kind: 'picture', url: k, from }))]
    .filter(x => x.url in ls && (ls[x.url] === 404 || ls[x.url] === 410 || ls[x.url] === 0));
  out.push(result('broken_links', broken.length > 10 ? 'FAIL' : broken.length ? 'WARNING' : 'PASS', {
    problem: broken.length ? `${plural(broken.length, 'broken link or picture', 'broken links or pictures')}: ${list(broken.map(b => `${b.url} (on ${b.from})`), 6)}.` : `${Object.keys(ls).length} links and pictures checked; none broken.`,
    details: { broken: broken.slice(0, 50), checked: Object.keys(ls).length, found: Object.keys(state.found?.links || {}).length + Object.keys(state.found?.images || {}).length },
  }));
  const aeson = pages.filter(([, p]) => p.aeson).map(([u]) => u);
  out.push(result('aeson_links', aeson.length ? 'WARNING' : 'PASS', { problem: aeson.length ? `aesonsports.com appears on: ${list(aeson)}.` : 'None found outside Partners.', details: { pages: aeson } }));
  const words = pages.filter(([, p]) => p.words?.length).map(([u, p]) => `${u} (${p.words.join(', ')})`);
  out.push(result('placeholder_text', words.length ? 'WARNING' : 'PASS', {
    problem: words.length ? `Placeholder words on ${plural(words.length, 'page')}: ${list(words, 6)}.` : 'None found.',
    details: { pages: words, note: '"Loading…" is not checked: pages fill those boxes in the browser.' },
  }));
  const KEY = ['/', '/tickets/', '/shop/', '/news/', '/fixtures/', '/membership/', '/partners/', '/commentary/', '/rewards/', '/predict-and-win/'];
  const meta = pages.filter(([u, p]) => (KEY.includes(u) || /^\/news\/[^/]+\/$/.test(u)) && p.status === 200 && (!p.title || !p.desc || !p.og))
    .map(([u, p]) => `${u} (${[!p.title && 'title', !p.desc && 'description', !p.og && 'share picture'].filter(Boolean).join(', ')} missing)`);
  out.push(result('seo_meta', meta.length ? 'WARNING' : 'PASS', { problem: meta.length ? list(meta, 6) + '.' : 'Key pages have a title, a description and a share picture.', details: { pages: meta } }));
  return out;
}

/** Step 'content': fixtures, league results, shop, partners and the kitchen menu. */
export async function stepContent(ctx) {
  const { env, origin } = ctx;
  const db = env.DB;
  const out = [];
  // Fixtures (the ticketed matches list).
  const events = await safeAll(db, `SELECT e.id, e.home_team, e.away_team, e.event_date, e.is_home, m.status FROM events e LEFT JOIN match_centre m ON m.event_id = e.id WHERE e.active = 1 ORDER BY e.event_date`);
  if (events === null) out.push(result('fixtures_upcoming', 'SKIPPED', { problem: 'No fixtures table yet.' }));
  else {
    const now = Date.now();
    const stale = events.filter(e => Date.parse(e.event_date) < now - 6 * 3600e3 && !['full-time', 'postponed', 'cancelled', 'abandoned'].includes(e.status || ''));
    const upcoming = events.filter(e => Date.parse(e.event_date) > now);
    const problems = [];
    if (stale.length) problems.push(`${plural(stale.length, 'past match', 'past matches')} still shown as upcoming: ${list(stale.map(e => `${e.home_team} v ${e.away_team} (${lagosDay(Date.parse(e.event_date))})`), 4)}`);
    if (!upcoming.length) problems.push('no upcoming fixtures are listed (fine in the off-season)');
    out.push(result('fixtures_upcoming', problems.length ? 'WARNING' : 'PASS', { problem: problems.length ? `${problems.join('; ')}.` : `${plural(upcoming.length, 'upcoming fixture')} listed; none out of date.`, details: { stale: stale.map(e => e.id), upcoming: upcoming.length } }));
  }
  const unplayed = await safeAll(db, `SELECT f.id, f.kickoff_at, h.name AS home, a.name AS away FROM league_fixtures f JOIN league_teams h ON h.id = f.home_team_id JOIN league_teams a ON a.id = f.away_team_id
    WHERE f.is_published = 1 AND f.status = 'scheduled' AND f.kickoff_at IS NOT NULL AND f.kickoff_at < ? ORDER BY f.kickoff_at DESC LIMIT 30`, ago(72));
  if (unplayed === null) out.push(result('league_results', 'SKIPPED', { problem: 'The league section is not set up.' }));
  else out.push(result('league_results', unplayed.length ? 'WARNING' : 'PASS', {
    problem: unplayed.length ? `${plural(unplayed.length, 'match', 'matches')} played over 3 days ago with no result: ${list(unplayed.map(f => `${f.home} v ${f.away} (${String(f.kickoff_at).slice(0, 10)})`), 4)}. The league table is out of date.` : 'Every played league match has a result.',
    details: { fixtures: unplayed.map(f => f.id) },
  }));
  // Shop and partners: from the list built with the site.
  let content = null;
  try {
    const r = env.ASSETS ? await env.ASSETS.fetch(new Request(`${origin}/admin/health-content.json`)) : null;
    if (r && r.ok) content = await r.json();
  } catch { content = null; }
  if (!content) {
    out.push(result('shop_products', 'SKIPPED', { problem: 'The shop list is made when the site is built; not available here.' }));
    out.push(result('partner_logos', 'SKIPPED', { problem: 'The partner list is made when the site is built; not available here.' }));
  } else {
    const prods = content.products.filter(p => p.inStock && (p.noPrice || p.noBuyLink));
    out.push(result('shop_products', prods.length ? 'WARNING' : 'PASS', { problem: prods.length ? `${plural(prods.length, 'product')} without ${[prods.some(p => p.noPrice) && 'a price', prods.some(p => p.noBuyLink) && 'a buy link'].filter(Boolean).join(' or ')}: ${list(prods.map(p => p.name), 6)}.` : 'Every product in stock has a price and a buy link.', details: { products: prods } }));
    const logos = content.partners.filter(p => p.noLogo);
    out.push(result('partner_logos', logos.length ? 'WARNING' : 'PASS', { problem: logos.length ? `${plural(logos.length, 'partner')} without a logo: ${list(logos.map(p => p.name))}.` : 'Every active partner has a logo.', details: { partners: logos } }));
  }
  const items = await safeAll(db, `SELECT name, price_kobo, photo_id, emoji FROM food_items WHERE archived = 0 AND available = 1`);
  if (items === null) out.push(result('menu_items', 'SKIPPED', { problem: 'MatchDay Kitchen is not set up.' }));
  else {
    const badItems = items.filter(i => !(i.price_kobo > 0) || (!i.photo_id && !i.emoji));
    out.push(result('menu_items', badItems.length ? 'WARNING' : 'PASS', { problem: badItems.length ? `${plural(badItems.length, 'menu item')} without a price or a photo: ${list(badItems.map(i => i.name))}.` : `All ${items.length} available menu items have a price and a photo.`, details: { items: badItems.map(i => i.name) } }));
  }
  return out;
}

// ── FAN JOURNEYS ──
export async function stepFans(ctx) {
  const { env, origin } = ctx;
  const out = [];
  const pagesList = ['/fans/register/', '/fans/login/', '/fans/forgot/', '/contact/', '/newsletter/'];
  const featureList = ['/predict-and-win/', '/man-of-the-match/', '/rewards/'];
  const check = async paths => (await Promise.all(paths.map(async p => { const f = await timedFetch(`${origin}${p}`, { redirect: 'follow' }); await drain(f.res); return { p, status: f.res?.status || 0, error: f.error }; })));
  const pr = await check(pagesList);
  const badP = pr.filter(x => !x.status || x.status >= 400);
  out.push(result('fan_pages', badP.length ? 'FAIL' : 'PASS', { problem: badP.length ? `Not opening: ${list(badP.map(x => `${x.p} (${x.error || x.status})`))}.` : 'Sign-up, login, password reset, contact and newsletter pages open.', details: pr }));
  // Each form is sent an empty request: it must answer "please fill in…" (4xx), never an error (5xx). Nothing is saved.
  const forms = [['/api/newsletter', 'Newsletter'], ['/api/enquiry', 'Contact form'], ['/api/fans/register', 'Fan sign-up'], ['/api/auth/login', 'Fan login'], ['/api/fans/forgot', 'Password reset']];
  const fr = await Promise.all(forms.map(async ([p, label]) => {
    const f = await timedFetch(`${origin}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: '{}' });
    await drain(f.res);
    return { label, path: p, status: f.res?.status || 0, error: f.error };
  }));
  const badF = fr.filter(x => !x.status || x.status >= 500 || x.status === 404);
  out.push(result('fan_endpoints', badF.length ? 'FAIL' : 'PASS', { problem: badF.length ? `Not answering properly: ${list(badF.map(x => `${x.label} (${x.error || `error ${x.status}`})`))}.` : 'Newsletter, contact, sign-up, login and password reset forms answer (tested with an empty form; nothing saved).', details: fr }));
  const fe = await check(featureList);
  const badE = fe.filter(x => !x.status || x.status >= 400);
  out.push(result('feature_pages', badE.length ? 'FAIL' : 'PASS', { problem: badE.length ? `Not opening: ${list(badE.map(x => `${x.p} (${x.error || x.status})`))}.` : 'Predict & Win, Man of the Match and Rewards pages open.', details: fe }));
  out.push(result('turnstile', env.TURNSTILE_SECRET_KEY ? 'PASS' : 'WARNING', { problem: env.TURNSTILE_SECRET_KEY ? 'The anti-spam secret key is set.' : 'TURNSTILE_SECRET_KEY is not set: forms are not protected from robots.' }));
  return out;
}

// ── PAYMENTS ──
export async function stepPayments(ctx) {
  const { env, origin } = ctx;
  const db = env.DB;
  const out = [];
  const key = env.PAYSTACK_SECRET_KEY || '';
  const live = /^sk_live_/.test(key), test = /^sk_test_/.test(key);
  const liveSite = /^https:\/\/(www\.)?lobistarsfc\.com$/i.test(origin);
  if (!key) out.push(result('paystack_keys', 'FAIL', { problem: 'PAYSTACK_SECRET_KEY is not set: no payment can be taken.' }));
  else if (!live && !test) out.push(result('paystack_keys', 'FAIL', { problem: 'PAYSTACK_SECRET_KEY does not look like a Paystack secret key.' }));
  else if (liveSite && test) out.push(result('paystack_keys', 'WARNING', { problem: 'The live website is using Paystack TEST keys: fans can "pay" but no money arrives. Switch to the live key when ready to sell.' }));
  else out.push(result('paystack_keys', 'PASS', { problem: `${live ? 'Live' : 'Test'} secret key set${liveSite ? '' : ' (test site)'}.` }));
  let paidInPaystack = null;
  if (key) {
    const f = await timedFetch(`https://api.paystack.co/transaction?perPage=50&status=success&from=${encodeURIComponent(ago(24))}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!f.res) out.push(result('paystack_api', 'FAIL', { problem: `Paystack did not answer: ${f.error}.`, details: { error: f.error } }));
    else {
      const d = await f.res.json().catch(() => ({}));
      if (f.res.status === 401) out.push(result('paystack_api', 'FAIL', { problem: 'Paystack refused the secret key (it may have been changed or deleted).', who: SA, fix: INFO.paystack_keys.fix, details: { status: 401 } }));
      else if (!f.res.ok) out.push(result('paystack_api', 'WARNING', { problem: `Paystack answered with error ${f.res.status}.`, details: { status: f.res.status, message: d.message } }));
      else { paidInPaystack = Number(d.meta?.total ?? (d.data || []).length); out.push(result('paystack_api', 'PASS', { problem: `Paystack answers (${f.ms} ms). ${plural(paidInPaystack, 'successful payment')} in the last 24 hours.` })); }
    }
  } else out.push(result('paystack_api', 'SKIPPED', { problem: 'No Paystack key to test with.' }));
  const hook = await safeFirst(db, `SELECT value FROM settings WHERE key = 'paystack_last_webhook'`);
  let lastHook = null; try { lastHook = hook ? JSON.parse(hook.value) : null; } catch { lastHook = null; }
  const hookRecent = lastHook && Date.now() - Date.parse(lastHook.at) < 24 * 3600e3;
  if (paidInPaystack && !hookRecent) out.push(result('paystack_webhook', 'FAIL', { problem: `Paystack had ${plural(paidInPaystack, 'successful payment')} in the last 24 hours but sent no confirmation to the website${lastHook ? ` (last one ${lastHook.at.slice(0, 16).replace('T', ' ')} UTC)` : ''}. Fans' paid orders may stay "Awaiting payment".`, details: { lastWebhook: lastHook?.at || null, paidLast24h: paidInPaystack } }));
  else out.push(result('paystack_webhook', 'PASS', { problem: lastHook ? `Last confirmation from Paystack: ${lastHook.at.slice(0, 16).replace('T', ' ')} UTC (signature checked on every one).` : 'No payments yet, so no confirmations expected. Every confirmation\'s signature is checked.', details: { lastWebhook: lastHook?.at || null } }));
  const stuck = await safeFirst(db, `SELECT COUNT(*) AS n FROM food_orders WHERE order_status IN ('AWAITING_PAYMENT', 'AWAITING_WHATSAPP') AND expires_at IS NOT NULL AND expires_at < ?`, ago(0.25));
  if (stuck === null) out.push(result('food_expiry', 'SKIPPED', { problem: 'MatchDay Kitchen is not set up.' }));
  else out.push(result('food_expiry', stuck.n ? 'WARNING' : 'PASS', { problem: stuck.n ? `${plural(stuck.n, 'unpaid food order')} past the time limit still open.` : 'Unpaid orders close on time.', fixId: stuck.n ? 'expire_food' : null }));
  const late = await safeAll(db, `SELECT ref, order_status, paid_iso FROM food_orders WHERE order_status IN ('PAID', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY') AND paid_iso IS NOT NULL AND paid_iso < ? AND paid_iso > ? ORDER BY paid_iso LIMIT 20`, ago(1), ago(12));
  if (late === null) out.push(result('food_delivery', 'SKIPPED', { problem: 'MatchDay Kitchen is not set up.' }));
  else out.push(result('food_delivery', late.length ? 'WARNING' : 'PASS', { problem: late.length ? `${plural(late.length, 'paid order')} not delivered after an hour: ${list(late.map(o => o.ref))}.` : 'No paid order waiting more than an hour.', details: { orders: late } }));
  return out;
}

// ── EMAIL ──
export async function stepEmail(ctx) {
  const { env } = ctx;
  const db = env.DB;
  const out = [];
  const domain = (String(env.RESEND_FROM || '').match(/@([^>\s]+)/) || [])[1] || 'lobistarsfc.com';
  if (!env.RESEND_API_KEY) out.push(result('email_service', 'FAIL', { problem: 'RESEND_API_KEY is not set: no emails are sent (tickets, receipts, sign-in links).' }));
  else {
    const f = await timedFetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    if (!f.res) out.push(result('email_service', 'FAIL', { problem: `Resend did not answer: ${f.error}.` }));
    else if (f.res.status === 401 || f.res.status === 403) { await drain(f.res); out.push(result('email_service', 'WARNING', { problem: 'Resend answers but the key cannot list domains (it may be a "sending only" key; replies to the Inbox need Full access).', details: { status: f.res.status } })); }
    else if (!f.res.ok) { await drain(f.res); out.push(result('email_service', 'WARNING', { problem: `Resend answered with error ${f.res.status}.` })); }
    else {
      const d = await f.res.json().catch(() => ({}));
      const dom = (d.data || []).find(x => x.name === domain);
      out.push(result('email_service', dom && dom.status === 'verified' ? 'PASS' : 'FAIL', { problem: dom ? (dom.status === 'verified' ? `Resend answers; ${domain} is verified.` : `${domain} is "${dom.status}" in Resend, not verified: emails may not send.`) : `${domain} is not added in Resend.`, details: { domains: (d.data || []).map(x => ({ name: x.name, status: x.status })) } }));
    }
  }
  const nd = await safeFirst(db, `SELECT COUNT(*) AS n, SUM(CASE WHEN status LIKE 'fail%' OR status IN ('bounced', 'error', 'complained') THEN 1 ELSE 0 END) AS bad FROM newsletter_deliveries WHERE at >= ?`, ago(24 * 7));
  if (!nd || !nd.n) out.push(result('email_failures', 'PASS', { problem: 'No newsletter sends in the last 7 days to measure.' }));
  else { const rate = (nd.bad || 0) / nd.n; out.push(result('email_failures', rate > 0.05 ? 'WARNING' : 'PASS', { problem: `${nd.bad || 0} of ${nd.n} newsletter emails failed in the last 7 days (${(rate * 100).toFixed(1)}%).` })); }
  const [spf, dkim, dmarc, mx] = await Promise.all([dohRecords(`send.${domain}`, 'TXT'), dohRecords(`resend._domainkey.${domain}`, 'TXT'), dohRecords(`_dmarc.${domain}`, 'TXT'), env.INBOX_REPLY_DOMAIN ? dohRecords(env.INBOX_REPLY_DOMAIN, 'MX') : Promise.resolve(null)]);
  const missing = [];
  if (!spf.records?.some(r => /v=spf1/i.test(r))) missing.push(`SPF (TXT on send.${domain})`);
  if (!dkim.records?.some(r => /p=/.test(r))) missing.push(`DKIM (TXT on resend._domainkey.${domain})`);
  if (!dmarc.records?.some(r => /v=DMARC1/i.test(r))) missing.push(`DMARC (TXT on _dmarc.${domain})`);
  if (mx && !mx.records?.length) missing.push(`MX for replies (${env.INBOX_REPLY_DOMAIN})`);
  out.push(result('email_dns', missing.length ? (missing.length > 1 ? 'FAIL' : 'WARNING') : 'PASS', { problem: missing.length ? `Missing or wrong: ${missing.join(', ')}.` : `SPF, DKIM and DMARC are in place${mx ? ', and the reply address has its MX record' : ''}.`, details: { domain, dmarc: dmarc.records?.[0] || null } }));
  const waiting = await safeAll(db, `SELECT ref, subject, last_in_at FROM inbox_threads WHERE status IN ('new', 'open') AND spam_at IS NULL AND last_in_at IS NOT NULL AND (last_out_at IS NULL OR last_out_at < last_in_at) AND last_in_at < ? ORDER BY last_in_at LIMIT 30`, ago(48));
  if (waiting === null) out.push(result('inbox_waiting', 'SKIPPED', { problem: 'The Inbox is not set up.' }));
  else out.push(result('inbox_waiting', waiting.length ? 'WARNING' : 'PASS', { problem: waiting.length ? `${plural(waiting.length, 'message')} waiting more than 48 hours for an answer (oldest ${String(waiting[0].last_in_at).slice(0, 10)}).` : 'No message waiting more than 48 hours.', details: { refs: waiting.map(w => w.ref) } }));
  return out;
}

// ── MATCHDAY AND BROADCAST ──
export async function stepMatchday(ctx) {
  const { env, origin } = ctx;
  const db = env.DB;
  const out = [];
  const { getSettings, probeStream, commentaryFixtures, commentaryWindow } = await import('./commentary.js');
  const s = await getSettings(env).catch(() => null);
  const rows = await commentaryFixtures(db).catch(() => []);
  const now = Date.now();
  const soon = rows.map(r => ({ r, w: commentaryWindow(r) })).find(x => x.w && x.w.start - 2 * 3600e3 < now && x.w.end > now);
  if (!s) out.push(result('stream', 'SKIPPED', { problem: 'Live Commentary is not set up.' }));
  else if (!s.enabled) out.push(result('stream', 'PASS', { problem: 'Live Commentary is switched off.' }));
  else if (!s.streamUrl) out.push(result('stream', 'WARNING', { problem: 'No commentary stream address is set.' }));
  else {
    const url = env.PARTNER_ORIGIN_STREAM_URL || new URL(s.streamUrl, origin).href;
    const https = /^https:/i.test(url) || s.streamUrl.startsWith('/');
    if (!https) out.push(result('stream', 'WARNING', { problem: 'The stream address is not HTTPS: phones may refuse to play it.' }));
    else if (soon) {
      const p = await probeStream(url);
      out.push(result('stream', p.ok ? 'PASS' : 'FAIL', { problem: p.ok ? `Stream is on air (${p.contentType}).` : `The stream is not playing (${p.error || `HTTP ${p.status}, ${p.contentType}`}) and a match is on or about to start.`, details: { status: p.status, contentType: p.contentType, ms: p.ms, backupSet: !!s.backupUrl } }));
    } else out.push(result('stream', 'PASS', { problem: `Stream address set${s.backupUrl ? ' (with a backup stream)' : ''}. It is tested from 2 hours before a match.` }));
  }
  if (env.PARTNER_ORIGIN_STREAM_URL) {
    let host = ''; try { host = new URL(env.PARTNER_ORIGIN_STREAM_URL).host; } catch {}
    const f = await timedFetch(`${origin}/commentary/`, { redirect: 'follow' });
    const html = f.res && f.res.ok ? await f.res.text() : (await drain(f.res), '');
    out.push(result('stream_hidden', host && html.includes(host) ? 'FAIL' : 'PASS', { problem: host && html.includes(host) ? 'The partner\'s stream address appears in the public commentary page.' : 'The partner\'s address is not shown on the public pages.' }));
  } else out.push(result('stream_hidden', 'PASS', { problem: 'No partner stream address is used.' }));
  // The next home match within 48 hours.
  const next = await safeAll(db, `SELECT e.id, e.home_team, e.away_team, e.event_date, e.commentary_enabled, e.public_sale_at, e.regular_price_kobo, m.squad_json FROM events e LEFT JOIN match_centre m ON m.event_id = e.id WHERE e.active = 1 AND e.is_home = 1 ORDER BY e.event_date`);
  const nh = (next || []).find(e => Date.parse(e.event_date) > now && Date.parse(e.event_date) < now + 48 * 3600e3);
  if (!nh) out.push(result('next_home_match', 'PASS', { problem: 'No home match in the next 48 hours.' }));
  else {
    const miss = [];
    if (s && s.enabled && !s.streamUrl) miss.push('no commentary stream address');
    if (nh.commentary_enabled === 0) miss.push('commentary is off for this match');
    let squad = []; try { squad = JSON.parse(nh.squad_json || '[]'); } catch {}
    if (!squad.length) miss.push('no matchday squad for Man of the Match voting');
    if (nh.public_sale_at && Date.parse(nh.public_sale_at) > now) miss.push('ticket sales are not open yet');
    out.push(result('next_home_match', miss.length ? 'WARNING' : 'PASS', { problem: miss.length ? `${nh.home_team} v ${nh.away_team} (${new Date(Date.parse(nh.event_date) + 3600e3).toISOString().slice(0, 16).replace('T', ' ')}): ${miss.join('; ')}.` : `${nh.home_team} v ${nh.away_team} is ready (commentary, squad, tickets).`, details: { eventId: nh.id } }));
  }
  const lastHome = await safeFirst(db, `SELECT e.id, e.home_team, e.away_team, m.home_score, m.away_score, m.ended_at, r.event_id AS done FROM events e JOIN match_centre m ON m.event_id = e.id LEFT JOIN prediction_results r ON r.event_id = e.id WHERE e.is_home = 1 AND m.status = 'full-time' ORDER BY e.event_date DESC LIMIT 1`);
  const anyPredictions = lastHome ? await safeFirst(db, `SELECT COUNT(*) AS n FROM predictions WHERE event_id = ?`, lastHome.id) : null;
  if (!lastHome) out.push(result('predict_result', 'PASS', { problem: 'No finished home match yet.' }));
  else if (lastHome.done || !anyPredictions?.n) out.push(result('predict_result', 'PASS', { problem: lastHome.done ? `Result calculated for ${lastHome.home_team} v ${lastHome.away_team}.` : 'No predictions were made for the last home match.' }));
  else out.push(result('predict_result', 'WARNING', { problem: `${lastHome.home_team} v ${lastHome.away_team} finished but the Predict & Win result has not been calculated.`, fixId: 'settle_predictions', details: { eventId: lastHome.id } }));
  const unpaid = await safeAll(db, `SELECT event_id, calculated_at FROM prediction_results WHERE winner_member_id IS NOT NULL AND prize_paid = 0 AND calculated_at < ?`, ago(24 * 7));
  out.push(result('predict_prizes', unpaid?.length ? 'WARNING' : 'PASS', { problem: unpaid?.length ? `${plural(unpaid.length, 'prize')} not marked paid after 7 days.` : 'No prize waiting more than 7 days.', details: { events: (unpaid || []).map(u => u.event_id) } }));
  const today = (next || []).find(e => lagosDay(Date.parse(e.event_date)) === lagosDay(now));
  if (!today) out.push(result('kitchen', 'PASS', { problem: 'Not a home matchday.' }));
  else {
    const mode = await safeFirst(db, `SELECT value FROM food_settings WHERE key = 'orderingMode'`);
    const avail = await safeFirst(db, `SELECT COUNT(*) AS n FROM food_items WHERE archived = 0 AND available = 1 AND sold_out = 0`);
    const miss = [];
    if ((mode?.value || 'auto') === 'closed') miss.push('ordering is set to Closed');
    if (!avail?.n) miss.push('no menu items are available');
    out.push(result('kitchen', miss.length ? 'WARNING' : 'PASS', { problem: miss.length ? `Home matchday today: ${miss.join('; ')}.` : `Ordering is ${mode?.value || 'automatic'} with ${avail.n} items available.` }));
  }
  return out;
}

// ── BACKGROUND TASKS AND DATA ──
export async function stepTasks(ctx) {
  const { env } = ctx;
  const db = env.DB;
  const out = [];
  const { securitySettings } = await import('./adminSecurity.js');
  const s = await securitySettings(db);
  const meta = await safeFirst(db, `SELECT value FROM uptime_meta WHERE key = 'last_run'`);
  const lastTick = meta ? Number(meta.value) : 0;
  out.push(result('timer_job', !lastTick ? 'WARNING' : Date.now() - lastTick > 20 * 60000 ? 'FAIL' : 'PASS', { problem: !lastTick ? 'The timer job has never run.' : Date.now() - lastTick > 20 * 60000 ? `The timer job last ran ${Math.round((Date.now() - lastTick) / 60000)} minutes ago (it should run every minute).` : 'The timer job is running.', details: { lastRun: lastTick ? new Date(lastTick).toISOString() : null } }));
  let last = null; try { last = s.auto_backup_last ? JSON.parse(s.auto_backup_last) : null; } catch {}
  let err = null; try { err = s.auto_backup_error ? JSON.parse(s.auto_backup_error) : null; } catch {}
  const age = last ? (Date.now() - Date.parse(last.at)) / 3600e3 : null;
  out.push(result('backup_recent', !env.BACKUP_BUCKET || !env.BACKUP_KEY ? 'FAIL' : !last ? 'WARNING' : age > 26 ? 'FAIL' : err?.error ? 'WARNING' : 'PASS', {
    problem: !env.BACKUP_BUCKET || !env.BACKUP_KEY ? 'Automatic backups are not set up (BACKUP_BUCKET / BACKUP_KEY).' : !last ? 'No automatic backup has finished yet.' : age > 26 ? `The last backup finished ${Math.round(age)} hours ago.` : err?.error ? `Last backup ${last.day}, but a later one failed: ${err.error}.` : `Last backup ${last.day}: ${last.tables} tables, ${Number(last.rows).toLocaleString('en-GB')} rows.`,
    fixId: (!last || age > 26 || err?.error) && env.BACKUP_BUCKET ? 'backup_now' : null,
  }));
  const rt = s.restore_tested_at ? (Date.now() - Date.parse(s.restore_tested_at)) / 864e5 : null;
  out.push(result('restore_test', rt === null ? 'WARNING' : rt > 90 ? 'WARNING' : 'PASS', { problem: rt === null ? 'No restore test has been recorded. (The developer rebuilt an empty database from a backup on 18 Oct 2026 while building the tools.)' : rt > 90 ? `The last restore test was ${Math.round(rt)} days ago.` : `Restore tested ${Math.round(rt)} days ago.`, fixId: rt === null || rt > 90 ? 'mark_restore_tested' : null }));
  const off = s.offsite_copy_at ? (Date.now() - Date.parse(s.offsite_copy_at)) / 864e5 : null;
  out.push(result('offsite_copy', off === null ? 'WARNING' : off > 9 ? 'WARNING' : 'PASS', { problem: off === null ? `No backup copy has been kept outside Cloudflare yet${s.offsite_email ? ' (the first weekly email goes on Monday)' : ''}.` : off > 9 ? `The last copy outside Cloudflare was ${Math.round(off)} days ago.` : `Copy kept outside Cloudflare ${Math.round(off)} days ago${s.offsite_email ? ', emailed every Monday' : ''}.`, fixId: s.offsite_email && (off === null || off > 9) ? 'offsite_send' : null }));
  // Scheduled jobs that record when they ran.
  const late = [];
  const rw = await safeFirst(db, `SELECT value, updated_at FROM settings WHERE key = 'rewards_last_run'`);
  if (rw && rw.updated_at && Date.now() - Date.parse(rw.updated_at.replace(' ', 'T') + 'Z') > 26 * 3600e3) late.push({ job: 'Rewards (points expiry and checks)', fixId: 'run_rewards' });
  const month = lagosDay().slice(0, 7);
  if (s.access_review_month && s.access_review_month !== month && Number(lagosDay().slice(8, 10)) > 3) late.push({ job: 'Monthly staff access review', fixId: 'run_access_review' });
  const due = await safeAll(db, `SELECT id, subject, scheduled_at FROM newsletter_issues WHERE status = 'scheduled' AND scheduled_at < ?`, ago(0.5));
  if (due?.length) late.push({ job: `Scheduled newsletter (${list(due.map(d => d.subject || d.id), 3)})`, fixId: 'run_newsletters' });
  out.push(result('jobs_recent', late.length ? 'WARNING' : 'PASS', { problem: late.length ? `Late: ${late.map(l => l.job).join('; ')}.` : 'Rewards, scheduled newsletters and the access review ran on time.', fixId: late[0]?.fixId || null, details: { late } }));
  // Database: answer time and size (free plan limit 500 MB per database; 10 GB on the paid plan).
  const t0 = Date.now();
  let size = null, dbErr = null;
  try { const r = await withTimeout(db.prepare('SELECT 1 AS ok').run(), 5000, 'The database'); size = r.meta?.size_after ?? null; } catch (e) { dbErr = String(e.message || e); }
  const dbMs = Date.now() - t0;
  const limit = Number(env.D1_LIMIT_MB || 500) * 1024 * 1024;
  out.push(result('database', dbErr ? 'FAIL' : size && size / limit > 0.8 ? 'WARNING' : dbMs > 2000 ? 'WARNING' : 'PASS', { problem: dbErr ? `The database did not answer: ${dbErr}.` : `Answered in ${dbMs} ms${size ? `; ${(size / 1048576).toFixed(1)} MB used of ${Math.round(limit / 1048576)} MB (${((size / limit) * 100).toFixed(0)}%)` : ''}.`, details: { ms: dbMs, bytes: size } }));
  const buckets = [['PROGRAMME_BUCKET', 'Programme files'], ['BACKUP_BUCKET', 'Backups']];
  const bs = await Promise.all(buckets.map(async ([b, label]) => { if (!env[b]) return { label, ok: null }; try { await withTimeout(env[b].list({ limit: 1 }), 6000, label); return { label, ok: true }; } catch (e) { return { label, ok: false, error: String(e.message || e) }; } }));
  const badB = bs.filter(b => b.ok === false), unset = bs.filter(b => b.ok === null);
  out.push(result('storage', badB.length ? 'FAIL' : unset.length ? 'WARNING' : 'PASS', { problem: badB.length ? `Not reachable: ${badB.map(b => b.label).join(', ')}.` : unset.length ? `Not set up: ${unset.map(b => b.label).join(', ')}.` : 'Programme and backup storage reachable.', details: bs }));
  out.push(result('error_log', 'SKIPPED', { problem: 'Error logs are kept by Cloudflare, not readable from the website. Look at them in the Cloudflare dashboard (fix steps).', fix: INFO.error_log.fix }));
  return out;
}

// ── SECURITY ──
export async function stepSecurity(ctx) {
  const { env, origin } = ctx;
  const db = env.DB;
  const out = [];
  const host = new URL(origin).hostname;
  const home = await timedFetch(`${origin}/`);
  const h = home.res?.headers;
  await drain(home.res);
  out.push(result('ssl', !home.res ? 'FAIL' : origin.startsWith('https:') ? 'PASS' : 'SKIPPED', { problem: !home.res ? `The site did not answer over HTTPS: ${home.error}.` : origin.startsWith('https:') ? 'The secure connection works. Cloudflare renews the certificate automatically.' : 'Test site (no HTTPS) - not checked.' }));
  if (/lobistarsfc\.com$/.test(host)) {
    const f = await timedFetch(`https://rdap.verisign.com/com/v1/domain/lobistarsfc.com`, { redirect: 'follow' }, 8000);
    const d = f.res && f.res.ok ? await f.res.json().catch(() => null) : (await drain(f.res), null);
    const exp = d?.events?.find(e => e.eventAction === 'expiration')?.eventDate;
    const days = exp ? (Date.parse(exp) - Date.now()) / 864e5 : null;
    out.push(result('domain_expiry', days === null ? 'SKIPPED' : days < 30 ? (days < 7 ? 'FAIL' : 'WARNING') : 'PASS', { problem: days === null ? 'The expiry date could not be read.' : `lobistarsfc.com is registered until ${exp.slice(0, 10)} (${Math.round(days)} days).` }));
  } else out.push(result('domain_expiry', 'SKIPPED', { problem: 'Test site.' }));
  const { results: staff } = await db.prepare(`SELECT id, name, email, role, totp_enabled, last_login_at, created_at, disabled_at, active, test_account FROM admin_users`).all();
  const active = staff.filter(u => u.active && !u.disabled_at && !u.test_account);
  const noTwo = active.filter(u => !u.totp_enabled && u.role !== 'kitchen_staff' && u.role !== 'gate_staff');
  out.push(result('staff_twostep', noTwo.length ? 'WARNING' : 'PASS', { problem: noTwo.length ? `${plural(noTwo.length, 'staff account')} without two-step login: ${list(noTwo.map(u => u.name))}.` : `All ${active.length} active staff accounts use two-step login.` }));
  const old = active.filter(u => { const t = Date.parse(String(u.last_login_at || u.created_at || '').replace(' ', 'T') + (String(u.last_login_at || u.created_at || '').includes('T') ? '' : 'Z')); return t && Date.now() - t > 30 * 864e5; });
  out.push(result('staff_inactive', old.length ? 'WARNING' : 'PASS', { problem: old.length ? `${plural(old.length, 'account')} not used for 30+ days: ${list(old.map(u => u.name))}.` : 'Every active account was used in the last 30 days.' }));
  const ds = await safeFirst(db, `SELECT COUNT(*) AS n FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id WHERE (u.active = 0 OR u.disabled_at IS NOT NULL) AND s.revoked_at IS NULL AND s.expires_at > ?`, Date.now());
  out.push(result('disabled_sessions', ds?.n ? 'WARNING' : 'PASS', { problem: ds?.n ? `${plural(ds.n, 'session')} still open for disabled accounts.` : 'No disabled account is still signed in.', fixId: ds?.n ? 'end_disabled_sessions' : null }));
  const fl = await safeFirst(db, `SELECT COUNT(*) AS n FROM admin_log WHERE action = 'login_failed' AND ts >= ?`, ago(24));
  out.push(result('failed_logins', (fl?.n || 0) > 50 ? 'WARNING' : 'PASS', { problem: `${fl?.n || 0} failed staff sign-ins in the last 24 hours${(fl?.n || 0) > 50 ? ': someone may be guessing passwords' : ''}.` }));
  if (h) {
    const want = [['Strict-Transport-Security', 'HSTS'], ['X-Content-Type-Options', 'X-Content-Type-Options'], ['Referrer-Policy', 'Referrer-Policy']];
    const miss = want.filter(([k]) => !h.get(k)).map(([, l]) => l);
    if (!h.get('X-Frame-Options') && !/frame-ancestors/i.test(h.get('Content-Security-Policy') || '')) miss.push('X-Frame-Options (or CSP frame-ancestors)');
    const noCsp = !h.get('Content-Security-Policy');
    out.push(result('headers', miss.length ? 'WARNING' : 'PASS', { problem: miss.length ? `Missing on public pages: ${miss.join(', ')}.` : `Security headers present${noCsp ? ' (the public pages have no Content-Security-Policy; the admin has one)' : ''}.`, details: { csp: !noCsp } }));
  } else out.push(result('headers', 'SKIPPED', { problem: 'The homepage did not answer.' }));
  const adm = await timedFetch(`${origin}/admin/dashboard/`);
  const api = await timedFetch(`${origin}/api/admin/dashboard`);
  await drain(adm.res); await drain(api.res);
  const admOk = adm.res && [301, 302, 303, 307, 308, 401, 403].includes(adm.res.status);
  const apiOk = api.res && [401, 403].includes(api.res.status);
  out.push(result('admin_login', admOk && apiOk ? 'PASS' : 'FAIL', { problem: admOk && apiOk ? 'Admin pages and admin data need a login.' : `Opened without signing in: ${[!admOk && `/admin/dashboard/ (${adm.res?.status})`, !apiOk && `/api/admin/dashboard (${api.res?.status})`].filter(Boolean).join(', ')}.` }));
  const { superAdminEmails } = await import('./superAdmins.js');
  const listed = superAdminEmails(env);
  const sa = staff.filter(u => u.role === 'super_admin' && u.active && !u.disabled_at && !u.test_account);
  const saProblems = [];
  if (listed.length !== 3) saProblems.push(`SUPER_ADMIN_EMAILS lists ${listed.length} addresses (should be 3)`);
  const extra = sa.filter(u => !listed.includes(String(u.email).toLowerCase()));
  if (extra.length) saProblems.push(`not on the list but Super Admin: ${list(extra.map(u => u.email))}`);
  const no2 = listed.filter(e => !sa.find(u => String(u.email).toLowerCase() === e && u.totp_enabled));
  if (no2.length) saProblems.push(`without two-step login: ${list(no2)}`);
  out.push(result('super_admins', saProblems.length ? (extra.length ? 'FAIL' : 'WARNING') : 'PASS', { problem: saProblems.length ? `${saProblems.join('; ')}.` : 'Exactly the three listed Super Admins, all with two-step login.' }));
  const { securitySettings } = await import('./adminSecurity.js');
  const sec = await securitySettings(db);
  out.push(result('admin_code', sec.admin_code_off === '1' || !env.ADMIN_CODE ? 'PASS' : 'WARNING', { problem: sec.admin_code_off === '1' || !env.ADMIN_CODE ? 'The old shared admin code is switched off.' : 'The old shared admin code still works.' }));
  const sw = ['FANS_DEV_LINKS', 'SOCIAL_POST_FAKE', 'PAYSTACK_FAKE', 'STAFF_TEST_PASSWORDS'].filter(k => env[k] && /lobistarsfc\.com$/.test(host));
  out.push(result('test_switches', sw.length ? 'FAIL' : 'PASS', { problem: sw.length ? `Testing switches on the live site: ${sw.join(', ')}.` : (/lobistarsfc\.com$/.test(host) ? 'No testing switch is on.' : 'Test site (testing switches allowed).') }));
  const files = ['/.env', '/.dev.vars', '/wrangler.toml', '/.git/config', '/package-lock.json'];
  const fr = await Promise.all(files.map(async p => { const f = await timedFetch(`${origin}${p}`); const ct = f.res?.headers.get('Content-Type') || ''; await drain(f.res); return { p, open: f.res?.status === 200 && !/html/i.test(ct) }; }));
  const exposed = fr.filter(x => x.open).map(x => x.p);
  out.push(result('private_files', exposed.length ? 'FAIL' : 'PASS', { problem: exposed.length ? `Reachable by anyone: ${exposed.join(', ')}.` : 'Configuration files are not reachable.' }));
  out.push(result('dependencies', 'SKIPPED', { problem: 'Can only be checked on the developer\'s computer ("npm audit"), not from the live site.', fix: INFO.dependencies.fix }));
  return out;
}

// ── OUTSIDE SERVICES ──
export async function stepOutside(ctx) {
  const { env } = ctx;
  const db = env.DB;
  const out = [];
  out.push(result('vtu', 'SKIPPED', { problem: 'No airtime/data provider is connected; airtime rewards are sent by staff.' }));
  const plats = await safeAll(db, `SELECT name, profile_url FROM social_platforms WHERE is_enabled = 1`);
  if (!plats) out.push(result('social_links', 'SKIPPED', { problem: 'Share Hub platforms are not set up.' }));
  else {
    const withUrl = plats.filter(p => p.profile_url);
    const missing = plats.filter(p => !p.profile_url && !/whatsapp status|copy/i.test(p.name)).map(p => p.name);
    const res = await Promise.all(withUrl.slice(0, 10).map(async p => { const f = await timedFetch(p.profile_url, { redirect: 'follow' }, 8000); await drain(f.res); return { name: p.name, status: f.res?.status || 0, error: f.error }; }));
    // Instagram, TikTok, X and Facebook often refuse automated checks (403/429): only "not found" counts.
    const broken = res.filter(r => r.status === 404 || r.status === 410 || (!r.status && !/No answer/.test(r.error || '')));
    out.push(result('social_links', broken.length ? 'WARNING' : missing.length ? 'WARNING' : 'PASS', { problem: broken.length ? `Not found: ${list(broken.map(b => b.name))}.` : missing.length ? `No profile address set for: ${list(missing)}.` : `${withUrl.length} social links set and answering.`, details: res }));
  }
  out.push(result('push_keys', env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? 'PASS' : 'WARNING', { problem: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? 'Phone notification keys are set.' : 'VAPID keys are not set: phone notifications (match and kitchen alerts) do not work.' }));
  if (!env.TELEGRAM_BOT_TOKEN) out.push(result('telegram', 'SKIPPED', { problem: 'The Telegram kitchen bot is not set up (optional).' }));
  else {
    const f = await timedFetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`, {}, 6000);
    const ok = f.res && f.res.ok;
    await drain(f.res);
    out.push(result('telegram', ok ? 'PASS' : 'WARNING', { problem: ok ? 'The Telegram bot answers.' : `The Telegram bot did not answer (${f.res?.status || f.error}).` }));
  }
  return out;
}

// ── SPEED ──
export const SPEED_PAGES = ['/', '/news/', '/fixtures/', '/shop/', '/commentary/'];
export async function stepSpeed(ctx, chunk) {
  const { origin, state } = ctx;
  state.speed ||= [];
  // A news article and a match page from the sitemap, if found.
  const extra = (state.urls || []).filter(u => /^\/news\/[^/]+\/$/.test(u)).slice(0, 1).concat((state.urls || []).filter(u => /^\/(match-centre|matches|m)\/[^/]+/.test(u)).slice(0, 1));
  const pages = [...SPEED_PAGES, ...extra];
  const batch = pages.slice(chunk * 4, chunk * 4 + 4);
  for (const p of batch) {
    const f = await timedFetch(`${origin}${p}`, { redirect: 'follow' });
    if (!f.res || !f.res.ok) { await drain(f.res); state.speed.push({ page: p, error: f.error || `HTTP ${f.res?.status}` }); continue; }
    const html = await f.res.text();
    const ms = f.ms;
    // Page weight (approximate): the page plus its stylesheets, scripts and the first pictures.
    const assets = [...new Set([...html.matchAll(/<(?:link[^>]+rel=["']stylesheet["'][^>]*href|script[^>]+src|img[^>]+src)=["']([^"']+)["']/gi)].map(m => m[1]).filter(u => !/^data:/i.test(u)))].slice(0, 6);
    let bytes = html.length;
    await Promise.all(assets.map(async a => { try { const u = new URL(a, origin + p); const h = await timedFetch(u.href, { method: 'HEAD' }, 5000); bytes += Number(h.res?.headers.get('Content-Length') || 0); await drain(h.res); } catch {} }));
    state.speed.push({ page: p, ms, kb: Math.round(bytes / 1024), assetsCounted: assets.length });
  }
  if (chunk * 4 + 4 < pages.length) return { more: true, results: [] };
  const slow = state.speed.filter(s => s.error || s.ms > 1500 || s.kb > 3072);
  return { more: false, results: [result('speed', slow.some(s => s.error) ? 'FAIL' : slow.length ? 'WARNING' : 'PASS', {
    problem: slow.length ? `${list(slow.map(s => s.error ? `${s.page} (${s.error})` : `${s.page} (${secs(s.ms)}, ${(s.kb / 1024).toFixed(1)} MB)`), 6)}.` : `Key pages answer in under 1.5 s and weigh under 3 MB (${state.speed.map(s => `${s.page} ${secs(s.ms)}`).join(', ')}).`,
    details: { pages: state.speed, note: 'Weight counts the page, its stylesheets, scripts and first pictures. A Google PageSpeed score can be added with a PAGESPEED_API_KEY (to do).' },
  })] };
}
