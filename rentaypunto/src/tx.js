// Cada petición que escribe corre dentro de una transacción: o se guarda todo, o no se guarda nada.
// Se confirma (COMMIT) justo antes de responder; si la respuesta es un error (4xx/5xx) o algo falla, se deshace (ROLLBACK).
// Funciona porque todas las rutas son síncronas: ninguna otra petición puede colarse a la mitad.
function transactional(db, handler) {
  return function txHandler(req, res, next) {
    db.exec('BEGIN IMMEDIATE');
    let open = true;
    const close = (ok) => {
      if (!open) return;
      open = false;
      db.exec(ok ? 'COMMIT' : 'ROLLBACK');
    };
    const end = res.end;
    res.end = function endAfterCommit(...args) {
      res.end = end;
      try {
        close(res.statusCode < 400);
      } catch (err) {
        // No se pudo guardar (p. ej. disco lleno): no se le dice al usuario que sí.
        try { if (open) { open = false; db.exec('ROLLBACK'); } } catch { /* ya no hay transacción */ }
        console.error('No se pudo confirmar la transacción:', err.message);
        const body = JSON.stringify({ error: 'No se pudo guardar. Intenta de nuevo.' });
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', Buffer.byteLength(body));
        return end.call(this, body);
      }
      return end.apply(this, args);
    };
    try {
      handler(req, res, next);
    } catch (err) {
      res.end = end;
      close(false);
      throw err;
    }
    // Si la ruta no respondió (pasó al siguiente middleware), se confirma lo que haya hecho.
    if (open && !res.headersSent) { res.end = end; close(true); }
  };
}

// Envuelve el último manejador de cada ruta que escribe (POST, PUT, PATCH, DELETE).
function transactionalRoutes(target, db) {
  for (const method of ['post', 'put', 'patch', 'delete']) {
    const original = target[method].bind(target);
    target[method] = (path, ...handlers) => {
      const last = handlers.pop();
      return original(path, ...handlers, transactional(db, last));
    };
  }
  return target;
}

module.exports = { transactional, transactionalRoutes };
