import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { getSources } from '../../_lib/contacts.js';
import { FAN_COLUMNS, queryContacts, exportRow, watDate, watTime } from '../../_lib/fanQuery.js';
import { buildXlsx, buildCsv } from '../../_lib/xlsx.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// GET /api/admin/fans/export?type=xlsx|filtered|marketing|sources[&filters…]
//   xlsx      "Download All Contacts": All Contacts + Summary + one sheet per source
//   filtered  "Download Filtered List": exactly the people matching the filters on screen
//   marketing "Marketing List": only people with marketing consent (with unsubscribe links)
//   sources   source breakdown (CSV)
// One row per person (no duplicates). Needs "can export fan data"; every download is logged.
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env, { needExport: true });
  if (denied) return denied;
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'xlsx';
  const date = watDate();
  const db = env.DB;
  const sources = await getSources(db);
  const labels = Object.fromEntries(sources.map(s => [s.key, s.label]));
  const row = r => exportRow(r, labels);
  const summarySheet = (rows, extra = []) => ({
    name: 'Summary', columns: ['Measure', 'Value'], rows: [
      ['Exported (Nigerian time)', watTime(new Date().toISOString())],
      ['Exported by', admin.name],
      ...extra,
      ['Total unique contacts', rows.length],
      ['Marketing consent = Yes', rows.filter(r => r.marketing_consent).length],
      ['Email verified = Yes', rows.filter(r => r.email_verified).length],
      ['Members', rows.filter(r => r.member).length],
      ['', ''],
      ['WHERE CONTACTS FIRST CAME FROM (each person once, adds up to 100%)', ''],
      ...firstTouch(rows, sources).map(s => [s.label, `${s.contacts} (${s.pct}%)`]),
      ['', ''],
      ['ALL CHANNELS USED (people can use several, so this can add up to more than 100%)', ''],
      ...sourceSummary(rows, sources).map(s => [s.label, `${s.contacts} (${s.pct}%)`]),
    ],
  });

  if (type === 'xlsx') {
    const { rows } = await queryContacts(db, { all: true });
    const sheets = [
      { name: 'All Contacts', columns: FAN_COLUMNS, rows: rows.map(row) },
      summarySheet(rows),
      ...sources.map(s => ({ name: s.label.replace(/[\\/?*[\]:]/g, '&'), columns: FAN_COLUMNS, rows: rows.filter(r => r.sources.includes(s.key)).map(row) })),
    ];
    await logAdminAction(db, admin, 'export_xlsx', `All contacts: ${rows.length} rows`);
    return file(buildXlsx(sheets), `lobi-stars-contacts-${date}.xlsx`, XLSX);
  }

  if (type === 'filtered') {
    const params = new URLSearchParams(url.searchParams);
    params.delete('type');
    const { rows } = await queryContacts(db, { all: true, params });
    const described = [...params].filter(([k]) => !['sort', 'dir', 'page'].includes(k)).map(([k, v]) => `${k}: ${k.endsWith('ource') ? labels[v] || v : v}`).join(', ') || 'none';
    const sheets = [
      { name: 'Filtered Contacts', columns: FAN_COLUMNS, rows: rows.map(row) },
      summarySheet(rows, [['Filters', described]]),
    ];
    await logAdminAction(db, admin, 'export_filtered_xlsx', `Filtered (${described}): ${rows.length} rows`);
    return file(buildXlsx(sheets), `lobi-stars-contacts-filtered-${date}.xlsx`, XLSX);
  }

  if (type === 'marketing') {
    const { rows } = await queryContacts(db, { all: true, marketingOnly: true });
    const origin = url.origin.includes('localhost') || url.origin.includes('127.0.0.1') ? url.origin : 'https://lobistarsfc.com';
    const sheets = [{
      name: 'Marketing List', columns: [...FAN_COLUMNS, 'Unsubscribe Link'],
      rows: rows.map(r => [...row(r), `${origin}/unsubscribe/?t=${r.unsub_token}`]),
    }, summarySheet(rows, [['List', 'Marketing consent = Yes only']])];
    await logAdminAction(db, admin, 'export_marketing_xlsx', `Marketing list: ${rows.length} rows`);
    return file(buildXlsx(sheets), `lobi-stars-marketing-list-${date}.xlsx`, XLSX);
  }

  if (type === 'sources') {
    const { rows } = await queryContacts(db, { all: true });
    const ft = firstTouch(rows, sources);
    const csv = buildCsv(['Source', 'Contacts', '% of all contacts', 'First source (contacts)', 'First source %'],
      sourceSummary(rows, sources).map(s => {
        const f = ft.find(x => x.key === s.key) || { contacts: 0, pct: 0 };
        return [s.label, s.contacts, s.pct, f.contacts, f.pct];
      }).concat([['Total contacts', rows.length, '', '', '']]));
    await logAdminAction(db, admin, 'export_sources_csv', `Source breakdown: ${rows.length} contacts`);
    return file(csv, `lobi-stars-source-breakdown-${date}.csv`, 'text/csv; charset=utf-8');
  }

  return Response.json({ error: 'Unknown export type' }, { status: 400 });
}

const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);

function sourceSummary(rows, sources) {
  return sources.map(({ key, label }) => {
    const n = rows.filter(r => r.sources.includes(key)).length;
    return { key, label, contacts: n, pct: pct(n, rows.length) };
  });
}
function firstTouch(rows, sources) {
  return sources.map(({ key, label }) => {
    const n = rows.filter(r => r.first_source === key).length;
    return { key, label, contacts: n, pct: pct(n, rows.length) };
  });
}

function file(body, name, type) {
  return new Response(body, {
    headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
  });
}
