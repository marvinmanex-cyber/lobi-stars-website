import qrcodeGenerator from 'qrcode-generator';

// Renders a QR code for `text` as a self-contained SVG string (no external
// requests, safe to inline in emails or HTML pages).
export function qrSvg(text, { size = 240, margin = 4 } = {}) {
  const qr = qrcodeGenerator(0, 'M'); // type 0 = auto-detect version, M = ~15% error correction
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const cell = size / (moduleCount + margin * 2);
  let cells = '';

  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col)) {
        const x = (col + margin) * cell;
        const y = (row + margin) * cell;
        cells += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="#000"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#fff"/>${cells}</svg>`;
}

export function qrSvgDataUri(text, opts) {
  const svg = qrSvg(text, opts);
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
