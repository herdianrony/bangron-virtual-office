import { getDatabase } from '../../database/connection.js';
import { ProjectRepository } from '../../database/repositories/project.repository.js';
import { TaskRepository } from '../../database/repositories/task.repository.js';
import { AuditRepository } from '../../database/repositories/audit.repository.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export class ProjectController {
  constructor(db = null) {
    this.db = db || getDatabase();
    this.projectRepo = new ProjectRepository(this.db);
    this.taskRepo = new TaskRepository(this.db);
    this.auditRepo = new AuditRepository(this.db);
  }

  getAll = (req, res) => {
    try {
      const projects = this.projectRepo.getAllProjects();
      return sendSuccess(res, projects);
    } catch (err) {
      return sendError(res, 'PROJECTS_FETCH_ERROR', err.message, [], 500);
    }
  };

  getById = (req, res) => {
    try {
      const project = this.projectRepo.getProjectById(req.params.id);
      if (!project) {
        return sendError(res, 'NOT_FOUND', 'Project not found', [], 404);
      }
      const tasks = this.taskRepo.getAllTasks({ projectId: req.params.id });
      return sendSuccess(res, { ...project, tasks });
    } catch (err) {
      return sendError(res, 'PROJECT_FETCH_ERROR', err.message, [], 500);
    }
  };

  create = (req, res) => {
    try {
      const { name, slug, description, priority, startDate, dueDate } = req.body;
      if (!name || !slug) {
        return sendError(res, 'VALIDATION_ERROR', 'name and slug are required', [], 400);
      }
      const project = this.projectRepo.createProject({
        name,
        slug,
        description,
        priority: priority || 'normal',
        startDate,
        dueDate
      });

      this.auditRepo.log({
        actorType: 'user',
        actorId: req.user ? String(req.user.id) : 'director',
        action: 'project.created',
        resourceType: 'project',
        resourceId: project.id,
        after: project
      });

      return sendSuccess(res, project, 'Project created successfully', null, 201);
    } catch (err) {
      return sendError(res, 'PROJECT_CREATE_ERROR', err.message, [], 500);
    }
  };
}

export const projectController = new ProjectController();
export default projectController;
