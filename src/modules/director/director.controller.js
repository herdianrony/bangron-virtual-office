import { getDatabase } from '../../database/connection.js';
import { hermesAdapter } from '../../integrations/hermes/adapter.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export class DirectorController {
  constructor(db = null) {
    this.db = db || getDatabase();
  }

  getDashboardMetrics = async (req, res) => {
    try {
      const db = this.db;

      // 1. Agent counts
      const totalAgents = db.prepare('SELECT COUNT(*) as count FROM agent_instances').get().count;
      const onlineAgents = db.prepare("SELECT COUNT(*) as count FROM agent_instances WHERE status != 'offline'").get().count;
      const offlineAgents = totalAgents - onlineAgents;
      const workingAgents = db.prepare("SELECT COUNT(*) as count FROM agent_instances WHERE status IN ('working', 'thinking', 'collaborating')").get().count;

      // 2. Task counts
      const runningTasks = db.prepare("SELECT COUNT(*) as count FROM agent_tasks WHERE status = 'running'").get().count;
      const completedTasks = db.prepare("SELECT COUNT(*) as count FROM agent_tasks WHERE status = 'completed'").get().count;
      const failedTasks = db.prepare("SELECT COUNT(*) as count FROM agent_tasks WHERE status = 'failed'").get().count;
      const waitingTasks = db.prepare("SELECT COUNT(*) as count FROM agent_tasks WHERE status = 'waiting'").get().count;
      const totalTasks = db.prepare('SELECT COUNT(*) as count FROM agent_tasks').get().count;

      // 3. Pending approvals
      const pendingApprovals = db.prepare("SELECT COUNT(*) as count FROM approval_requests WHERE status = 'pending'").get().count;

      // 4. Projects
      const activeProjects = db.prepare("SELECT COUNT(*) as count FROM projects WHERE status = 'active'").get().count;
      const projectsList = db.prepare(`
        SELECT p.*,
          (SELECT COUNT(*) FROM agent_tasks WHERE project_id = p.id) as total_tasks,
          (SELECT COUNT(*) FROM agent_tasks WHERE project_id = p.id AND status = 'completed') as completed_tasks
        FROM projects p
        ORDER BY p.created_at DESC
        LIMIT 5
      `).all();

      // 5. Recent activities
      const recentActivities = db.prepare(`
        SELECT a.*, ai.display_name as agent_name, ap.department as agent_department
        FROM agent_activities a
        JOIN agent_instances ai ON a.agent_instance_id = ai.id
        JOIN agent_profiles ap ON ai.profile_id = ap.id
        ORDER BY a.occurred_at DESC
        LIMIT 10
      `).all();

      // 6. Active tasks preview
      const activeTasksList = db.prepare(`
        SELECT t.*, ai.display_name as assigned_agent_name, p.name as project_name
        FROM agent_tasks t
        LEFT JOIN agent_instances ai ON t.assigned_agent_id = ai.id
        LEFT JOIN projects p ON t.project_id = p.id
        WHERE t.status IN ('running', 'waiting', 'assigned')
        ORDER BY CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END, t.created_at DESC
        LIMIT 8
      `).all();

      // 7. Hermes runtime health
      const hermesHealth = await hermesAdapter.getRuntimeStatus();

      return sendSuccess(res, {
        metrics: {
          totalAgents,
          onlineAgents,
          offlineAgents,
          workingAgents,
          runningTasks,
          completedTasks,
          failedTasks,
          waitingTasks,
          totalTasks,
          pendingApprovals,
          activeProjects
        },
        projects: projectsList,
        activeTasks: activeTasksList,
        recentActivities,
        hermesHealth
      });
    } catch (err) {
      return sendError(res, 'METRICS_ERROR', err.message, [], 500);
    }
  };
}

export const directorController = new DirectorController();
export default directorController;
