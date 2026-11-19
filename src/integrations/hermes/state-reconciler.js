import { getDatabase } from '../../database/connection.js';
import { EventRepository } from '../../database/repositories/event.repository.js';
import { AgentRepository } from '../../database/repositories/agent.repository.js';
import { TaskRepository } from '../../database/repositories/task.repository.js';
import { ActivityRepository } from '../../database/repositories/activity.repository.js';
import { PolicyEngine } from '../../services/policy-engine.js';
import { HermesAgentProvisioner } from './agent-provisioner.js';
import { eventPublisher } from '../../realtime/event-publisher.js';
import logger from '../../utils/logger.js';

export class StateReconciler {
  constructor(db = null) {
    this.db = db || getDatabase();
    this.eventRepo = new EventRepository(this.db);
    this.agentRepo = new AgentRepository(this.db);
    this.taskRepo = new TaskRepository(this.db);
    this.activityRepo = new ActivityRepository(this.db);
    this.policyEngine = new PolicyEngine(this.db);
    // Auto-provisioning agen dari identitas asli Hermes (nama profil/agent_id)
    this.provisioner = new HermesAgentProvisioner(this.db);
    // Wire format resmi Outbound Webhooks Hermes TIDAK membawa identitas agen
    // eksplisit (hanya session_id + nama profile). Gunakan rantai resolusi:
    // instance eksplisit → session yang dikenal → map profil → instance default.
    this.defaultInstanceId = process.env.HERMES_DEFAULT_AGENT_ID || 'inst_demo_hermes';
    try {
      this.profileAgentMap = process.env.HERMES_PROFILE_AGENT_MAP
        ? JSON.parse(process.env.HERMES_PROFILE_AGENT_MAP)
        : {};
    } catch {
      this.profileAgentMap = {};
      logger.warn('HERMES_PROFILE_AGENT_MAP bukan JSON valid; mapping profil dilewati');
    }
  }

  reconcile(event) {
    logger.info({ eventType: event.event_type, eventId: event.event_id, taskId: event.task_id }, 'Reconciling event');

    // 1. Idempotency & Persistence check
    const recordResult = this.eventRepo.recordEvent({
      eventId: event.event_id,
      eventType: event.event_type,
      source: event.source,
      agentId: event.agent_id,
      instanceId: event.instance_id,
      sessionId: event.session_id,
      parentSessionId: event.parent_session_id,
      taskId: event.task_id,
      correlationId: event.correlation_id,
      payload: event.payload,
      occurredAt: event.occurred_at
    });

    if (recordResult.isDuplicate && recordResult.event.processing_status === 'processed') {
      logger.info({ eventId: event.event_id }, 'Duplicate event ignored: already processed');
      return { status: 'ignored', reason: 'DUPLICATE_EVENT' };
    }

    // 2. Wrap state transition in SQLite transaction
    const tx = this.db.transaction(() => {
      this._processStateTransition(event);
      this.eventRepo.markProcessed(event.event_id, 'processed');
    });

    try {
      tx();
      return { status: 'processed', eventId: event.event_id };
    } catch (err) {
      logger.error({ err, eventId: event.event_id }, 'Failed to reconcile event');
      this.eventRepo.markProcessed(event.event_id, 'failed');
      throw err;
    }
  }

  _processStateTransition(event) {
    let { event_type, instance_id, session_id, task_id, payload, occurred_at } = event;

    // Real-world tolerance: ID dari Hermes eksternal bisa jadi belum terdaftar di
    // database kantor (instance/task dibuat terpisah). Jangan biarkan FK constraint
    // menggagalkan ingest — resolusikan eksistensi dulu, lewati yang tidak dikenal.
    if (instance_id && !this.agentRepo.getInstanceById(instance_id)) {
      logger.warn({ instanceId: instance_id }, 'Unknown agent instance in Hermes event; falling back to identity resolution');
      instance_id = null;
    }
    // 1) Tanpa instance eksplisit: cek session yang sudah dikenal (stikiness)
    if (!instance_id && session_id) {
      const knownSession = this.agentRepo.getSessionById(session_id);
      if (knownSession && knownSession.agent_instance_id) {
        instance_id = knownSession.agent_instance_id;
      }
    }
    // 2) Map profil eksplisit (HERMES_PROFILE_AGENT_MAP) → auto-provision nama
    //    asli Hermes (profile/agent_id) → instance default.
    if (!instance_id) {
      const mapped = (event.profile && this.profileAgentMap[event.profile]) || null;
      if (mapped && this.agentRepo.getInstanceById(mapped)) {
        instance_id = mapped;
      } else if (!mapped) {
        const provisioned = this.provisioner.resolveFromEvent(event);
        if (provisioned) {
          instance_id = provisioned.id;
        }
      }
      if (!instance_id && this.defaultInstanceId && this.agentRepo.getInstanceById(this.defaultInstanceId)) {
        instance_id = this.defaultInstanceId;
      } else if (!instance_id && (event.profile || event.agent_id)) {
        logger.warn({ profile: event.profile, agentId: event.agent_id }, 'Auto-provision gagal dan default instance tidak ada');
      }
    }
    if (task_id && !this.taskRepo.getTaskById(task_id)) {
      logger.warn({ taskId: task_id }, 'Unknown task in Hermes event; task-related updates skipped');
      task_id = null;
    }
    // Session: auto-register saat pertama kali terlihat. Tanpa ini FK
    // agent_activities.session_id / agent_sessions gagal, dan endSession tidak
    // bisa merekonsiliasi sesi Hermes yang nyata.
    if (session_id && !this.agentRepo.getSessionById(session_id)) {
      if (instance_id) {
        let parentSessionId = event.parent_session_id || null;
        if (parentSessionId && !this.agentRepo.getSessionById(parentSessionId)) {
          logger.warn({ parentSessionId }, 'Unknown parent session; parent link skipped');
          parentSessionId = null;
        }
        this.agentRepo.createSession({
          id: session_id,
          agentInstanceId: instance_id,
          parentSessionId,
          taskId: task_id,
          metadata: { source: event.source || 'hermes', auto_created: true, agent_id: event.agent_id }
        });
        logger.info({ sessionId: session_id, agentInstanceId: instance_id }, 'Hermes session auto-registered in control plane');
      } else {
        logger.warn({ sessionId: session_id }, 'Unknown session without known agent instance; session-related updates skipped');
        session_id = null;
      }
    }

    // A. Tool Started: Check for high-risk actions requiring Director approval
    if (event_type === 'agent.tool.started') {
      const toolName = payload.tool_name || payload.tool || '';
      const actionType = payload.action_type || toolName;

      const evalResult = instance_id
        ? this.policyEngine.evaluateAction({
            taskId: task_id,
            agentInstanceId: instance_id,
            actionType,
            description: payload.description || `Agent executing sensitive tool: ${toolName}`,
            payload: payload.tool_input || payload
          })
        : null;

      if (evalResult && evalResult.requiresApproval) {
        if (instance_id) {
          this.agentRepo.updateInstanceStatus(instance_id, 'waiting');
          eventPublisher.publishAgentStatus(instance_id, 'waiting', { reason: 'approval_required' });
        }
        if (task_id) {
          const updatedTask = this.taskRepo.getTaskById(task_id);
          eventPublisher.publishTaskStatus(updatedTask);
        }
        eventPublisher.publishApprovalUpdate(evalResult.approvalRequest);

        this.activityRepo.recordActivity({
          agentInstanceId: instance_id,
          sessionId: session_id,
          taskId: task_id,
          activityType: 'approval.requested',
          description: `Action '${actionType}' requires Director approval`,
          metadata: evalResult.approvalRequest,
          occurredAt: occurred_at
        });
        return;
      }

      // Safe tool execution: Agent is working
      if (instance_id) {
        this.agentRepo.updateInstanceStatus(instance_id, 'working');
        eventPublisher.publishAgentStatus(instance_id, 'working', { current_tool: toolName });
      }

      this._recordActivity({
        agentInstanceId: instance_id,
        sessionId: session_id,
        taskId: task_id,
        activityType: 'tool.executed',
        description: `Running tool '${toolName}'`,
        metadata: { toolName, args: payload.tool_input },
        occurredAt: occurred_at
      });
      return;
    }

    // B. Tool Completed: Tool finished. NEVER mark overall task completed here!
    if (event_type === 'agent.tool.completed') {
      const toolName = payload.tool_name || payload.tool || 'tool';
      if (instance_id) {
        this.agentRepo.updateInstanceStatus(instance_id, 'working');
        eventPublisher.publishAgentStatus(instance_id, 'working', { completed_tool: toolName });
      }

      this._recordActivity({
        agentInstanceId: instance_id,
        sessionId: session_id,
        taskId: task_id,
        activityType: 'tool.completed',
        description: `Completed tool '${toolName}'`,
        metadata: { toolName, success: payload.success !== false },
        occurredAt: occurred_at
      });
      return;
    }

    // C. Execution Started
    if (event_type === 'agent.execution.started') {
      if (instance_id) {
        this.agentRepo.updateInstanceStatus(instance_id, 'working');
        eventPublisher.publishAgentStatus(instance_id, 'working');
      }

      if (task_id) {
        this.taskRepo.updateTaskStatus(task_id, 'running');
        const task = this.taskRepo.getTaskById(task_id);
        eventPublisher.publishTaskStatus(task);
      }

      this._recordActivity({
        agentInstanceId: instance_id,
        sessionId: session_id,
        taskId: task_id,
        activityType: 'execution.started',
        description: 'Agent session started execution',
        metadata: payload,
        occurredAt: occurred_at
      });
      return;
    }

    // D. Execution Step (Reasoning / Planning)
    if (event_type === 'agent.execution.step') {
      if (instance_id) {
        this.agentRepo.updateInstanceStatus(instance_id, 'thinking');
        eventPublisher.publishAgentStatus(instance_id, 'thinking');
      }

      this._recordActivity({
        agentInstanceId: instance_id,
        sessionId: session_id,
        taskId: task_id,
        activityType: 'execution.step',
        description: payload.thought || payload.step_description || 'Evaluating task steps',
        metadata: payload,
        occurredAt: occurred_at
      });
      return;
    }

    // E. Subagent Spawned / Exited
    if (event_type === 'agent.subagent.spawned') {
      if (instance_id) {
        this.agentRepo.updateInstanceStatus(instance_id, 'collaborating');
        eventPublisher.publishAgentStatus(instance_id, 'collaborating');
      }

      this._recordActivity({
        agentInstanceId: instance_id,
        sessionId: session_id,
        taskId: task_id,
        activityType: 'subagent.spawned',
        description: `Delegated subtask to specialist: ${payload.subagent_role || payload.subagent_name}`,
        metadata: payload,
        occurredAt: occurred_at
      });
      return;
    }

    // F. Execution Ended: Reconcile Task and Subtasks
    if (event_type === 'agent.execution.ended') {
      const isSuccess = payload.success !== false && payload.exit_code !== 1 && !payload.error;
      const resultSummary = payload.summary || payload.result || (isSuccess ? 'Completed successfully' : payload.error || 'Execution failed');

      if (session_id) {
        this.agentRepo.endSession(session_id, isSuccess ? 'completed' : 'failed');
      }

      if (task_id) {
        if (!isSuccess) {
          this.taskRepo.updateTaskStatus(task_id, 'failed', resultSummary);
          if (instance_id) {
            this.agentRepo.updateInstanceStatus(instance_id, 'failed');
            eventPublisher.publishAgentStatus(instance_id, 'failed');
          }
          const failedTask = this.taskRepo.getTaskById(task_id);
          eventPublisher.publishTaskStatus(failedTask);
        } else {
          // Check if there are uncompleted subtasks
          const uncompletedSubtasks = this.db.prepare(
            "SELECT count(*) as count FROM agent_tasks WHERE parent_task_id = ? AND status != 'completed'"
          ).get(task_id);

          if (uncompletedSubtasks.count > 0) {
            logger.info({ taskId: task_id, pendingSubtasks: uncompletedSubtasks.count }, 'Task execution session ended, but subtasks remain pending');
            this.taskRepo.updateTaskStatus(task_id, 'running', 'Waiting for remaining subtasks to complete');
          } else {
            this.taskRepo.updateTaskStatus(task_id, 'completed', resultSummary);
            const compTask = this.taskRepo.getTaskById(task_id);
            eventPublisher.publishTaskStatus(compTask);

            // Check if this task is a subtask, and if all sibling subtasks are done, reconcile parent task!
            if (compTask.parent_task_id) {
              this._reconcileParentTask(compTask.parent_task_id);
            }
          }

          if (instance_id) {
            this.agentRepo.updateInstanceStatus(instance_id, 'idle');
            eventPublisher.publishAgentStatus(instance_id, 'idle');
          }
        }
      } else {
        if (instance_id) {
          this.agentRepo.updateInstanceStatus(instance_id, 'idle');
          eventPublisher.publishAgentStatus(instance_id, 'idle');
        }
      }

      this._recordActivity({
        agentInstanceId: instance_id,
        sessionId: session_id,
        taskId: task_id,
        activityType: isSuccess ? 'execution.completed' : 'execution.failed',
        description: isSuccess ? 'Agent completed execution' : `Execution failed: ${resultSummary}`,
        metadata: payload,
        occurredAt: occurred_at
      });
      return;
    }

    // G. Execution Failed (from run.failed SSE event)
    if (event_type === 'agent.execution.failed') {
      const errorMsg = payload.error || payload.message || 'Unknown execution failure';
      const resultSummary = `Execution failed: ${errorMsg}`;

      if (session_id) {
        this.agentRepo.endSession(session_id, 'failed');
      }

      if (task_id) {
        this.taskRepo.updateTaskStatus(task_id, 'failed', resultSummary);
        const failedTask = this.taskRepo.getTaskById(task_id);
        eventPublisher.publishTaskStatus(failedTask);
      }

      if (instance_id) {
        this.agentRepo.updateInstanceStatus(instance_id, 'failed');
        eventPublisher.publishAgentStatus(instance_id, 'failed');
      }

      this._recordActivity({
        agentInstanceId: instance_id,
        sessionId: session_id,
        taskId: task_id,
        activityType: 'execution.failed',
        description: resultSummary,
        metadata: payload,
        occurredAt: occurred_at
      });
      return;
    }

    // H. Execution Cancelled (from run.cancelled SSE event)
    if (event_type === 'agent.execution.cancelled') {
      const reason = payload.reason || payload.turn_exit_reason || 'Execution cancelled';

      if (session_id) {
        this.agentRepo.endSession(session_id, 'cancelled');
      }

      if (task_id) {
        this.taskRepo.updateTaskStatus(task_id, 'cancelled', reason);
        const cancelledTask = this.taskRepo.getTaskById(task_id);
        eventPublisher.publishTaskStatus(cancelledTask);
      }

      if (instance_id) {
        this.agentRepo.updateInstanceStatus(instance_id, 'idle');
        eventPublisher.publishAgentStatus(instance_id, 'idle');
      }

      this._recordActivity({
        agentInstanceId: instance_id,
        sessionId: session_id,
        taskId: task_id,
        activityType: 'execution.cancelled',
        description: `Execution cancelled: ${reason}`,
        metadata: payload,
        occurredAt: occurred_at
      });
      return;
    }

    // I. Execution Steered (from run.steered SSE event - human intervention)
    if (event_type === 'agent.execution.steered') {
      const steerReason = payload.reason || payload.message || 'Execution steered by human';

      if (instance_id) {
        this.agentRepo.updateInstanceStatus(instance_id, 'waiting');
        eventPublisher.publishAgentStatus(instance_id, 'waiting', { reason: 'steered' });
      }

      if (task_id) {
        this.taskRepo.updateTaskStatus(task_id, 'waiting', `Steered: ${steerReason}`);
        const steeredTask = this.taskRepo.getTaskById(task_id);
        eventPublisher.publishTaskStatus(steeredTask);
      }

      this._recordActivity({
        agentInstanceId: instance_id,
        sessionId: session_id,
        taskId: task_id,
        activityType: 'execution.steered',
        description: `Execution steered: ${steerReason}`,
        metadata: payload,
        occurredAt: occurred_at
      });
      return;
    }

    // J. Approval Requested
    if (event_type === 'agent.approval.requested') {
      if (instance_id) {
        this.agentRepo.updateInstanceStatus(instance_id, 'waiting');
        eventPublisher.publishAgentStatus(instance_id, 'waiting', { reason: 'approval_required' });
      }

      if (task_id) {
        const updatedTask = this.taskRepo.getTaskById(task_id);
        eventPublisher.publishTaskStatus(updatedTask);
      }

      this._recordActivity({
        agentInstanceId: instance_id,
        sessionId: session_id,
        taskId: task_id,
        activityType: 'approval.requested',
        description: `Approval requested: ${payload.description || payload.action_type || 'Sensitive operation'}`,
        metadata: payload,
        occurredAt: occurred_at
      });
      return;
    }

    // K. Approval Resolved
    if (event_type === 'agent.approval.resolved') {
      const approved = payload.approved === true || payload.decision === 'approved';

      if (approved) {
        if (instance_id) {
          this.agentRepo.updateInstanceStatus(instance_id, 'working');
          eventPublisher.publishAgentStatus(instance_id, 'working');
        }
        if (task_id) {
          this.taskRepo.updateTaskStatus(task_id, 'running');
          const task = this.taskRepo.getTaskById(task_id);
          eventPublisher.publishTaskStatus(task);
        }
      } else {
        if (instance_id) {
          this.agentRepo.updateInstanceStatus(instance_id, 'idle');
          eventPublisher.publishAgentStatus(instance_id, 'idle');
        }
        if (task_id) {
          this.taskRepo.updateTaskStatus(task_id, 'cancelled', 'Approval denied');
          const task = this.taskRepo.getTaskById(task_id);
          eventPublisher.publishTaskStatus(task);
        }
      }

      this._recordActivity({
        agentInstanceId: instance_id,
        sessionId: session_id,
        taskId: task_id,
        activityType: approved ? 'approval.approved' : 'approval.denied',
        description: approved ? 'Approval granted, execution resumed' : 'Approval denied, execution cancelled',
        metadata: payload,
        occurredAt: occurred_at
      });
      return;
    }

    // L. Subagent Exited
    if (event_type === 'agent.subagent.exited') {
      if (instance_id) {
        this.agentRepo.updateInstanceStatus(instance_id, 'working');
        eventPublisher.publishAgentStatus(instance_id, 'working');
      }

      this._recordActivity({
        agentInstanceId: instance_id,
        sessionId: session_id,
        taskId: task_id,
        activityType: 'subagent.exited',
        description: `Subagent finished: ${payload.subagent_role || payload.subagent_name || 'unknown'}`,
        metadata: payload,
        occurredAt: occurred_at
      });
      return;
    }
  }

  // agent_activities.agent_instance_id adalah NOT NULL — tanpa instance yang
  // dikenal, aktivitas tidak bisa dicatat; log dan lewati (bukan gagal).
  _recordActivity(activity) {
    if (!activity.agentInstanceId) {
      logger.warn({ activityType: activity.activityType }, 'Activity not recorded: agent instance unknown');
      return;
    }
    this.activityRepo.recordActivity(activity);
  }

  _reconcileParentTask(parentTaskId) {
    const pending = this.db.prepare(
      "SELECT count(*) as count FROM agent_tasks WHERE parent_task_id = ? AND status != 'completed'"
    ).get(parentTaskId);

    if (pending.count === 0) {
      logger.info({ parentTaskId }, 'All child subtasks completed. Marking parent task completed.');
      this.taskRepo.updateTaskStatus(parentTaskId, 'completed', 'All child subtasks successfully reconciled.');
      const parentTask = this.taskRepo.getTaskById(parentTaskId);
      eventPublisher.publishTaskStatus(parentTask);
    }
  }
}

export default StateReconciler;
