/* AOS · Avisos breves (toasts). Sin spinners: solo mensajes. */
import { $, esc } from '../util.js';

export function toast(msg, o) {
  o = o || {};
  const box = $('#toast');
  const el = document.createElement('div');
  el.className = 'toast' + (o.err ? ' is-err' : '');
  el.innerHTML = o.html || '<span>' + esc(msg) + '</span>';
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  const kill = () => { el.classList.add('is-out'); setTimeout(() => el.remove(), 380); };
  let timer = setTimeout(kill, o.ttl || 2800);
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => { timer = setTimeout(kill, 1500); });
  el._kill = kill;
  return el;
}
