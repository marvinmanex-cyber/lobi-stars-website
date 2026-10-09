import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { SOURCES } from '../../_lib/contacts.js';
import { FAN_COLUMNS, queryContacts, exportRow, watDate, watTime } from '../../_lib/fanQuery.js';
import { buildXlsx, buildCsv } from '../../_lib/xlsx.js';

// GET /api/admin/fans/export?type=xlsx|sources|marketing
// Needs the "can export fan data" permission. Every download is logged.
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env, { needExport: true });
  if (denied) return denied;
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'xlsx';
  const date = watDate();
  const db = env.DB;

  if (type === 'xlsx') {
    const { rows } = await queryContacts(db, { all: true });
    const all = rows.map(exportRow);
    const summary = sourceSummary(rows);
    const sheets = [
      { name: 'All Contacts', columns: FAN_COLUMNS, rows: all },
      {
        name: 'Summary', columns: ['Measure', 'Value'], rows: [
          ['Export date (WAT)', watTime(new Date().toISOString())],
          ['Exported by', admin.name],
          ['Total contacts', rows.length],
          ['Marketing consent = Y', rows.filter(r => r.marketing_consent).length],
          ['Email verified = Y', rows.filter(r => r.email_verified).length],
          ['Members', rows.filter(r => r.member).length],
          ['', ''],
          ['Source (people can be in more than one, so % can add up to more than 100)', ''],
          ...summary.map(s => [s.label, `${s.contacts} (${s.pct}%)`]),
          ['', ''],
          ['First source (how people first reached us, adds up to 100%)', ''],
          ...firstTouch(rows).map(s => [s.label, `${s.contacts} (${s.pct}%)`]),
        ],
      },
      ...Object.entries(SOURCES).map(([key, label]) => ({
        name: label.replace('/', '&'), columns: FAN_COLUMNS, rows: rows.filter(r => r.sources.includes(key)).map(exportRow),
      })),
    ];
    await logAdminAction(db, admin, 'export_xlsx', `${rows.length} contacts`);
    return file(buildXlsx(sheets), `lobi-stars-fan-database-${date}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  if (type === 'sources') {
    const { rows } = await queryContacts(db, { all: true });
    const ft = firstTouch(rows);
    const csv = buildCsv(['Source', 'Contacts', '% of all contacts', 'First source (contacts)', 'First source %'],
      sourceSummary(rows).map(s => {
        const f = ft.find(x => x.key === s.key) || { contacts: 0, pct: 0 };
        return [s.label, s.contacts, s.pct, f.contacts, f.pct];
      }).concat([['Total contacts', rows.length, '', '', '']]));
    await logAdminAction(db, admin, 'export_sources_csv', `${rows.length} contacts`);
    return file(csv, `lobi-stars-source-breakdown-${date}.csv`, 'text/csv; charset=utf-8');
  }

  if (type === 'marketing') {
    const { rows } = await queryContacts(db, { all: true, marketingOnly: true });
    const origin = url.origin.includes('localhost') || url.origin.includes('127.0.0.1') ? url.origin : 'https://lobistarsfc.com';
    const csv = buildCsv(['First Name', 'Surname', 'Email', 'Phone', 'State', 'Sources', 'Unsubscribe Link'],
      rows.map(r => [r.first_name || '', r.surname || '', r.email || '', r.phone || '', r.state || '',
        r.sources.map(s => SOURCES[s] || s).join(', '), `${origin}/unsubscribe/?t=${r.unsub_token}`]));
    await logAdminAction(db, admin, 'export_marketing_csv', `${rows.length} contacts`);
    return file(csv, `lobi-stars-marketing-list-${date}.csv`, 'text/csv; charset=utf-8');
  }

  return Response.json({ error: 'Unknown export type' }, { status: 400 });
}

const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);

function sourceSummary(rows) {
  return Object.entries(SOURCES).map(([key, label]) => {
    const n = rows.filter(r => r.sources.includes(key)).length;
    return { key, label, contacts: n, pct: pct(n, rows.length) };
  });
}
function firstTouch(rows) {
  return Object.entries(SOURCES).map(([key, label]) => {
    const n = rows.filter(r => r.first_source === key).length;
    return { key, label, contacts: n, pct: pct(n, rows.length) };
  });
}

function file(body, name, type) {
  return new Response(body, {
    headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
  });
}
