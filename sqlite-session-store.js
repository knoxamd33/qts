in continua valendo mesmo depois de o
// servidor reiniciar.
const { Store } = require('express-session');
const db = require('./db');

class SqliteSessionStore extends Store {
  constructor(options = {}) {
    super(options);
    // Intervalo (ms) para apagar sessões expiradas do banco. Padrão: 1h.
    this.cleanupIntervalMs = options.cleanupIntervalMs || 1000 * 60 * 60;
    this._startCleanup();
  }

  _startCleanup() {
    this._cleanupTimer = setInterval(() => {
      try {
        db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
      } catch (err) {
        console.error('[sqlite-session-store] erro ao limpar sessões expiradas:', err);
      }
    }, this.cleanupIntervalMs);
    // Não impede o processo Node de encerrar por causa desse timer.
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  _expiresAt(sess) {
    const ttlMs = sess && sess.cookie && sess.cookie.maxAge
      ? sess.cookie.maxAge
      : 1000 * 60 * 60 * 8; // 8h padrão, igual ao maxAge configurado no server.js
    return Date.now() + ttlMs;
  }

  get(sid, callback) {
    try {
      const row = db.prepare('SELECT sess, expires_at FROM sessions WHERE sid = ?').get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at < Date.now()) {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess));
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const expiresAt = this._expiresAt(sess);
      const data = JSON.stringify(sess);
      db.prepare(`
        INSERT INTO sessions (sid, sess, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at
      `).run(sid, data, expiresAt);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      const expiresAt = this._expiresAt(sess);
      const info = db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(expiresAt, sid);
      // Se a sessão ainda não existir na tabela (raro), cria normalmente.
      if (info.changes === 0) return this.set(sid, sess, callback);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  all(callback) {
    try {
      const rows = db.prepare('SELECT sid, sess FROM sessions WHERE expires_at >= ?').all(Date.now());
      callback(null, rows.map((r) => ({ ...JSON.parse(r.sess), sid: r.sid })));
    } catch (err) {
      callback(err);
    }
  }

  clear(callback) {
    try {
      db.prepare('DELETE FROM sessions').run();
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  length(callback) {
    try {
      const row = db.prepare('SELECT COUNT(*) AS c FROM sessions').get();
      callback(null, row.c);
    } catch (err) {
      callback(err);
    }
  }
}

module.exports = SqliteSessionStore;
