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

  return router;
}

module.exports = { webhooksRouter };
