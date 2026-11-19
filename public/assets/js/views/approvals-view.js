import { api } from '../core/api.js';

export class ApprovalsView {
  constructor(container) {
    this.container = container;
  }

  async render() {
    this.container.innerHTML = `
      <div class="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-base-content/10">
          <div>
            <h2 class="text-2xl font-bold tracking-tight text-base-content flex items-center gap-2.5">
              <i class="fi fi-rr-shield-check text-warning text-xl"></i>
              Director Authorization & Approvals Center
            </h2>
            <p class="text-xs text-base-content/60 mt-1">Enforce human-in-the-loop governance over high-risk actions, sensitive deployments, and external mutations.</p>
          </div>
        </div>

        <!-- Filter Tabs with DaisyUI Join -->
        <div class="flex items-center gap-2">
          <span class="text-xs text-base-content/60 font-bold uppercase tracking-wider mr-2">Status:</span>
          <div class="join shadow-sm border border-base-content/10 bg-base-200 p-1">
            <button class="btn btn-xs join-item approval-filter-btn active btn-primary" data-status="pending">Pending Review</button>
            <button class="btn btn-xs join-item approval-filter-btn btn-ghost" data-status="approved">Approved</button>
            <button class="btn btn-xs join-item approval-filter-btn btn-ghost" data-status="rejected">Rejected</button>
            <button class="btn btn-xs join-item approval-filter-btn btn-ghost" data-status="all">All</button>
          </div>
        </div>

        <div id="approvals-list" class="space-y-4">
          <div class="text-base-content/50 text-xs py-8 text-center">Loading pending approval requests...</div>
        </div>
      </div>
    `;

    this.initEvents();
    await this.loadApprovals('pending');
  }

  async loadApprovals(filterStatus = 'pending') {
    try {
      const list = await api.get('/api/approvals');
      const container = document.getElementById('approvals-list');
      if (!container) return;

      const filtered = filterStatus === 'all'
        ? list
        : list.filter((a) => a.status === filterStatus);

      // Update Top Nav Badge count if pending
      const pendingCount = list.filter((a) => a.status === 'pending').length;
      const navBadge = document.getElementById('nav-pending-badge');
      if (navBadge) {
        navBadge.innerText = pendingCount;
        navBadge.classList.toggle('hidden', pendingCount === 0);
      }

      if (filtered.length === 0) {
        container.innerHTML = `
          <div class="card bg-base-200 border border-base-content/10 p-8 text-center shadow-lg rounded-box space-y-2">
            <div class="text-success text-3xl">
              <i class="fi fi-rr-badge-check"></i>
            </div>
            <div class="font-bold text-base-content text-sm">All Clear — No ${filterStatus} Requests</div>
            <p class="text-xs text-base-content/60">All agent actions have been resolved or are within safe operating policy bounds.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = filtered.map((item) => {
        let payloadObj = {};
        try { payloadObj = JSON.parse(item.payload_json || '{}'); } catch {}

        const isPending = item.status === 'pending';

        return `
          <div class="card bg-base-200 border ${isPending ? 'border-warning/60 shadow-xl ring-1 ring-warning/20' : 'border-base-content/10 shadow-lg'} rounded-box overflow-hidden">
            <div class="card-body p-5 space-y-4">
              <div class="flex items-start justify-between gap-4">
                <div class="space-y-1">
                  <div class="flex items-center gap-2">
                    <span class="badge ${this.getRiskBadgeClass(item.risk_level)} badge-xs uppercase font-bold font-mono">
                      ${item.risk_level} RISK
                    </span>
                    <span class="font-bold text-base-content text-base">${item.action_type}</span>
                  </div>
                  <p class="text-xs text-base-content/80">${item.reason || 'Agent requested execution requiring Director authorization.'}</p>
                </div>
                <div>
                  <span class="badge badge-sm font-mono ${item.status === 'approved' ? 'badge-success' : item.status === 'rejected' ? 'badge-error' : 'badge-warning'}">
                    ${item.status}
                  </span>
                </div>
              </div>

              <!-- Context Specs -->
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-base-300/50 p-3 rounded-lg border border-base-content/10">
                <div>
                  <span class="text-base-content/60 block text-[11px]">Requesting Agent</span>
                  <strong class="text-base-content">${item.agent_name || 'System Orchestrator'}</strong>
                </div>
                <div>
                  <span class="text-base-content/60 block text-[11px]">Related Task</span>
                  <span class="text-info truncate block font-medium">${item.task_title || 'General Pipeline'}</span>
                </div>
                <div>
                  <span class="text-base-content/60 block text-[11px]">Project</span>
                  <span class="text-base-content/80 block">${item.project_name || 'Studio General'}</span>
                </div>
                <div>
                  <span class="text-base-content/60 block text-[11px]">Timestamp</span>
                  <span class="text-base-content/60 font-mono text-[11px] block">${item.created_at ? new Date(item.created_at).toLocaleString() : '-'}</span>
                </div>
              </div>

              <!-- Action Payload Collapse Accordion -->
              <div tabindex="0" class="collapse collapse-arrow bg-base-300/40 border border-base-content/10 rounded-lg text-xs">
                <div class="collapse-title font-semibold text-base-content/80 py-2 min-h-0 text-xs">
                  Inspect Parameter Payload & Command Spec
                </div>
                <div class="collapse-content">
                  <pre class="bg-base-300 p-3 rounded-lg text-[11px] font-mono text-primary overflow-x-auto border border-base-content/10 mt-1">${JSON.stringify(payloadObj, null, 2)}</pre>
                </div>
              </div>

              ${isPending ? `
                <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-base-content/10">
                  <input type="text" class="input input-bordered input-sm bg-base-100 border-base-content/20 text-xs text-base-content flex-1" id="review-notes-${item.id}" placeholder="Optional Director review notes or rationale..." />
                  <div class="flex items-center gap-2">
                    <button class="btn btn-error btn-sm gap-1.5 btn-reject shadow" data-id="${item.id}">
                      <i class="fi fi-rr-cross-small text-sm"></i>
                      <span>Reject</span>
                    </button>
                    <button class="btn btn-success btn-sm gap-1.5 btn-approve shadow" data-id="${item.id}">
                      <i class="fi fi-rr-check text-sm"></i>
                      <span>Authorize Execution</span>
                    </button>
                  </div>
                </div>
              ` : `
                <div class="pt-2 text-xs text-base-content/60 border-t border-base-content/10 flex justify-between">
                  <span>Reviewed by: <strong class="text-base-content">${item.reviewed_by_name || 'Director'}</strong></span>
                  <span class="italic">${item.review_notes ? `Notes: "${item.review_notes}"` : 'No review notes.'}</span>
                </div>
              `}
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load approvals:', err);
    }
  }

  getRiskBadgeClass(risk) {
    switch (risk) {
      case 'critical': return 'badge-error';
      case 'high': return 'badge-warning';
      case 'medium': return 'badge-info';
      default: return 'badge-ghost';
    }
  }

  initEvents() {
    // Status filters
    document.querySelectorAll('.approval-filter-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.approval-filter-btn').forEach((b) => {
          b.classList.remove('active', 'btn-primary');
          b.classList.add('btn-ghost');
        });
        e.target.classList.add('active', 'btn-primary');
        e.target.classList.remove('btn-ghost');
        this.loadApprovals(e.target.dataset.status);
      });
    });

    // Handle Approve / Reject
    this.container.addEventListener('click', async (e) => {
      const approveBtn = e.target.closest('.btn-approve');
      if (approveBtn) {
        const id = approveBtn.dataset.id;
        const notes = document.getElementById(`review-notes-${id}`)?.value || 'Approved by Director via console';
        await api.post(`/api/approvals/${id}/approve`, { notes });
        await this.loadApprovals('pending');
      }

      const rejectBtn = e.target.closest('.btn-reject');
      if (rejectBtn) {
        const id = rejectBtn.dataset.id;
        const notes = document.getElementById(`review-notes-${id}`)?.value || 'Rejected by Director via console';
        await api.post(`/api/approvals/${id}/reject`, { notes });
        await this.loadApprovals('pending');
      }
    });
  }

  destroy() {}
}

export default ApprovalsView;
