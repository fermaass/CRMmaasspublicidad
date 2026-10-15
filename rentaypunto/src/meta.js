// API de Conversiones de Meta: manda cada cita agendada (evento Lead) desde el servidor, además del píxel del navegador.
// Así Meta cuenta la conversión aunque el navegador bloquee el píxel. El mismo event_id evita contarla dos veces.
// Datos personales: solo se manda el teléfono cifrado con SHA-256 (Meta no ve el número), como pide su documentación.
const crypto = require('node:crypto');

const sha = (v) => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');

function metaCapi(config, log = console) {
  const enabled = Boolean(config.metaToken);
  async function sendLead({ pixelId, leadId, phone, firstName, url, ip, ua, fbp, fbc, code, rent }) {
    if (!enabled || !pixelId) return false;
    const body = {
      data: [{
        event_name: 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        event_id: `lead-${leadId}`,
        action_source: 'website',
        event_source_url: url,
        user_data: {
          ph: [sha(`52${phone}`)],
          fn: firstName ? [sha(firstName)] : undefined,
          country: [sha('mx')],
          client_ip_address: ip || undefined,
          client_user_agent: ua || undefined,
          fbp: fbp || undefined,
          fbc: fbc || undefined,
        },
        custom_data: { content_ids: [code], content_type: 'product', value: rent, currency: 'MXN' },
      }],
      ...(config.metaTestCode ? { test_event_code: config.metaTestCode } : {}),
      access_token: config.metaToken, // en el cuerpo y no en la dirección: las direcciones quedan en registros de proxies
    };
    try {
      const r = await fetch(`https://graph.facebook.com/${config.metaApiVersion}/${encodeURIComponent(pixelId)}/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`Meta respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return true;
    } catch (err) {
      log.error('No se pudo mandar el evento a Meta:', err.message);
      return false;
    }
  }
  return { enabled, sendLead };
}

module.exports = { metaCapi, sha };
