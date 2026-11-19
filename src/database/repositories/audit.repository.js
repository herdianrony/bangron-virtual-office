export class AuditRepository {
  constructor(db) {
    this.db = db;
  }

  log({ userId = null, actorType = 'user', actorId, action, resourceType, resourceId = null, before = null, after = null, ipAddress = null, userAgent = null }) {
    const now = new Date().toISOString();
    const beforeJson = before ? JSON.stringify(before) : null;
    const afterJson = after ? JSON.stringify(after) : null;

    this.db.prepare(`
      INSERT INTO audit_logs (
        user_id, actor_type, actor_id, action, resource_type,
        resource_id, before_json, after_json, ip_address, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, actorType, actorId, action, resourceType, resourceId, beforeJson, afterJson, ipAddress, userAgent, now);
  }

  getRecentLogs(limit = 100) {
    return this.db.prepare(`
      SELECT 
        l.*,
        u.name as user_name,
        u.email as user_email
      FROM audit_logs l
      LEFT JOIN users u ON l.user_id = u.id
      ORDER BY l.created_at DESC
      LIMIT ?
    `).all(limit);
  }
}

export default AuditRepository;
