// Fills a LOCAL test copy of the website with demo data so the admin can be
// tried out: contact, sponsorship and hospitality messages (Inbox), newsletter
// sign-ups (Fan Database, Contact Sources chart), a staff reply, a fan's email
// reply and a private note. Everything goes through the normal website forms
// and admin APIs, exactly as real visitors and staff would.
//
//   BASE=http://127.0.0.1:8833 ADMIN_CODE=... npm run seed:local
//
// Refuses to run against anything except this computer, so it can never add
// demo data to the live site. All demo emails end in @example.com.
const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const CODE = process.env.ADMIN_CODE;
const INBOUND = process.env.INBOX_INBOUND_KEY || 'test-inbound';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error(`Refusing to seed ${BASE}: demo data is only for a local test server (http://127.0.0.1:PORT).`);
  process.exit(1);
}
if (!CODE) { console.error('Set ADMIN_CODE to the local test server\'s admin code.'); process.exit(1); }

const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const tag = Math.random().toString(36).slice(2, 6);
const send = async (path, body, admin = false) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip(), ...(admin ? { 'x-admin-code': CODE } : {}) }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} ${r.status}: ${data.error || ''}`);
  return data;
};

const people = [
  ['Ngozi', 'Okafor'], ['Tersoo', 'Iorver'], ['Aisha', 'Bello'], ['Emeka', 'Nwosu'], ['Doowuese', 'Akaa'], ['Halima', 'Sani'],
];
const messages = [
  { form: 'contact', subject: 'Season tickets', message: 'When do season tickets for the new season go on sale?' },
  { form: 'contact', subject: 'Lost property', message: 'I left a blue cap in the Cover Stand at the last home match.' },
  { form: 'contact', subject: 'Fan club in Abuja', message: 'We would like to register our supporters club in Abuja. Who should we speak to?' },
  { form: 'partnership', interest: 'Official Supplier', company: 'Demo Water Ltd', message: 'We supply bottled water and would like to talk about a partnership.' },
  { form: 'partnership', interest: 'Digital & Social Media Activation', company: 'Demo Media', message: 'Interested in a social media campaign this season.' },
  { form: 'hospitality', guests: 8, message: 'Company outing for eight people, any home match in the next two months.' },
];

let refs = [];
for (const [i, m] of messages.entries()) {
  const [first, last] = people[i];
  const email = `demo-${first.toLowerCase()}-${tag}@example.com`;
  const body = m.form === 'partnership'
    ? { ...m, name: `${first} ${last}`, email, phone: `0803${r7()}`, privacy_consent: true }
    : { ...m, first_name: first, last_name: last, email, phone: `0805${r7()}`, privacy_consent: true };
  const d = await send('/api/enquiry', body);
  refs.push({ ref: d.ref, email, first });
  console.log(`Message ${d.ref} from ${first} ${last} (${m.form})`);
}
for (let i = 0; i < 5; i++) {
  const email = `demo-news${i}-${tag}@example.com`;
  await send('/api/newsletter', { fullName: `Demo Subscriber ${i + 1}`, phone: `0806${r7()}`, email, confirmEmail: email, consent: true, source: 'demo' });
}
console.log('5 newsletter sign-ups');

// A staff reply, the fan's email answer and a private note on the first message.
const list = await (await fetch(`${BASE}/api/admin/inbox?q=${encodeURIComponent(refs[0].email)}`, { headers: { 'x-admin-code': CODE } })).json();
const thread = list.threads?.[0];
if (thread) {
  await send(`/api/admin/inbox/${thread.id}`, { action: 'reply', html: `<p>Hi ${refs[0].first},</p><p>Season tickets go on sale soon. We will announce the date on the website and our social pages.</p>` }, true);
  const r = await fetch(`${BASE}/api/inbox/inbound?key=${encodeURIComponent(INBOUND)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: refs[0].email, to: `reply+${thread.ref}@reply.lobistarsfc.com`, subject: `Re: Season tickets [${thread.ref}]`, text: 'Thank you! Will members get them first?' }) });
  console.log(r.ok ? `Fan replied by email to ${thread.ref}` : `Fan email reply skipped (inbound email not set up on this server: ${r.status})`);
  await send(`/api/admin/inbox/${thread.id}`, { action: 'note', text: 'Check the members priority window before answering.' }, true);
  console.log('Staff reply and private note added');
}
console.log(`\nDone. Open ${BASE}/admin/inbox/ to see the demo messages.`);
