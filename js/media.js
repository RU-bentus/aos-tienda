/* ==========================================================================
   AOS · Medios del producto (imagen / vídeo / YouTube / Drive) → qué etiqueta HTML usar.
   ========================================================================== */

/**
 * m = { tipo:'imagen'|'video', url, poster }
 * @returns {{k:'img'|'video'|'iframe', src:string, thumb:string, poster:string}}
 *   thumb: imagen pequeña para mosaicos y miniaturas ('' si no hay).
 */
export function mediaKind(m) {
  const u = String((m && m.url) || '');
  const poster = String((m && m.poster) || '');
  if (m && m.tipo === 'video') {
    if (/youtube\.com|youtu\.be/.test(u)) {
      const y = (u.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{6,})/) || [])[1];
      return { k: 'iframe', src: 'https://www.youtube.com/embed/' + y + '?rel=0&playsinline=1', thumb: poster || (y ? 'https://img.youtube.com/vi/' + y + '/hqdefault.jpg' : ''), poster };
    }
    if (/drive\.google\.com/.test(u)) {
      const d = (u.match(/\/d\/([\w-]+)/) || u.match(/[?&]id=([\w-]+)/) || [])[1];
      return { k: 'iframe', src: 'https://drive.google.com/file/d/' + d + '/preview', thumb: poster, poster };
    }
    return { k: 'video', src: u, thumb: poster, poster };
  }
  return { k: 'img', src: u, thumb: u, poster: '' };
}
