// Seguridad transversal: encabezados del navegador, política de contenido (CSP), candado de origen (Cloudflare)
// e IP real del visitante. Todo lo que el navegador puede hacer por nosotros, se lo pedimos aquí.
const crypto = require('node:crypto');

let trustCloudflare = false;
// IP real: solo se cree el encabezado de Cloudflare si el candado de origen está activo (si no, cualquiera lo podría inventar).
const clientIp = (req) => String((trustCloudflare && req.get('cf-connecting-ip')) || req.ip || '');

// Candado de origen: Cloudflare agrega un encabezado secreto (Reglas de transformación); sin él, el servidor no responde.
// Así nadie entra directo a la dirección de Railway saltándose Cloudflare.
function originGuard(config) {
  trustCloudflare = Boolean(config.originSecret);
  const expected = config.originSecret ? Buffer.from(config.originSecret) : null;
  return (req, res, next) => {
    if (!expected || req.path === '/health') return next();
    const got = Buffer.from(String(req.get('x-origin-auth') || ''));
    if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) return next();
    res.status(403).type('text').send('Acceso no permitido');
  };
}

const PERMISSIONS = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()';

// Encabezados para todo. HSTS solo cuando la conexión es segura (HTTPS de verdad).
function baseHeaders(config) {
  return (req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': PERMISSIONS, 'Cross-Origin-Opener-Policy': 'same-origin', 'X-DNS-Prefetch-Control': 'off',
    });
    if (req.secure || config.cookieSecure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

// Sitio público: los <script> en línea solo corren si traen el "nonce" de esta respuesta. El píxel de Meta, permitido.
function siteCsp(config = {}) {
  return (req, res, next) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    res.locals.nonce = nonce;
    res.set('Content-Security-Policy', [
      "default-src 'self'", `script-src 'self' 'nonce-${nonce}' https://connect.facebook.net`, "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://www.facebook.com", "font-src 'self'", "connect-src 'self' https://www.facebook.com https://connect.facebook.net",
      "frame-src 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
      ...(req.secure || config.cookieSecure ? ['upgrade-insecure-requests'] : []),
    ].join('; '));
    next();
  };
}

// Panel: solo código propio; nada de terceros. Sus respuestas de datos no se guardan en caché (computadora compartida).
function panelCsp() {
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
        "connect-src 'self'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join('; '),
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  };
}

// Contraseñas: largo mínimo, que no sean de las más usadas ni contengan el correo.
const COMMON = ['contraseña', 'contrasena', 'password', '1234567890', '0123456789', 'qwertyuiop', 'rentaypunto', 'queretaro', '12345678910', 'asdfghjkl', 'iloveyou', 'abc1234567', 'teamo1234', 'mexico1234', 'administrador', 'admin12345'];
function passwordProblem(password, email) {
  const p = String(password || '');
  if (p.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (p.length > 200) return 'La contraseña es demasiado larga.';
  const low = p.toLowerCase();
  if (COMMON.some((c) => low.includes(c)) || /^(.)\1+$/.test(p) || /^\d+$/.test(p)) return 'Esa contraseña es muy fácil de adivinar. Usa una frase con palabras y números.';
  const user = String(email || '').split('@')[0].toLowerCase();
  if (user.length >= 4 && low.includes(user)) return 'La contraseña no debe contener tu correo.';
  return null;
}

module.exports = { clientIp, originGuard, baseHeaders, siteCsp, panelCsp, passwordProblem };
