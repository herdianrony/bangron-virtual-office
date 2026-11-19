import { getDatabase } from '../../database/connection.js';
import { TaskRepository } from '../../database/repositories/task.repository.js';
import { AgentRepository } from '../../database/repositories/agent.repository.js';
import { ActivityRepository } from '../../database/repositories/activity.repository.js';
import { DeliverableRepository } from '../../database/repositories/deliverable.repository.js';
import { AuditRepository } from '../../database/repositories/audit.repository.js';
import { eventPublisher } from '../../realtime/event-publisher.js';
import { hermesAdapter } from '../../integrations/hermes/adapter.js';
import { hermesEventBridge } from '../../integrations/hermes/event-bridge.js';
import logger from '../../utils/logger.js';

export class TaskService {
  constructor(db = null) {
    this.db = db || getDatabase();
    this.taskRepo = new TaskRepository(this.db);
    this.agentRepo = new AgentRepository(this.db);
    this.activityRepo = new ActivityRepository(this.db);
    this.deliverableRepo = new DeliverableRepository(this.db);
    this.auditRepo = new AuditRepository(this.db);
  }

  getAll(filters = {}) {
    return this.taskRepo.getAllTasks(filters);
  }

  getById(id) {
    const task = this.taskRepo.getTaskById(id);
    if (!task) return null;

    const subtasks = this.taskRepo.getSubtasks(id);
    const dependencies = this.taskRepo.getDependencies(id);
    const deliverables = this.deliverableRepo.getAllDeliverables({ taskId: id });
    const activities = this.activityRepo.getRecentActivities(20, { taskId: id });

    return {
      ...task,
      subtasks,
      dependencies,
      deliverables,
      activities
    };
  }

  createTask(taskData, actorId = 'director') {
    const task = this.taskRepo.createTask(taskData);

    this.auditRepo.log({
      actorType: 'user',
      actorId,
      action: 'task.created',
      resourceType: 'agent_task',
      resourceId: task.id,
      after: task
    });

    eventPublisher.publish('task.created', task);
    return task;
  }

  addDependency(taskId, dependsOnTaskId, dependencyType = 'finish_to_start') {
    const dep = this.taskRepo.addDependency(taskId, dependsOnTaskId, dependencyType);
    eventPublisher.publish('task.dependency.added', dep);
    return dep;
  }

  async assignAgent(taskId, agentInstanceId, actorId = 'director') {
    const task = this.taskRepo.getTaskById(taskId);
    if (!task) throw new Error('Task not found');

    const agent = this.agentRepo.getInstanceById(agentInstanceId);
    if (!agent) throw new Error('Agent instance not found');

    // Check prerequisites
    const satisfied = this.taskRepo.arePrerequisitesSatisfied(taskId);
    if (!satisfied) {
      throw new Error('Cannot assign/start task: Prerequisite tasks have not been completed yet.');
    }

    // Build instruction for Hermes
    const instruction = `Task: ${task.title}\n\nDescription: ${task.description || 'No description provided.'}\n\nPriority: ${task.priority}\nAssigned Agent: ${agent.display_name} (${agent.profile_name})\n\nPlease execute this task and provide a summary of the work completed.`;

    // Dispatch to Hermes
    const agentProfile = {
      slug: agent.profile_slug,
      name: agent.profile_name
    };

    const dispatchResult = await hermesAdapter.dispatchTaskInstruction({
      taskId: task.id,
      instruction,
      agentProfile,
      parameters: {}
    });

    let hermesRunId = null;
    if (dispatchResult.dispatched) {
      hermesRunId = dispatchResult.runId;
      // Store the run_id in the task
      this.taskRepo.setHermesRunId(taskId, hermesRunId);
      // Register run-to-task mapping for event correlation
      hermesEventBridge.registerRunTaskMapping(hermesRunId, taskId);
      logger.info({ taskId, hermesRunId }, 'Hermes run ID stored for task');
    } else {
      logger.warn({ taskId, reason: dispatchResult.reason }, 'Failed to dispatch task to Hermes');
    }

    const updatedTask = this.taskRepo.assignAgent(taskId, agentInstanceId);
    this.agentRepo.updateInstanceStatus(agentInstanceId, 'working');

    const activity = this.activityRepo.recordActivity({
      agentInstanceId,
      taskId,
      activityType: 'task.assigned',
      description: `Task assigned: ${task.title}` + (hermesRunId ? ` (Hermes run: ${hermesRunId})` : '')
    });

    this.auditRepo.log({
      actorType: 'user',
      actorId,
      action: 'task.assigned',
      resourceType: 'agent_task',
      resourceId: taskId,
      after: { assignedAgentId: agentInstanceId, hermesRunId }
    });

    eventPublisher.publishTaskStatus(updatedTask);
    eventPublisher.publishAgentStatus(agentInstanceId, 'working');
    eventPublisher.publishAgentActivity(activity);

    return { ...updatedTask, hermesRunId };
  }

  cancelTask(taskId, reason = 'Cancelled by Director', actorId = 'director') {
    const updatedTask = this.taskRepo.updateTaskStatus(taskId, 'cancelled', reason);
    if (updatedTask.assigned_agent_id) {
      this.agentRepo.updateInstanceStatus(updatedTask.assigned_agent_id, 'idle');
      eventPublisher.publishAgentStatus(updatedTask.assigned_agent_id, 'idle');
    }

    this.auditRepo.log({
      actorType: 'user',
      actorId,
      action: 'task.cancelled',
      resourceType: 'agent_task',
      resourceId: taskId,
      after: { reason }
    });

    eventPublisher.publishTaskStatus(updatedTask);
    return updatedTask;
  }

  retryTask(taskId, actorId = 'director') {
    const task = this.taskRepo.getTaskById(taskId);
    if (!task) throw new Error('Task not found');
    if (task.status !== 'failed' && task.status !== 'cancelled') {
      throw new Error(`Cannot retry task with status '${task.status}'. Only failed or cancelled tasks can be retried.`);
    }

    const updatedTask = this.taskRepo.updateTaskStatus(taskId, 'pending', 'Retried by Director');
    if (task.assigned_agent_id) {
      this.assignAgent(taskId, task.assigned_agent_id, actorId);
    }

    this.auditRepo.log({
      actorType: 'user',
      actorId,
      action: 'task.retried',
      resourceType: 'agent_task',
      resourceId: taskId
    });

    eventPublisher.publishTaskStatus(updatedTask);
    return updatedTask;
  }
}

export default TaskService;
