# Rentaypunto: cómo publicarlo

## 1. Servicio de pruebas (para probar la fase 1, unos 15 minutos)

1. En Railway: **New Project → Deploy from GitHub repo** → `fermaass/CRMmaasspublicidad`.
2. En el servicio → **Settings**:
   - **Source → Branch**: `claude/lucid-euler-wuaia7`.
   - **Source → Root Directory**: `rentaypunto` (así Railway usa solo esta carpeta, no Maass Leads).
3. Clic derecho en el servicio → **Attach volume** con ruta `/data`. Sin volumen, propiedades, leads y fotos se borran en cada actualización.
4. **Variables**: `SEED_DEMO` = `true` (carga 6 propiedades de ejemplo, solo para pruebas).
5. **Settings → Networking → Generate Domain**. Te da algo como `rentaypunto-pruebas.up.railway.app`.
6. En **Deploy Logs** aparece `Código de instalación: XXXX-XXXX`.

Para probar:
- Sitio público: `https://<tu-dominio-de-railway>/`
- Panel: `https://<tu-dominio-de-railway>/panel/` → pide el código de instalación, tu nombre, correo y contraseña. Luego la verificación en dos pasos: instala **Google Authenticator** en tu celular, escanea el código y escribe los 6 dígitos.

## 2. Producción (cuando apruebes)

Variables del servicio:

| Variable | Valor |
|---|---|
| `SITE_URL` | `https://www.rentaypunto.com` |
| `PANEL_HOST` | `panel.rentaypunto.com` (el panel ya no existe en `/panel/` del sitio público) |
| `RESEND_API_KEY`, `MAIL_FROM` | Para avisar por correo a cada asesor cuando le llega un lead. Cuenta gratis en resend.com, verificando el dominio |
| `BACKUP_S3_*` | Respaldo diario y copia de las fotos en Cloudflare R2 (igual que en Maass Leads) |
| `META_CAPI_TOKEN` | Token de la API de Conversiones: Meta → Administrador de eventos → tu píxel → Configuración → "Generar token de acceso". El ID del píxel se pone en el panel (Equipo → Configuración) |
| `META_TEST_EVENT_CODE` | Solo mientras pruebas: el código de "Probar eventos" del Administrador de eventos. Quítalo después |
| `DOCS_KEY` | Llave de la bóveda de documentos (expedientes y comprobantes). Sin ella, los expedientes están apagados. Se genera en el panel: **Equipo → Seguridad → Generar llave** (solo el Dueño, se muestra una vez). Cópiala a la variable y **guárdala en tu gestor de contraseñas**. Si se pierde o se cambia, los documentos ya guardados no se pueden abrir |
| `ORIGIN_SECRET` | Candado de origen: la misma clave que pones en Cloudflare como encabezado `X-Origin-Auth` (24 caracteres o más). Con ella, el servidor solo responde a lo que pasa por Cloudflare. Ver `SEGURIDAD.md` |
| `WA_TOKEN`, `WA_PHONE_ID` | WhatsApp oficial (ver `WHATSAPP.md`). Sin ellas, el panel usa enlaces wa.me |
| `META_API_VERSION` | Opcional. De fábrica `v23.0`; cámbiala si Meta avisa que esa versión venció |
| *(no poner `SEED_DEMO`)* | |

Dominios: en Railway agrega `www.rentaypunto.com`, `rentaypunto.com` y `panel.rentaypunto.com` como Custom Domain; en Cloudflare, un CNAME por cada uno con el destino que da Railway y su TXT de verificación. Igual que en Maass Leads: nube gris hasta que Railway lo marque en verde, luego naranja, SSL en **Full**.

Después: en Google Search Console da de alta el dominio y envía `https://www.rentaypunto.com/sitemap.xml`.

## Si alguien pierde el celular con la app de códigos

- Gerente: el Dueño entra a **Equipo → Reiniciar verificación**.
- Dueño: en Railway agrega la variable `RESET_2FA` = tu correo, deja que reinicie, entra y configura la app de nuevo. Luego **quita la variable**.

## Seguridad

Antes de abrir el sitio al público, sigue la sección "Lo que hay que configurar" de `SEGURIDAD.md`: Cloudflare en Full (strict), candado de origen, Bot Fight Mode, límite de intentos en el login, bucket R2 privado y verificación en dos pasos en todas las cuentas de la empresa.
