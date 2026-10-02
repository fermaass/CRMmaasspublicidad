# Primera publicación de Maass Leads: lista paso a paso

Marca cada casilla al terminarla. La parte A se hace una sola vez; la B por cada cliente; la C es la prueba completa del primer proyecto (Maass) antes de dar de alta a otros.

## A. Una sola vez, para toda la plataforma

- [ ] **Dominio** de la plataforma (por ejemplo `maassleads.com`) dado de alta en Cloudflare.
- [ ] **Captcha:** Cloudflare → Turnstile → *Add widget*, hostname = el dominio de la plataforma (revisa que cubra los subdominios; si no, agrega cada uno). Guarda la *Site key* y la *Secret key*.
- [ ] **Respaldos fuera del servidor (Cloudflare R2):**
  - R2 → *Create bucket* `maass-leads-respaldos` (privado).
  - R2 → *Manage API tokens* → token con permiso **Object Read & Write** solo para ese bucket. Guarda el *Access Key ID*, el *Secret Access Key* y el *endpoint* (`https://<ID-DE-CUENTA>.r2.cloudflarestorage.com`).
  - Opcional: en el bucket, regla de ciclo de vida para borrar respaldos de más de 90 días.
- [ ] **Claves propias:** inventa y guarda en tu gestor de contraseñas:
  - `OPS_TOKEN`: una cadena larga al azar (40 caracteres o más), la misma para todos los proyectos. Con ella el panel lee el estado técnico.
  - `PANEL_PASSWORD`: la contraseña de tu panel (12 caracteres o más).
- [ ] **Panel de Maass Leads:** en Railway, *New → GitHub Repo* (este mismo repositorio), servicio llamado `panel`, con las variables:
  - `PANEL_INSTANCES` = `Maass Publicidad=https://maass.maassleads.com` (agrega cada cliente separado por comas)
  - `OPS_TOKEN` y `PANEL_PASSWORD`
  - Dominio `panel.maassleads.com`. Entras con usuario `maass` y tu contraseña. **No necesita volumen.**
- [ ] **Servicio de pruebas:** un proyecto más (`pruebas.maassleads.com`) que siga otra rama del repositorio. Ahí ves cada cambio antes de que llegue a los clientes.
- [ ] **Aviso de caídas:** en UptimeRobot (gratis) un monitor por subdominio, apuntando a `https://cliente.maassleads.com/health`.
- [ ] **Legal:** aviso de privacidad y contrato con cada cliente (tú eres encargado del tratamiento de sus datos personales). Revísalo con un abogado.

## B. Por cada cliente

Sigue "Dar de alta un cliente nuevo" del README. Las variables de cada servicio son:

| Variable | Valor |
|---|---|
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | las del widget del captcha |
| `OPS_TOKEN` | la misma del panel |
| `BACKUP_S3_ENDPOINT` | `https://<ID-DE-CUENTA>.r2.cloudflarestorage.com` |
| `BACKUP_S3_BUCKET` | `maass-leads-respaldos` |
| `BACKUP_S3_KEY_ID`, `BACKUP_S3_SECRET` | las del token de R2 |
| `BACKUP_S3_PREFIX` | nombre corto del cliente, sin espacios (por ejemplo `gimnasio-fuerte`); así cada cliente queda en su carpeta |
| `SETUP_CODE` (opcional) | si quieres poner tú el código de instalación |

- [ ] Volumen en `/data`.
- [ ] Subdominio en Railway y su CNAME en Cloudflare (nube naranja).
- [ ] Instalación con el código y "Lo instalo para un cliente"; mandar la invitación al gerente.
- [ ] Agregar el cliente a `PANEL_INSTANCES` del panel y verlo en verde.
- [ ] Monitor en UptimeRobot.

## C. Prueba completa del primer proyecto (Maass)

**Acceso**
- [ ] `https://maass.maassleads.com` abre con candado y se ve la portada.
- [ ] Pide el código de instalación; con el de *Deploy Logs* se crea el gerente.
- [ ] Aparece la verificación del captcha y deja entrar.
- [ ] Invitar a un vendedor a tu propio celular por WhatsApp; abrir el link en el celular y crear la contraseña.
- [ ] Instalar Maass Leads como app en Android y en iPhone ("Agregar a pantalla de inicio").

**Trabajo diario**
- [ ] Configurar empresa (logo), productos y precios, una campaña con inversión.
- [ ] Pegar el formulario en la página web y mandar un lead de prueba: llega solo.
- [ ] Asignarlo, registrar toques; en el celular, "Llamar" marca y "WhatsApp" abre el chat con el mensaje.
- [ ] Cotizar y vender; ver el Resumen; abrir un reporte en PDF y en Excel; descargar la cartera.

**Datos y respaldos**
- [ ] Al día siguiente, en el panel: respaldo diario y **respaldo externo** con fecha. En R2 aparece `maass/crm-AAAA-MM-DD.db.gz`.
- [ ] Hacer un *Redeploy* en Railway y confirmar que los datos siguen (el volumen funciona).
- [ ] Descargar un respaldo desde Configuración → Tus datos y guardarlo en tu computadora.
- [ ] Ensayar una restauración en el servicio de pruebas (lo hacemos juntos la primera vez).

**Panel**
- [ ] El proyecto aparece en verde. Apaga un momento el servicio de pruebas y comprueba que el panel lo marca como caído.
