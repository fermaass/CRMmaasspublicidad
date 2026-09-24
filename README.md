# CRM Maass Publicidad

CRM sencillo para que marketing y ventas trabajen los mismos leads. Los leads del formulario web entran solos; los de WhatsApp o llamada se capturan con el botón **+ Lead**. Cada lead avanza por etapas que mueven los toques (Nuevo, Contactando, Contestó, Cumple perfil, Cotizando, Vendido y Declinado con o sin perfil) y lleva aparte su **perfil** (sin perfilar, cumple, no cumple). El perfil se queda aunque el lead se decline, así que los declinados con perfil quedan como base para otras campañas.

## Etapas del tablero

El tablero, Mi día, el filtro de etapa y el Resumen usan las mismas columnas, y **las mueven los toques**:

| Columna | Quién está ahí |
|---|---|
| Nuevo | Llegó y nadie lo ha tocado |
| Contactando | Ya se intentó y aún no contesta (toque 1 a 4 de 5) |
| Contestó | Respondió, falta perfilar |
| Cumple perfil | Perfilado, falta cotizar |
| Cotizando | Cotización enviada, en seguimiento |
| Vendido | Cliente (postventa: referidos y renovación) |
| Declinado · con perfil | Cumplía perfil y no compró: la base para campañas futuras |
| Declinado · sin perfil | No cumplía o nunca se perfiló (los que nunca contestaron no se muestran en el tablero, pero cuentan en el Resumen) |

Nuevo, Contactando y Contestó se calculan de los toques, así que no se arrastran a mano; solo se puede corregir arrastrando hacia Cumple perfil, Cotizando, Vendido o Declinado.

## Mi día

Es la primera pantalla de vendedores, marketing y gerente. Junta lo que toca hoy o ya está vencido, agrupado con las **mismas etapas y colores del Tablero**, así que un lead en Nuevo del tablero aparece bajo Nuevo. Cada etapa dice cuántos tocan hoy de los que hay en el tablero. Cada fila tiene los botones de resultado, así que un toque se registra con un clic sin abrir la ficha. Quien administra los leads ve además cuántos están sin asignar.

## Asignación de leads

Los vendedores no toman leads: los asigna quien administra los leads. Ese es un permiso aparte, **Administra leads**, que el gerente le da a quien quiera en **Usuarios**, sea cual sea su rol. El gerente siempre lo tiene.

- Al capturar un lead con **+ Lead**, quien administra elige al vendedor. Viene preseleccionado el que tiene menos carga.
- En la pestaña **Asignación** ve la **carga de cada vendedor** (leads en curso: por cotizar y cotizando), sus pendientes vencidos y cuántos recibió esta semana. Abajo están los leads sin dueño, del más viejo al más nuevo, cada uno con su selector y el botón Asignar. "Repartir todos parejo" asigna todos de una vez, cada uno al de menor carga en ese momento.
- La sugerencia es el vendedor con menos leads en curso; si hay empate, el que recibió menos esta semana. Un lead vendido o declinado deja de contar como carga.

Si un vendedor captura un lead que le escribió directo, se queda con él. En la ficha, quien administra puede cambiar el vendedor en cualquier momento. En **Configuración → Reparto de leads** se puede encender la asignación automática: cada lead que llegue sin vendedor se asigna solo al de menor carga. De fábrica está apagada.

Si un vendedor se desactiva o deja de ser vendedor, sus leads en curso quedan **sin asignar** (con una nota en su historial) para repartirlos; antes de hacerlo, la app avisa cuántos son. La pestaña Asignación muestra cuántos leads esperan vendedor y se pone en rojo si alguno lleva más de 2 horas esperando.

## Lo que captura el vendedor (todo opcional y en un solo paso)

- **Perfil rápido.** Al marcar "Contestó y cumple perfil" salen tres preguntas de un toque: ¿habla con quien decide?, ¿tiene presupuesto? y ¿cuándo arranca? (este mes, 1 a 3 meses, más adelante). Se ven y se cambian con un toque en la ficha.
- **Qué se acordó y cuándo.** Al registrar una respuesta (contestó, sigue en conversación, cotización enviada) se puede escribir qué se habló y la fecha y hora del siguiente paso. Esa fecha **manda sobre la cadencia** en Mi día ("Acordado: … · jueves 11:00"). El siguiente toque reemplaza el acuerdo.
- **Última nota en Mi día**, para preparar la llamada sin abrir la ficha.
- **Postventa.** Al cerrar la venta se pregunta cuándo termina la campaña. A las 3 semanas de vendido aparece "¿Cómo va la campaña? Pedir referidos" y 30 días antes de que termine, "Renovación". Si renueva, se registra el monto (aparte de la venta original) y la nueva fecha de fin, y el ciclo vuelve a empezar. Los clientes aparecen en Mi día bajo Vendido.

## Botón de WhatsApp

En la ficha y en Mi día hay un botón que abre WhatsApp (en el celular o en WhatsApp Web) con el chat del cliente y un mensaje ya escrito según lo que toque: primer contacto, seguimiento, seguimiento de la cotización o volver a contactar. Quien lo envía puede cambiarlo antes. Los mensajes se editan en **Configuración → Mensajes de WhatsApp** con `{nombre}` (primer nombre del cliente), `{vendedor}` (quien envía) y `{producto}`.

El número se arregla solo: a 10 dígitos se le pone la lada de México (52) y a `+52 1 …` se le quita el 1. Usa las ligas `wa.me`, sin API ni costo, así que el mensaje no se envía solo ni la app se entera: después de enviarlo se registra el toque (ya queda seleccionado WhatsApp como medio).

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

Si el cliente nunca contesta, el **quinto toque** lo pasa solo a Declinado con motivo "No contestó (5 toques)". La misma lógica sigue en el resto del embudo: si el cliente ya había contestado (en Nuevo, Cumple perfil o Cotizando) y luego acumula **3 seguimientos seguidos sin respuesta**, pasa solo a Declinado con motivo "Dejó de contestar". Cualquier respuesta reinicia la cuenta, y el seguimiento que declinaría al lead aparece marcado como "último intento". Estos leads conservan su perfil y sus hitos, así que entran en las audiencias de remarketing.

En la columna Nuevo, los que ya contestaron pero falta perfilar llevan la marca **"Ya contestó · falta perfilar"** (con borde verde) para distinguirlos de los que aún no contestan. Las tarjetas muestran el siguiente toque y si está vencido, y arriba del tablero aparece cuántos toques están vencidos o tocan hoy.

Después de contestar, el seguimiento es cada 3 días hasta cotizar. Ya cotizado, los seguimientos tocan a los **2, 5 y 10 días** de enviada la cotización y luego cada 7 días. Al registrar la cotización se pide el monto (opcional) para saber cuánto dinero hay en juego. Si el cliente "lo pospuso", se puede poner una **fecha para volver a contactarlo** y ese día aparece en Mi día.

La regla de qué toca y cuándo vive en un solo archivo (`public/followup.js`) que usan el servidor y el navegador.

Los motivos de declinado son una lista fija: No contestó (5 toques), Dejó de contestar, No cumple perfil, Precio, Eligió a otro proveedor, Lo pospuso / sin presupuesto ahora, Otro.

El Resumen muestra **en qué toque responden** los leads, **en qué toque se cotiza**, **por qué se pierden** y, por vendedor, los toques promedio hasta respuesta y cotización y sus toques vencidos.

## Campañas y su eficiencia

En **Configuración → Campañas** marketing da de alta sus campañas, el **canal** de cada una (Facebook, Google…) y su **inversión por mes**. Así, al filtrar por periodo, el costo por lead y por cierre usa solo la inversión de esos meses. El vendedor solo puede elegir campañas de esa lista al capturar un lead. Si llega por formulario una campaña que no está (por ejemplo un `utm_campaign` nuevo), se agrega sola para que marketing le ponga su inversión. Renombrar una campaña actualiza sus leads.

Al marcar un lead como **vendido** se puede capturar el **monto de venta** (opcional). Con eso, el Resumen muestra por campaña: costo por lead, costo por cotización, costo por cierre, ventas y **retorno** (ventas ÷ inversión). La campaña más eficiente es la de mayor retorno; si no hay montos capturados, la de menor costo por cierre. Las campañas de antes que solo tienen inversión total se cuentan únicamente con "Todo el tiempo".

Al capturar un lead a mano se pregunta **"¿De dónde viene?"** en una sola lista con campañas y canales orgánicos; si eliges una campaña, el canal se toma de la campaña.

## Listas: productos y canales de percepción

En **Configuración** (gerente y marketing) se administran los productos y los canales por los que el cliente se enteró de ustedes. En cada lead se eligen de una lista, y el Resumen muestra leads, perfil y ventas por producto y por canal. Quitar un elemento lo oculta de la lista pero los leads que ya lo tenían lo conservan.

## Declinados y audiencias

Los declinados no se borran: son la base del embudo y de lo que cuesta cada campaña. Borrar a los que nunca contestaron haría que las campañas se vieran mejores de lo que son.

- En el **Tablero**, la columna Declinado muestra solo a los que contestaron o cumplían perfil. Los que nunca contestaron se ocultan (se dice cuántos) y siguen contando en el Resumen.
- En **Resumen → Marketing** están las audiencias para remarketing, con su conteo y un botón para descargarlas en CSV: cumplían perfil y no compraron, lo pospusieron, contestaron pero no cumplían perfil, y clientes. Los que nunca contestaron no entran en ninguna.

## Roles

| Rol | Qué puede hacer |
|---|---|
| Gerente | Todo: leads, asignación, usuarios, exportar, eliminar leads |
| Marketing | Ver y editar todos los leads, campañas y listas; exportar. Asigna solo si tiene el permiso Administra leads |
| Vendedor | Ver y trabajar solo los leads que le asignan; su propio Resumen de ventas (sin inversión ni datos de otros) |
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

Un contacto se reconoce por los últimos 10 dígitos del teléfono o por el email. Así `+52 1 55 1234 5678` (como aparece en WhatsApp) y `55 1234 5678` (como lo escriben en un formulario) son la misma persona. Si un lead declinado o vendido vuelve a escribir, se reabre en Nuevo (o Cumple perfil si ya estaba perfilado) y conserva su historial.

## Respaldos

Toda la información vive en el archivo `crm.db` del volumen. En Railway activa los respaldos del volumen desde la pestaña del volumen.
