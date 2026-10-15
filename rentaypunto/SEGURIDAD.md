# Seguridad de Rentaypunto

Este documento resume lo que protege el sistema, lo que hay que configurar fuera del código y qué hacer si algo sale mal. Es una revisión interna, no una auditoría externa: antes de manejar volumen real conviene una prueba de penetración por un tercero.

## Lo que ya protege el código

**Acceso al panel**
- Contraseñas cifradas con scrypt. Se rechazan las cortas (menos de 10), las muy comunes y las que contienen el correo.
- Verificación en dos pasos (app de códigos) obligatoria para Gerente y Dueño; opcional para vendedores desde **Equipo → Seguridad** (recomendada).
- Un código de 6 dígitos no sirve dos veces.
- El login responde igual y tarda lo mismo exista o no el correo: no se puede averiguar quién tiene cuenta.
- 5 intentos fallidos bloquean ese correo 15 minutos, y 30 desde una misma conexión, también. Los códigos de verificación y los links de invitación tienen su propio límite.
- Sesiones en cookie `__Host-`, HttpOnly, Secure y SameSite=Strict. Duran 7 días para Gerente y Dueño y 14 para vendedores.
- Cambiar la contraseña, desactivar a alguien o reiniciar su verificación cierra sus sesiones. Cada quien puede cerrar sus otras sesiones.
- Invitaciones y links de contraseña: un solo uso, 72 horas. En la base solo se guarda su huella (hash).

**Permisos (revisados en el servidor, no solo ocultando botones)**
- El vendedor solo ve sus leads, sus citas y los expedientes de sus leads. No puede ligar propietarios ajenos a una propiedad (se corrigió en esta revisión).
- Documentos: solo los ve el asesor de ese lead, propietario o propiedad, el Gerente y el Dueño. Cada vez que alguien abre, valida o borra un documento queda registrado.

**Datos sensibles**
- Expedientes, documentos de propietarios y comprobantes se guardan **cifrados (AES-256-GCM)**. La llave `DOCS_KEY` vive solo en Railway. El tipo de archivo se revisa por su contenido, no por su nombre (solo PDF, JPG o PNG, hasta 8 MB).
- Borrado definitivo a mano (Gerente o Dueño) y borrado automático configurable: los documentos de leads cerrados y propietarios descartados se borran pasados N días, también su copia externa.
- La dirección exacta de las propiedades nunca sale en el sitio.
- A Meta solo se le manda el teléfono cifrado (SHA-256), y el token de Meta no viaja en la dirección web.
- Los enlaces privados (expediente, portal, opinión) no se indexan, no se guardan en caché y no se filtran a otros sitios.

**Navegador**
- Política de contenido (CSP) estricta:
  - En el sitio público, cada script en línea lleva un permiso único por respuesta, y solo se permite el píxel de Meta como tercero.
  - En el panel no se carga nada de terceros. El QR se genera con una librería alojada aquí.
- HTTPS obligatorio (HSTS), sin incrustar en otros sitios (anti-clickjacking), sin adivinar tipos de archivo y sin cámara, micrófono ni ubicación.
- El panel no aparece en Google y sus datos no quedan en la caché del navegador. Al salir se pide al navegador borrar lo guardado.
- Todo lo que se muestra con datos de usuarios pasa por escape de HTML. Las consultas a la base son parametrizadas (sin inyección SQL).

**Formularios públicos**
- Límite de envíos por conexión, campo trampa para robots y aceptación del aviso de privacidad.

**Bitácora de seguridad** (**Equipo → Seguridad**)
- Entradas y fallos de login, altas y cambios de usuarios, links generados, reinicios de verificación, cambios de ajustes de seguridad, propiedades eliminadas y borrados automáticos. Guarda los últimos 5,000 movimientos.

**Candado de origen**
- Con `ORIGIN_SECRET`, el servidor solo responde a peticiones que pasan por Cloudflare. Así nadie se salta Cloudflare entrando directo a la dirección de Railway, ni puede fingir otra IP para burlar los límites de intentos.

## Lo que hay que configurar (una sola vez)

**Cloudflare** (dominio rentaypunto.com)
1. SSL/TLS en **Full (strict)** una vez que Railway emitió su certificado. Activar **Always Use HTTPS** y **TLS mínimo 1.2**.
2. **Candado de origen:**
   - Inventa una clave larga (40 caracteres o más) y guárdala en tu gestor de contraseñas.
   - En Cloudflare → Rules → Transform Rules → Modify Request Header → *Set static*: encabezado `X-Origin-Auth` con esa clave, para todo el dominio.
   - En Railway, la variable `ORIGIN_SECRET` con la misma clave.
   - Prueba: la dirección `*.up.railway.app` debe responder "Acceso no permitido" y `rentaypunto.com` debe abrir normal.
3. **Security → Bots:** activar *Bot Fight Mode*.
4. **WAF → Rate limiting rules:** una regla para `panel.rentaypunto.com/api/login`, por ejemplo 20 peticiones por minuto por IP → bloquear 10 minutos.
5. **R2:** el bucket de respaldos debe ser **privado**, con regla de ciclo de vida que borre respaldos de más de 90 días. El token de R2, solo con permiso a ese bucket.

**Railway**
- Variables con secretos: `DOCS_KEY`, `ORIGIN_SECRET`, `META_CAPI_TOKEN`, `WA_TOKEN`, `RESEND_API_KEY` y `BACKUP_S3_*`. Nunca en el código ni en GitHub.
- Solo el Dueño (y quien lo opere) como miembro del proyecto. Los registros de Railway muestran el código de instalación del primer uso.

**Cuentas de la empresa:** activar verificación en dos pasos en Railway, Cloudflare, GitHub, Meta Business, Google y el correo del dominio. Si alguien entra a cualquiera de esas cuentas, entra a todo.

## Qué hacer si…

- **Alguien perdió su celular o su laptop:**
  - Si es un vendedor, Equipo → **Desactivar**; si es Gerente o Dueño, **Reiniciar verificación**.
  - La persona cambia su contraseña desde otro equipo, o pide un link nuevo.
  - Si lo perdió el Dueño: variable `RESET_2FA` en Railway (ver PUBLICAR.md).
- **Sospecha de acceso indebido:**
  1. Revisa la **bitácora de seguridad**.
  2. Desactiva a la persona.
  3. Cambia `ORIGIN_SECRET` en Cloudflare y en Railway al mismo tiempo.
  4. Cambia los tokens de Meta, WhatsApp, Resend y R2.
  5. Si hubo datos personales expuestos, la ley pide avisar a los afectados: consúltalo con su despacho.
- **Alguien pide que borren sus datos (derecho ARCO):**
  - Documentos: borrarlos desde el lead o el propietario.
  - Datos del lead o del propietario: por ahora se borran a mano en la base. Pídeselo a quien da mantenimiento al sistema.
- **La llave `DOCS_KEY`:** no se puede cambiar sin volver a cifrar los documentos. Si se filtra, avisa a quien da mantenimiento: hay que migrar los documentos a una llave nueva.

## Límites conocidos

- Los límites de intentos se guardan en memoria: se reinician cuando el servidor se reinicia. Cloudflare (punto 4) cubre eso.
- La base de datos (nombres, teléfonos, citas) no va cifrada por la aplicación; los documentos sí. Los respaldos contienen datos personales: por eso el bucket privado y el borrado a 90 días.
- Los formularios públicos no tienen captcha visible; dependen del límite de envíos, el campo trampa y Cloudflare.
- No se ha hecho una prueba de penetración externa.
