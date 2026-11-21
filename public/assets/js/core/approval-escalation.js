/**
 * Approval Escalation Timer - Auto-reject pending approvals after 24h
 * Tracks pending approvals, shows countdown, auto-rejects on expiry
 */

export class ApprovalEscalationTimer {
  constructor(options = {}) {
    this.checkIntervalMs = options.checkIntervalMs || 60 * 1000; // Check every minute
    this.autoRejectAfterHours = options.autoRejectAfterHours || 24;
    this.timerId = null;
    this.onAutoReject = options.onAutoReject || (() => {});
    this.pendingApprovals = []; // { id, created_at, title, risk }
  }

  start(pendingApprovals = []) {
    this.pendingApprovals = pendingApprovals;
    this.stop();
    this.timerId = setInterval(() => this.checkExpirations(), this.checkIntervalMs);
    // Initial check
    this.checkExpirations();
  }

  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  checkExpirations() {
    const now = Date.now();
    const threshold = now - (this.autoRejectAfterHours * 60 * 60 * 1000);

    const expired = this.pendingApprovals.filter((a) => {
      const created = new Date(a.created_at).getTime();
      return created < threshold;
    });

    if (expired.length > 0) {
      console.log(`[ApprovalEscalation] ${expired.length} approval(s) expired auto-reject threshold`);
      expired.forEach((a) => {
        this.onAutoReject(a.id, a.title || 'Approval');
      });
      // Remove expired from tracking
      this.pendingApprovals = this.pendingApprovals.filter((a) => !expired.includes(a));
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