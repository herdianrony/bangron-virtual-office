import { getDatabase } from '../../database/connection.js';
import { AuditRepository } from '../../database/repositories/audit.repository.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export class AuditController {
  constructor(db = null) {
    this.db = db || getDatabase();
    this.auditRepo = new AuditRepository(this.db);
  }

  getAll = (req, res) => {
    try {
      const limit = parseInt(req.query.limit || '100', 10);
      const logs = this.auditRepo.getRecentLogs(limit);
      return sendSuccess(res, logs);
    } catch (err) {
      return sendError(res, 'AUDIT_FETCH_ERROR', err.message, [], 500);
    }
  };
}

export const auditController = new AuditController();
export default auditController;
