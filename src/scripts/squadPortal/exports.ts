// Squad & Staff Data Portal: exports (PDF, Word, Excel, CSV, JSON, Data Package). Built in Phase 6.
export type ExportOpts = { place: 'portal' | 'admin'; format: 'pdf' | 'docx' | 'xlsx' | 'csv' | 'json' | 'zip' | 'records-xlsx' | 'records-pdf'; which: string; season: string; status: (t: string, ok?: boolean) => void; button?: HTMLButtonElement; extra?: Record<string, string> };
export async function runExport(o: ExportOpts) { o.status('Downloads are being added.', false); }
