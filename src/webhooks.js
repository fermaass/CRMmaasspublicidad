const crypto = require('node:crypto');
const express = require('express');
const { ingestLead } = require('./leads');

const pick = (body, ...keys) => {
  for (const k of keys) if (body[k] != null && String(body[k]).trim() !== '') return body[k];
  return null;
};

function webhooksRouter(db, config) {
  const router = express.Router();

  // Formularios web, landing pages, Zapier/Make (Meta Lead Ads, Google Ads, etc.)
  router.options('/form', (req, res) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    }).sendStatus(204);
  });

  router.post('/form', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const body = req.body || {};
    const key = req.get('x-api-key') || req.query.key || body.key;
    if (!config.formApiKey || key !== config.formApiKey) return res.status(401).json({ error: 'Clave inválida' });

    // Campo trampa para bots: si viene lleno, se responde OK pero no se guarda.
    if (body.website) return res.json({ ok: true });

    try {
      const result = ingestLead(db, {
        source: 'formulario',
        name: pick(body, 'nombre', 'name', 'full_name'),
        phone: pick(body, 'telefono', 'teléfono', 'phone', 'phone_number', 'whatsapp'),
        email: pick(body, 'email', 'correo'),
        message: pick(body, 'mensaje', 'message', 'comentarios'),
        campaign: pick(body, 'campana', 'campaña', 'campaign', 'utm_campaign'),
      });
      const redirect = pick(body, 'redirect');
      if (redirect && /^https?:\/\//.test(redirect)) return res.redirect(303, redirect);
      res.status(result.created ? 201 : 200).json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // WhatsApp Cloud API: verificación del webhook
  router.get('/whatsapp', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && config.whatsappVerifyToken
      && req.query['hub.verify_token'] === config.whatsappVerifyToken) {
      return res.send(req.query['hub.challenge']);
    }
    res.sendStatus(403);
  });

  // WhatsApp Cloud API: mensajes entrantes
  router.post('/whatsapp', (req, res) => {
    if (config.whatsappAppSecret) {
      const expected = 'sha256=' + crypto.createHmac('sha256', config.whatsappAppSecret)
        .update(req.rawBody || '').digest('hex');
      const got = req.get('x-hub-signature-256') || '';
      if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
        return res.sendStatus(401);
      }
    }

    for (const entry of req.body?.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const names = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
        for (const msg of value.messages || []) {
          const text = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title
            || msg.interactive?.list_reply?.title || `[${msg.type}]`;
          try {
            ingestLead(db, {
              source: 'whatsapp',
              phone: `+${msg.from}`,
              name: names[msg.from],
              message: text,
              campaign: msg.referral?.headline || msg.referral?.source_url || null,
            });
          } catch (err) {
            console.error('WhatsApp: no se pudo guardar el mensaje', err.message);
          }
        }
      }
    }
    // Meta reintenta si no recibe 200, así que siempre respondemos OK.
    res.sendStatus(200);
  });

  return router;
}

module.exports = { webhooksRouter };
