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

  // Cómo le llama cada negocio a lo que vende y que se renueva (campaña, contrato, membresía…). Se configura por empresa.
  const TERMS = { campana: ['campaña', 'la'], contrato: ['contrato', 'el'], membresia: ['membresía', 'la'], servicio: ['servicio', 'el'],
    poliza: ['póliza', 'la'], suscripcion: ['suscripción', 'la'], proyecto: ['proyecto', 'el'], propiedad: ['propiedad', 'la'],
    tratamiento: ['tratamiento', 'el'], auto: ['auto', 'el'] };

  // Perfil rápido: tres preguntas de un toque. Las claves son fijas (columnas del lead); lo que pregunta cambia por giro.
  // ok: respuestas que califican. Si las dos primeras califican, el lead pasa solo a "Cumple perfil".
  const WHEN = (q) => ({ label: q, options: { mes: 'Este mes', trimestre: '1 a 3 meses', despues: 'Más adelante' } });
  const BUDGET = (q, yes, maybe) => ({ label: q, options: { si: yes, por_definir: maybe }, ok: ['si'] });
  const PAYMENT = (q, options, ok) => ({ label: q, options, ok });
  const GENERAL_PROFILE = {
    decision_maker: { label: '¿Habla con quien decide?', options: { si: 'Sí, decide', no: 'No, decide otro' }, ok: ['si'] },
    budget_status: BUDGET('¿Tiene presupuesto?', 'Sí tiene', 'Por definir'),
    start_window: WHEN('¿Cuándo arranca?'),
  };
  // Giro del negocio: ajusta cómo se le llama a lo que vende, si hay renovaciones, si se mide en citas y qué se pregunta
  // para perfilar. Se elige en Configuración y se puede cambiar cuando sea; no borra ni cambia datos ya capturados.
  const INDUSTRIES = {
    general: { name: 'General', term: 'campana', renewals: true, appointments: false, profile: GENERAL_PROFILE,
      help: 'El embudo de siempre: contestó, cumple perfil, cotización y venta.' },
    bienes_raices: { name: 'Bienes raíces', term: 'propiedad', renewals: false, appointments: true, appt: 'cita',
      help: 'Se mide en citas: cuántos agendan, cuántos llegan y cuántos compran o rentan.',
      profile: {
        decision_maker: PAYMENT('¿Cómo va a pagar?', { credito: 'Crédito aprobado', contado: 'De contado', tramite: 'Sin crédito aún' }, ['credito', 'contado']),
        budget_status: BUDGET('¿Su presupuesto alcanza?', 'Sí alcanza', 'Por definir'),
        start_window: WHEN('¿Para cuándo la necesita?'),
      } },
    salud: { name: 'Salud y estética', term: 'tratamiento', renewals: false, appointments: true, appt: 'valoración',
      help: 'Se mide en valoraciones: cuántos agendan, cuántos llegan y cuántos empiezan tratamiento.',
      profile: {
        decision_maker: { label: '¿Puede venir a la clínica?', options: { si: 'Sí puede venir', no: 'Le queda lejos' }, ok: ['si'] },
        budget_status: BUDGET('¿Le acomoda el precio?', 'Sí le acomoda', 'Lo está pensando'),
        start_window: WHEN('¿Cuándo quiere empezar?'),
      } },
    automotriz: { name: 'Automotriz', term: 'auto', renewals: false, appointments: true, appt: 'prueba de manejo',
      help: 'Se mide en pruebas de manejo: cuántos agendan, cuántos llegan y cuántos compran.',
      profile: {
        decision_maker: PAYMENT('¿Cómo va a pagar?', { contado: 'De contado', credito: 'Con crédito', por_definir: 'Aún no sabe' }, ['contado', 'credito']),
        budget_status: BUDGET('¿Su presupuesto alcanza?', 'Sí alcanza', 'Por definir'),
        start_window: WHEN('¿Cuándo quiere estrenar?'),
      } },
    servicios: { name: 'Servicios', term: 'servicio', renewals: true, appointments: true, appt: 'reunión', profile: GENERAL_PROFILE,
      help: 'Agencias, despachos y consultorías: se mide en reuniones y se ofrece la renovación a tiempo.' },
  };
  const config = { term: 'campana', renewals: true, industry: 'general', appointments: false };
  function configure(opts = {}) {
    if (Object.prototype.hasOwnProperty.call(TERMS, opts.term)) config.term = opts.term;
    if (opts.renewals !== undefined) config.renewals = Boolean(opts.renewals);
    if (Object.prototype.hasOwnProperty.call(INDUSTRIES, opts.industry)) config.industry = opts.industry;
    if (opts.appointments !== undefined) config.appointments = Boolean(opts.appointments);
  }
  const term = () => TERMS[config.term][0];
  const theTerm = () => `${TERMS[config.term][1]} ${TERMS[config.term][0]}`;
  const industry = () => INDUSTRIES[config.industry];
  const appointments = () => config.appointments;
  // Cómo se le llama a la cita en este giro (cita, valoración, prueba de manejo, reunión). Todas son "la".
  const apptNoun = () => industry().appt || 'cita';
  const PLURAL = { cita: 'citas', valoración: 'valoraciones', 'prueba de manejo': 'pruebas de manejo', reunión: 'reuniones' };
  const apptPlural = (noun = apptNoun()) => PLURAL[noun] || `${noun}s`;
  const quickProfile = () => industry().profile;
  // Texto de una respuesta del perfil; si se capturó con otro giro, se busca en todos para no perderla.
  function answerLabel(k, v) {
    if (!v) return '';
    const own = quickProfile()[k]?.options[v];
    if (own) return own;
    for (const g of Object.values(INDUSTRIES)) if (g.profile[k]?.options[v]) return g.profile[k].options[v];
    return v;
  }
  // Habla con quien decide (o ya sabe cómo paga) y le alcanza: cumple perfil.
  const qualifies = (a) => ['decision_maker', 'budget_status'].every((k) => (quickProfile()[k].ok || []).includes(a[k]));

  // Etapas que se ven (tablero, Mi día, Resumen). Salen de la etapa guardada y de los toques; nadie las cambia a mano.
  //   Nuevo: nadie lo ha tocado · Contactando: ya se intentó y no contesta · Contestó: respondió, falta perfilar.
  //   Con citas: Cita agendada (incluye a los que no llegaron y hay que reagendar) y Asistió, antes de cotizar.
  //   Los declinados se separan en con perfil (base para campañas futuras) y sin perfil.
  const STAGES = ['nuevo', 'contactando', 'contesto', 'nuevo_perfil', 'cotizando', 'vendido', 'declinado_perfil', 'declinado_sin'];
  const APPT_STAGES = ['nuevo', 'contactando', 'contesto', 'nuevo_perfil', 'cita', 'asistio', 'cotizando', 'vendido', 'declinado_perfil', 'declinado_sin'];
  const stages = () => (config.appointments ? APPT_STAGES : STAGES);
  const OPEN = ['nuevo', 'nuevo_perfil'];
  const SCHEDULED = ['agendada', 'confirmada'];
  function stageOf(l) {
    if (config.appointments && OPEN.includes(l.status) && l.appt_state) {
      if (l.appt_state === 'asistio') return 'asistio';
      return 'cita'; // agendada, confirmada o no llegó (toca reagendar)
    }
    if (l.status === 'nuevo') return l.contacted_at ? 'contesto' : (l.touch_count || 0) > 0 ? 'contactando' : 'nuevo';
    if (l.status === 'declinado') return l.profile === 'cumple' ? 'declinado_perfil' : 'declinado_sin';
    return l.status;
  }
  // Nombres de las etapas y resultados de toque que dependen del giro.
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const apptLabels = () => ({ cita: `${cap(apptNoun())} agendada`, asistio: 'Asistió' });
  const apptOutcomes = () => ({ cita_agendada: `Agendó ${apptNoun()}`, confirmo: `Confirmó la ${apptNoun()}`, asistio: 'Asistió', no_asistio: 'No llegó', reagendo: 'Cambió la fecha' });

  // Resultados posibles del siguiente toque según la etapa (los primeros cuatro son los que se ven en Mi día).
  const OUTCOMES = {
    // Desde el primer toque se puede cotizar o cerrar: el lead salta a esa etapa.
    nuevo: ['sin_respuesta', 'conversacion', 'cumple', 'cotizado', 'no_cumple', 'rechazo', 'vendido'],
    nuevo_perfil: ['sin_respuesta', 'seguimiento', 'cotizado', 'rechazo', 'vendido'],
    cotizando: ['sin_respuesta', 'seguimiento', 'vendido', 'rechazo'],
    vendido: ['referidos', 'renovo', 'no_renueva'], // postventa: cuál aplica depende de lo que toque (ver nextAction)
  };
  // null = lead cerrado (declinado): hay que reactivarlo para registrar toques.
  function outcomesFor(l) {
    if (!OUTCOMES[l.status]) return null;
    if (l.status === 'vendido') {
      const k = nextAction(l)?.kind;
      return k === 'postventa' ? ['referidos'] : k === 'renovacion' ? ['renovo', 'no_renueva'] : [];
    }
    if (!config.appointments || !OPEN.includes(l.status)) return OUTCOMES[l.status];
    if (SCHEDULED.includes(l.appt_state)) {
      return [...(l.appt_state === 'agendada' ? ['confirmo'] : []), 'asistio', 'no_asistio', 'reagendo', 'sin_respuesta', 'cotizado', 'rechazo', 'vendido'];
    }
    if (l.appt_state === 'asistio') return ['cotizado', 'seguimiento', 'cita_agendada', 'sin_respuesta', 'vendido', 'rechazo'];
    // Sin cita (o no llegó): lo que se busca es agendarla.
    return l.status === 'nuevo'
      ? ['sin_respuesta', 'conversacion', 'cita_agendada', 'cumple', 'cotizado', 'no_cumple', 'rechazo', 'vendido']
      : ['sin_respuesta', 'cita_agendada', 'seguimiento', 'cotizado', 'rechazo', 'vendido'];
  }

  const fmtDay = (d) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  // Aviso cuando el siguiente seguimiento sin respuesta declinaría el lead.
  const lastTry = (l) => ((l.silent_streak || 0) >= SILENT_MAX - 1 ? ' (último intento)' : '');

  // Devuelve { kind, n, due, label } o null si no hay nada pendiente.
  function nextAction(l) {
    if (l.status === 'vendido') {
      if (l.won_at && !l.postsale_at) {
        return { kind: 'postventa', n: null, due: new Date(ms(l.won_at) + REFERRAL_AFTER * DAY), label: `¿Cómo va ${theTerm()}? Pedir referidos` };
      }
      if (config.renewals && l.campaign_end && l.renewal_for !== l.campaign_end) {
        const end = new Date(`${l.campaign_end}T09:00:00`);
        return { kind: 'renovacion', n: null, due: new Date(end.getTime() - RENEW_BEFORE * DAY), label: `Renovación: ${theTerm()} termina el ${fmtDay(end)}` };
      }
      return null;
    }
    if (l.status === 'declinado') {
      if (!l.recontact_at) return null;
      return { kind: 'recontacto', n: null, due: new Date(`${l.recontact_at}T09:00:00`), label: 'Volver a contactar' };
    }
    const done = l.touch_count || 0;
    const n = done + 1;
    // Cita agendada: confirmarla un día antes y, ya pasada la hora, anotar si llegó. Manda sobre lo demás.
    const appt = config.appointments && OPEN.includes(l.status);
    if (appt && SCHEDULED.includes(l.appt_state) && l.appt_at) {
      const at = ms(l.appt_at);
      const when = `${fmtDay(new Date(at))} ${new Date(at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
      if (l.appt_state === 'agendada' && Date.now() < at) {
        return { kind: 'cita', n, due: new Date(Math.max(at - DAY, ms(l.last_touch_at || l.created_at))),
          label: `Confirmar la ${apptNoun()} del ${when}` };
      }
      // agreed: se muestra la hora de la cita junto al día.
      return { kind: 'asistencia', n, due: new Date(at), agreed: true, label: `¿Llegó a la ${apptNoun()}?` };
    }
    // Lo que el vendedor acordó con el cliente manda sobre la cadencia.
    if (l.next_step_at) {
      return { kind: l.status === 'cotizando' ? 'cotizacion' : 'seguimiento', n, due: new Date(l.next_step_at), agreed: true,
        label: `Acordado: ${l.next_step || 'dar seguimiento'}${lastTry(l)}` };
    }
    if (!l.contacted_at) {
      if (l.status !== 'nuevo' || done >= MAX) return null;
      return { kind: 'cadencia', n, due: new Date(ms(l.created_at) + CADENCE[done] * DAY), label: `Toque ${n}/${MAX}` };
    }
    // No llegó a la cita: reagendarla al día siguiente.
    if (appt && l.appt_state === 'no_asistio') {
      return { kind: 'reagendar', n, due: new Date(ms(l.last_touch_at || l.created_at) + DAY), label: `No llegó: reagendar la ${apptNoun()}${lastTry(l)}` };
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
      label: `${appt && !l.appt_state ? `Agendar ${apptNoun()}` : l.status === 'nuevo_perfil' || l.appt_state === 'asistio' ? 'Enviar cotización' : 'Perfilar'}${lastTry(l)}`,
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

  // Fecha de la cita como se le escribe al cliente: "jueves 23 de octubre a las 10:00".
  function apptWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })} a las ${d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
  }

  // Liga para abrir WhatsApp con el mensaje ya escrito. vars: { nombre, vendedor, producto, empresa, fecha }.
  function waLink(phone, template, vars = {}) {
    const n = waNumber(phone);
    if (!n) return null;
    const first = String(vars.nombre || '').trim().split(/\s+/)[0] || '';
    const text = String(template || '')
      .replace(/\{nombre\}/g, first)
      .replace(/\{vendedor\}/g, vars.vendedor || '')
      .replace(/\{producto\}/g, vars.producto || 'nuestros servicios')
      .replace(/\{empresa\}/g, vars.empresa || '')
      .replace(/\{servicio\}/g, term())
      .replace(/\{cita\}/g, apptNoun())
      .replace(/\{fecha\}/g, vars.fecha || '')
      .replace(/ {2,}/g, ' ').replace(/ ,/g, ',').trim();
    return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  }

  const api = { TERMS, INDUSTRIES, configure, term, theTerm, industry, appointments, apptNoun, apptPlural, quickProfile, answerLabel, qualifies, stages, apptLabels, apptOutcomes, OUTCOMES, outcomesFor, apptWhen, DAY, MAX, CADENCE, FOLLOW_EVERY, QUOTE_CADENCE, AFTER_QUOTE_EVERY, STAGES, stageOf, SILENT_MAX, REFERRAL_AFTER, RENEW_BEFORE, nextAction, dayDiff, waNumber, waLink };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CRMFollowup = api;
})(this);
