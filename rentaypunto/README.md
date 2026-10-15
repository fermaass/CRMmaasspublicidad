# Rentaypunto

Sitio público de rentas en Querétaro y panel interno del equipo. Fase 1.

- **Sitio público** (`SITE_URL`): listado con filtros y favoritos, buscador "Encuentra tu renta", ficha por propiedad con URL propia (`/renta/<zona>/<titulo>-<codigo>`), páginas por zona, agendar visita, "Avísame", "Renta tu propiedad" con estimador, ayuda, quejas, póliza jurídica y aviso de privacidad. SEO: título, descripción, H1, datos estructurados, Open Graph y `sitemap.xml` (sin rentadas, pausadas ni borradores). Guarda el origen del lead (UTM) y cuenta los clics a WhatsApp.
- **Panel** (`PANEL_HOST`, o `/panel/` si no está): login por invitación, verificación en dos pasos para Gerente y Dueño, Hoy, Leads, Citas, Propiedades (alta con SEO automático, captura rápida, borrador y aprobación, fotos), Seguimiento y Equipo. Los permisos se revisan en el servidor.

Cómo publicarlo: `PUBLICAR.md`.

```bash
npm install
npm start      # http://localhost:3000 (panel en /panel/)
npm test
```
