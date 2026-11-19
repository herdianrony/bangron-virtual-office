export class UserRepository {
  constructor(db) {
    this.db = db;
  }

  findByEmail(email) {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  }

  findByEmailOrName(identifier) {
    return this.db.prepare(
      'SELECT * FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(name) = LOWER(?)'
    ).get(identifier, identifier);
  }

  findById(id) {
    return this.db.prepare('SELECT id, name, email, role, is_active, last_login_at, created_at FROM users WHERE id = ?').get(id);
  }

  updateLastLogin(id) {
    const now = new Date().toISOString();
    return this.db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  }

  createUser({ name, email, passwordHash, role = 'director' }) {
    const now = new Date().toISOString();
    const info = this.db.prepare(`
      INSERT INTO users (name, email, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(name, email, passwordHash, role, now, now);
    return this.findById(info.lastInsertRowid);
  }
}

export default UserRepository;
