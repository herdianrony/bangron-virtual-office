import { generateId } from '../../utils/crypto.js';

export class ProjectRepository {
  constructor(db) {
    this.db = db;
  }

  getAllProjects() {
    return this.db.prepare(`
      SELECT 
        p.*,
        (SELECT COUNT(*) FROM agent_tasks WHERE project_id = p.id) as total_tasks,
        (SELECT COUNT(*) FROM agent_tasks WHERE project_id = p.id AND status = 'completed') as completed_tasks
      FROM projects p
      ORDER BY p.created_at DESC
    `).all();
  }

  getProjectById(id) {
    return this.db.prepare(`
      SELECT 
        p.*,
        (SELECT COUNT(*) FROM agent_tasks WHERE project_id = p.id) as total_tasks,
        (SELECT COUNT(*) FROM agent_tasks WHERE project_id = p.id AND status = 'completed') as completed_tasks
      FROM projects p
      WHERE p.id = ?
    `).get(id);
  }

  createProject({ id, name, slug, description = '', status = 'active', priority = 'normal', startDate = null, dueDate = null }) {
    const projectId = id || generateId('proj');
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO projects (id, name, slug, description, status, priority, start_date, due_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(projectId, name, slug, description, status, priority, startDate, dueDate, now, now);

    return this.getProjectById(projectId);
  }
}

export default ProjectRepository;
