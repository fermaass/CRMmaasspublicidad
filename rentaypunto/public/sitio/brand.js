// Identidad visual de Rentaypunto: logo, íconos e ilustración del banner (Acueducto de Querétaro).
// Lo usan el servidor (páginas) y el navegador (tarjetas del buscador y panel), así todo se ve igual.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BRAND = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  // Íconos de línea (24×24, trazo del color del texto). Se dibujan una vez en la página y se usan con <use>.
  const ICONS = {
    bed: '<path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 14h18M3 18v2M21 18v2M7 9V7.5A1.5 1.5 0 0 1 8.5 6h2A1.5 1.5 0 0 1 12 7.5V9"/>',
    bath: '<path d="M4 12h16v2.5A4.5 4.5 0 0 1 15.5 19h-7A4.5 4.5 0 0 1 4 14.5zM6.5 12V5.5a2 2 0 0 1 3.7-1M7.5 19l-1 2M16.5 19l1 2"/>',
    area: '<path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M8 8h8v8H8z"/>',
    car: '<path d="M5 15l1.6-4.6A2 2 0 0 1 8.5 9h7a2 2 0 0 1 1.9 1.4L19 15M4 15h16v4H4zM6 19v2M18 19v2M7.5 17h.01M16.5 17h.01"/>',
    paw: '<circle cx="7" cy="9" r="1.8"/><circle cx="11" cy="6" r="1.8"/><circle cx="15.5" cy="6.5" r="1.8"/><circle cx="18.5" cy="10.5" r="1.8"/><path d="M8.5 17.5c0-2.8 2-5.5 4.5-5.5s4 2.2 4 4.4c0 1.9-1.4 3.1-3.2 3.1-1 0-1.6-.5-2.6-.5s-1.4.6-2.2.6c-.9 0-.5-1.1-.5-2.1z"/>',
    sofa: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M3 13a2 2 0 0 1 4 0v1h10v-1a2 2 0 0 1 4 0v4H3zM5 17v2M19 17v2"/>',
    shield: '<path d="M12 3l8 3v5.5c0 4.6-3.4 8.6-8 9.5-4.6-.9-8-4.9-8-9.5V6z"/><path d="M9 12l2 2 4-4.5"/>',
    heart: '<path d="M12 20s-7.5-4.6-9.2-9.4A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 9.2 4C19.5 15.4 12 20 12 20z"/>',
    chat: '<path d="M4.5 19.5l1.2-3.6A8 8 0 1 1 8.3 18.4z"/><path d="M9.3 8.6c.2 2.6 3 5.6 5.8 6l1-1.3-2-1.1-.8.8c-1-.4-2-1.4-2.4-2.4l.8-.8-1.1-2z"/>',
    calendar: '<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2"/>',
    pin: '<path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l1.8 1.8"/>',
    user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    users: '<circle cx="9" cy="8.5" r="3.3"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M15.5 5.2a3.3 3.3 0 0 1 0 6.6M17.5 13.6A6.5 6.5 0 0 1 21.5 20"/>',
    family: '<circle cx="7" cy="6.5" r="2.5"/><circle cx="17" cy="6.5" r="2.5"/><circle cx="12" cy="12" r="2"/><path d="M3 20v-3.5A4 4 0 0 1 7 12.5M21 20v-3.5a4 4 0 0 0-4-4M8.5 20v-1.5a3.5 3.5 0 0 1 7 0V20"/>',
    cap: '<path d="M2.5 9.5L12 5l9.5 4.5L12 14z"/><path d="M6.5 11.5v4c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-4M21.5 9.5v5"/>',
    bolt: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
    tag: '<path d="M3.5 12.5V4h8.5l8.5 8.5-8 8z"/><circle cx="8" cy="8.5" r="1.3"/>',
    home: '<path d="M3.5 11L12 4l8.5 7M5.5 9.5V20h13V9.5M10 20v-5.5h4V20"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    doc: '<path d="M6.5 3h8l4 4v14h-12z"/><path d="M14 3v4.5h4.5M9 12.5h6M9 16h6"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.8z"/>',
    camera: '<path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z"/><circle cx="12" cy="13" r="3.3"/>',
    share: '<circle cx="6" cy="12" r="2.3"/><circle cx="17.5" cy="6" r="2.3"/><circle cx="17.5" cy="18" r="2.3"/><path d="M8.1 11l7.3-3.9M8.1 13l7.3 3.9"/>',
    map: '<path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2zM9 4.5v13M15 6.5v13"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    building: '<path d="M5 21V4h10v17M15 9h4v12M3 21h18M8.5 8h3M8.5 11.5h3M8.5 15h3"/>',
    chart: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  };
  const sprite = () => '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">'
    + Object.entries(ICONS).map(([k, v]) => '<symbol id="i-' + k + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + v + '</symbol>').join('') + '</svg>';
  const icon = (name, cls) => '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';

  // Logo: una casa dentro de un pin, con el "punto" en ámbar.
  const mark = (size) => '<svg class="mark" width="' + (size || 34) + '" height="' + (size || 34) + '" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 38s-14-11.6-14-22a14 14 0 0 1 28 0c0 10.4-14 22-14 22z" fill="var(--pr)"/><path d="M13 18.5l7-6 7 6v7.5h-4.5v-4.5h-5v4.5H13z" fill="#fff"/><circle cx="31.5" cy="31.5" r="4.5" fill="var(--ac)" stroke="var(--bg)" stroke-width="2"/></svg>';
  const logo = (size) => '<span class="logo-in">' + mark(size) + '<span class="word">Renta<b>y</b>punto</span></span>';

  // Banner: el Acueducto de Querétaro con cerros y casas. Ilustración de marca (no es una propiedad real).
  function hero() {
    let arches = '';
    const top = 228; const base = 312; const w = 34;
    for (let x = -10; x < 1220; x += w) arches += 'M' + x + ' ' + base + 'V' + (top + 30) + 'a' + (w / 2 - 5) + ' ' + (w / 2 - 5) + ' 0 0 1 ' + (w - 10) + ' 0V' + base + 'z';
    let houses = '';
    const H = [[40, 64, 46], [118, 52, 38], [930, 70, 50], [1010, 56, 40], [1080, 76, 52], [1170, 50, 36]];
    H.forEach(([x, w2, h]) => { houses += '<path d="M' + x + ' 360V' + (360 - h) + 'l' + (w2 / 2) + ' -' + Math.round(h * 0.45) + 'l' + (w2 / 2) + ' ' + Math.round(h * 0.45) + 'V360z" class="h-house"/><rect x="' + (x + w2 * 0.38) + '" y="' + (360 - h * 0.55) + '" width="' + (w2 * 0.24) + '" height="' + (h * 0.55) + '" class="h-door"/>'; });
    return '<svg class="hero-art" viewBox="0 140 1200 220" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">'
      + '<circle cx="1040" cy="196" r="30" class="h-sun"/>'
      + '<path d="M0 250C140 190 260 210 380 236S640 170 780 196s300 40 420 8V360H0z" class="h-hill1"/>'
      + '<path d="M0 214h1200v14H0z" class="h-deck" transform="translate(0 0)"/>'
      + '<path d="M-10 ' + top + 'h1230v' + (base - top) + 'H-10z' + arches + '" fill-rule="evenodd" class="h-aq"/>'
      + '<path d="M0 300C200 280 380 300 560 296s420-24 640-6V360H0z" class="h-hill2"/>'
      + houses + '</svg>';
  }
  // Foto pendiente: dibujo neutro en lugar de una imagen falsa.
  const noPhoto = (label) => '<div class="nophoto">' + icon('home') + '<span>' + (label || 'Fotos próximamente') + '</span></div>';

  return { ICONS, sprite, icon, mark, logo, hero, noPhoto };
}));
