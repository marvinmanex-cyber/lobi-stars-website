import { requireAdminUser } from '../../../_lib/adminEvents.js';
import { logAdminAction } from '../../../_lib/adminSession.js';
import {
  ensureProgrammeSchema, programmeSettings, bucket, r2Keys, isPdf, isJpeg,
  PAGE_COUNT, MAX_IMAGE_BYTES, MAX_COVER_BYTES,
} from '../../../_lib/programme.js';

// POST /api/admin/programmes/:id/upload  (multipart/form-data)
//   pdf, cover (JPEG), page1..page4 (JPEG), pageCount, width1..4, height1..4
// The browser makes the page images with pdf.js, but every file is checked
// again here. Files go under a NEW version folder in R2; only when all of them
// are stored is D1 switched over (one batch), then the old version is deleted.
export async function onRequestPost({ request, env, params, waitUntil }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const b = bucket(env);
  if (!b) return Response.json({ error: 'File storage (R2 bucket PROGRAMME_BUCKET) is not connected yet. See DEPLOYMENT.md, "Match Day Programme".' }, { status: 503 });
  try {
    const db = env.DB;
    await ensureProgrammeSchema(db);
    const p = await db.prepare(`SELECT * FROM programmes WHERE id = ?`).bind(Number(params.id) || 0).first();
    if (!p) return Response.json({ error: 'Programme not found' }, { status: 404 });
    const { maxPdfMb } = await programmeSettings(db);

    let form;
    try { form = await request.formData(); } catch { return Response.json({ error: 'The upload could not be read. Please try again.' }, { status: 400 }); }
    const bytesOf = async f => (f && typeof f === 'object' && 'arrayBuffer' in f ? new Uint8Array(await f.arrayBuffer()) : null);

    if (Number(form.get('pageCount')) !== PAGE_COUNT) return Response.json({ error: `The programme must have exactly ${PAGE_COUNT} pages.` }, { status: 400 });
    const pdf = await bytesOf(form.get('pdf'));
    if (!pdf || !isPdf(pdf)) return Response.json({ error: 'The programme file must be a PDF.' }, { status: 400 });
    if (pdf.length > maxPdfMb * 1024 * 1024) return Response.json({ error: `The PDF is larger than ${maxPdfMb} MB. Please export a smaller file.` }, { status: 413 });
    const cover = await bytesOf(form.get('cover'));
    if (!cover || !isJpeg(cover)) return Response.json({ error: 'The cover image is missing or not a JPEG.' }, { status: 400 });
    if (cover.length > MAX_COVER_BYTES) return Response.json({ error: 'The cover image is larger than 500 KB.' }, { status: 413 });
    const pages = [];
    for (let i = 1; i <= PAGE_COUNT; i++) {
      const img = await bytesOf(form.get(`page${i}`));
      if (!img || !isJpeg(img)) return Response.json({ error: `Page ${i} image is missing or not a JPEG.` }, { status: 400 });
      if (img.length > MAX_IMAGE_BYTES) return Response.json({ error: `Page ${i} image is larger than 2 MB.` }, { status: 413 });
      const dim = n => { const x = Number(form.get(`${n}${i}`)); return Number.isInteger(x) && x > 0 && x < 20000 ? x : null; };
      pages.push({ img, width: dim('width'), height: dim('height') });
    }
    if (form.get(`page${PAGE_COUNT + 1}`)) return Response.json({ error: `The programme must have exactly ${PAGE_COUNT} pages.` }, { status: 400 });

    const version = p.version + 1;
    const keys = r2Keys(p.slug, version);
    const jpeg = { httpMetadata: { contentType: 'image/jpeg' } };
    try {
      await Promise.all([
        b.put(keys.pdf, pdf, { httpMetadata: { contentType: 'application/pdf' } }),
        b.put(keys.cover, cover, jpeg),
        ...pages.map((pg, i) => b.put(keys.pages[i], pg.img, jpeg)),
      ]);
    } catch (err) {
      console.error('[admin programmes] R2 upload', err);
      waitUntil(b.delete([keys.pdf, keys.cover, ...keys.pages]).catch(() => {}));
      return Response.json({ error: 'The files could not be stored. Nothing was changed; please try again.' }, { status: 502 });
    }

    await db.batch([
      db.prepare(`UPDATE programmes SET version = ?, pdf_key = ?, pdf_size_bytes = ?, cover_key = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(version, keys.pdf, pdf.length, keys.cover, p.id),
      db.prepare(`DELETE FROM programme_pages WHERE programme_id = ?`).bind(p.id),
      ...pages.map((pg, i) => db.prepare(`INSERT INTO programme_pages (programme_id, page_number, image_key, width, height) VALUES (?, ?, ?, ?, ?)`)
        .bind(p.id, i + 1, keys.pages[i], pg.width, pg.height)),
    ]);
    if (p.version > 0) {
      const old = r2Keys(p.slug, p.version);
      waitUntil(b.delete([old.pdf, old.cover, ...old.pages]).catch(err => console.error('[admin programmes] old files', err)));
    }
    const total = pdf.length + cover.length + pages.reduce((s, pg) => s + pg.img.length, 0);
    await logAdminAction(db, admin, 'programme_upload', `${p.title}: version ${version}, PDF ${(pdf.length / 1048576).toFixed(1)} MB, ${(total / 1048576).toFixed(1)} MB in total`);
    return Response.json({ ok: true, version, pdfSize: pdf.length });
  } catch (err) {
    console.error('[admin programmes] upload', err);
    return Response.json({ error: 'The upload failed. Please try again.' }, { status: 500 });
  }
}
