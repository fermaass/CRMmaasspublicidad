# Rentaypunto

Sitio público de rentas en Querétaro y panel interno del equipo. Fases 1 a 4.

- **Sitio público** (`SITE_URL`): listado con filtros y favoritos, buscador "Encuentra tu renta", ficha por propiedad con URL propia (`/renta/<zona>/<titulo>-<codigo>`), páginas por zona, agendar visita, "Avísame", "Renta tu propiedad" con estimador, ayuda, quejas, póliza jurídica y aviso de privacidad. SEO: título, descripción, H1, datos estructurados, Open Graph y `sitemap.xml` (sin rentadas, pausadas ni borradores). Guarda el origen del lead (UTM) y cuenta los clics a WhatsApp.
- **Panel** (`PANEL_HOST`, o `/panel/` si no está): login por invitación, verificación en dos pasos para Gerente y Dueño, Hoy, Leads, Citas, Propiedades (alta con SEO automático, captura rápida, borrador y aprobación, fotos), Seguimiento y Equipo. Los permisos se revisan en el servidor.

- **Fase 2:** alertas "Avísame" que se cruzan solas con lo que se publica, reporte semanal para cada propietario (se manda por WhatsApp con un clic), Resumen con embudo y citas por origen, zona y asesor, costo por cita de Meta (solo Dueño), píxel de Meta y API de Conversiones, opiniones anónimas después de la visita, solicitudes de propietarios, contratos por vencer, acta de entrega con fotos privadas y "Mis números" con comisión estimada.

- **Fase 3:** expediente del inquilino y documentos del propietario con enlace privado (se cierra al enviarlo; uno nuevo invalida el anterior). Archivos cifrados (AES-256-GCM, llave `DOCS_KEY` solo en Railway), revisión por documento, aprobación del expediente por Gerente o Dueño, bitácora de quién abrió cada archivo y borrado definitivo.
- **Fase 4:** WhatsApp oficial con mensajes automáticos (ver `WHATSAPP.md`) y administración de propiedades rentadas: portal privado del inquilino para subir comprobantes y cuadro de pagos por mes y concepto.

- **SEO:** páginas que se arman solas por intención de búsqueda, para todo Querétaro y por zona (`/renta/<zona>/departamentos-para-estudiantes`, `para-familias`, `que-aceptan-mascotas`, `amueblados`, `economicas`, `casas`, `1-recamara`…). Escritas con las frases de quien busca: el estudiante foráneo, el papá que busca para su hijo, quien renta solo o en pareja, la familia y quien llega por trabajo. Solo existen si tienen propiedades y se indexan con 2 o más. Además: texto propio por zona, preguntas frecuentes con marcado, enlaces internos desde "Ideal para", mapa del sitio con imágenes, aviso automático a Bing (IndexNow) al publicar o cambiar, rentadas que a los 30 días redirigen a su zona y "Sugerir descripción" en el panel.

- **Diseño:** identidad propia (logo de casa dentro de un pin con el "punto" en ámbar, ilustración del Acueducto de Querétaro en el banner), tipografía Plus Jakarta Sans servida desde el propio sitio (licencia OFL), íconos propios en `public/sitio/brand.js` y modo oscuro automático. El panel usa los mismos colores, letra, logo e íconos. No hay fotos de stock ni testimonios o cifras inventados: sin fotos reales se muestra un dibujo neutro.

Cómo publicarlo: `PUBLICAR.md`. Lo que falta definir con el cliente: `PENDIENTES_CLIENTE.md`.

```bash
npm install
npm start      # http://localhost:3000 (panel en /panel/)
npm test
```
