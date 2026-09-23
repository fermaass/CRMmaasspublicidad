// Qué toca hacer con cada lead y cuándo. Lo usan el servidor (reportes, vencidos) y el navegador (Mi día, tablero).
(function (root) {
  const DAY = 86400e3;
  const MAX = 5;
  // Sin respuesta: 5 toques en 12 días desde que llega el lead.
  const CADENCE = [0, 1, 3, 7, 12];
  // Ya respondió pero falta perfilar o cotizar: seguimiento cada 3 días desde el último toque.
  const FOLLOW_EVERY = 3;
  // Después de cotizar: seguimientos a los 2, 5 y 10 días; luego cada 7 días desde el último toque.
  const QUOTE_CADENCE = [2, 5, 10];
  const AFTER_QUOTE_EVERY = 7;

  const ms = (iso) => new Date(iso).getTime();

  // Devuelve { kind, n, due, label } o null si no hay nada pendiente.
  function nextAction(l) {
    if (l.status === 'vendido') return null;
    if (l.status === 'declinado') {
      if (!l.recontact_at) return null;
      return { kind: 'recontacto', n: null, due: new Date(`${l.recontact_at}T09:00:00`), label: 'Volver a contactar' };
    }
    const done = l.touch_count || 0;
    const n = done + 1;
    if (!l.contacted_at) {
      if (l.status !== 'nuevo' || done >= MAX) return null;
      return { kind: 'cadencia', n, due: new Date(ms(l.created_at) + CADENCE[done] * DAY), label: `Toque ${n}/${MAX}` };
    }
    if (l.status === 'cotizando' && l.quoted_at) {
      const since = Math.max(0, done - (l.quote_touch ?? 0)); // seguimientos hechos desde la cotización
      const due = since < QUOTE_CADENCE.length
        ? ms(l.quoted_at) + QUOTE_CADENCE[since] * DAY
        : ms(l.last_touch_at || l.quoted_at) + AFTER_QUOTE_EVERY * DAY;
      return { kind: 'cotizacion', n, due: new Date(due), label: `Seguimiento ${since + 1} de la cotización` };
    }
    return {
      kind: 'seguimiento', n,
      due: new Date(ms(l.last_touch_at || l.contacted_at) + FOLLOW_EVERY * DAY),
      label: l.status === 'nuevo_perfil' ? 'Enviar cotización' : 'Perfilar',
    };
  }

  // Días entre hoy y la fecha (negativo = atrasado), contando días de calendario.
  function dayDiff(due, now = new Date()) {
    const a = new Date(due); a.setHours(0, 0, 0, 0);
    const b = new Date(now); b.setHours(0, 0, 0, 0);
    return Math.round((a - b) / DAY);
  }

  // Número para wa.me: solo dígitos y con lada de país. 10 dígitos se toman como México (52);
  // el "1" viejo de celulares mexicanos (52 1 ...) se quita. Devuelve null si no parece un teléfono.
  function waNumber(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.length === 10) d = `52${d}`;
    if (d.length === 13 && d.startsWith('521')) d = `52${d.slice(3)}`;
    return d.length >= 11 && d.length <= 15 ? d : null;
  }

  // Liga para abrir WhatsApp con el mensaje ya escrito. vars: { nombre, vendedor, producto }.
  function waLink(phone, template, vars = {}) {
    const n = waNumber(phone);
    if (!n) return null;
    const first = String(vars.nombre || '').trim().split(/\s+/)[0] || '';
    const text = String(template || '')
      .replace(/\{nombre\}/g, first)
      .replace(/\{vendedor\}/g, vars.vendedor || '')
      .replace(/\{producto\}/g, vars.producto || 'nuestros espacios')
      .replace(/ {2,}/g, ' ').replace(/ ,/g, ',').trim();
    return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  }

  const api = { DAY, MAX, CADENCE, FOLLOW_EVERY, QUOTE_CADENCE, AFTER_QUOTE_EVERY, nextAction, dayDiff, waNumber, waLink };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CRMFollowup = api;
})(this);
