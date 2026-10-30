/* ==========================================================================
   AOS · ARRASTRAR AL CARRITO (drag & drop)
   - Mantener pulsada una tarjeta del canvas (o el asa) → "fantasma" que sigue el dedo/cursor.
   - Mantener pulsado un chip del dock (o arrastrarlo con ratón).
   - Soltar sobre el ícono flotante de la bolsa agrega el producto.
   ========================================================================== */
import { prod, cover, isOut, t } from './store.js';
import { toast } from './ui/toast.js';
import { addToCart, setDragGuard } from './actions.js';
import { $, esc, anim } from './util.js';

let active = false, lastEnd = 0;
export const recentlyDragged = () => Date.now() - lastEnd < 350;
setDragGuard(recentlyDragged);

function over(x, y) {
  const r = $('#fab').getBoundingClientRect();
  return Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) < r.width * 0.95;
}

/** info = { pointerId, x, y, id, src } → true si se inició el arrastre. */
export function startDrag(info) {
  if (active) return false;
  const p = prod(info.id);
  if (!p) return false;
  if (isOut(p)) { toast(t('texto_agotado'), { err: true }); return false; }
  const g = $('#ghost'), fab = $('#fab');
  active = true;
  g.innerHTML = '<img alt="" src="' + esc(info.src || cover(p)) + '">';
  g.classList.add('on'); document.body.classList.add('is-dragging');
  const pos = (x, y) => { g.style.transform = 'translate3d(' + (x - 46) + 'px,' + (y - 70) + 'px,0) rotate(-6deg)'; };
  pos(info.x, info.y);
  const mv = (e) => {
    if (e.pointerId !== info.pointerId) return;
    pos(e.clientX, e.clientY);
    fab.classList.toggle('is-drop', over(e.clientX, e.clientY));
  };
  const noScroll = (e) => { if (e.cancelable) e.preventDefault(); };
  const end = (e) => {
    if (e.pointerId !== info.pointerId) return;
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    document.removeEventListener('touchmove', noScroll);
    document.body.classList.remove('is-dragging');
    fab.classList.remove('is-drop');
    lastEnd = Date.now();
    const drop = e.type === 'pointerup' && over(e.clientX, e.clientY);
    const done = () => { g.classList.remove('on'); active = false; };
    if (drop) {
      const r = fab.getBoundingClientRect();
      const a = anim(g, [
        { transform: g.style.transform },
        { transform: 'translate3d(' + (r.left + r.width / 2 - 46) + 'px,' + (r.top + r.height / 2 - 58) + 'px,0) scale(.18) rotate(20deg)', opacity: 0.2 },
      ], { duration: 420, fill: 'forwards' });
      const fin = () => { done(); addToCart(info.id, 1, { src: 'drag' }); };
      if (a) a.onfinish = fin; else fin();
    } else {
      const b = anim(g, [{ opacity: 1 }, { opacity: 0, transform: g.style.transform + ' scale(.85)' }], { duration: 220, fill: 'forwards' });
      if (b) b.onfinish = done; else done();
    }
  };
  window.addEventListener('pointermove', mv, { passive: true });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  document.addEventListener('touchmove', noScroll, { passive: false });
  return true;
}

/** Pulsación larga (o arrastre con ratón) sobre un chip del dock. */
export function bindChipDrag() {
  let st = null;
  const track = $('#dockTrack');
  track.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip || e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    st = { id: chip.dataset.id, pid: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mouse: e.pointerType === 'mouse', t: 0, chip };
    st.fire = () => {
      if (!st) return;
      const c = st.chip;
      if (startDrag({ pointerId: st.pid, x: st.x, y: st.y, id: st.id, src: '' })) {
        c.classList.add('dragging'); setTimeout(() => c.classList.remove('dragging'), 500);
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (er) { /* noop */ } }
      }
      st = null;
    };
    st.t = setTimeout(st.fire, 380);
  });
  window.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.pid) return;
    st.x = e.clientX; st.y = e.clientY;
    if (Math.hypot(e.clientX - st.sx, e.clientY - st.sy) > 8) {
      clearTimeout(st.t);
      if (st.mouse) st.fire(); else st = null;           // en táctil, mover = desplazar el dock (no arrastrar)
    }
  }, { passive: true });
  const cancel = (e) => { if (st && e.pointerId === st.pid) { clearTimeout(st.t); st = null; } };
  window.addEventListener('pointerup', cancel);
  window.addEventListener('pointercancel', cancel);
}
