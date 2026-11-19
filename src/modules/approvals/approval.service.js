import { getDatabase } from '../../database/connection.js';
import { ApprovalRepository } from '../../database/repositories/approval.repository.js';
import { TaskRepository } from '../../database/repositories/task.repository.js';
import { AgentRepository } from '../../database/repositories/agent.repository.js';
import { AuditRepository } from '../../database/repositories/audit.repository.js';
import { eventPublisher } from '../../realtime/event-publisher.js';

export class ApprovalService {
  constructor(db = null) {
    this.db = db || getDatabase();
    this.approvalRepo = new ApprovalRepository(this.db);
    this.taskRepo = new TaskRepository(this.db);
    this.agentRepo = new AgentRepository(this.db);
    this.auditRepo = new AuditRepository(this.db);
  }

  getAll(filters = {}) {
    return this.approvalRepo.getAllApprovals(filters);
  }

  getById(id) {
    return this.approvalRepo.getApprovalById(id);
  }

  approve(id, reviewerId, reviewNotes = 'Approved by Director') {
    const approval = this.approvalRepo.getApprovalById(id);
    if (!approval) throw new Error('Approval request not found');
    if (approval.status !== 'pending') {
      throw new Error(`Approval request is already ${approval.status}`);
    }

    const updated = this.approvalRepo.reviewApproval(id, {
      status: 'approved',
      reviewedBy: reviewerId,
      reviewNotes
    });

    // Release task and agent if linked
    if (approval.task_id) {
      this.taskRepo.updateTaskStatus(approval.task_id, 'running', 'Approved by Director');
      const task = this.taskRepo.getTaskById(approval.task_id);
      eventPublisher.publishTaskStatus(task);
    }

    if (approval.requested_by) {
      this.agentRepo.updateInstanceStatus(approval.requested_by, 'working');
      eventPublisher.publishAgentStatus(approval.requested_by, 'working');
    }

    this.auditRepo.log({
      userId: reviewerId,
      actorType: 'user',
      actorId: String(reviewerId),
      action: 'approval.approved',
      resourceType: 'approval_request',
      resourceId: id,
      after: updated
    });

    eventPublisher.publishApprovalUpdate(updated);
    return updated;
  }

  reject(id, reviewerId, reviewNotes = 'Rejected by Director') {
    const approval = this.approvalRepo.getApprovalById(id);
    if (!approval) throw new Error('Approval request not found');
    if (approval.status !== 'pending') {
      throw new Error(`Approval request is already ${approval.status}`);
    }

    const updated = this.approvalRepo.reviewApproval(id, {
      status: 'rejected',
      reviewedBy: reviewerId,
      reviewNotes
    });

    if (approval.task_id) {
      this.taskRepo.updateTaskStatus(approval.task_id, 'cancelled', `Operation rejected: ${reviewNotes}`);
      const task = this.taskRepo.getTaskById(approval.task_id);
      eventPublisher.publishTaskStatus(task);
    }

    if (approval.requested_by) {
      this.agentRepo.updateInstanceStatus(approval.requested_by, 'idle');
      eventPublisher.publishAgentStatus(approval.requested_by, 'idle');
    }

    this.auditRepo.log({
      userId: reviewerId,
      actorType: 'user',
      actorId: String(reviewerId),
      action: 'approval.rejected',
      resourceType: 'approval_request',
      resourceId: id,
      after: updated
    });

    eventPublisher.publishApprovalUpdate(updated);
    return updated;
  }
}

export default ApprovalService;
