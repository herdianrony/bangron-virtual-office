import { generateId } from '../../utils/crypto.js';

export class ActivityRepository {
  constructor(db) {
    this.db = db;
  }

  getRecentActivities(limit = 50, filters = {}) {
    let query = `
      SELECT 
        a.*,
        ai.display_name as agent_name,
        ap.department as agent_department,
        t.title as task_title
      FROM agent_activities a
      JOIN agent_instances ai ON a.agent_instance_id = ai.id
      JOIN agent_profiles ap ON ai.profile_id = ap.id
      LEFT JOIN agent_tasks t ON a.task_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.agentInstanceId) {
      query += ' AND a.agent_instance_id = ?';
      params.push(filters.agentInstanceId);
    }
    if (filters.taskId) {
      query += ' AND a.task_id = ?';
      params.push(filters.taskId);
    }

    query += ' ORDER BY a.occurred_at DESC LIMIT ?';
    params.push(limit);

    return this.db.prepare(query).all(...params);
  }

  recordActivity({ id, agentInstanceId, sessionId = null, taskId = null, activityType, description, metadata = {}, occurredAt = null }) {
    const activityId = id || generateId('act');
    const now = occurredAt || new Date().toISOString();
    const metaStr = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);

    this.db.prepare(`
      INSERT INTO agent_activities (id, agent_instance_id, session_id, task_id, activity_type, description, metadata_json, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(activityId, agentInstanceId, sessionId, taskId, activityType, description, metaStr, now, now);

    return { id: activityId, agentInstanceId, sessionId, taskId, activityType, description, occurredAt: now };
  }
}

export default ActivityRepository;
