/* ==========================================================================
   AOS · Motor del canvas bidireccional (X e Y)

   - Cámara 2D con suavizado exponencial calculado en requestAnimationFrame:
     es la interpolación de scroll "tipo Lenis" (sin librerías), con inercia.
   - Rueda / trackpad / arrastre / táctil / teclado / minimapa / menú (flyTo).
   - Parallax por capas: cada pieza se mueve con `transform: translate3d()` (solo GPU),
     calculado en el MISMO bucle rAF que la cámara → sin tirones.
   - Capa WebGL propia (sin librerías): lente + ondulación al pasar el cursor o tocar y
     estela cromática según la velocidad. Si WebGL o CORS fallan, la imagen DOM sigue
     visible (degradación elegante).
   - Filtro (buscador): las piezas que no coinciden se atenúan (DOM y WebGL).
   ========================================================================== */
import { clamp, reduceMotion as reduce } from './util.js';

const vp = document.getElementById('viewport');
const back = document.getElementById('back');
const front = document.getElementById('front');
const glc = document.getElementById('gl');
const mmEl = document.getElementById('minimap');
const rootEl = document.documentElement;
const PAR = reduce ? 0 : 1;

let cfg = {};
let vw = window.innerWidth, vh = window.innerHeight, S = 1, dpr = 1;
const cam = { x: 0, y: 0 }, tgt = { x: 0, y: 0 }, vel = { x: 0, y: 0 };
const lim = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
let bnd = { x0: 0, y0: 0, x1: 1, y1: 1 };
let items = [], decor = [], regions = [];
const byEl = new Map();
let blocked = false, running = false, raf = 0, last = 0;
let flight = null, drag = null, suppressClick = false, hovered = null;
let activeRegion = null, activeT = 0, interacted = false, inited = false;
let texCount = 0, mmScale = 1;
let filterSet = null;

/* ======================================================================
   WebGL (plano texturizado por producto)
   ====================================================================== */
const GL = { ok: false, gl: null, v2: false };

const VS = [
  'attribute vec2 aPos;',
  'uniform vec2 uRes; uniform vec4 uRect; uniform float uRot;',
  'varying vec2 vUv;',
  'void main(){',
  '  vUv = aPos;',
  '  vec2 c = uRect.xy + uRect.zw * 0.5;',
  '  vec2 p = (aPos - 0.5) * uRect.zw;',
  '  float s = sin(uRot), co = cos(uRot);',
  '  p = vec2(p.x * co - p.y * s, p.x * s + p.y * co);',
  '  vec2 w = c + p;',
  '  gl_Position = vec4(w.x / uRes.x * 2.0 - 1.0, 1.0 - w.y / uRes.y * 2.0, 0.0, 1.0);',
  '}',
].join('\n');

const FS = [
  '#ifdef GL_FRAGMENT_PRECISION_HIGH',
  'precision highp float;',
  '#else',
  'precision mediump float;',
  '#endif',
  'uniform sampler2D uTex;',
  'uniform vec2 uMouse; uniform vec2 uVel;',
  'uniform float uHover, uTime, uAspect, uImgAspect, uAlpha;',
  'varying vec2 vUv;',
  'void main(){',
  '  float r = uAspect / uImgAspect;',
  '  vec2 sc = r > 1.0 ? vec2(1.0, 1.0 / r) : vec2(r, 1.0);',
  '  vec2 d = vUv - uMouse;',
  '  float dist = length(vec2(d.x * uAspect, d.y));',
  '  float infl = (1.0 - smoothstep(0.0, 0.65, dist)) * uHover;',
  '  vec2 uv = vUv;',
  '  uv -= d * infl * 0.22;',                                                              // lente
  '  uv += normalize(d + vec2(1e-5)) * sin(dist * 34.0 - uTime * 5.0) * 0.0045 * infl;',   // onda
  '  uv = (uv - 0.5) * (1.0 - 0.035 * uHover) + 0.5;',                                     // zoom suave
  '  float v = clamp(length(uVel) * 0.35, 0.0, 1.0);',
  '  uv.x += sin(vUv.y * 6.2831 + uTime * 1.5) * 0.008 * v;',                              // ondulación por velocidad
  '  uv.y += sin(vUv.x * 6.2831 + uTime * 1.3) * 0.008 * v;',
  '  vec2 off = clamp(uVel, -3.0, 3.0) * 0.0022;',                                         // separación cromática
  '  vec2 a = (uv + off - 0.5) * sc + 0.5;',
  '  vec2 b = (uv - 0.5) * sc + 0.5;',
  '  vec2 c = (uv - off - 0.5) * sc + 0.5;',
  '  vec3 col = vec3(texture2D(uTex, a).r, texture2D(uTex, b).g, texture2D(uTex, c).b);',
  '  gl_FragColor = vec4(col, 1.0) * uAlpha;',
  '}',
].join('\n');

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function glInit() {
  try {
    const opts = { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'high-performance' };
    let gl = glc.getContext('webgl2', opts);
    GL.v2 = !!gl;
    if (!gl) gl = glc.getContext('webgl', opts) || glc.getContext('experimental-webgl', opts);
    if (!gl) return false;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    ['uRes', 'uRect', 'uRot', 'uTex', 'uMouse', 'uVel', 'uHover', 'uTime', 'uAspect', 'uImgAspect', 'uAlpha']
      .forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
    gl.uniform1i(U.uTex, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    GL.gl = gl; GL.U = U; GL.prog = prog;
    GL.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;
    GL.ok = true;
    return true;
  } catch (e) {
    console.warn('[AOS] WebGL no disponible, uso modo DOM.', e && e.message);
    GL.ok = false;
    return false;
  }
}

function makeTex(img) {
  const gl = GL.gl;
  let src = img;
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const max = Math.min(GL.maxTex, 1600);
  if (Math.max(nw, nh) > max) {               // limita la memoria de vídeo en móviles
    const k = max / Math.max(nw, nh);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(nw * k)); c.height = Math.max(1, Math.round(nh * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    src = c;
  }
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);   // lanza SecurityError si el CORS falla
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (GL.v2) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
  return t;
}

function tryUpload(it) {
  if (!GL.ok || it.noGL || !it.loaded || it.tex) return;
  try {
    it.tex = makeTex(it.imgEl);
    it.alpha = 0;
    texCount++;
    it.el.classList.add('gl');
  } catch (e) {
    it.noGL = true;                           // CORS o memoria: se queda la imagen DOM
  }
}

function freeTex(it) {
  if (!it.tex || !GL.ok) return;
  GL.gl.deleteTexture(it.tex);
  it.tex = null; texCount--;
  it.el.classList.remove('gl');
}

function glDraw(now) {
  const gl = GL.gl, U = GL.U;
  gl.viewport(0, 0, glc.width, glc.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(U.uRes, vw, vh);
  gl.uniform1f(U.uTime, now / 1000);
  gl.uniform2f(U.uVel, clamp(vel.x / 1000, -3, 3), clamp(vel.y / 1000, -3, 3));
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.vis || !it.tex || it.alpha < 0.001) continue;
    gl.bindTexture(gl.TEXTURE_2D, it.tex);
    gl.uniform4f(U.uRect, it.sx, it.sy, it.W, it.MH);
    gl.uniform1f(U.uRot, it.rot * Math.PI / 180);
    gl.uniform2f(U.uMouse, it.mx, it.my);
    gl.uniform1f(U.uHover, reduce ? 0 : it.hover);
    gl.uniform1f(U.uAspect, it.W / it.MH);
    gl.uniform1f(U.uImgAspect, it.imgAspect);
    gl.uniform1f(U.uAlpha, it.alpha * it.dim);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

/* ======================================================================
   Construcción y layout
   ====================================================================== */
function clearWorld() {
  items.forEach((it) => freeTex(it));
  items = []; decor = []; regions = []; byEl.clear(); texCount = 0;
  back.innerHTML = ''; front.innerHTML = '';
  hovered = null; activeRegion = null;
}

/**
 * data = { items:[{id,el,mediaEl,imgEl,src,x,y,w,pr,d,rot,textH}], decor:[…], regions:[{id,label,cx,cy}], start }
 * opts.keepCamera: al reconstruir tras una actualización del catálogo, no mueve la vista.
 */
function build(data, opts) {
  opts = opts || {};
  const keep = opts.keepCamera ? { x: cam.x, y: cam.y } : null;
  clearWorld();
  (data.items || []).forEach((d) => {
    items.push(Object.assign({
      vis: false, started: false, loaded: false, noGL: false, tex: null, alpha: 0, hover: 0, hoverT: 0,
      mx: 0.5, my: 0.5, imgAspect: 1, sx: 0, sy: 0, shown: false, retried: false, textH: 96, rot: 0, d: 1, pr: 1.25, dim: 1, dimT: 1,
    }, d));
  });
  items.sort((a, b) => a.d - b.d);
  items.forEach((it, i) => {
    it.el.style.display = 'none';
    it.el.style.zIndex = String(10 + i);
    front.appendChild(it.el);
    byEl.set(it.el, it);
    hookImg(it);
  });
  (data.decor || []).forEach((d, i) => {
    const o = Object.assign({ d: 1, rot: 0, vis: false, w: 200, h: 100, sx: 0, sy: 0 }, d);
    const layer = o.layer || (o.d < 1 ? 'back' : (o.d >= 1.3 ? 'top' : 'mid'));
    o.el.style.display = 'none';
    if (layer === 'back') { o.el.style.zIndex = String(i); back.appendChild(o.el); }
    else { o.el.style.zIndex = layer === 'top' ? String(500 + i) : String(5); front.appendChild(o.el); }
    decor.push(o);
  });
  (data.regions || []).forEach((r) => { regions.push(Object.assign({ sx: 0, sy: 0 }, r)); });
  applyFilterNow();
  layout(false);
  if (keep) {
    cam.x = tgt.x = clamp(keep.x, lim.minX, lim.maxX);
    cam.y = tgt.y = clamp(keep.y, lim.minY, lim.maxY);
    wake();
    return;
  }
  let start = null;
  regions.forEach((r) => { if (r.id === data.start) start = r; });
  start = start || regions[0];
  if (start) {
    const cx = start.sx, cy = start.sy;
    cam.x = tgt.x = clamp(cx - vw / 2 - 420 * S, lim.minX, lim.maxX);
    cam.y = tgt.y = clamp(cy - vh / 2 - 260 * S, lim.minY, lim.maxY);
    wake();
    flyPx(cx, cy, { dur: reduce ? 0.01 : 1.9, id: start.id, bias: true });
  } else { wake(); }
}

function hookImg(it) {
  const img = it.imgEl;
  if (!img) return;
  img.addEventListener('load', () => {
    it.loaded = true;
    it.imgAspect = (img.naturalWidth && img.naturalHeight) ? img.naturalWidth / img.naturalHeight : 1;
    it.el.classList.add('is-loaded');
    tryUpload(it);
    wake();
  });
  img.addEventListener('error', () => {
    if (!it.retried && it.src) {              // reintento sin CORS: se ve la imagen, sin shader
      it.retried = true; it.noGL = true;
      img.removeAttribute('crossorigin');
      img.src = it.src;
    }
  });
}

function startImg(it) {
  it.started = true;
  if (!it.src) return;
  it.imgEl.crossOrigin = 'anonymous';
  it.imgEl.decoding = 'async';
  it.imgEl.src = it.src;
}

function layout(keepCenter) {
  const oS = S, ovw = vw, ovh = vh;
  const wcx = (cam.x + ovw / 2) / oS, wcy = (cam.y + ovh / 2) / oS;
  vw = vp.clientWidth || window.innerWidth;
  vh = vp.clientHeight || window.innerHeight;
  S = clamp(vw / 1280, 0.5, 1);
  rootEl.style.setProperty('--S', S.toFixed(4));
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  glc.width = Math.round(vw * dpr);
  glc.height = Math.round(vh * dpr);

  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const grow = (a, b, c, d) => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); };

  items.forEach((it) => {
    it.x0 = it.x * S; it.y0 = it.y * S;
    it.W = it.w * S; it.MH = it.W * it.pr; it.H = it.MH + it.textH * Math.max(0.8, S);
    it.cx = it.x0 + it.W / 2; it.cy = it.y0 + it.MH / 2;
    it.el.style.width = it.W.toFixed(1) + 'px';
    it.mediaEl.style.height = it.MH.toFixed(1) + 'px';
    it.el.style.transformOrigin = '50% ' + (it.MH / 2).toFixed(1) + 'px';
    grow(it.x0, it.y0 - 60 * S, it.x0 + it.W, it.y0 + it.H);
  });
  decor.forEach((o) => {
    o.x0 = o.x * S; o.y0 = o.y * S; o.W = o.w * S; o.H = o.h * S;
    o.cx = o.x0 + o.W / 2; o.cy = o.y0 + o.H / 2;
    if (o.d >= 0.9 && o.d <= 1.1) grow(o.x0, o.y0, o.x0 + o.W, o.y0 + o.H);
  });
  regions.forEach((r) => { r.sx = r.cx * S; r.sy = r.cy * S; grow(r.sx - 160 * S, r.sy - 160 * S, r.sx + 160 * S, r.sy + 160 * S); });
  if (x0 > x1) { x0 = 0; y0 = 0; x1 = vw; y1 = vh; }
  bnd = { x0, y0, x1, y1 };
  const pad = Math.min(vw, vh) * 0.12;
  lim.minX = x0 - pad; lim.maxX = Math.max(lim.minX, x1 - vw + pad);
  lim.minY = y0 - pad; lim.maxY = Math.max(lim.minY, y1 - vh + pad);

  if (keepCenter) {
    cam.x = tgt.x = clamp(wcx * S - vw / 2, lim.minX, lim.maxX);
    cam.y = tgt.y = clamp(wcy * S - vh / 2, lim.minY, lim.maxY);
  }
  buildMini();
  wake();
}

/* ======================================================================
   Bucle de render (UN solo requestAnimationFrame para cámara, parallax y WebGL)
   ====================================================================== */
function wake() {
  if (blocked) return;
  if (!running) { running = true; last = performance.now(); }
  if (!raf) raf = requestAnimationFrame(frame);
}

function frame(now) {
  raf = 0;
  if (!running) return;
  if (blocked) { running = false; return; }
  const dt = clamp((now - last) / 1000, 0.001, 0.05);
  last = now;
  const px = cam.x, py = cam.y;

  if (flight) {
    const p = clamp((now - flight.t0) / flight.d, 0, 1);
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    cam.x = flight.x0 + (flight.x1 - flight.x0) * e;
    cam.y = flight.y0 + (flight.y1 - flight.y0) * e;
    tgt.x = cam.x; tgt.y = cam.y;
    if (p >= 1) { const f = flight; flight = null; if (cfg.onFlightEnd) cfg.onFlightEnd(f.id); }
  } else {
    // interpolación exponencial hacia el objetivo (scroll suavizado, independiente de los FPS)
    const k = 1 - Math.exp(-dt * ((drag && drag.moved) ? 28 : (reduce ? 40 : 8.5)));
    cam.x += (tgt.x - cam.x) * k;
    cam.y += (tgt.y - cam.y) * k;
    if (Math.abs(tgt.x - cam.x) < 0.04) cam.x = tgt.x;
    if (Math.abs(tgt.y - cam.y) < 0.04) cam.y = tgt.y;
  }
  vel.x += ((cam.x - px) / dt - vel.x) * 0.25;
  vel.y += ((cam.y - py) / dt - vel.y) * 0.25;
  if (Math.abs(vel.x) < 0.5) vel.x = 0;
  if (Math.abs(vel.y) < 0.5) vel.y = 0;

  let anim = false;
  const hk = 1 - Math.exp(-dt * 10);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const dh = it.hoverT - it.hover;
    if (Math.abs(dh) > 0.002) { it.hover += dh * hk; anim = true; } else it.hover = it.hoverT;
    const dd = it.dimT - it.dim;
    if (Math.abs(dd) > 0.004) { it.dim += dd * (1 - Math.exp(-dt * 9)); anim = true; } else it.dim = it.dimT;
    if (it.tex && it.alpha < 1) { it.alpha = Math.min(1, it.alpha + dt * 2.4); anim = true; }
  }
  if (hovered) anim = true;

  placeAll();
  if (GL.ok) glDraw(now);
  tickActive(now);
  drawMini();
  vp.style.setProperty('--bgx', (-(cam.x * 0.6) % 34).toFixed(1) + 'px');
  vp.style.setProperty('--bgy', (-(cam.y * 0.6) % 34).toFixed(1) + 'px');
  if (cfg.onFrame) cfg.onFrame(cam, vel);

  const moving = flight || tgt.x !== cam.x || tgt.y !== cam.y || vel.x !== 0 || vel.y !== 0;
  if (moving || anim || drag) { raf = requestAnimationFrame(frame); }
  else { running = false; tickActive(now, true); }   // al detenerse, la sección activa siempre queda al día
}

function placeAll() {
  const ccx = cam.x + vw / 2, ccy = cam.y + vh / 2;
  const M = 160, P = Math.max(vw, vh) * 0.9, F = Math.max(vw, vh) * 2.6;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const sx = it.x0 - cam.x + (it.cx - ccx) * (it.d - 1) * PAR;
    const sy = it.y0 - cam.y + (it.cy - ccy) * (it.d - 1) * PAR;
    it.sx = sx; it.sy = sy;
    const vis = sx + it.W > -M && sx < vw + M && sy + it.H > -M && sy < vh + M;
    const pre = sx + it.W > -P && sx < vw + P && sy + it.H > -P && sy < vh + P;
    if (pre && !it.started) startImg(it);
    if (pre && it.loaded && !it.tex && !it.noGL && GL.ok) tryUpload(it);
    if (it.tex && !pre && texCount > 30 && (sx + it.W < -F || sx > vw + F || sy + it.H < -F || sy > vh + F)) freeTex(it);
    if (vis) {
      if (!it.vis) {
        it.vis = true;
        it.el.style.display = '';
        if (!it.shown) { it.shown = true; void it.el.offsetWidth; it.el.classList.add('is-in'); }
      }
      it.el.style.transform = 'translate3d(' + sx.toFixed(2) + 'px,' + sy.toFixed(2) + 'px,0) rotate(' + it.rot + 'deg)';
    } else if (it.vis) {
      it.vis = false;
      it.el.style.display = 'none';
      if (hovered === it) setHover(null);
    }
  }
  for (let i = 0; i < decor.length; i++) {
    const o = decor[i];
    const sx = o.x0 - cam.x + (o.cx - ccx) * (o.d - 1) * PAR;
    const sy = o.y0 - cam.y + (o.cy - ccy) * (o.d - 1) * PAR;
    const vis = sx + o.W > -M && sx < vw + M && sy + o.H > -M && sy < vh + M;
    if (vis) {
      if (!o.vis) { o.vis = true; o.el.style.display = ''; }
      o.el.style.transform = 'translate3d(' + sx.toFixed(2) + 'px,' + sy.toFixed(2) + 'px,0)' + (o.rot ? ' rotate(' + o.rot + 'deg)' : '');
    } else if (o.vis) { o.vis = false; o.el.style.display = 'none'; }
  }
}

function tickActive(now, force) {
  if ((!force && now - activeT < 120) || !regions.length) return;
  activeT = now;
  const cx = cam.x + vw / 2, cy = cam.y + vh / 2;
  let best = null, bd = 1e18;
  regions.forEach((r) => { const dx = r.sx - cx, dy = r.sy - cy, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = r; } });
  if (best && best !== activeRegion) {
    activeRegion = best;
    regions.forEach((r) => { if (r.mm) r.mm.classList.toggle('is-on', r === best); });
    if (cfg.onActiveRegion) cfg.onActiveRegion(best.id);
  }
}

/* ---------- Minimapa ---------- */
function buildMini() {
  if (!mmEl) return;
  const world = mmEl.querySelector('.mm__world');
  world.querySelectorAll('.mm__r').forEach((n) => n.remove());
  const bw = Math.max(1, bnd.x1 - bnd.x0), bh = Math.max(1, bnd.y1 - bnd.y0);
  const w = 168;
  mmScale = w / bw;
  world.style.height = Math.max(46, Math.round(bh * mmScale)) + 'px';
  world.style.overflow = 'hidden';
  regions.forEach((r) => {
    const n = document.createElement('span');
    n.className = 'mm__r' + (r === activeRegion ? ' is-on' : '');
    n.textContent = r.label;
    n.style.left = ((r.sx - bnd.x0) * mmScale) + 'px';
    n.style.top = ((r.sy - bnd.y0) * mmScale) + 'px';
    world.appendChild(n);
    r.mm = n;
  });
  mmEl.classList.add('is-ready');            // ya tiene su altura final: aparece sin mover nada
}

function drawMini() {
  if (!mmEl) return;
  const v = mmEl.querySelector('.mm__vp');
  v.style.left = ((cam.x - bnd.x0) * mmScale) + 'px';
  v.style.top = ((cam.y - bnd.y0) * mmScale) + 'px';
  v.style.width = (vw * mmScale) + 'px';
  v.style.height = (vh * mmScale) + 'px';
}

/* ======================================================================
   Vuelos (menú / minimapa / buscador)
   ====================================================================== */
/** En escritorio el menú ocupa la esquina superior izquierda: al encuadrar una sección, el contenido se corre un poco. */
function viewBias() { return vw > 820 ? { x: -60 * S, y: -80 * S } : { x: 0, y: 0 }; }

function flyPx(cx, cy, o) {
  o = o || {};
  if (o.bias) { const vb = viewBias(); cx += vb.x; cy += vb.y; }
  const tx = clamp(cx - vw / 2, lim.minX, lim.maxX);
  const ty = clamp(cy - vh / 2, lim.minY, lim.maxY);
  const dist = Math.hypot(tx - cam.x, ty - cam.y);
  if (dist < 2) { if (cfg.onFlightEnd) cfg.onFlightEnd(o.id); return; }
  const d = o.dur || clamp(0.75 + dist / 2600, 0.85, 1.9);
  flight = { x0: cam.x, y0: cam.y, x1: tx, y1: ty, t0: performance.now(), d: (reduce ? 0.01 : d) * 1000, id: o.id };
  wake();
}

function flyTo(wx, wy, o) { flyPx(wx * S, wy * S, o); }
function flyToRegion(id) {
  for (let i = 0; i < regions.length; i++) if (regions[i].id === id) { flyPx(regions[i].sx, regions[i].sy, { id, bias: true }); return true; }
  return false;
}
/** Encuadra un producto (por id) en el centro de la pantalla. */
function flyToItem(id) {
  const it = items.find((x) => x.id === id);
  if (!it) return false;
  flyPx(it.cx, it.cy + it.textH * 0.2, { id });
  return true;
}

/* ---------- Filtro (buscador) ---------- */
function applyFilterNow() {
  items.forEach((it) => {
    const keep = !filterSet || filterSet.has(it.id);
    it.dimT = keep ? 1 : 0.16;
    it.el.classList.toggle('is-dim', !keep);
    it.el.setAttribute('aria-hidden', keep ? 'false' : 'true');
    if (!keep) it.el.tabIndex = -1; else it.el.tabIndex = 0;
  });
}
/** ids = Set de ids a mantener; null = sin filtro. */
function setFilter(ids) {
  filterSet = ids ? new Set(ids) : null;
  applyFilterNow();
  wake();
}

/* ======================================================================
   Entrada: rueda, arrastre, táctil, teclado
   ====================================================================== */
function interact() {
  if (interacted) return;
  interacted = true;
  if (cfg.onFirstInteract) cfg.onFirstInteract();
}
function cancelFlight() { if (flight) { flight = null; tgt.x = cam.x; tgt.y = cam.y; } }
function nudge(dx, dy) {
  tgt.x = clamp(tgt.x + dx, lim.minX, lim.maxX);
  tgt.y = clamp(tgt.y + dy, lim.minY, lim.maxY);
  wake();
}

function pick(x, y) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.vis && x >= it.sx && x <= it.sx + it.W && y >= it.sy && y <= it.sy + it.H) return it;
  }
  return null;
}

function setHover(it, x, y) {
  if (hovered && hovered !== it) { hovered.hoverT = 0; hovered.el.classList.remove('is-hover'); }
  hovered = it || null;
  if (it) {
    it.hoverT = 1;
    if (x !== undefined) { it.mx = clamp((x - it.sx) / it.W, 0, 1); it.my = clamp((y - it.sy) / it.MH, 0, 1); }
    it.el.classList.add('is-hover');
  }
  wake();
}

function onWheel(e) {
  if (blocked) return;
  e.preventDefault();
  interact(); cancelFlight();
  let dx = e.deltaX, dy = e.deltaY;
  if (e.deltaMode === 1) { dx *= 32; dy *= 32; } else if (e.deltaMode === 2) { dx *= vw; dy *= vh; }
  if (e.shiftKey && !dx) { dx = dy; dy = 0; }
  nudge(dx * 1.05, dy * 1.05);
}

function onDown(e) {
  if (blocked) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (drag) return;
  interact(); cancelFlight();
  const tileEl = e.target.closest ? e.target.closest('.tile') : null;
  const it = tileEl ? byEl.get(tileEl) : null;
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, mode: 'pan', it, hist: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }], lp: 0 };
  if (it) {
    if (e.target.closest('[data-grip]')) { startExt(it); }
    else {
      drag.lp = setTimeout(() => startExt(it), 380);
      if (e.pointerType !== 'mouse') setHover(it, e.clientX, e.clientY);
    }
  }
  wake();
}

function startExt(it) {
  if (!drag || drag.mode !== 'pan' || drag.moved) return;
  const ok = cfg.onLongPress && cfg.onLongPress({ pointerId: drag.id, x: drag.lx, y: drag.ly, id: it.id, src: it.src });
  if (ok) {
    drag.mode = 'ext'; drag.moved = true; suppressClick = true;
    setHover(null);
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) { /* noop */ } }
  }
}

function onMove(e) {
  if (!drag || e.pointerId !== drag.id) {
    if (e.pointerType === 'mouse' && !blocked && !drag) {
      if (!(e.target && e.target.closest && e.target.closest('#viewport'))) { if (hovered) setHover(null); return; }
      const it = pick(e.clientX, e.clientY);
      if (it || hovered) setHover(it, e.clientX, e.clientY);
    }
    return;
  }
  let dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
  drag.lx = e.clientX; drag.ly = e.clientY;
  if (drag.mode === 'ext') return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 7) {
    drag.moved = true; suppressClick = true;
    clearTimeout(drag.lp);
    try { vp.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    vp.classList.add('is-drag');
    setHover(null);
    dx = e.clientX - drag.x0; dy = e.clientY - drag.y0;   // recupera la "zona muerta" inicial: sin saltos
  }
  if (drag.moved) {
    tgt.x = clamp(tgt.x - dx, lim.minX, lim.maxX);
    tgt.y = clamp(tgt.y - dy, lim.minY, lim.maxY);
    drag.hist.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    while (drag.hist.length > 2 && e.timeStamp - drag.hist[0].t > 110) drag.hist.shift();
    wake();
  } else if (hovered && e.pointerType !== 'mouse') {
    hovered.mx = clamp((e.clientX - hovered.sx) / hovered.W, 0, 1);
    hovered.my = clamp((e.clientY - hovered.sy) / hovered.MH, 0, 1);
  }
}

function onUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  clearTimeout(drag.lp);
  if (drag.mode === 'pan' && drag.moved && e.type === 'pointerup') {
    const h = drag.hist, a = h[0], b = h[h.length - 1];
    const span = Math.max(16, b.t - a.t);
    if (e.timeStamp - b.t < 140 && h.length > 1) {          // 140 ms: tolera móviles lentos o con carga
      const vx = (b.x - a.x) / span * 1000, vy = (b.y - a.y) / span * 1000;
      nudge(-vx * 0.26, -vy * 0.26);                         // inercia
    }
  }
  try { vp.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
  vp.classList.remove('is-drag');
  if (e.pointerType !== 'mouse') setHover(null);
  drag = null;
  setTimeout(() => { suppressClick = false; }, 60);
  wake();
}

function onClick(e) {
  if (suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
  const tileEl = e.target.closest ? e.target.closest('.tile') : null;
  if (!tileEl) return;
  const it = byEl.get(tileEl);
  if (!it) return;
  const actEl = e.target.closest('[data-act]');
  const act = actEl ? actEl.getAttribute('data-act') : 'open';
  if (cfg.onAction) cfg.onAction(act, it.id, e);
}

function onKey(e) {
  if (blocked || e.defaultPrevented) return;
  const tg = e.target && e.target.tagName;
  if (/INPUT|SELECT|TEXTAREA/.test(tg || '')) return;
  const sx = vw * 0.34, sy = vh * 0.34;
  let used = true, goTo = null;
  switch (e.key) {
    case 'ArrowLeft': nudge(-sx, 0); break;
    case 'ArrowRight': nudge(sx, 0); break;
    case 'ArrowUp': nudge(0, -sy); break;
    case 'ArrowDown': nudge(0, sy); break;
    case 'PageUp': nudge(0, -vh * 0.8); break;
    case 'PageDown': nudge(0, vh * 0.8); break;
    case 'Home': if (regions[0]) goTo = regions[0].id; break;
    case 'End': if (regions.length) goTo = regions[regions.length - 1].id; break;
    case 'Enter':
      if (e.target && e.target.classList && e.target.classList.contains('tile')) {
        const it = byEl.get(e.target); if (it && cfg.onAction) cfg.onAction('open', it.id, e);
      } else used = false;
      break;
    default: used = false;
  }
  if (used) {
    interact(); cancelFlight(); e.preventDefault();
    if (goTo) flyToRegion(goTo);                 // después de cancelar: si no, el vuelo recién creado se anularía
  }
}

function onMini(e) {
  const world = mmEl.querySelector('.mm__world');
  const rc = world.getBoundingClientRect();
  const wx = (e.clientX - rc.left) / mmScale + bnd.x0;
  const wy = (e.clientY - rc.top) / mmScale + bnd.y0;
  interact();
  flyPx(wx, wy, {});
}

/* ======================================================================
   API pública
   ====================================================================== */
function init(opts) {
  cfg = opts || {};
  if (inited) return;
  inited = true;
  glInit();
  vp.addEventListener('wheel', onWheel, { passive: false });
  vp.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  vp.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !drag) setHover(null); });
  vp.addEventListener('click', onClick, true);
  vp.addEventListener('contextmenu', (e) => { e.preventDefault(); });
  window.addEventListener('keydown', onKey);
  if (mmEl) mmEl.addEventListener('pointerdown', onMini);
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => layout(true), 120); });
  glc.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); GL.ok = false;
    items.forEach((it) => { it.tex = null; it.el.classList.remove('gl'); });
    texCount = 0;
  });
  glc.addEventListener('webglcontextrestored', () => { glInit(); wake(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
}

function setBlocked(b) {
  blocked = !!b;
  if (blocked) { if (hovered) setHover(null); }
  else wake();
}

export const Canvas = {
  init, build, flyTo, flyToRegion, flyToItem, setFilter, setBlocked, wake,
  getScale: () => S,
  getCam: () => ({ x: cam.x, y: cam.y }),
  hasGL: () => GL.ok,
  stats() {
    let v = 0, t = 0;
    items.forEach((it) => { if (it.vis) v++; if (it.tex) t++; });
    return { gl: GL.ok, v2: GL.v2, visible: v, textures: t, cam: { x: Math.round(cam.x), y: Math.round(cam.y) }, items: items.length, active: activeRegion && activeRegion.id, vw, vh, S };
  },
};
