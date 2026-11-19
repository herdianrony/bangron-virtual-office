import { generateId } from '../../utils/crypto.js';

export class ApprovalRepository {
  constructor(db) {
    this.db = db;
  }

  getAllApprovals(filters = {}) {
    let query = `
      SELECT 
        a.*,
        ai.display_name as requested_by_agent_name,
        ap.department as agent_department,
        t.title as task_title,
        u.name as reviewed_by_name
      FROM approval_requests a
      JOIN agent_instances ai ON a.requested_by = ai.id
      JOIN agent_profiles ap ON ai.profile_id = ap.id
      LEFT JOIN agent_tasks t ON a.task_id = t.id
      LEFT JOIN users u ON a.reviewed_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.status) {
      query += ' AND a.status = ?';
      params.push(filters.status);
    }

    query += ' ORDER BY CASE a.status WHEN "pending" THEN 1 ELSE 2 END, a.created_at DESC';
    return this.db.prepare(query).all(...params);
  }

  getApprovalById(id) {
    return this.db.prepare(`
      SELECT 
        a.*,
        ai.display_name as requested_by_agent_name,
        ap.department as agent_department,
        t.title as task_title,
        u.name as reviewed_by_name
      FROM approval_requests a
      JOIN agent_instances ai ON a.requested_by = ai.id
      JOIN agent_profiles ap ON ai.profile_id = ap.id
      LEFT JOIN agent_tasks t ON a.task_id = t.id
      LEFT JOIN users u ON a.reviewed_by = u.id
      WHERE a.id = ?
    `).get(id);
  }

  reviewApproval(id, { status, reviewedBy, reviewNotes = '' }) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE approval_requests SET
        status = ?, reviewed_by = ?, reviewed_at = ?, review_notes = ?, updated_at = ?
      WHERE id = ?
    `).run(status, reviewedBy, now, reviewNotes, now, id);

    return this.getApprovalById(id);
  }
}

export default ApprovalRepository;
