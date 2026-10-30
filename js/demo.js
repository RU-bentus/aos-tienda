/* ==========================================================================
   AOS · MODO DEMO (solo si config.js → API_URL está vacía)
   Imita la API de Google Apps Script con datos de ejemplo guardados en el navegador,
   para ver el diseño y probar todo el flujo antes de conectar tu Google Sheets.
   No registra pedidos reales: no llega nada a tu hoja.
   ========================================================================== */
import { DEFAULTS } from './defaults.js';
import { LS } from './storage.js';
import { round2, pad2, sleep } from './util.js';
import { ApiError } from './api.js';

function jpg(seed, label, w, h) {
  const c = document.createElement('canvas'); c.width = w || 480; c.height = h || 640;
  const g = c.getContext('2d'), hue = (seed * 47) % 360;
  const gr = g.createLinearGradient(0, 0, c.width, c.height);
  gr.addColorStop(0, 'hsl(' + hue + ',34%,66%)'); gr.addColorStop(1, 'hsl(' + ((hue + 38) % 360) + ',42%,26%)');
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
  g.globalAlpha = 0.16; g.fillStyle = '#fff';
  for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(80 + ((seed * 71 + i * 97) % 340), 100 + ((seed * 53 + i * 131) % 440), 40 + i * 24, 0, 6.283); g.fill(); }
  g.globalAlpha = 0.9; g.fillStyle = '#fff'; g.font = 'italic 700 210px Georgia, serif'; g.textAlign = 'center';
  g.fillText(label, c.width / 2, c.height * 0.62);
  g.globalAlpha = 1; g.font = '600 22px sans-serif'; g.fillText('DEMO ' + seed, c.width / 2, c.height * 0.94);
  return c.toDataURL('image/jpeg', 0.82);
}

function qrPlaceholder() {
  const c = document.createElement('canvas'); c.width = 420; c.height = 420;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 420, 420); g.fillStyle = '#000';
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) if (((x * 7 + y * 13 + x * y) % 5) < 2) g.fillRect(x * 20, y * 20, 20, 20);
  g.fillRect(0, 0, 140, 140); g.fillStyle = '#fff'; g.fillRect(20, 20, 100, 100); g.fillStyle = '#000'; g.fillRect(40, 40, 60, 60);
  return c.toDataURL('image/png');
}

const CATS = [
  { id: 'S-M', nombre: 'S-M', orden: 1, cx: 1100, cy: 800, tipo: 'productos', sub: 'Tallas S a M' },
  { id: 'L-XL', nombre: 'L-XL', orden: 2, cx: 3300, cy: 2100, tipo: 'productos', sub: 'Tallas L a XL' },
  { id: 'PLUS-SIZE', nombre: 'PLUS-SIZE', orden: 3, cx: 5500, cy: 800, tipo: 'productos', sub: 'Tallas Plus' },
  { id: 'CONTACTO', nombre: 'CONTACTO', orden: 4, cx: 7600, cy: 2100, tipo: 'contacto', sub: 'Hablemos' },
];
// nombre, descripción, sección, precio, precio anterior, stock, etiqueta
const RAW = [
  ['Camisa Lino Arena', 'Camisa de lino lavado, corte relajado y botones de nácar. Se arruga con elegancia.', 'S-M', 289, 360, 7, 'Nuevo'],
  ['Vestido Midi Olivo', 'Midi fluido con cintura marcada y espalda abierta. Cae como seda, pesa como nada.', 'S-M', 420, 0, 2, ''],
  ['Blazer Estructurado Negro', 'Hombros definidos, forro interior satinado. Convierte cualquier jean en reunión.', 'S-M', 520, 650, 5, 'Top'],
  ['Falda Plisada Tinta', 'Plisado permanente que no se marca. Se mueve contigo, tinta azul profundo.', 'S-M', 235, 0, 9, ''],
  ['Chaqueta Oversize Terracota', 'Oversize de algodón grueso en tono terracota. Bolsillos reales, hombros caídos.', 'L-XL', 480, 560, 6, 'Nuevo'],
  ['Pantalón Wide Crudo', 'Tiro alto y pierna ancha en algodón crudo. La base de todo el armario.', 'L-XL', 310, 0, 3, ''],
  ['Top Satinado Marfil', 'Satín mate con espalda cruzada. Brilla sin gritar.', 'L-XL', 198, 240, 0, ''],
  ['Abrigo Largo Grafito', 'Lana mezclada, largo a la pantorrilla. El abrigo que dura diez inviernos.', 'L-XL', 690, 0, 1, 'Top'],
  ['Vestido Wrap Burdeos', 'Cruzado ajustable que favorece cada silueta. Burdeos intenso.', 'PLUS-SIZE', 395, 450, 8, 'Nuevo'],
  ['Conjunto Punto Carbón', 'Dos piezas de punto suave: top y pantalón. Comodidad sin parecer pijama.', 'PLUS-SIZE', 365, 0, 5, ''],
  ['Blusa Fluida Cobre', 'Blusa de caída ligera con mangas globo. Color cobre que ilumina la cara.', 'PLUS-SIZE', 215, 0, 12, ''],
  ['Jumpsuit Utilitario Salvia', 'Mono utilitario con cinturón y bolsillos amplios. Verde salvia.', 'PLUS-SIZE', 440, 520, 3, ''],
];
const LAYOUT = [[-640, -380, 380, 1.25, 1.10, -2], [-90, -120, 300, 1.0, 0.90, 1.5], [380, -430, 290, 1.4, 1.22, 2], [250, 140, 420, 1.2, 1.0, -1]];
const COUPONS = { BIENVENIDO10: { tipo: 'PORCENTAJE', valor: 10, min: 0 }, AOS50: { tipo: 'MONTO', valor: 50, min: 300 } };
const SHIP_LABEL = { pickup: 'Recoger en tienda', departamental: 'Envío departamental', casillero: 'Casillero', delivery: 'Delivery directo' };

let products = null;
function build() {
  if (products) return;
  const slot = {};
  products = RAW.map((r, i) => {
    const k = (slot[r[2]] = slot[r[2]] === undefined ? 0 : slot[r[2]] + 1);
    const l = LAYOUT[k % 4], c = CATS.find((x) => x.id === r[2]), ini = r[0].charAt(0);
    return {
      id: 'P' + ('00' + (i + 1)).slice(-3), nombre: r[0], desc: r[1], cat: r[2], etiqueta: r[6], orden: i + 1,
      precio: r[3], precioAnt: r[4], stock: r[5], alerta: 2,
      x: c.cx + l[0], y: c.cy + l[1], w: l[2], pr: l[3], d: l[4], rot: l[5],
      media: [1, 2, 3].map((s) => ({ slot: s, tipo: 'imagen', url: jpg(i * 3 + s, ini), poster: '' })),
      sold7: i % 4 === 0 ? 6 : 1, favs: i % 3 === 0 ? 5 : 0,
    };
  });
  // el stock del demo recuerda los pedidos hechos en este navegador
  const sold = LS.get('demo.sold', {});
  products.forEach((p) => { if (sold[p.id]) p.stock = Math.max(0, p.stock - sold[p.id]); });
}

function tinyPdf(text) {
  const parts = ['%PDF-1.4\n'], offs = [];
  const stream = 'BT /F1 20 Tf 30 150 Td (' + text.replace(/[()\\]/g, '') + ') Tj ET';
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    '<</Length ' + stream.length + '>>\nstream\n' + stream + '\nendstream', '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let len = parts[0].length;
  objs.forEach((o, i) => { offs.push(len); const s = (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; parts.push(s); len += s.length; });
  const x = 'xref\n0 6\n0000000000 65535 f \n' + offs.map((o) => ('0000000000' + o).slice(-10) + ' 00000 n \n').join('');
  parts.push(x + 'trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n' + len + '\n%%EOF');
  return btoa(parts.join(''));
}

export const demoApi = {
  demo: true,
  async catalog() {
    build();
    await sleep(450);
    const cfg = Object.assign({}, DEFAULTS, {
      titulo_tienda: 'AOS', url_qr_pago: qrPlaceholder(),
      texto_hero_subtitulo: 'Modo demostración: conecta tu Google Sheets en js/config.js para ver tus prendas.',
    });
    return { ok: true, v: 2, rev: 'demo1', config: cfg, categories: CATS, products: JSON.parse(JSON.stringify(products)) };
  },
  async coupon(code, sub) {
    code = String(code || '').trim().toUpperCase(); sub = Number(sub) || 0;
    await sleep(300);
    const c = COUPONS[code];
    if (!c) return { ok: false, mensaje: 'Ese código no existe.' };
    if (c.min && sub < c.min) return { ok: false, mensaje: 'Compra mínima de Bs ' + c.min + ' para usar este código.' };
    const d = c.tipo === 'PORCENTAJE' ? round2(sub * c.valor / 100) : Math.min(c.valor, sub);
    return { ok: true, code, tipo: c.tipo, valor: c.valor, descuento: d, compraMinima: c.min, mensaje: c.tipo === 'PORCENTAJE' ? c.valor + '% de descuento aplicado' : 'Bs ' + c.valor + ' de descuento aplicado' };
  },
  async getFavorites() { return { ok: true, ids: [] }; },
  async favorites() { return { ok: true }; },
  async events() { return { ok: true }; },
  async receipt(id) {
    await sleep(900);
    return { ok: true, filename: 'Comprobante_' + String(id).replace('/', '-') + '.pdf', mime: 'application/pdf', base64: tinyPdf('Comprobante DEMO ' + id), url: '' };
  },
  async qr() { return { ok: false, error: 'demo' }; },
  /** doPost de demostración (idempotente por requestId, como el servidor real). */
  async order(p) {
    build();
    await sleep(700);
    const seen = LS.get('demo.req', {});
    if (seen[p.requestId]) return Object.assign({}, seen[p.requestId], { duplicado: true });
    const items = p.items.map((it) => {
      const pr = products.find((x) => x.id === it.id);
      if (!pr) throw new ApiError('Un producto de tu lista ya no está disponible.', 'user');
      if (pr.stock < it.qty) throw new ApiError(pr.stock > 0 ? 'Solo quedan ' + pr.stock + ' unidad(es) de "' + pr.nombre + '".' : '"' + pr.nombre + '" se agotó.', 'user');
      return { id: pr.id, nombre: pr.nombre, cat: pr.cat, qty: it.qty, precio: pr.precio, sub: pr.precio * it.qty, img: pr.media[0].url };
    });
    const sub = items.reduce((a, i) => a + i.sub, 0);
    let disc = 0, cup = null;
    if (p.coupon && COUPONS[p.coupon]) { const c = COUPONS[p.coupon]; cup = { code: p.coupon, tipo: c.tipo, valor: c.valor }; disc = c.tipo === 'PORCENTAJE' ? round2(sub * c.valor / 100) : Math.min(c.valor, sub); }
    const now = new Date(), dm = pad2(now.getDate()) + pad2(now.getMonth() + 1), key = 'demo.seq.' + dm;
    const seq = (LS.get(key, 0) || 0) + 1; LS.set(key, seq);
    const sold = LS.get('demo.sold', {});
    items.forEach((it) => { const pr = products.find((x) => x.id === it.id); pr.stock = Math.max(0, pr.stock - it.qty); sold[it.id] = (sold[it.id] || 0) + it.qty; });
    LS.set('demo.sold', sold);
    const s = p.shipping || { type: 'pickup' };
    const det = [s.destino && 'Destino: ' + s.destino, s.nombre && 'Nombre: ' + s.nombre, s.celular && 'Tel: ' + s.celular, s.transportadora && 'Transportadora: ' + s.transportadora].filter(Boolean).join(' · ');
    const res = {
      ok: true, orderId: 'AOS-' + dm + '/' + ('00' + seq).slice(-3), uuid: 'demo-' + p.requestId, fecha: now.toLocaleString('es-BO'),
      items, subtotal: sub, descuento: disc, cupon: cup, total: round2(sub - disc),
      envio: { tipo: s.type, etiqueta: SHIP_LABEL[s.type] || s.type, detalle: det }, referencia: p.referencia || '',
    };
    seen[p.requestId] = res; LS.set('demo.req', seen);
    return res;
  },
};
