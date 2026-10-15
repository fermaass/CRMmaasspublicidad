// "Para quién es" cada propiedad y qué tan bien le queda a una búsqueda. Lo usan el servidor (ficha) y el navegador
// (buscador "Encuentra tu renta"), así ambos dicen lo mismo. Sin reglas discriminatorias: solo características de la propiedad.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MATCH = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');
  const fdate = (s) => { if (!s) return '—'; const a = String(s).slice(0, 10).split('-'); return a[2] + '/' + a[1] + '/' + a[0]; };
  const PROFILES = ['Una persona o pareja', 'Familia pequeña', 'Familia grande', 'Estudiante o joven'];
  const SPACE = { 'Una persona o pareja': 40, 'Familia pequeña': 80, 'Familia grande': 140, 'Estudiante o joven': 35 };
  const has = (p, x) => (p.extras || []).indexOf(x) >= 0;
  const parkOf = (p) => (p.parking != null && p.parking !== '' ? Number(p.parking) : (has(p, 'Estacionamiento') ? 1 : 0));

  function ideal(p) {
    const a = []; const r = Number(p.bedrooms) || 0; const m = Number(p.m2) || 0; const o = Number(p.max_occupants) || r * 2;
    if (r <= 1 || (r === 2 && m <= 90)) a.push('Una persona o pareja');
    if (r >= 2 && r <= 3 && m >= 70 && o >= 3) a.push('Familia pequeña');
    if (r >= 4 || (r >= 3 && m >= 150)) a.push('Familia grande');
    if ((r <= 2 && p.rent <= 13000) || has(p, 'Amueblado')) a.push('Estudiante o joven');
    return a;
  }

  function considera(p) {
    const a = []; const inc = p.includes || [];
    if (!parkOf(p)) a.push('Sin cochera indicada');
    if (!has(p, 'Mascotas')) a.push('Mascotas: no indicado como permitido');
    if (p.maintenance && inc.indexOf('Mantenimiento') < 0) a.push('Mantenimiento aparte: ' + money(p.maintenance) + '/mes');
    if (p.min_term >= 12) a.push('Contrato mínimo de ' + p.min_term + ' meses');
    if (p.consider_note) a.push(p.consider_note);
    return a;
  }

  // b = { perfil, pers, presu, cuando: ''|'mes'|'dos', prior: [] }. today = 'AAAA-MM-DD'.
  function fit(p, b, today) {
    const R = []; const X = []; const inc = p.includes || []; let s = 0; let ex = false;
    const fijo = p.rent + (inc.indexOf('Mantenimiento') >= 0 ? 0 : (p.maintenance || 0));
    if (ideal(p).indexOf(b.perfil) >= 0) { s += 3; R.push('Ideal para ' + b.perfil.toLowerCase()); }
    if (b.pers && p.max_occupants) {
      if (b.pers <= p.max_occupants) R.push('Capacidad para ' + p.max_occupants + ' personas');
      else { ex = true; X.push('Capacidad máxima de ' + p.max_occupants + ' personas'); }
    }
    if (b.presu) {
      if (p.rent <= b.presu) { s += 2; R.push('Renta dentro de tu presupuesto (' + money(p.rent) + ')'); if (fijo > b.presu) X.push('Con el mantenimiento llegas a ' + money(fijo) + '/mes'); }
      else { ex = true; X.push('Renta arriba de tu presupuesto (' + money(p.rent) + ')'); }
    }
    if (b.cuando) {
      const lim = new Date(today + 'T12:00:00');
      if (b.cuando === 'mes') lim.setMonth(lim.getMonth() + 1, 0); else lim.setDate(lim.getDate() + 60);
      const limIso = lim.toISOString().slice(0, 10);
      if (!p.available_from || p.available_from <= limIso) { s += 1; R.push(p.available_from && p.available_from > today ? 'Disponible desde ' + fdate(p.available_from) : 'Disponible ya'); }
      else X.push('Disponible hasta el ' + fdate(p.available_from));
    }
    (b.prior || []).forEach(function (k) {
      if (k === 'Seguridad') { if (has(p, 'Seguridad 24h')) { s += 2; R.push('Seguridad 24h'); } else X.push('Sin seguridad 24h indicada'); }
      else if (k === 'Cochera') { const need = b.perfil === 'Familia grande' ? 2 : 1; const pk = parkOf(p); if (pk >= need) { s += 2; R.push('Cochera para ' + pk + ' auto(s)'); } else X.push('Cochera: ' + (pk ? pk + ' lugar(es)' : 'no indicada')); }
      else if (k === 'Mascotas') { if (has(p, 'Mascotas')) { s += 3; R.push('Se indican mascotas como permitidas'); } else X.push('Mascotas: no indicado como permitido'); }
      else if (k === 'Amueblado') { if (has(p, 'Amueblado')) { s += 2; R.push('Amueblado'); } else X.push('No se indica amueblado'); }
      else if (k === 'Servicios incluidos') { const sv = inc.filter(function (x) { return x !== 'Mantenimiento'; }); if (sv.length) { s += 2; R.push('Incluye ' + sv.join(', ').toLowerCase()); } else X.push('Los servicios van por tu cuenta'); }
      else if (k === 'Espacio') { const th = SPACE[b.perfil] || 0; if (p.m2 >= th) { s += 1; R.push(p.m2 + ' m²'); } else X.push('Solo ' + (p.m2 || 0) + ' m²'); }
    });
    return { s: s, R: R, X: X, ex: ex };
  }

  const buscaTxt = (b) => b.perfil + ' · ' + (b.pers || '?') + ' persona(s)' + (b.presu ? ' · hasta ' + money(b.presu) : '')
    + ((b.prior || []).length ? ' · prioridades: ' + b.prior.join(', ').toLowerCase() : '');

  return { PROFILES: PROFILES, money: money, fdate: fdate, ideal: ideal, considera: considera, fit: fit, parkOf: parkOf, buscaTxt: buscaTxt };
}));
