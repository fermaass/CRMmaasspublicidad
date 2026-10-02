# Maass Leads

Plataforma de leads hecha por Maass Publicidad; sirve para cualquier giro.

CRM sencillo para que marketing y ventas trabajen los mismos leads. Cada empresa tiene **su propia instalación** (su link y su base de datos, separada de las demás); el nombre, el logo, los productos con sus precios y cómo le llama a lo que vende se configuran en la app. Los leads del formulario web entran solos; los de WhatsApp o llamada se capturan con el botón **+ Lead**. Cada lead avanza por etapas que mueven los toques (Nuevo, Contactando, Contestó, Cumple perfil, Cotizando, Vendido y Declinado con o sin perfil) y lleva aparte su **perfil** (sin perfilar, cumple, no cumple). El perfil se queda aunque el lead se decline, así que los declinados con perfil quedan como base para otras campañas.

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

Es la primera pantalla del vendedor. Junta lo que toca hoy o ya está vencido, agrupado con las **mismas etapas y colores del Tablero**, así que un lead en Nuevo del tablero aparece bajo Nuevo. Solo salen las etapas con algo que hacer hoy. Cada etapa dice cuántos tocan hoy de los que hay en el tablero. Cada fila tiene los botones de resultado, así que un toque se registra con un clic sin abrir la ficha.

- **Llamar y WhatsApp** a un toque, en Mi día y en la ficha. Al usarlos, el toque que se registre después queda con ese medio.
- **Buscador** para encontrar a un cliente que regresa la llamada (por nombre, teléfono o campaña) sin salir de Mi día.
- **Contador en la pestaña Mi día** con lo que hay que atender; en rojo si hay vencidos. Se ve desde el Tablero o el Resumen.

El **Resumen del vendedor** dice cómo va su mes (ventas contra el mes pasado a estas alturas, cotizaciones abiertas, frías y vencidos), lo compara contra el promedio del equipo (sin nombres de compañeros: conversión, cierre de lo cotizado, ticket, descuento y primer toque), y muestra su embudo, su pipeline y por qué pierde.

## Asignación de leads

Los vendedores no toman leads: los asigna el **Coordinador de leads**, un rol para la persona cuyo único trabajo es capturar leads, repartirlos y corregir sus datos (no ve reportes ni registra toques).

- Al capturar un lead con **+ Lead**, el coordinador elige al vendedor; viene preseleccionado el que tiene menos carga.
- En **Asignación** ve la **carga de cada vendedor** (leads en curso: por cotizar y cotizando), sus pendientes vencidos y cuántos recibió esta semana, y abajo los leads sin dueño, del más viejo al más nuevo. "Repartir todos parejo" asigna todos de una vez, cada uno al de menor carga. Ahí mismo se enciende o apaga la asignación automática (de fábrica, apagada).
- La sugerencia es el vendedor con menos leads en curso; si hay empate, el que recibió menos esta semana. Un lead vendido o declinado deja de contar como carga.
- El gerente no asigna en su día a día; solo puede **reasignar desde la ficha** en una emergencia.
- **Cualquier usuario puede asignar además de su trabajo:** en Usuarios, la casilla **"También asigna leads"** (gerente, gerente de marketing, vendedor o analista) le da la pestaña Asignación y le deja elegir vendedor al capturar. En el primer uso la app le pregunta al gerente si él asignará. Si un vendedor captura un lead que le escribió directo, se queda con él.
- **Vendedor que también asigna:** en Asignación ve los leads sin dueño, pero en su tablero y su Resumen solo los suyos. Para que se note si se queda con los mejores, en **Equipo hoy** sale cuántos de los leads que repartió esa semana se asignó a sí mismo (en rojo si fueron más que su parte pareja).

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

## Para el gerente de ventas

- **Equipo hoy:** una fila por vendedor con semáforo. Rojo: vencidos, un lead sin primer toque después de 2 horas, acuerdos vencidos o un pedido del gerente con más de 24 h sin atender. Amarillo: cotizaciones frías (más de 15 días sin contacto) o datos incompletos. Debajo de cada vendedor van los leads concretos que requieren atención, y aparte **las 5 cotizaciones más grandes** con su último contacto y siguiente paso.
- **Ficha del vendedor** (clic en su nombre): conversión, cierre de lo cotizado, ticket, descuento y primer toque **contra el promedio del equipo**, su embudo, su pipeline, por qué pierde, los pedidos abiertos y qué tan a tiempo los atiende. Es la base para la junta uno a uno.
- **Pedir seguimiento:** desde la ficha del lead; al vendedor le aparece hasta arriba en su Mi día y se quita sola cuando registra el toque. Queda un historial: se mide el % de pedidos que cada vendedor atiende en menos de 24 h.
- **Reporte de ventas:** con las fechas que elijas (de entrada, los últimos 7 días) contra el periodo anterior: ventas cerradas, cotizaciones enviadas y renovaciones por vendedor, el pipeline, las cotizaciones más grandes y por qué se perdieron. Para imprimir, PDF o Excel.
- **Montos obligatorios** al registrar una cotización y una venta: sin ellos el pipeline, la venta esperada, el ticket y el descuento salen mal. Los datos viejos incompletos aparecen como aviso en Equipo hoy.
- En **Resumen → Ventas**: lectura rápida del equipo (quién tiene vencidos, venta esperada, cotizaciones frías y ventas contra el periodo anterior), embudo, pipeline con venta esperada y una tabla de vendedores con lo que sirve para decidir. "¿En qué toque responden?" queda plegada.
- No registra toques en leads de otros, pero puede corregir datos y etapas y reasignar en emergencias.

## Para el gerente de marketing

- El rol se llama **Gerente de marketing**. Entra directo al **Resumen de marketing** (no ve la pestaña de ventas ni evalúa vendedores), no registra toques ni mueve etapas; desde la ficha de un lead solo corrige origen, producto y contacto, y deja notas.
- **Lectura rápida:** cuántas campañas hay que revisar, de dónde viene el lead con perfil más barato del mes y cuántos leads no tienen origen. Desde ahí sale el **reporte de marketing** con las fechas que elijas (de entrada, el mes pasado), para imprimir, PDF o Excel.
- **Campañas a revisar (mes en curso):** rojo si una campaña tiene inversión y no trae leads en 7 días, si ninguno de 5 o más leads cumple perfil, o si cada lead con perfil cuesta más del doble del promedio. Amarillo si trajo leads sin inversión capturada (sus costos saldrían en cero) o si la mitad de sus descartes son por un mismo motivo.
- **Indicadores con comparación** contra el periodo anterior: leads, % que cumple perfil, inversión, costo por lead, **costo por lead con perfil**, costo por cierre, retorno y leads sin origen.
- **Tabla de campañas** con lo que decide la inversión: leads, cumplen perfil, inversión, costo por lead con perfil, cierres, retorno y por qué se descartan. Clic en una campaña abre su **ficha**: indicadores contra el promedio, tendencia semanal de leads y leads con perfil (muestra cuándo un anuncio se cansa), inversión contra leads por mes, sus anuncios, **lo que dicen sus leads** (perfil rápido: decisor, presupuesto, cuándo arranca) y por qué se descartan.
- **Por anuncio**, **audiencias** (lista completa o formato para Meta / Google), leads por día, de dónde vienen y por producto.
- **Configuración en pestañas:** Campañas y links (inversión por mes, canal y generador de links con UTM), Formulario y WhatsApp, y Productos y canales.
- Al capturar un lead a mano, **"¿De dónde viene?" es obligatorio**.

## Listas: productos y canales de percepción

En **Configuración** (gerente y marketing) se administran los productos y los canales por los que el cliente se enteró de ustedes. En cada lead se eligen de una lista, y el Resumen muestra leads, perfil y ventas por producto y por canal. Quitar un elemento lo oculta de la lista pero los leads que ya lo tenían lo conservan.

## Declinados y audiencias

Los declinados no se borran: son la base del embudo y de lo que cuesta cada campaña. Borrar a los que nunca contestaron haría que las campañas se vieran mejores de lo que son.

- En el **Tablero**, la columna Declinado muestra solo a los que contestaron o cumplían perfil. Los que nunca contestaron se ocultan (se dice cuántos) y siguen contando en el Resumen.
- En **Resumen → Marketing** están las audiencias para remarketing, con su conteo y un botón para descargarlas en CSV: cumplían perfil y no compraron, lo pospusieron, contestaron pero no cumplían perfil, y clientes. Los que nunca contestaron no entran en ninguna.

## Roles

| Rol | Qué puede hacer |
|---|---|
| Gerente | Dirige: Equipo hoy, Resumen, todos los leads, pedir seguimiento, corregir y reasignar en emergencias; usuarios y configuración. Opcional: también asigna leads |
| Coordinador de leads | Su único trabajo: captura y asigna leads (pestaña Asignación), corrige datos de contacto y origen; no ve reportes ni registra toques |
| Vendedor | Trabaja solo los leads que le asignan (toques, notas, etapas) y ve su propio Resumen de ventas |
| Gerente de marketing | Resumen de marketing, campañas a revisar, ficha de cada campaña, links, audiencias y reporte de marketing; corrige el origen de los leads (no toques ni etapas) |
| Analista | Solo lectura: Equipo hoy, Resumen y exportar CSV |

## En el celular

Maass Leads se puede **instalar como app**: en el celular abre la dirección del CRM y elige "Agregar a pantalla de inicio" (en iPhone, desde el botón Compartir de Safari). Queda con su ícono y se abre a pantalla completa, sin la barra del navegador.

## Usuarios y acceso

- **Solo el gerente** da de alta usuarios, les asigna rol y la casilla "También asigna leads", y los desactiva.
- **Alta por invitación:** el gerente pone nombre, email y rol, y la app genera un **link de invitación** (un solo uso, vence en 72 horas) que se manda por WhatsApp o correo con un clic. La persona abre el link y **elige su propia contraseña**; eso confirma que el acceso le llegó a ella. Nadie más conoce las contraseñas, ni el gerente.
- **Olvidó su contraseña:** en Usuarios, "Link para contraseña nueva" y se le manda igual. Un link nuevo invalida el anterior.
- **Cambiar mi contraseña:** clic en tu nombre arriba a la derecha (pide la actual). Cierra tu sesión en los demás dispositivos.
- **Bloqueo:** 5 intentos fallidos seguidos bloquean ese email 15 minutos (el link de contraseña nueva lo desbloquea).
- En Usuarios se ve el estado de cada quien: invitación pendiente o vencida, último acceso o desactivado.

## Tu cartera: tus datos son tuyos

En **Configuración → Tus datos**, el gerente descarga **su cartera completa en Excel**: una hoja con todos los contactos y una por clasificación (clientes, cotizando, en proceso, declinados con y sin perfil), con montos, vendedor, origen, perfil y fechas; además cada toque, el historial de cada contacto, productos con precios, campañas con su inversión por mes, canales y el equipo. Si la empresa deja la plataforma, se lleva todo en un archivo que abre cualquier hoja de cálculo. Solo el gerente la descarga porque trae los datos de contacto de todos los clientes.

## Seguridad

Contraseñas cifradas (scrypt), sesión en cookie segura, solo el gerente ve correos y accesos del equipo, la app no se puede incrustar en otra página, los errores no muestran detalles internos, y los Excel exportados no dejan correr fórmulas que lleguen en el formulario público.

## Productos y precios

Cada producto puede tener **precio de lista**. Con la casilla **precio fijo**, al cotizar o vender se elige producto y cantidad y el monto se calcula solo (precio × cantidad); el vendedor no lo puede cambiar y solo el gerente lo corrige. Sin precio fijo, el precio de lista sale como referencia y el vendedor captura el monto real.

## Reportes por periodo

Cada rol tiene su reporte con **las fechas que elija** (últimos 7 días, este mes, mes pasado… o desde/hasta). Se abre en otra pestaña para **imprimir o guardar en PDF** o **descargar en Excel**:

| Reporte | Quién | Dónde |
|---|---|---|
| Mi reporte de ventas | Vendedor (solo lo suyo) | Resumen → Descargar reporte |
| Reporte de ventas (por vendedor) | Gerente y analista | Equipo hoy o Resumen → Ventas |
| Reporte de marketing (campañas, anuncios, costos, audiencias) | Gerente de marketing, gerente y analista | Resumen → Marketing |
| Reporte de asignación (cuántos llegaron, de dónde, en cuánto se asignaron) | Coordinador y quien asigna | Asignación |

En el de ventas cada venta cuenta **el día que se cerró** y cada cotización el día que se envió, aunque el lead haya llegado antes; trae además el embudo de los leads que llegaron en el periodo. Todos se comparan contra el periodo anterior del mismo largo. El Resumen también acepta "Elegir fechas…".

## Dar de alta un cliente nuevo (cada uno en su subdominio)

Cada cliente es una **instalación aparte** con su propio subdominio, su base de datos y sus sesiones: los datos de un cliente nunca se cruzan con los de otro. Ejemplo: `maass.maassleads.com`, `gimnasiofuerte.maassleads.com`.

**Una sola vez (para toda la plataforma)**
1. El dominio de la plataforma (por ejemplo `maassleads.com`) en Cloudflare.
2. **Captcha:** en Cloudflare → Turnstile → *Add widget*, con el dominio de la plataforma como hostname (revisa al crearlo que cubra los subdominios). Copia la *Site key* y la *Secret key*: sirven para todos los clientes.

**Por cada cliente (unos 15 minutos)**
1. **Railway:** en el proyecto, *New → GitHub Repo* con este repositorio (un servicio por cliente) y nómbralo como el cliente.
2. **Volumen:** clic derecho en el servicio → *Attach volume* con ruta `/data`. Sin volumen los datos se borran en cada actualización.
3. **Variables** del servicio: `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY` (las del captcha). Opcional: `SETUP_CODE` si quieres poner tú el código de instalación; si no, se genera solo.
4. **Subdominio:** *Settings → Networking → Custom Domain* → `cliente.maassleads.com`. Railway te da un destino; en Cloudflare → DNS agrega un **CNAME** `cliente` hacia ese destino, con la nube naranja (proxy) encendida. SSL/TLS en modo *Full (strict)*.
5. **Código de instalación:** en Railway → el servicio → *Deploy Logs* aparece `Código de instalación: XXXX-XXXX` (o el que pusiste en `SETUP_CODE`).
6. Abre `https://cliente.maassleads.com`: pide el código, el nombre de la empresa y el gerente. Elige **"Lo instalo para un cliente"**: la app crea a su gerente y te da un **link de invitación** para mandárselo por WhatsApp o correo. Él crea su contraseña; tú nunca la conoces. Si eres tú el gerente (como en Maass), elige "Yo, soy el gerente".
7. El gerente del cliente entra, completa **Configuración → Empresa** (logo, cómo le llama a lo que vende, renovaciones), productos y precios, y da de alta a su equipo por invitación.

Sin el código nadie puede crear la primera cuenta, aunque abra el subdominio antes que tú; después de usarlo deja de servir.

**Actualizaciones:** todos los servicios salen del mismo repositorio, así que una actualización llega a todos los clientes a la vez (los cambios de la base se aplican solos al arrancar). Recomendado: un servicio de **pruebas** que siga otra rama, para probar ahí antes de actualizar a todos.

## Seguridad de acceso

- **Captcha** (Cloudflare Turnstile) en entrar, crear contraseña y primer uso, si el servicio tiene sus claves. Para la mayoría es invisible o una casilla.
- **Límites:** 5 intentos fallidos bloquean ese email 15 minutos; 30 fallidos desde una misma conexión, 15 minutos. El formulario público acepta hasta 20 envíos por conexión cada 10 minutos.
- **Código de instalación** para la primera cuenta.

## Publicarlo en Railway (recomendado)

1. Crea una cuenta en [railway.com](https://railway.com) entrando con tu cuenta de GitHub.
2. **New Project → Deploy from GitHub repo** y elige este repositorio.
3. Cuando aparezca el servicio, clic derecho sobre él → **Attach volume** (o *Add Volume*), con ruta `/data`. Ahí se guarda la base de datos; sin volumen se borraría en cada actualización.
4. En el servicio: **Settings → Networking → Generate Domain**. Esa es la dirección de tu CRM.
5. Abre esa dirección: la app pide el **código de instalación** (en *Deploy Logs*), el nombre de la empresa y el gerente. Luego entra a **Configuración** para conectar el formulario de tu página. Para clientes con subdominio sigue "Dar de alta un cliente nuevo".

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

Un contacto se reconoce por los últimos 10 dígitos del teléfono o por el email. Así `+52 1 55 1234 5678` (como aparece en WhatsApp) y `55 1234 5678` (como lo escriben en un formulario) son la misma persona. Si un lead declinado vuelve a escribir, se reabre en Nuevo (o Cumple perfil si ya estaba perfilado) y conserva su historial.

Si un **cliente que ya compró** vuelve a escribir, se abre una **oportunidad nueva** asignada a su mismo vendedor, ligada en el historial de las dos. Su venta, su postventa y su renovación no se tocan, y una segunda venta queda con su propio monto. Si escribe otra vez, el contacto se suma a esa oportunidad abierta.

## Respaldos y seguridad de los datos

- **Todo o nada:** cada acción que guarda (un toque, una asignación, un lead del formulario) se guarda completa o no se guarda; nunca queda a medias.
- **Escritura segura a disco:** la base usa el modo WAL con sincronización completa. Probado: con escrituras simultáneas y apagando el servidor de golpe, no se perdió ningún dato confirmado y la base quedó íntegra.
- **Sin duplicados:** 300 formularios simultáneos de 100 personas dejan 100 leads. El doble clic o el reintento por mala conexión no registran un toque dos veces.
- **Datos que no se pisan:** si alguien cambió un lead mientras otra persona tenía la ficha abierta, al guardar se avisa y se recarga en vez de borrar lo nuevo.
- **Sin internet:** la app avisa claramente "no se guardó" y lo escrito (por ejemplo una nota) se queda en pantalla para reintentar.
- **Respaldo automático diario** en la carpeta `respaldos` del volumen (se guardan los últimos 14), y en **Configuración → Respaldos y datos** el gerente descarga una copia completa cuando quiera. Recomendado: descargar una cada semana y guardarla fuera del servidor (computadora o Drive).
- **Restaurar:** detén el servicio, reemplaza `crm.db` del volumen por el respaldo (y borra `crm.db-wal` y `crm.db-shm` si existen) y vuelve a arrancar.
- **Aviso sin volumen:** si la app corre en Railway sin volumen, lo dice en los registros y le muestra al gerente un aviso en rojo, porque la base se borraría en la siguiente actualización.
- Al actualizar, el servidor termina las peticiones en curso y cierra la base de forma ordenada. Al arrancar revisa la integridad de la base.
- Además, en Railway activa los respaldos del volumen desde la pestaña del volumen.
