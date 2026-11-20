// Real 3D drinks for the MatchDay Kitchen Drinks stage (owner's request, 20 Nov 2026: "animated and in 3D, not 2D,
// never upside down, looking real"). Plain WebGL, no library (nothing to install, no cost).
//
// "lathe" (bottles and cans): the drink's outline is read from its cut-out photo row by row and spun into a solid
// body of revolution; the photo is the skin (front half as photographed, back half the same label the right way
// round), lit with soft studio light, shine (plastic) or sheen (metal). It turns slowly round, always upright, and
// floats gently. "card" (a group of bottles, a glass with fruit): the photo sways side to side in 3D.
// If WebGL is not available, null is returned and the flat photo stays.

type Mode = 'lathe' | 'card';
type Handle = { destroy(): void };

// ── Small matrix helpers (column-major, like WebGL) ──
const mul = (a: Float32Array, b: Float32Array) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const perspective = (fov: number, aspect: number, near: number, far: number) => { const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far); return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]); };
function lookAt(e: number[], c: number[]) {
  const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
}
const rotY = (a: number) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
const trans = (x: number, y: number, z: number) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
function norm(v: number[]) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function cross(a: number[], b: number[]) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a: number[], b: number[]) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

const VS = `attribute vec3 p; attribute vec3 n; attribute vec2 t;
uniform mat4 model, view, proj; varying vec3 vn; varying vec2 vt; varying vec3 vp;
void main() { vec4 w = model * vec4(p, 1.0); vp = w.xyz; vn = mat3(model) * n; vt = t; gl_Position = proj * view * w; }`;
const FS = `precision mediump float;
uniform sampler2D tex; uniform vec3 eye; uniform float metal; varying vec3 vn; varying vec2 vt; varying vec3 vp;
void main() {
  vec4 c = texture2D(tex, vt);
  if (c.a < 0.45) discard;
  vec3 N = normalize(vn), V = normalize(eye - vp);
  if (dot(N, V) < 0.0) N = -N;
  vec3 key = normalize(vec3(0.55, 0.55, 0.65)), fill = normalize(vec3(-0.7, 0.2, 0.4));
  float d = max(dot(N, key), 0.0) * 0.55 + max(dot(N, fill), 0.0) * 0.18;
  vec3 H = normalize(key + V);
  float spec = pow(max(dot(N, H), 0.0), mix(46.0, 90.0, metal)) * mix(0.45, 0.8, metal);
  float stripe = pow(max(dot(N, normalize(vec3(-0.35, 0.1, 1.0))), 0.0), 60.0) * 0.25;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.35;
  vec3 col = c.rgb * (0.66 + d) + vec3(spec + stripe) + rim * vec3(1.0, 0.82, 0.35);
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}`;

function compile(gl: WebGLRenderingContext) {
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
}

/** The outline of the drink, row by row, from the photo's transparency: [y (0 top..1 bottom), half width (px)]. */
function profile(img: HTMLImageElement) {
  const w = img.naturalWidth, h = img.naturalHeight, cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx2 = cv.getContext('2d', { willReadFrequently: true })!;
  cx2.drawImage(img, 0, 0);
  const data = cx2.getImageData(0, 0, w, h).data, ROWS = 140, rows: [number, number, number][] = [];
  for (let j = 0; j <= ROWS; j++) {
    const y = Math.min(h - 1, Math.round((j / ROWS) * (h - 1)));
    let l = -1, r = -1;
    for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 110) { if (l < 0) l = x; r = x; }
    if (l >= 0) rows.push([y / (h - 1), (r - l) / 2, (l + r) / 2]);
  }
  // Smooth the outline a little (no ragged edges from splashes or droplets).
  return rows.map((row, i) => { const a = rows[Math.max(0, i - 1)], b = rows[Math.min(rows.length - 1, i + 1)]; return [row[0], (a[1] + row[1] * 2 + b[1]) / 4, row[2]] as [number, number, number]; });
}

function latheMesh(img: HTMLImageElement) {
  const W = img.naturalWidth, H = img.naturalHeight, s = 2 / H; // world height 2
  const rows = profile(img), SEG = 48;
  const cx = rows.reduce((a, r) => a + r[2], 0) / rows.length;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  // Two half shells (front as photographed, back the same label read the right way round), so there is no seam
  // smear down the middle.
  for (const back of [false, true]) {
    const base = pos.length / 3;
    for (let j = 0; j < rows.length; j++) {
      const [v, hw] = rows[j], r = hw * s, y = 1 - v * 2;
      const a = rows[Math.max(0, j - 1)], b = rows[Math.min(rows.length - 1, j + 1)];
      const dr = (b[1] - a[1]) * s, dy = -(b[0] - a[0]) * 2;
      const nl = Math.hypot(dr, dy) || 1, nr = -dy / nl, ny = dr / nl; // outward normal of the outline
      for (let i = 0; i <= SEG; i++) {
        const f = -Math.PI / 2 + (i / SEG) * Math.PI + (back ? Math.PI : 0);
        const sin = Math.sin(f), cos = Math.cos(f);
        pos.push(r * sin, y, r * cos);
        nor.push(sin * nr, ny, cos * nr);
        const px = back ? cx - r * sin / s : cx + r * sin / s;
        uv.push(Math.min(1, Math.max(0, px / W)), v);
      }
    }
    const cols = SEG + 1;
    for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < SEG; i++) {
      const p0 = base + j * cols + i, p1 = p0 + 1, p2 = p0 + cols, p3 = p2 + 1;
      idx.push(p0, p2, p1, p1, p2, p3);
    }
  }
  // Top and bottom caps (coloured from the middle of the top and bottom rows).
  for (const top of [true, false]) {
    const row = top ? rows[0] : rows[rows.length - 1], y = 1 - row[0] * 2, r = row[1] * s, centre = pos.length / 3;
    pos.push(0, y, 0); nor.push(0, top ? 1 : -1, 0); uv.push(cx / W, row[0]);
    for (let i = 0; i <= SEG * 2; i++) { const f = (i / (SEG * 2)) * Math.PI * 2; pos.push(r * Math.sin(f), y, r * Math.cos(f)); nor.push(0, top ? 1 : -1, 0); uv.push(cx / W, row[0]); }
    for (let i = 0; i < SEG * 2; i++) idx.push(centre, centre + 1 + i, centre + 2 + i);
  }
  return { pos, nor, uv, idx, halfW: (W / 2) * s };
}
function cardMesh(img: HTMLImageElement) {
  const a = img.naturalWidth / img.naturalHeight, w = a; // height 2, width 2a
  return { pos: [-w, 1, 0, w, 1, 0, -w, -1, 0, w, -1, 0], nor: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], uv: [0, 0, 1, 0, 0, 1, 1, 1], idx: [0, 2, 1, 1, 2, 3], halfW: w };
}

/** Puts the turning 3D drink into `box` (over the flat photo). isRunning() false = hold still (pause, hover, off screen). */
export function mount3D(box: HTMLElement, src: string, mode: Mode, isRunning: () => boolean, metal = false): Promise<Handle | null> {
  const canvas = document.createElement('canvas');
  canvas.className = 'kd-3d-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true }) as WebGLRenderingContext | null;
  if (!gl) return Promise.resolve(null);
  const prog = compile(gl);
  if (!prog) return Promise.resolve(null);
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  return img.decode().then(() => {
    const m = mode === 'lathe' ? latheMesh(img) : cardMesh(img);
    const buf = (data: number[], loc: string, size: number) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW); const l = gl.getAttribLocation(prog, loc); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0); };
    gl.useProgram(prog);
    buf(m.pos, 'p', 3); buf(m.nor, 'n', 3); buf(m.uv, 't', 2);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    const big = m.pos.length / 3 > 65535 && gl.getExtension('OES_element_index_uint');
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(m.idx) : new Uint16Array(m.idx), gl.STATIC_DRAW);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    gl.uniform1f(U('metal'), metal ? 1 : 0);
    gl.enable(gl.DEPTH_TEST);
    box.appendChild(canvas);
    box.classList.add('kd-3d');
    let raf = 0, angle = mode === 'lathe' ? -0.5 : 0, t = 0, last = 0, alive = true;
    const eye = [0, 0.32, 6.2];
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(1, Math.round(box.clientWidth * dpr)), h = Math.max(1, Math.round(box.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const aspect = w / h, fov = 2 * Math.atan(1.12 / 6.2);
      // Fit: the whole drink (height 2, and its width) stays in the box.
      // Visible height at the drink is 2.24 (it is 2 tall); shrink only if it is wider than the box.
      const sc = Math.min(1, (2.24 * aspect) / (2 * m.halfW * 1.08));
      const bob = Math.sin(t * 1.3) * 0.035;
      const turn = mode === 'lathe' ? angle : Math.sin(t * 0.7) * 0.45;
      const model = mul(trans(0, bob, 0), mul(rotY(turn), new Float32Array([sc, 0, 0, 0, 0, sc, 0, 0, 0, 0, sc, 0, 0, 0, 0, 1])));
      gl.uniformMatrix4fv(U('model'), false, model);
      gl.uniformMatrix4fv(U('view'), false, lookAt(eye, [0, 0, 0]));
      gl.uniformMatrix4fv(U('proj'), false, perspective(fov, aspect, 0.1, 50));
      gl.uniform3fv(U('eye'), eye);
      gl.drawElements(gl.TRIANGLES, m.idx.length, big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
    };
    const frame = (now: number) => {
      if (!alive) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      if (isRunning()) { t += dt; angle += dt * 0.75; draw(); }
      raf = requestAnimationFrame(frame);
    };
    draw();
    raf = requestAnimationFrame(frame);
    return { destroy() { alive = false; cancelAnimationFrame(raf); gl.getExtension('WEBGL_lose_context')?.loseContext(); canvas.remove(); box.classList.remove('kd-3d'); } };
  }).catch(() => null);
}
