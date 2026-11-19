import { generateId } from '../../utils/crypto.js';

export class TaskRepository {
  constructor(db) {
    this.db = db;
  }

  getAllTasks(filters = {}) {
    let query = `
      SELECT 
        t.*,
        p.name as project_name,
        ai.display_name as assigned_agent_name,
        ap.name as assigned_agent_role,
        (SELECT COUNT(*) FROM agent_tasks WHERE parent_task_id = t.id) as subtask_count,
        (SELECT COUNT(*) FROM agent_tasks WHERE parent_task_id = t.id AND status = 'completed') as subtasks_completed_count
      FROM agent_tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN agent_instances ai ON t.assigned_agent_id = ai.id
      LEFT JOIN agent_profiles ap ON ai.profile_id = ap.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.status) {
      query += ' AND t.status = ?';
      params.push(filters.status);
    }
    if (filters.projectId) {
      query += ' AND t.project_id = ?';
      params.push(filters.projectId);
    }
    if (filters.assignedAgentId) {
      query += ' AND t.assigned_agent_id = ?';
      params.push(filters.assignedAgentId);
    }
    if (filters.parentTaskId !== undefined) {
      if (filters.parentTaskId === null) {
        query += ' AND t.parent_task_id IS NULL';
      } else {
        query += ' AND t.parent_task_id = ?';
        params.push(filters.parentTaskId);
      }
    }

    query += ' ORDER BY CASE t.priority WHEN "critical" THEN 1 WHEN "high" THEN 2 WHEN "normal" THEN 3 ELSE 4 END, t.created_at DESC';

    return this.db.prepare(query).all(...params);
  }

  getTaskById(id) {
    return this.db.prepare(`
      SELECT 
        t.*,
        p.name as project_name,
        ai.display_name as assigned_agent_name,
        ap.name as assigned_agent_role
      FROM agent_tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN agent_instances ai ON t.assigned_agent_id = ai.id
      LEFT JOIN agent_profiles ap ON ai.profile_id = ap.id
      WHERE t.id = ?
    `).get(id);
  }

  getSubtasks(parentTaskId) {
    return this.getAllTasks({ parentTaskId });
  }

  getDependencies(taskId) {
    return this.db.prepare(`
      SELECT 
        d.*,
        t.title as prerequisite_title,
        t.status as prerequisite_status
      FROM agent_dependencies d
      JOIN agent_tasks t ON d.depends_on_task_id = t.id
      WHERE d.task_id = ?
    `).all(taskId);
  }

  createTask({ id, projectId = null, parentTaskId = null, title, description = '', priority = 'normal', assignedAgentId = null, createdBy = 'director', requiresApproval = 0, hermesRunId = null }) {
    const taskId = id || generateId('task');
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO agent_tasks (
        id, project_id, parent_task_id, title, description,
        status, priority, assigned_agent_id, created_by,
        requires_approval, hermes_run_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskId,
      projectId,
      parentTaskId,
      title,
      description,
      priority,
      assignedAgentId,
      createdBy,
      requiresApproval ? 1 : 0,
      hermesRunId,
      now,
      now
    );

    return this.getTaskById(taskId);
  }

  updateTaskStatus(id, status, resultSummary = null) {
    const now = new Date().toISOString();
    let startedAtClause = '';
    let completedAtClause = '';
    const params = [status];

    if (resultSummary !== null) {
      params.push(resultSummary);
    }

    params.push(now);

    if (status === 'running') {
      startedAtClause = ', started_at = COALESCE(started_at, ?)';
      params.push(now);
    } else if (['completed', 'failed', 'cancelled'].includes(status)) {
      completedAtClause = ', completed_at = ?';
      params.push(now);
    }

    params.push(id);

    let query = `UPDATE agent_tasks SET status = ?`;
    if (resultSummary !== null) query += `, result_summary = ?`;
    query += `, updated_at = ?${startedAtClause}${completedAtClause} WHERE id = ?`;

    this.db.prepare(query).run(...params);
    return this.getTaskById(id);
  }

  assignAgent(taskId, agentInstanceId) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE agent_tasks SET assigned_agent_id = ?, status = 'assigned', updated_at = ? WHERE id = ?
    `).run(agentInstanceId, now, taskId);
    return this.getTaskById(taskId);
  }

  setHermesRunId(taskId, hermesRunId) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE agent_tasks SET hermes_run_id = ?, updated_at = ? WHERE id = ?
    `).run(hermesRunId, now, taskId);
    return this.getTaskById(taskId);
  }

  /**
   * Adds dependency with cycle prevention.
   * If taskId depends on dependsOnTaskId, we must verify that dependsOnTaskId doesn't already depend on taskId (directly or transitively).
   */
  addDependency(taskId, dependsOnTaskId, dependencyType = 'finish_to_start') {
    if (taskId === dependsOnTaskId) {
      throw new Error('Task cannot depend on itself.');
    }

    // Cycle detection using BFS: traverse all prerequisites of dependsOnTaskId
    const visited = new Set();
    const queue = [dependsOnTaskId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === taskId) {
        throw new Error(`Circular dependency detected: adding ${taskId} -> ${dependsOnTaskId} would form a cycle.`);
      }
      visited.add(current);

      const parents = this.db.prepare('SELECT depends_on_task_id FROM agent_dependencies WHERE task_id = ?').all(current);
      for (const p of parents) {
        if (!visited.has(p.depends_on_task_id)) {
          queue.push(p.depends_on_task_id);
        }
      }
    }

    const id = generateId('dep');
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO agent_dependencies (id, task_id, depends_on_task_id, dependency_type, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, taskId, dependsOnTaskId, dependencyType, now);

    return { id, taskId, dependsOnTaskId, dependencyType };
  }

  /**
   * Check if all prerequisite tasks for this task are completed.
   */
  arePrerequisitesSatisfied(taskId) {
    const uncompleted = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM agent_dependencies d
      JOIN agent_tasks t ON d.depends_on_task_id = t.id
      WHERE d.task_id = ? AND t.status != 'completed'
    `).get(taskId);
    return uncompleted.count === 0;
  }
}

export default TaskRepository;
