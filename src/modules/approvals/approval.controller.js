import { ApprovalService } from './approval.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export class ApprovalController {
  constructor() {
    this.approvalService = new ApprovalService();
  }

  getAll = (req, res) => {
    try {
      const approvals = this.approvalService.getAll({ status: req.query.status });
      return sendSuccess(res, approvals);
    } catch (err) {
      return sendError(res, 'APPROVALS_FETCH_ERROR', err.message, [], 500);
    }
  };

  getById = (req, res) => {
    try {
      const approval = this.approvalService.getById(req.params.id);
      if (!approval) {
        return sendError(res, 'NOT_FOUND', 'Approval request not found', [], 404);
      }
      return sendSuccess(res, approval);
    } catch (err) {
      return sendError(res, 'APPROVAL_FETCH_ERROR', err.message, [], 500);
    }
  };

  approve = (req, res) => {
    try {
      const { reviewNotes } = req.body || {};
      const reviewerId = req.user ? req.user.id : null;
      const updated = this.approvalService.approve(req.params.id, reviewerId, reviewNotes);
      return sendSuccess(res, updated, 'Approval request approved');
    } catch (err) {
      return sendError(res, 'APPROVAL_ERROR', err.message, [], 400);
    }
  };

  reject = (req, res) => {
    try {
      const { reviewNotes } = req.body || {};
      const reviewerId = req.user ? req.user.id : null;
      const updated = this.approvalService.reject(req.params.id, reviewerId, reviewNotes);
      return sendSuccess(res, updated, 'Approval request rejected');
    } catch (err) {
      return sendError(res, 'APPROVAL_ERROR', err.message, [], 400);
    }
  };
}

export const approvalController = new ApprovalController();
export default approvalController;
