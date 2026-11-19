import { getDatabase } from '../../database/connection.js';
import { AgentRepository } from '../../database/repositories/agent.repository.js';
import { ActivityRepository } from '../../database/repositories/activity.repository.js';
import { TaskRepository } from '../../database/repositories/task.repository.js';
import { AuditRepository } from '../../database/repositories/audit.repository.js';
import { eventPublisher } from '../../realtime/event-publisher.js';

export class AgentService {
  constructor(db = null) {
    this.db = db || getDatabase();
    this.agentRepo = new AgentRepository(this.db);
    this.activityRepo = new ActivityRepository(this.db);
    this.taskRepo = new TaskRepository(this.db);
    this.auditRepo = new AuditRepository(this.db);
  }

  getAll() {
    const instances = this.agentRepo.getAllInstances();
    const profiles = this.agentRepo.getAllProfiles();
    return { instances, profiles };
  }

  getById(id) {
    const instance = this.agentRepo.getInstanceById(id);
    if (!instance) return null;

    const recentActivities = this.activityRepo.getRecentActivities(20, { agentInstanceId: id });
    const assignedTasks = this.taskRepo.getAllTasks({ assignedAgentId: id });
    const sessions = this.db.prepare(
      'SELECT * FROM agent_sessions WHERE agent_instance_id = ? ORDER BY started_at DESC LIMIT 5'
    ).all(id);

    return {
      ...instance,
      activities: recentActivities,
      tasks: assignedTasks,
      sessions
    };
  }

  createProfile(profileData, actorId = 'director') {
    const profile = this.agentRepo.createProfile(profileData);
    this.auditRepo.log({
      actorType: 'user',
      actorId,
      action: 'agent_profile.created',
      resourceType: 'agent_profile',
      resourceId: profile.id,
      after: profile
    });
    return profile;
  }

  updateProfile(id, updates, actorId = 'director') {
    const before = this.agentRepo.getProfileById(id);
    const updated = this.agentRepo.updateProfile(id, updates);
    this.auditRepo.log({
      actorType: 'user',
      actorId,
      action: 'agent_profile.updated',
      resourceType: 'agent_profile',
      resourceId: id,
      before,
      after: updated
    });
    return updated;
  }

  sendCommand(instanceId, command, parameters = {}, actorId = 'director') {
    const instance = this.agentRepo.getInstanceById(instanceId);
    if (!instance) throw new Error('Agent instance not found');

    const activity = this.activityRepo.recordActivity({
      agentInstanceId: instanceId,
      activityType: 'command.received',
      description: `Director sent command: ${command}`,
      metadata: { command, parameters }
    });

    if (command === 'pause') {
      this.agentRepo.updateInstanceStatus(instanceId, 'waiting');
      eventPublisher.publishAgentStatus(instanceId, 'waiting');
    } else if (command === 'resume') {
      this.agentRepo.updateInstanceStatus(instanceId, 'working');
      eventPublisher.publishAgentStatus(instanceId, 'working');
    }

    eventPublisher.publishAgentActivity(activity);

    this.auditRepo.log({
      actorType: 'user',
      actorId,
      action: 'agent.command',
      resourceType: 'agent_instance',
      resourceId: instanceId,
      after: { command, parameters }
    });

    return { command, instanceId, status: 'acknowledged' };
  }
}

export default AgentService;
