# CRM Maass Publicidad

CRM sencillo para que marketing y ventas trabajen los mismos leads. Los leads del formulario web entran solos; los de WhatsApp o llamada se capturan con el botón **+ Lead**. Cada lead se mueve entre cinco etapas (Nuevo, Nuevo – cumple perfil, Cotizando, Declinado, Vendido) y lleva aparte su **perfil** (sin perfilar, cumple, no cumple). El perfil se queda aunque el lead se decline, así que después se puede filtrar "declinados que cumplen perfil" y exportarlos para otra campaña.

## Mi día

Es la primera pantalla de vendedores, marketing y gerente. Junta lo que toca hoy o ya está vencido, ordenado por urgencia: volver a contactar a quien lo pospuso, seguimiento de cotizaciones, siguiente paso con quien ya contestó y toques de la cadencia. Cada fila tiene los botones de resultado, así que un toque se registra con un clic sin abrir la ficha. El vendedor ve además los leads sin dueño para tomarlos.

## Reparto automático

Cada lead que llega por formulario o que captura marketing o el gerente se asigna por turnos al siguiente vendedor activo. Si lo captura un vendedor, se queda con él. Se apaga en **Configuración → Reparto de leads**.

## Embudo de conversión y eficiencia por vendedor

Cada lead guarda la fecha en que pasó por cada paso: **recibido → contestó → perfilado (cumple perfil) → cotizado → cerrado**. Esos pasos no se borran aunque el lead se decline, así que un lead que cotizó y luego se perdió sigue contando como cotizado. El embudo es acumulado: llegar a un paso cuenta también los anteriores (si se cotizó, el cliente contestó).

- Que el cliente contestó se registra con los toques (ver abajo).
- El **Resumen** tiene dos pestañas. **Ventas**: embudo, velocidad al primer toque, dinero en cotización, eficiencia por vendedor (cuántos recibe, le contestan, perfila, cotiza y cierra; cuánto tarda en dar el primer toque y cuánto tarda el cliente en contestar, ambos desde que llega el lead), en qué toque responden y se cotiza, y por qué se pierden. **Marketing**: costo por lead, costo por cierre, retorno, % que cumple perfil, conversión y eficiencia por campaña, resultados por anuncio y de dónde vienen los leads.
- Todo se puede filtrar por periodo (este mes, mes pasado, 30/90 días, este año) y por campaña.

## Toques y cadencia

Cada lead lleva hasta **5 toques** (intentos de contacto del vendedor) con una cadencia de **12 días**: día 0, 1, 3, 7 y 12 desde que llega el lead. En la ficha del lead se registra cada toque con su medio (llamada, WhatsApp, correo o visita) y su resultado, y **el resultado mueve al lead de etapa**:

| Etapa | Resultados posibles |
|---|---|
| Nuevo | No contestó · Contestó y cumple perfil (→ Cumple perfil) · Contestó pero no cumple (→ Declinado) · Contestó, falta perfilar |
| Cumple perfil | No contestó · Sigue en conversación · Se envió cotización (→ Cotizando) · No le interesó (→ Declinado, con motivo) |
| Cotizando | No contestó · Sigue en conversación · Cerró venta (→ Vendido, con monto) · Rechazó (→ Declinado, con motivo) |

Si el cliente nunca contesta, el **quinto toque** lo pasa solo a Declinado con motivo "No contestó (5 toques)". Cuando el cliente ya respondió, los toques siguen contando (para saber en cuál se cotizó y cerró) sin límite. Las tarjetas muestran el siguiente toque y si está vencido, y arriba del tablero aparece cuántos toques están vencidos o tocan hoy.

Después de contestar, el seguimiento es cada 3 días hasta cotizar. Ya cotizado, los seguimientos tocan a los **2, 5 y 10 días** de enviada la cotización y luego cada 7 días. Al registrar la cotización se pide el monto (opcional) para saber cuánto dinero hay en juego. Si el cliente "lo pospuso", se puede poner una **fecha para volver a contactarlo** y ese día aparece en Mi día.

La regla de qué toca y cuándo vive en un solo archivo (`public/followup.js`) que usan el servidor y el navegador.

Los motivos de declinado son una lista fija: No contestó (5 toques), No cumple perfil, Precio, Eligió a otro proveedor, Lo pospuso / sin presupuesto ahora, Otro.

El Resumen muestra **en qué toque responden** los leads, **en qué toque se cotiza**, **por qué se pierden** y, por vendedor, los toques promedio hasta respuesta y cotización y sus toques vencidos.

## Campañas y su eficiencia

En **Configuración → Campañas** marketing da de alta sus campañas, el **canal** de cada una (Facebook, Google…) y su **inversión por mes**. Así, al filtrar por periodo, el costo por lead y por cierre usa solo la inversión de esos meses. El vendedor solo puede elegir campañas de esa lista al capturar un lead. Si llega por formulario una campaña que no está (por ejemplo un `utm_campaign` nuevo), se agrega sola para que marketing le ponga su inversión. Renombrar una campaña actualiza sus leads.

Al marcar un lead como **vendido** se puede capturar el **monto de venta** (opcional). Con eso, el Resumen muestra por campaña: costo por lead, costo por cotización, costo por cierre, ventas y **retorno** (ventas ÷ inversión). La campaña más eficiente es la de mayor retorno; si no hay montos capturados, la de menor costo por cierre. Las campañas de antes que solo tienen inversión total se cuentan únicamente con "Todo el tiempo".

Al capturar un lead a mano se pregunta **"¿De dónde viene?"** en una sola lista con campañas y canales orgánicos; si eliges una campaña, el canal se toma de la campaña.

## Listas: productos y canales de percepción

En **Configuración** (gerente y marketing) se administran los productos y los canales por los que el cliente se enteró de ustedes. En cada lead se eligen de una lista, y el Resumen muestra leads, perfil y ventas por producto y por canal. Quitar un elemento lo oculta de la lista pero los leads que ya lo tenían lo conservan.

## Audiencias

En la **Lista** hay atajos para armar audiencias y exportarlas en CSV: cumplen perfil y no compraron, lo pospusieron, nunca contestaron y clientes. Cada atajo solo aplica filtros; "Exportar CSV" descarga lo que se ve.

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
- `utm_source`, `utm_medium`, `utm_content` (o `anuncio`): el formulario de ejemplo los toma solos del link del anuncio y los recuerda aunque la persona navegue a otra página. Con `utm_content` el Resumen muestra qué anuncio trae leads que cierran.
- `producto`: nombre de un producto de la lista (el formulario de ejemplo ya trae el selector)
- `canal` / `como_se_entero`: nombre de un canal de percepción de la lista
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
