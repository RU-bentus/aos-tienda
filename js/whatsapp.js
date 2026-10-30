/* ==========================================================================
   AOS · Mensaje de WhatsApp (plantilla editable en la hoja `Configuracion`)
   Puro: recibe un pedido y devuelve texto / URL. No toca el DOM.
   ========================================================================== */
import { S, t, money } from './store.js';
import { fmt } from './util.js';

/** Número de WhatsApp en formato wa.me (solo dígitos, con código de país). */
export const waNumber = () => String(t('whatsapp_numero')).replace(/\D/g, '');

/**
 * Variables de la plantilla `whatsapp_mensaje_plantilla`:
 *   {id_pedido} {items} {subtotal} {descuento_linea} {total} {envio} {envio_detalle} {tienda} {fecha}
 * o = { orderId, items:[{nombre,cat,qty,sub}], subtotal, descuento, cupon, total, envio:{etiqueta,detalle}, fecha }
 */
export function waMessage(o) {
  const lines = o.items.map((it, i) => fmt(t('whatsapp_linea_item'), {
    n: i + 1, nombre: it.nombre, cat: it.cat, qty: it.qty, importe: money(it.sub),
  }));
  let desc = '';
  if (o.descuento > 0) {
    const c = o.cupon;
    desc = t('texto_descuento') + (c ? ' (' + c.code + (c.tipo === 'PORCENTAJE' ? ' · ' + c.valor + '%' : '') + ')' : '') + ': − ' + money(o.descuento) + '\n';
  }
  const msg = fmt(t('whatsapp_mensaje_plantilla'), {
    id_pedido: o.orderId,
    items: lines.join('\n'),
    subtotal: money(o.subtotal),
    descuento_linea: desc,
    total: money(o.total),
    envio: (o.envio && o.envio.etiqueta) || '',
    envio_detalle: (o.envio && o.envio.detalle) || '',
    tienda: S.cfg.titulo_tienda || '',
    fecha: o.fecha || new Date().toLocaleString('es-BO'),
  });
  return msg.replace(/\n{3,}/g, '\n\n');          // si no hay detalle de envío no quedan renglones vacíos de más
}

export const waUrl = (o) => 'https://wa.me/' + waNumber() + '?text=' + encodeURIComponent(waMessage(o));

/** Enlace del botón WhatsApp de la sección CONTACTO. */
export function waContactUrl() {
  return 'https://wa.me/' + waNumber() + '?text=' + encodeURIComponent(fmt(t('whatsapp_mensaje_contacto'), { tienda: S.cfg.titulo_tienda || '' }));
}
