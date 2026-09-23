# CRM Maass Publicidad

CRM sencillo para que marketing y ventas trabajen los mismos leads. Los leads entran solos desde formularios web y WhatsApp. Cada lead se mueve entre cinco etapas (Nuevo, Nuevo – cumple perfil, Cotizando, Declinado, Vendido) y lleva aparte su **perfil** (sin perfilar, cumple, no cumple). El perfil se queda aunque el lead se decline, así que después se puede filtrar "declinados que cumplen perfil" y exportarlos para otra campaña.

## Roles

| Rol | Qué puede hacer |
|---|---|
| Gerente | Todo: leads, asignación, usuarios, exportar, eliminar leads |
| Marketing | Ver y editar todos los leads, perfilar, asignar a vendedores, exportar |
| Vendedor | Ver sus leads y los que no tienen dueño; tomar un lead libre; cambiar etapa, perfil y agregar notas de los suyos |
| Analista | Solo lectura de todo, resumen y exportar CSV |

## Instalación

Requiere Node.js 22.13 o superior. No usa servicios externos: la base de datos es un archivo SQLite.

```bash
npm install
cp .env.example .env   # y edita los valores
npm start
```

La primera vez que arranca crea el usuario gerente con `ADMIN_EMAIL` y `ADMIN_PASSWORD`. Desde la pestaña **Usuarios** el gerente da de alta a los demás.

Pruebas: `npm test`.

## Entrada automática de leads

### Formularios

`POST /webhooks/form` con la clave en el header `x-api-key` o en el campo/parámetro `key`. Acepta JSON o formulario HTML normal. Campos reconocidos (en español o inglés):

- `nombre` / `name`
- `telefono` / `phone`
- `email` / `correo`
- `mensaje` / `message`
- `campana` / `campaign` / `utm_campaign`
- `redirect` (opcional): URL a la que se manda al visitante después de enviar
- `website`: campo trampa para bots, déjalo oculto y vacío

Ejemplo con un formulario HTML:

```html
<form action="https://TU-DOMINIO/webhooks/form" method="post">
  <input type="hidden" name="key" value="TU_FORM_API_KEY">
  <input type="hidden" name="campana" value="landing-espectaculares">
  <input type="hidden" name="redirect" value="https://maass.com/gracias">
  <input name="website" style="display:none" tabindex="-1" autocomplete="off">
  <input name="nombre" required>
  <input name="telefono" required>
  <input name="email" type="email">
  <textarea name="mensaje"></textarea>
  <button>Enviar</button>
</form>
```

La clave queda visible en el HTML de la página. Para formularios públicos es aceptable (lo peor que pasa es que alguien mande leads falsos), pero si empieza a llegar spam cambia la clave o manda el formulario desde tu servidor.

Para Meta Lead Ads, Google Ads u otros, conecta con Zapier o Make apuntando a esta misma URL.

### WhatsApp (WhatsApp Business Cloud API de Meta)

1. En tu app de Meta for Developers, en WhatsApp → Configuración → Webhook:
   - URL de devolución de llamada: `https://TU-DOMINIO/webhooks/whatsapp`
   - Token de verificación: el mismo valor de `WHATSAPP_VERIFY_TOKEN`
2. Suscríbete al campo `messages`.
3. Pon el "App secret" de la app en `WHATSAPP_APP_SECRET` para que el servidor rechace mensajes que no vengan de Meta.

Cada número nuevo que escribe crea un lead con su nombre de perfil de WhatsApp. Si el número ya existe no se duplica: el mensaje se agrega a su historial.

### Duplicados

Un contacto se reconoce por los últimos 10 dígitos del teléfono o por el email. Así `+52 1 55 1234 5678` (como llega de WhatsApp) y `55 1234 5678` (como lo escriben en un formulario) son la misma persona. Si un lead declinado o vendido vuelve a escribir, se reabre en Nuevo (o Nuevo – cumple perfil si ya estaba perfilado) y conserva su historial.

## Publicarlo

Sirve cualquier servidor con Node y disco persistente (un VPS, Railway, Render con disco, etc.). WhatsApp exige HTTPS, así que ponlo detrás de un dominio con certificado y usa `COOKIE_SECURE=true`. Respalda el archivo de `DB_PATH` con regularidad.
