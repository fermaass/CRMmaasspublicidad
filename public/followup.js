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
  // Si ya contestó y luego deja de responder: con 3 seguimientos seguidos sin respuesta se declina ("Dejó de contestar").
  const SILENT_MAX = 3;
  // Después de vender: pedir referidos a las 3 semanas y ofrecer renovación 30 días antes de que termine la campaña.
  const REFERRAL_AFTER = 21;
  const RENEW_BEFORE = 30;

  const ms = (iso) => new Date(iso).getTime();

  // Etapas que se ven (tablero, Mi día, Resumen). Salen de la etapa guardada y de los toques; nadie las cambia a mano.
  //   Nuevo: nadie lo ha tocado · Contactando: ya se intentó y no contesta · Contestó: respondió, falta perfilar.
  //   Los declinados se separan en con perfil (base para campañas futuras) y sin perfil.
  const STAGES = ['nuevo', 'contactando', 'contesto', 'nuevo_perfil', 'cotizando', 'vendido', 'declinado_perfil', 'declinado_sin'];
  function stageOf(l) {
    if (l.status === 'nuevo') return l.contacted_at ? 'contesto' : (l.touch_count || 0) > 0 ? 'contactando' : 'nuevo';
    if (l.status === 'declinado') return l.profile === 'cumple' ? 'declinado_perfil' : 'declinado_sin';
    return l.status;
  }
  const fmtDay = (d) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  // Aviso cuando el siguiente seguimiento sin respuesta declinaría el lead.
  const lastTry = (l) => ((l.silent_streak || 0) >= SILENT_MAX - 1 ? ' (último intento)' : '');

  // Devuelve { kind, n, due, label } o null si no hay nada pendiente.
  function nextAction(l) {
    if (l.status === 'vendido') {
      if (l.won_at && !l.postsale_at) {
        return { kind: 'postventa', n: null, due: new Date(ms(l.won_at) + REFERRAL_AFTER * DAY), label: '¿Cómo va la campaña? Pedir referidos' };
      }
      if (l.campaign_end && l.renewal_for !== l.campaign_end) {
        const end = new Date(`${l.campaign_end}T09:00:00`);
        return { kind: 'renovacion', n: null, due: new Date(end.getTime() - RENEW_BEFORE * DAY), label: `Renovación: la campaña termina el ${fmtDay(end)}` };
      }
      return null;
    }
    if (l.status === 'declinado') {
      if (!l.recontact_at) return null;
      return { kind: 'recontacto', n: null, due: new Date(`${l.recontact_at}T09:00:00`), label: 'Volver a contactar' };
    }
    const done = l.touch_count || 0;
    const n = done + 1;
    // Lo que el vendedor acordó con el cliente manda sobre la cadencia.
    if (l.next_step_at) {
      return { kind: l.status === 'cotizando' ? 'cotizacion' : 'seguimiento', n, due: new Date(l.next_step_at), agreed: true,
        label: `Acordado: ${l.next_step || 'dar seguimiento'}${lastTry(l)}` };
    }
    if (!l.contacted_at) {
      if (l.status !== 'nuevo' || done >= MAX) return null;
      return { kind: 'cadencia', n, due: new Date(ms(l.created_at) + CADENCE[done] * DAY), label: `Toque ${n}/${MAX}` };
    }
    if (l.status === 'cotizando' && l.quoted_at) {
      const since = Math.max(0, done - (l.quote_touch ?? 0)); // seguimientos hechos desde la cotización
      const due = since < QUOTE_CADENCE.length
        ? ms(l.quoted_at) + QUOTE_CADENCE[since] * DAY
        : ms(l.last_touch_at || l.quoted_at) + AFTER_QUOTE_EVERY * DAY;
      return { kind: 'cotizacion', n, due: new Date(due), label: `Seguimiento ${since + 1} de la cotización${lastTry(l)}` };
    }
    return {
      kind: 'seguimiento', n,
      due: new Date(ms(l.last_touch_at || l.contacted_at) + FOLLOW_EVERY * DAY),
      label: `${l.status === 'nuevo_perfil' ? 'Enviar cotización' : 'Perfilar'}${lastTry(l)}`,
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

  const api = { DAY, MAX, CADENCE, FOLLOW_EVERY, QUOTE_CADENCE, AFTER_QUOTE_EVERY, STAGES, stageOf, SILENT_MAX, REFERRAL_AFTER, RENEW_BEFORE, nextAction, dayDiff, waNumber, waLink };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CRMFollowup = api;
})(this);
