# Rentaypunto

Sitio público de rentas en Querétaro y panel interno del equipo. Fases 1 y 2.

- **Sitio público** (`SITE_URL`): listado con filtros y favoritos, buscador "Encuentra tu renta", ficha por propiedad con URL propia (`/renta/<zona>/<titulo>-<codigo>`), páginas por zona, agendar visita, "Avísame", "Renta tu propiedad" con estimador, ayuda, quejas, póliza jurídica y aviso de privacidad. SEO: título, descripción, H1, datos estructurados, Open Graph y `sitemap.xml` (sin rentadas, pausadas ni borradores). Guarda el origen del lead (UTM) y cuenta los clics a WhatsApp.
- **Panel** (`PANEL_HOST`, o `/panel/` si no está): login por invitación, verificación en dos pasos para Gerente y Dueño, Hoy, Leads, Citas, Propiedades (alta con SEO automático, captura rápida, borrador y aprobación, fotos), Seguimiento y Equipo. Los permisos se revisan en el servidor.

- **Fase 2:** alertas "Avísame" que se cruzan solas con lo que se publica, reporte semanal para cada propietario (se manda por WhatsApp con un clic), Resumen con embudo y citas por origen, zona y asesor, costo por cita de Meta (solo Dueño), píxel de Meta y API de Conversiones, opiniones anónimas después de la visita, solicitudes de propietarios, contratos por vencer, acta de entrega con fotos privadas y "Mis números" con comisión estimada.

Cómo publicarlo: `PUBLICAR.md`.

```bash
npm install
npm start      # http://localhost:3000 (panel en /panel/)
npm test
```
