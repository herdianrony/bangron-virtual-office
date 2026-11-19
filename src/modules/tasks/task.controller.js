import { TaskService } from './task.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export class TaskController {
  constructor() {
    this.taskService = new TaskService();
  }

  getAll = (req, res) => {
    try {
      const filters = {
        status: req.query.status,
        projectId: req.query.projectId,
        assignedAgentId: req.query.assignedAgentId,
        parentTaskId: req.query.parentTaskId === 'null' ? null : req.query.parentTaskId
      };
      const tasks = this.taskService.getAll(filters);
      return sendSuccess(res, tasks);
    } catch (err) {
      return sendError(res, 'TASKS_FETCH_ERROR', err.message, [], 500);
    }
  };

  getById = (req, res) => {
    try {
      const task = this.taskService.getById(req.params.id);
      if (!task) {
        return sendError(res, 'NOT_FOUND', 'Task not found', [], 404);
      }
      return sendSuccess(res, task);
    } catch (err) {
      return sendError(res, 'TASK_FETCH_ERROR', err.message, [], 500);
    }
  };

  create = (req, res) => {
    try {
      const { title, description, priority, projectId, parentTaskId, assignedAgentId, requiresApproval } = req.body;
      if (!title) {
        return sendError(res, 'VALIDATION_ERROR', 'title is required', [], 400);
      }

      const task = this.taskService.createTask({
        title,
        description,
        priority: priority || 'normal',
        projectId: projectId || null,
        parentTaskId: parentTaskId || null,
        assignedAgentId: assignedAgentId || null,
        requiresApproval: requiresApproval ? 1 : 0
      }, req.user ? String(req.user.id) : 'director');

      return sendSuccess(res, task, 'Task created successfully', null, 201);
    } catch (err) {
      return sendError(res, 'TASK_CREATE_ERROR', err.message, [], 500);
    }
  };

  assign = (req, res) => {
    try {
      const { agentId } = req.body;
      if (!agentId) {
        return sendError(res, 'VALIDATION_ERROR', 'agentId is required', [], 400);
      }
      const updated = this.taskService.assignAgent(req.params.id, agentId, req.user ? String(req.user.id) : 'director');
      return sendSuccess(res, updated, 'Task assigned to agent');
    } catch (err) {
      return sendError(res, 'TASK_ASSIGN_ERROR', err.message, [], 400);
    }
  };

  cancel = (req, res) => {
    try {
      const { reason } = req.body;
      const updated = this.taskService.cancelTask(req.params.id, reason, req.user ? String(req.user.id) : 'director');
      return sendSuccess(res, updated, 'Task cancelled');
    } catch (err) {
      return sendError(res, 'TASK_CANCEL_ERROR', err.message, [], 500);
    }
  };

  retry = (req, res) => {
    try {
      const updated = this.taskService.retryTask(req.params.id, req.user ? String(req.user.id) : 'director');
      return sendSuccess(res, updated, 'Task retry initiated');
    } catch (err) {
      return sendError(res, 'TASK_RETRY_ERROR', err.message, [], 400);
    }
  };

  addDependency = (req, res) => {
    try {
      const { dependsOnTaskId, dependencyType } = req.body;
      if (!dependsOnTaskId) {
        return sendError(res, 'VALIDATION_ERROR', 'dependsOnTaskId is required', [], 400);
      }
      const dep = this.taskService.addDependency(req.params.id, dependsOnTaskId, dependencyType || 'finish_to_start');
      return sendSuccess(res, dep, 'Dependency added successfully', null, 201);
    } catch (err) {
      return sendError(res, 'DEPENDENCY_ERROR', err.message, [], 400);
    }
  };
}

export const taskController = new TaskController();
export default taskController;
