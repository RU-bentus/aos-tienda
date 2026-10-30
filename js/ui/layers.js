/* ==========================================================================
   AOS · Capas (modales y paneles). Gestiona apertura/cierre animado, foco, Escape
   y bloquea el canvas mientras haya algo abierto encima.
   ========================================================================== */
import { $ } from '../util.js';

let blockFn = () => {};
export function onBlock(fn) { blockFn = fn; }

const stack = [];
const closers = new Map();   // id → callback al cerrar

const z = (el) => parseInt(getComputedStyle(el).zIndex, 10) || 0;

export const Layers = {
  stack,
  isOpen(id) { const el = typeof id === 'string' ? $('#' + id) : id; return stack.indexOf(el) >= 0; },
  open(id, opt) {
    const el = typeof id === 'string' ? $('#' + id) : id;
    if (!el || stack.indexOf(el) >= 0) return;
    el.hidden = false; el.classList.add('is-open'); void el.offsetWidth; el.classList.add('is-in');
    stack.push(el);
    blockFn(true);
    el._last = document.activeElement;
    if (opt && opt.onClose) closers.set(el, opt.onClose);
    const f = el.querySelector('.pm__x, [data-close], button, input');
    if (!(opt && opt.noFocus)) setTimeout(() => { try { if (f) f.focus({ preventScroll: true }); } catch (e) { /* noop */ } }, 80);
  },
  close(id) {
    const el = typeof id === 'string' ? $('#' + id) : id;
    const i = stack.indexOf(el);
    if (i < 0) return;
    stack.splice(i, 1);
    el.classList.remove('is-in');
    setTimeout(() => { if (!el.classList.contains('is-in')) { el.classList.remove('is-open'); el.hidden = true; } }, 380);
    if (!stack.length) blockFn(false);
    try { if (el._last && el._last.focus) el._last.focus({ preventScroll: true }); } catch (e) { /* noop */ }
    const cb = closers.get(el);
    if (cb) { closers.delete(el); try { cb(); } catch (e) { console.error(e); } }
  },
  top() {
    let best = null, bz = -1;
    stack.forEach((el) => { const v = z(el); if (v >= bz) { bz = v; best = el; } });
    return best;
  },
};

document.addEventListener('click', (e) => {
  const c = e.target.closest && e.target.closest('[data-close]');
  if (!c) return;
  const l = c.closest('.layer');
  if (l) Layers.close(l);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const t = Layers.top();
  if (t) { e.preventDefault(); Layers.close(t); }
});
