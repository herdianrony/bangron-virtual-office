import session from 'express-session';
import logger from '../utils/logger.js';

export class SQLiteSessionStore extends session.Store {
  constructor(db, options = {}) {
    super();
    this.db = db;
    this.tableName = options.tableName || 'sessions';
    this.cleanupIntervalMs = options.cleanupIntervalMs || 15 * 60 * 1000;

    this.getStmt = this.db.prepare(`SELECT sess, expired_at FROM ${this.tableName} WHERE sid = ?`);
    this.setStmt = this.db.prepare(
      `INSERT INTO ${this.tableName} (sid, sess, expired_at) VALUES (?, ?, ?)
       ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired_at = excluded.expired_at`
    );
    this.destroyStmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE sid = ?`);
    this.touchStmt = this.db.prepare(`UPDATE ${this.tableName} SET expired_at = ? WHERE sid = ?`);
    this.clearStmt = this.db.prepare(`DELETE FROM ${this.tableName}`);
    this.cleanupStmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE expired_at < ?`);
    this.lengthStmt = this.db.prepare(`SELECT count(*) as count FROM ${this.tableName}`);

    this._startCleanupTimer();
  }

  _startCleanupTimer() {
    this._timer = setInterval(() => {
      try {
        const now = Date.now();
        const info = this.cleanupStmt.run(now);
        if (info.changes > 0) {
          logger.debug({ prunedSessions: info.changes }, 'Pruned expired sessions from SQLite');
        }
      } catch (err) {
        logger.error({ err }, 'Failed to prune expired sessions');
      }
    }, this.cleanupIntervalMs);

    if (this._timer.unref) {
      this._timer.unref();
    }
  }

  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row) {
        return cb(null, null);
      }
      if (row.expired_at < Date.now()) {
        this.destroy(sid, () => {});
        return cb(null, null);
      }
      const sess = JSON.parse(row.sess);
      cb(null, sess);
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      let maxAge = 86400000; // 24h default
      if (sess && sess.cookie && sess.cookie.maxAge) {
        maxAge = sess.cookie.maxAge;
      }
      const expiredAt = Date.now() + maxAge;
      const sessStr = JSON.stringify(sess);
      this.setStmt.run(sid, sessStr, expiredAt);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.destroyStmt.run(sid);
      if (cb) cb(null);
    } catch (err) {
      if (cb) cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      let maxAge = 86400000;
      if (sess && sess.cookie && sess.cookie.maxAge) {
        maxAge = sess.cookie.maxAge;
      }
      const expiredAt = Date.now() + maxAge;
      this.touchStmt.run(expiredAt, sid);
      if (cb) cb(null);
    } catch (err) {
      if (cb) cb(err);
    }
  }

  clear(cb) {
    try {
      this.clearStmt.run();
      if (cb) cb(null);
    } catch (err) {
      if (cb) cb(err);
    }
  }

  length(cb) {
    try {
      const row = this.lengthStmt.get();
      cb(null, row ? row.count : 0);
    } catch (err) {
      cb(err);
    }
  }

  stopCleanup() {
    if (this._timer) {
      clearInterval(this._timer);
    }
  }
}

export default SQLiteSessionStore;
