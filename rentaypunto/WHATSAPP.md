# WhatsApp oficial (WhatsApp Cloud API)

Mientras no se conecte, el panel sigue funcionando con enlaces wa.me: el asesor revisa el mensaje y lo manda él. Con la API conectada, estos mensajes salen solos (cada uno se enciende en **Equipo → WhatsApp oficial**).

## Lo que necesita el cliente

1. Un número de teléfono **que no esté en uso en la app de WhatsApp** (o migrarlo) para WhatsApp Business.
2. Cuenta en Meta Business verificada (razón social y documentos de la empresa).
3. En developers.facebook.com: app de tipo Business → producto WhatsApp → agregar el número.
4. Un **usuario del sistema** con token permanente y permiso `whatsapp_business_messaging`.
5. Dar de alta estas 5 plantillas (categoría **Utilidad**, idioma **Español (México)**), con estos nombres exactos y las variables en este orden:

| Nombre | Texto sugerido |
|---|---|
| `rp_cita_solicitada` | Hola {{1}}, recibimos tu solicitud para visitar {{2}} el {{3}} a las {{4}}. Tu folio es {{5}}. Tu asesor te confirmará la cita por este medio. |
| `rp_lead_nuevo` | {{1}}, tienes un lead nuevo: {{2}} (WhatsApp {{3}}) quiere visitar {{4}} el {{5}}. Atiéndelo en el panel de Rentaypunto. |
| `rp_recordatorio_cita` | Hola {{1}}, te recordamos tu visita de mañana a {{2}} a las {{3}}, en {{4}}. Si no puedes asistir, respóndenos por aquí. |
| `rp_reporte_semanal` | Hola {{1}}, este es el resumen semanal de {{2}}: {{3}} visitas a la ficha, {{4}} citas solicitadas y {{5}} visitas realizadas. Recomendación: {{6}} |
| `rp_expediente_recibido` | {{1}}, {{2}} envió {{3}}. Revísalo en el panel de Rentaypunto. |

## Variables en Railway

| Variable | Valor |
|---|---|
| `WA_TOKEN` | El token permanente del usuario del sistema |
| `WA_PHONE_ID` | El "Identificador del número de teléfono" (no el número) |
| `WA_LANG` | Opcional, de fábrica `es_MX` (debe coincidir con el idioma de las plantillas) |

## Cuándo sale cada mensaje

- **Confirmación al prospecto** y **aviso al asesor**: en cuanto alguien agenda en el sitio (el asesor necesita su WhatsApp capturado en Equipo).
- **Recordatorio**: la víspera, a partir de las 18:00, solo para citas en etapa "Cita confirmada".
- **Reporte semanal**: lunes a partir de las 10:00, a cada propiedad publicada o pausada que tenga propietario ligado.
- **Expediente o comprobante recibido**: al asesor de ese lead, propietario o propiedad.

Ningún mensaje sale dos veces. En **Equipo → WhatsApp oficial → Últimos mensajes** se ve qué salió y, si falló, por qué.

Costo: Meta cobra por mensaje según la categoría y el país; las de utilidad son las más baratas. Consulta la tabla vigente en la página de precios de WhatsApp Business antes de encenderlo.
