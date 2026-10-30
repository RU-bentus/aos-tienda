/* ==========================================================================
   AOS · Utilidades puras (sin estado de la tienda)
   ========================================================================== */

export const $ = (s, r) => (r || document).querySelector(s);
export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

export const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
export const isTouch = !!(window.matchMedia && matchMedia('(hover: none)').matches);
export const EASE = 'cubic-bezier(0.25, 1, 0.5, 1)';

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const pad2 = (n) => (n < 10 ? '0' : '') + n;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function uid() {
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* noop */ }
  return 'x' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}
/** Código corto legible (sin 0/O/1/I) para la referencia provisional del pedido. */
export function shortCode(n) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  try {
    const a = new Uint32Array(n); crypto.getRandomValues(a);
    a.forEach((v) => { out += abc[v % abc.length]; });
  } catch (e) { for (let i = 0; i < n; i++) out += abc[Math.floor(Math.random() * abc.length)]; }
  return out;
}

export const ic = (name, cls) => `<svg class="ic ${cls || ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/** "Quedan {n}" + {n:3}  →  "Quedan 3". Las claves que no existen se dejan tal cual. */
export function fmt(tpl, vars) {
  return String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));
}

export function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

/** Minúsculas sin tildes: "Camisa LINO" y "camisa lino" son lo mismo para el buscador. */
export function fold(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Web Animations con curva de la tienda; respeta "reducir movimiento". */
export function anim(el, frames, opt) {
  if (!el || !el.animate) return null;
  const o = Object.assign({ duration: 450, easing: EASE }, opt || {});
  if (reduceMotion) o.duration = 1;
  return el.animate(frames, o);
}

/** FLIP: mide, cambia el DOM y anima cada hijo desde su posición anterior (transform: solo GPU). */
export function flip(container, mutate, dur, hero) {
  const first = new Map();
  $$(':scope > *', container).forEach((k) => first.set(k, k.getBoundingClientRect()));
  mutate();
  $$(':scope > *', container).forEach((k) => {
    const f = first.get(k), l = k.getBoundingClientRect();
    if (!f) { anim(k, [{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'none' }], { duration: dur || 500 }); return; }
    const dx = f.left - l.left, dy = f.top - l.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    if (k === hero) {
      anim(k, [
        { transform: `translate(${dx}px,${dy}px) scale(1)`, offset: 0 },
        { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 34}px) scale(1.12) rotate(-4deg)`, offset: 0.45 },
        { transform: 'none', offset: 1 },
      ], { duration: (dur || 600) + 150 });
    } else {
      anim(k, [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: dur || 600 });
    }
  });
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
export function b64ToBlob(b64, mime) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime || 'application/octet-stream' });
}

/** Enlaces de Drive → URL directa (con CORS) que sí sirve para WebGL. El resto queda igual. */
export function normUrl(u, tipo) {
  u = String(u || '').trim();
  if (!u || tipo === 'video') return u;
  const m = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/) || u.match(/drive\.google\.com\/(?:open|uc)\?[^#]*id=([\w-]+)/);
  return m ? 'https://lh3.googleusercontent.com/d/' + m[1] + '=w1600' : u;
}

/** Color CSS cualquiera ("#da532c", "rgb()", "tomato") → "218, 83, 44". */
export function rgbOf(color, fallback) {
  try {
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = '#000000';
    c.fillStyle = String(color);
    const v = c.fillStyle;                                   // "#rrggbb" o "rgba(r, g, b, a)"
    if (v[0] === '#') return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).join(', ');
    const m = v.match(/[\d.]+/g);
    return m ? m.slice(0, 3).map((x) => Math.round(Number(x))).join(', ') : fallback;
  } catch (e) { return fallback; }
}

/** Mini bus de eventos: separa el estado (store) del DOM (vistas). */
export function createBus() {
  const m = new Map();
  return {
    on(ev, fn) { (m.get(ev) || m.set(ev, new Set()).get(ev)).add(fn); return () => m.get(ev).delete(fn); },
    emit(ev, data) { (m.get(ev) || []).forEach((fn) => { try { fn(data); } catch (e) { console.error('[AOS] error en', ev, e); } }); },
  };
}
