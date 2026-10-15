// Avisos por correo (Resend). Si no hay RESEND_API_KEY y MAIL_FROM, no se manda nada y el lead igual aparece en el panel.
function mailer(config, log = console) {
  const enabled = Boolean(config.resendKey && config.mailFrom);
  async function send(to, subject, text) {
    const list = [...new Set((Array.isArray(to) ? to : [to]).filter(Boolean))];
    if (!enabled || !list.length) return false;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.mailFrom, to: list, subject, text }),
      });
      if (!r.ok) throw new Error(`Resend respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return true;
    } catch (err) {
      log.error('No se pudo mandar el aviso por correo:', err.message);
      return false;
    }
  }
  return { enabled, send };
}

module.exports = { mailer };
