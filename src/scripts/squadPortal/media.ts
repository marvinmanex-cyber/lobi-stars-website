// Squad & Staff Data Portal and the club review page: photos.
//
// Photos are processed on this device before upload (the website's server has
// no image tools): the browser applies the camera's rotation, re-drawing the
// picture removes all location / EXIF data, the photo is cropped to 4:5 around
// the upper body, and three versions are made: 400 px and 1200 px WebP (JPEG
// where the browser cannot make WebP, e.g. Safari) and a 1200 px JPG. Where the
// browser has a built-in face finder it is used ONLY to centre the crop:
// nothing about the face is stored or sent, and there is no face recognition.
// Quality warnings (never blocks): small, very dark, very blurry.
// The hero photo (wide header of a profile page, added by the club) is cropped
// 16:9 around the middle and also made 2000 px wide.
const MAX_BYTES = 10 * 1024 * 1024;

export type PhotoKind = 'profile' | 'action' | 'hero';
export type Processed = { w400: Blob; w1200: Blob; jpg: Blob; w2000?: Blob; width: number; height: number; warnings: string[]; preview: string };

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    (img.style as any).imageOrientation = 'from-image';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error(/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)
      ? 'This browser cannot open HEIC photos. Use "Take photo", or choose a JPG or PNG (on iPhone: Settings › Camera › Formats › Most Compatible).'
      : 'This file could not be opened as a photo. Choose a JPG, PNG, WebP or HEIC photo.');
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/** The crop box (4:5, or 16:9 for the hero photo): around the face if the browser can find one, otherwise the upper middle of the picture. */
async function cropBox(img: HTMLImageElement, kind: PhotoKind) {
  const w = img.naturalWidth, h = img.naturalHeight, r = kind === 'hero' ? 9 / 16 : 1.25;
  let cw = Math.min(w, Math.round(h / r)), ch = Math.round(cw * r);
  if (ch > h) { ch = h; cw = Math.round(h / r); }
  let cx = (w - cw) / 2, cy = kind === 'profile' ? (h - ch) * 0.2 : (h - ch) / 2;
  const FD = (window as any).FaceDetector;
  if (kind === 'profile' && FD) {
    try {
      const faces = await new FD({ fastMode: true, maxDetectedFaces: 1 }).detect(img);
      const f = faces?.[0]?.boundingBox;
      if (f) { cx = f.x + f.width / 2 - cw / 2; cy = f.y + f.height / 2 - ch * 0.38; }
    } catch { /* no face finder: the upper-middle crop is used */ }
  }
  cx = Math.max(0, Math.min(w - cw, cx)); cy = Math.max(0, Math.min(h - ch, cy));
  return { sx: Math.round(cx), sy: Math.round(cy), sw: cw, sh: ch };
}

function toBlob(c: HTMLCanvasElement, type: string, q: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('The photo could not be prepared.'))), type, q));
}
function draw(img: HTMLImageElement, box: { sx: number; sy: number; sw: number; sh: number }, outW: number) {
  const c = document.createElement('canvas');
  const scale = Math.min(1, outW / box.sw);
  c.width = Math.round(box.sw * scale); c.height = Math.round(box.sh * scale);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, box.sx, box.sy, box.sw, box.sh, 0, 0, c.width, c.height);
  return c;
}
async function webpOrJpeg(c: HTMLCanvasElement) {
  const b = await toBlob(c, 'image/webp', 0.82);
  return b.type === 'image/webp' ? b : toBlob(c, 'image/jpeg', 0.86); // Safari makes PNG when asked for WebP
}

/** Brightness (0–255) and sharpness (variance of the edge filter) on a small grey copy. */
function quality(c: HTMLCanvasElement) {
  const s = document.createElement('canvas'), W = 240;
  s.width = W; s.height = Math.round(W * c.height / c.width);
  const ctx = s.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, s.width, s.height);
  const { data } = ctx.getImageData(0, 0, s.width, s.height);
  const g = new Float32Array(s.width * s.height);
  let sum = 0;
  for (let i = 0; i < g.length; i++) { g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; sum += g[i]; }
  let lap = 0, lap2 = 0, n = 0;
  for (let y = 1; y < s.height - 1; y++) for (let x = 1; x < s.width - 1; x++) {
    const i = y * s.width + x, v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - s.width] - g[i + s.width];
    lap += v; lap2 += v * v; n++;
  }
  const mean = lap / n;
  return { brightness: sum / g.length, sharpness: lap2 / n - mean * mean };
}

export async function processPhoto(file: File, kind: PhotoKind): Promise<Processed> {
  if (file.size > MAX_BYTES) throw new Error('That photo is larger than 10 MB. Choose a smaller one.');
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new Error('Choose a JPG, PNG, WebP or HEIC photo.');
  const img = await loadImage(file);
  const box = await cropBox(img, kind);
  const big = draw(img, box, 1200), small = draw(img, box, 400);
  const [w1200, w400, jpg, w2000] = await Promise.all([webpOrJpeg(big), webpOrJpeg(small), toBlob(big, 'image/jpeg', 0.86), kind === 'hero' ? webpOrJpeg(draw(img, box, 2000)) : Promise.resolve(undefined)]);
  const warnings: string[] = [];
  if (Math.min(img.naturalWidth, img.naturalHeight) < 600 || box.sw < 600) warnings.push('The photo is small (under 600 pixels): it may look blurry on the website.');
  if (kind === 'hero' && box.sw < 1600) warnings.push('For the wide header, a photo at least 1600 pixels wide looks best.');
  const q = quality(big);
  if (q.brightness < 55) warnings.push('The photo is very dark. Good daylight works best.');
  if (q.sharpness < 40) warnings.push('The photo looks blurry. Hold the phone still and tap to focus.');
  return { w400, w1200, jpg, w2000, width: big.width, height: big.height, warnings, preview: URL.createObjectURL(w1200) };
}
