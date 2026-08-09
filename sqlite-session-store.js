// sqlite-session-store.js — session store persistente para express-session,
// usando a mesma conexão node:sqlite do resto do app.
//
// Por que isso existe: por padrão o express-session guarda as sessões só em
// memória (MemoryStore). Isso funciona local, mas em qualquer plataforma que
// reinicia o processo (deploy novo, "sleep" por inatividade, crash, etc.) —
// como o Render — todo mundo que estava logado é derrubado, porque a memória
// zera. Guardando a sessão no mesmo arquivo SQLite dos usuários/respostas
// (que já fica em disco persistente via DATA_DIR), o login sobrevive a
// reinícios do servidor.
const session = require('express-session');

class SqliteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this._stmtGet = db.prepare('SELECT sess, expires_at FROM sessions WHERE sid = ?');
    this._stmtSet = db.prepare(
      'INSERT INTO sessions (sid, sess, expires_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expires_at=excluded.expires_at'
    );
    this._stmtDestroy = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this._stmtTouch = db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?');
    this._stmtPrune = db.prepare('DELETE FROM sessions WHERE expires_at < ?');

    // limpa sessões expiradas periodicamente para o arquivo não crescer sem limite
    this._pruneInterval = setInterval(() => {
      try { this._stmtPrune.run(Date.now()); } catch (e) { /* ignora */ }
    }, 1000 * 60 * 60);
    if (this._pruneInterval.unref) this._pruneInterval.unref();
  }

  get(sid, cb) {
    try {
      const row = this._stmtGet.get(sid);
      if (!row) return cb(null, null);
      if (row.expires_at < Date.now()) {
        this._stmtDestroy.run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 1000 * 60 * 60 * 8;
      const expiresAt = Date.now() + maxAge;
      this._stmtSet.run(sid, JSON.stringify(sess), expiresAt);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this._stmtDestroy.run(sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 1000 * 60 * 60 * 8;
      this._stmtTouch.run(Date.now() + maxAge, sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }
}

module.exports = SqliteSessionStore;
