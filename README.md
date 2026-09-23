# CRM Maass Publicidad

CRM sencillo para que marketing y ventas trabajen los mismos leads. Los leads del formulario web entran solos; los de WhatsApp o llamada se capturan con el botón **+ Lead**. Cada lead se mueve entre cinco etapas (Nuevo, Nuevo – cumple perfil, Cotizando, Declinado, Vendido) y lleva aparte su **perfil** (sin perfilar, cumple, no cumple). El perfil se queda aunque el lead se decline, así que después se puede filtrar "declinados que cumplen perfil" y exportarlos para otra campaña.

## Roles

| Rol | Qué puede hacer |
|---|---|
| Gerente | Todo: leads, asignación, usuarios, exportar, eliminar leads |
| Marketing | Ver y editar todos los leads, perfilar, asignar a vendedores, exportar |
| Vendedor | Ver sus leads y los que no tienen dueño; tomar un lead libre; cambiar etapa, perfil y agregar notas de los suyos |
| Analista | Solo lectura de todo, resumen y exportar CSV |

## Publicarlo en Railway (recomendado)

1. Crea una cuenta en [railway.com](https://railway.com) entrando con tu cuenta de GitHub.
2. **New Project → Deploy from GitHub repo** y elige este repositorio.
3. Cuando aparezca el servicio, clic derecho sobre él → **Attach volume** (o *Add Volume*), con ruta `/data`. Ahí se guarda la base de datos; sin volumen se borraría en cada actualización.
4. En el servicio: **Settings → Networking → Generate Domain**. Esa es la dirección de tu CRM.
5. Abre esa dirección: la app te pide crear el usuario gerente. Luego entra a **Configuración** para conectar el formulario de tu página.

No hace falta configurar variables de entorno: la app detecta el volumen y genera sola sus claves.

## Correrlo en una computadora (desarrollo)

Requiere Node.js 22.13 o superior.

```bash
npm install
npm start      # abre http://localhost:3000
npm test
```

## Entrada automática de leads

### Formularios

La dirección y la clave aparecen en **Configuración**, junto con un formulario de ejemplo listo para copiar. Técnicamente: `POST /webhooks/form` con la clave en el header `x-api-key` o en el campo/parámetro `key`. Acepta JSON o formulario HTML normal. Campos reconocidos (en español o inglés):

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

### WhatsApp y llamadas (captura manual)

Con **+ Lead** se elige por dónde llegó (WhatsApp, llamada u otro) y se escribe el teléfono. Si ese contacto ya existe, no se duplica: se abre su ficha y el nuevo contacto queda en su historial. Si lo atiende otro vendedor, la app avisa quién. En el Resumen se ve cuántos leads llegan por cada canal.

### Duplicados

Un contacto se reconoce por los últimos 10 dígitos del teléfono o por el email. Así `+52 1 55 1234 5678` (como aparece en WhatsApp) y `55 1234 5678` (como lo escriben en un formulario) son la misma persona. Si un lead declinado o vendido vuelve a escribir, se reabre en Nuevo (o Nuevo – cumple perfil si ya estaba perfilado) y conserva su historial.

## Respaldos

Toda la información vive en el archivo `crm.db` del volumen. En Railway activa los respaldos del volumen desde la pestaña del volumen.
