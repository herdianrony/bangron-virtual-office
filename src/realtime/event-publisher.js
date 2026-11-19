import { connectionManager } from './connection-manager.js';
import { generateId } from '../utils/crypto.js';
import logger from '../utils/logger.js';

export class EventPublisher {
  constructor(manager = connectionManager) {
    this.manager = manager;
  }

  publish(type, data = {}, correlationId = null) {
    const envelope = {
      type,
      event_id: generateId('ws_evt'),
      timestamp: new Date().toISOString(),
      correlation_id: correlationId,
      data
    };

    logger.debug({ type, eventId: envelope.event_id }, 'Broadcasting realtime event');
    this.manager.broadcast(envelope);
    return envelope;
  }

  // Domain shortcuts
  publishAgentStatus(agentInstanceId, status, details = {}) {
    return this.publish('agent.status.updated', {
      agent_instance_id: agentInstanceId,
      status,
      ...details
    });
  }

  publishAgentPosition(agentInstanceId, roomId, workstationId, positionX, positionY, direction, extras = {}) {
    return this.publish('agent.position.updated', {
      agent_instance_id: agentInstanceId,
      room_id: roomId,
      workstation_id: workstationId,
      position_x: positionX,
      position_y: positionY,
      direction,
      path: extras.path || null,
      move_note: extras.moveNote || null,
      arrive_status: extras.arriveStatus || null
    });
  }

  publishAgentActivity(activity) {
    return this.publish('agent.activity.created', activity);
  }

  publishAgentCreated(agentInstance) {
    return this.publish('agent.created', agentInstance);
  }

  publishTaskStatus(task) {
    return this.publish('task.status.updated', task);
  }

  publishApprovalUpdate(approval) {
    return this.publish('approval.updated', approval);
  }

  publishOfficeState(state) {
    return this.publish('office.state.updated', state);
  }
}

export const eventPublisher = new EventPublisher();
export default eventPublisher;
