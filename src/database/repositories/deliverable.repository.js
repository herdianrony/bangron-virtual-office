import { generateId } from '../../utils/crypto.js';

export class DeliverableRepository {
  constructor(db) {
    this.db = db;
  }

  getAllDeliverables(filters = {}) {
    let query = `
      SELECT 
        d.*,
        t.title as task_title,
        p.name as project_name,
        ai.display_name as agent_name
      FROM deliverables d
      JOIN agent_tasks t ON d.task_id = t.id
      LEFT JOIN projects p ON t.project_id = p.id
      JOIN agent_instances ai ON d.agent_instance_id = ai.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.taskId) {
      query += ' AND d.task_id = ?';
      params.push(filters.taskId);
    }

    query += ' ORDER BY d.created_at DESC';
    return this.db.prepare(query).all(...params);
  }

  getDeliverableById(id) {
    return this.db.prepare(`
      SELECT 
        d.*,
        t.title as task_title,
        ai.display_name as agent_name
      FROM deliverables d
      JOIN agent_tasks t ON d.task_id = t.id
      JOIN agent_instances ai ON d.agent_instance_id = ai.id
      WHERE d.id = ?
    `).get(id);
  }

  createDeliverable({ id, taskId, agentInstanceId, name, description = '', filePath, mimeType, fileSize, metadata = {} }) {
    const deliverableId = id || generateId('deliv');
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO deliverables (id, task_id, agent_instance_id, name, description, file_path, mime_type, file_size, status, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)
    `).run(
      deliverableId,
      taskId,
      agentInstanceId,
      name,
      description,
      filePath,
      mimeType,
      fileSize,
      JSON.stringify(metadata),
      now,
      now
    );

    return this.getDeliverableById(deliverableId);
  }
}

export default DeliverableRepository;
