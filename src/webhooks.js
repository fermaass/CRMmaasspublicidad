const express = require('express');
const { ingestLead } = require('./leads');
const { getSetting } = require('./db');

const pick = (body, ...keys) => {
  for (const k of keys) if (body[k] != null && String(body[k]).trim() !== '') return body[k];
  return null;
};

function webhooksRouter(db) {
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
    const formKey = getSetting(db, 'form_api_key');
    if (!formKey || key !== formKey) return res.status(401).json({ error: 'Clave inválida' });

    // Campo trampa para bots: si viene lleno, se responde OK pero no se guarda.
    if (body.website) return res.json({ ok: true });

    // Canal y producto se reconocen por nombre (sin importar mayúsculas); si no están en la lista,
    // se agregan al mensaje para no perder el dato.
    const extras = [];
    const byName = (kind, value) => {
      if (!value) return null;
      const item = db.prepare('SELECT id FROM catalog_items WHERE kind = ? AND active = 1 AND name = ? COLLATE NOCASE')
        .get(kind, String(value).trim());
      if (!item) extras.push(`${kind === 'canal' ? 'Se enteró por' : 'Producto'}: ${value}`);
      return item?.id ?? null;
    };
    const channelId = byName('canal', pick(body, 'canal', 'como_se_entero', 'cómo_se_enteró', 'como_nos_conocio'));
    const productId = byName('producto', pick(body, 'producto', 'product'));
    const message = [pick(body, 'mensaje', 'message', 'comentarios'), ...extras].filter(Boolean).join('\n') || null;

    try {
      const result = ingestLead(db, {
        channel_id: channelId,
        product_id: productId,
        source: 'formulario',
        name: pick(body, 'nombre', 'name', 'full_name'),
        phone: pick(body, 'telefono', 'teléfono', 'phone', 'phone_number', 'whatsapp'),
        email: pick(body, 'email', 'correo'),
        message,
        campaign: pick(body, 'campana', 'campaña', 'campaign', 'utm_campaign'),
      });
      const redirect = pick(body, 'redirect');
      if (redirect && /^https?:\/\//.test(redirect)) return res.redirect(303, redirect);
      res.status(result.created ? 201 : 200).json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { webhooksRouter };
