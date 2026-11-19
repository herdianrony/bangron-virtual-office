import { isActionSensitive } from '../policies/approval-policies.js';
import { generateId } from '../utils/crypto.js';
import logger from '../utils/logger.js';

export class PolicyEngine {
  constructor(db) {
    this.db = db;
  }

  /**
   * Evaluates if an agent action requires Director approval.
   * If yes, creates a pending approval_request in the database and returns it.
   */
  evaluateAction({ taskId, agentInstanceId, actionType, description, payload = {} }) {
    const policy = isActionSensitive(actionType);

    if (!policy) {
      return {
        requiresApproval: false,
        approvalRequest: null
      };
    }

    const approvalId = generateId('appr');
    const now = new Date().toISOString();
    // Default expiration in 24 hours
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO approval_requests (
        id, task_id, requested_by, action_type, description, risk_level,
        payload_json, status, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `);

    stmt.run(
      approvalId,
      taskId || null,
      agentInstanceId,
      policy.type,
      description || policy.description,
      policy.riskLevel,
      JSON.stringify(payload),
      expiresAt,
      now,
      now
    );

    // If there is an active task, put it into 'waiting' status
    if (taskId) {
      this.db.prepare(
        "UPDATE agent_tasks SET status = 'waiting', requires_approval = 1, updated_at = ? WHERE id = ?"
      ).run(now, taskId);
    }

    logger.warn(
      { approvalId, actionType: policy.type, riskLevel: policy.riskLevel, taskId },
      'High-risk action intercepted; requires Director approval.'
    );

    return {
      requiresApproval: true,
      approvalRequest: {
        id: approvalId,
        actionType: policy.type,
        riskLevel: policy.riskLevel,
        status: 'pending',
        expiresAt
      }
    };
  }
}

export default PolicyEngine;
