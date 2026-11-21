/**
 * Approval Escalation Timer - Informational countdown only.
 *
 * Client-side automatic rejection is DISABLED. The countdown is shown to
 * the Director as informational UI only. No approval request is ever
 * silently rejected by a browser timer. If automatic expiry is required
 * as business policy, it must be implemented server-side with explicit
 * Director authorization.
 */

export class ApprovalEscalationTimer {
  constructor(options = {}) {
    this.checkIntervalMs = options.checkIntervalMs || 60 * 1000; // Check every minute
    this.autoRejectAfterHours = options.autoRejectAfterHours || 24;
    this.timerId = null;
    this.pendingApprovals = []; // { id, created_at, title, risk }
    this.autoRejectEnabled = false; // Client-side auto-reject is disabled by policy
  }

  start(pendingApprovals = []) {
    this.pendingApprovals = pendingApprovals;
    this.stop();
    // Timer runs only to refresh countdown UI, NOT to auto-reject
    this.timerId = setInterval(() => this.checkExpirations(), this.checkIntervalMs);
    this.checkExpirations();
  }

  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  checkExpirations() {
    // Informational only: log expired items but never auto-reject
    const now = Date.now();
    const threshold = now - (this.autoRejectAfterHours * 60 * 60 * 1000);

    const expired = this.pendingApprovals.filter((a) => {
      const created = new Date(a.created_at).getTime();
      return created < threshold;
    });

    if (expired.length > 0) {
      console.log(`[ApprovalEscalation] ${expired.length} approval(s) past 24h informational threshold (auto-reject disabled)`);
    }
  }

  updateApprovals(approvals) {
    this.pendingApprovals = approvals.filter((a) => a.status === 'pending' || a.status === 'open');
  }

  getTimeRemaining(approval) {
    const created = new Date(approval.created_at).getTime();
    const deadline = created + (this.autoRejectAfterHours * 60 * 60 * 1000);
    const remaining = deadline - Date.now();

    if (remaining <= 0) return { expired: true, hours: 0, minutes: 0 };

    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    return { expired: false, hours, minutes };
  }

  destroy() {
    this.stop();
    this.pendingApprovals = [];
  }
}

export const approvalEscalationTimer = new ApprovalEscalationTimer();
export default approvalEscalationTimer;