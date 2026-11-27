import { api } from '../core/api.js';
import { themeManager } from '../core/theme-manager.js';
import { showToast } from '../core/toast.js';

export class SettingsView {
  constructor(container) {
    this.container = container;
    this.status = null;
    this.themeUnsubscribe = null;
  }

  render() {
    this.container.innerHTML = `
      <div class="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="btn btn-square btn-primary no-animation pointer-events-none">
              <i class="fi fi-rr-settings-sliders text-lg"></i>
            </div>
            <div>
              <h2 class="text-2xl font-bold tracking-tight">Hermes Control Plane</h2>
              <p class="text-xs text-base-content/60">API Server surfaces, runtime capabilities, governance, and demo state.</p>
            </div>
          </div>
          <div class="join">
            <button class="btn btn-outline btn-sm join-item" id="btn-ping-hermes">
              <i class="fi fi-rr-refresh text-xs"></i><span>Refresh</span>
              <span class="loading loading-spinner loading-xs hidden" id="ping-spinner"></span>
            </button>
            <button class="btn btn-primary btn-sm join-item" id="btn-export-status">
              <i class="fi fi-rr-download text-xs"></i><span>Export JSON</span>
            </button>
          </div>
        </div>

        <!-- Runtime KPI stats (DaisyUI stats) -->
        <div class="stats stats-vertical lg:stats-horizontal shadow-xl bg-base-200 border border-base-content/10 w-full">
          <div class="stat">
            <div class="stat-title">Runtime</div>
            <div class="stat-value text-xl" id="stat-runtime"><span class="loading loading-dots loading-sm"></span></div>
            <div class="stat-desc" id="stat-runtime-desc">GET /v1/models</div>
          </div>
          <div class="stat">
            <div class="stat-title">Readiness</div>
            <div class="stat-value text-xl" id="stat-health">—</div>
            <div class="stat-desc" id="stat-health-desc">GET /health/detailed</div>
          </div>
          <div class="stat">
            <div class="stat-title">Capabilities</div>
            <div class="stat-value text-xl" id="stat-caps">—</div>
            <div class="stat-desc">GET /v1/capabilities</div>
          </div>
          <div class="stat">
            <div class="stat-title">Models / Sessions</div>
            <div class="stat-value text-xl" id="stat-models">—</div>
            <div class="stat-desc">/api/model/options · /api/sessions</div>
          </div>
        </div>

        <!-- Tabs: DaisyUI tabs + tab-content -->
        <div role="tablist" aria-label="Hermes API Server surfaces" class="tabs tabs-border">
          <input type="radio" name="hermes-tabs" class="tab" aria-label="Overview" checked />
          <div class="tab-content border-base-300 bg-base-100 p-5 rounded-box" role="tabpanel">
            <div class="flex flex-wrap gap-2 mb-4" id="capability-badges"></div>
            <div role="alert" class="alert alert-info text-xs">
              <i class="fi fi-rr-info text-base"></i>
              <span><strong>Integration Rule:</strong> Saat runtime tidak terverifikasi, semua operasi otonom berjalan via adapter simulasi. Flag produksi: <code class="badge badge-ghost badge-sm">HERMES_RUNTIME_VERIFIED</code>.</span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div class="form-control">
                <label class="label"><span class="label-text text-xs font-semibold">Inbound Webhook URL</span></label>
                <div class="join">
                  <input type="text" readonly class="input input-bordered input-sm join-item flex-1 font-mono text-xs" value="https://studio.bangron.my.id/api/integrations/hermes/events" />
                  <button class="btn btn-outline btn-sm join-item" data-copy="https://studio.bangron.my.id/api/integrations/hermes/events" title="Copy"><i class="fi fi-rr-copy text-xs"></i></button>
                </div>
              </div>
              <div class="form-control">
                <label class="label"><span class="label-text text-xs font-semibold">Verification Endpoint</span></label>
                <div class="join">
                  <input type="text" readonly class="input input-bordered input-sm join-item flex-1 font-mono text-xs" value="/api/integrations/hermes/status" />
                  <button class="btn btn-outline btn-sm join-item" data-copy="/api/integrations/hermes/status" title="Copy"><i class="fi fi-rr-copy text-xs"></i></button>
                </div>
              </div>
            </div>
            <div class="form-control mt-4 max-w-md">
              <label class="label"><span class="label-text text-xs font-semibold">HMAC Webhook Secret</span></label>
              <div class="join">
                <input type="password" id="webhook-secret-input" class="input input-bordered input-sm join-item flex-1 font-mono text-xs" value="hermes_shared_webhook_secret_key_bangron_2026" />
                <button class="btn btn-outline btn-sm join-item" id="btn-toggle-secret">Show</button>
              </div>
            </div>
          </div>

          <input type="radio" name="hermes-tabs" class="tab" aria-label="Models" />
          <div class="tab-content border-base-300 bg-base-100 p-5 rounded-box" role="tabpanel">
            <div class="overflow-x-auto">
              <table class="table table-zebra table-sm">
                <thead><tr><th>Model</th><th>Provider</th><th>Status</th></tr></thead>
                <tbody id="models-tbody"><tr><td colspan="3"><span class="loading loading-dots loading-sm"></span></td></tr></tbody>
              </table>
            </div>
          </div>

          <input type="radio" name="hermes-tabs" class="tab" aria-label="Sessions" />
          <div class="tab-content border-base-300 bg-base-100 p-5 rounded-box" role="tabpanel">
            <div class="flex items-center gap-2 mb-3">
              <span class="badge badge-primary badge-sm" id="sessions-count">0</span>
              <span class="text-xs text-base-content/60">API-server sessions (REST)</span>
            </div>
            <div class="overflow-x-auto">
              <table class="table table-zebra table-sm">
                <thead><tr><th>Session</th><th>Source</th><th>Updated</th></tr></thead>
                <tbody id="sessions-tbody"><tr><td colspan="3"><span class="loading loading-dots loading-sm"></span></td></tr></tbody>
              </table>
            </div>
          </div>

          <input type="radio" name="hermes-tabs" class="tab" aria-label="Jobs" />
          <div class="tab-content border-base-300 bg-base-100 p-5 rounded-box" role="tabpanel">
            <div class="flex justify-between items-center mb-3">
              <span class="text-xs text-base-content/60">Hermes Jobs API — source of truth di Hermes, office hanya proxy.</span>
              <button class="btn btn-outline btn-xs" id="btn-refresh-jobs"><i class="fi fi-rr-refresh text-xs"></i> Refresh</button>
            </div>
            <div class="overflow-x-auto">
              <table class="table table-zebra table-sm">
                <thead><tr><th>Job</th><th>Schedule</th><th>State</th><th>Actions</th></tr></thead>
                <tbody id="jobs-tbody"><tr><td colspan="4"><span class="loading loading-dots loading-sm"></span></td></tr></tbody>
              </table>
            </div>
            <div class="collapse collapse-arrow bg-base-200 rounded-box mt-4">
              <input type="checkbox" />
              <div class="collapse-title text-sm font-medium">Buat job baru (POST /v1/jobs via proxy)</div>
              <div class="collapse-content">
                <form id="job-form" class="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <div class="form-control"><label class="label"><span class="label-text text-xs">Prompt</span></label><input name="prompt" class="input input-bordered input-sm" required /></div>
                  <div class="form-control"><label class="label"><span class="label-text text-xs">Schedule (cron)</span></label><input name="schedule" class="input input-bordered input-sm" value="0 9 * * *" required /></div>
                  <button class="btn btn-primary btn-sm" type="submit">Create Job</button>
                </form>
              </div>
            </div>
          </div>

          <input type="radio" name="hermes-tabs" class="tab" aria-label="Governance" />
          <div class="tab-content border-base-300 bg-base-100 p-5 rounded-box" role="tabpanel">
            <div class="form-control">
              <label class="cursor-pointer label justify-start gap-3">
                <input type="checkbox" checked disabled class="checkbox checkbox-primary checkbox-sm" />
                <span class="text-sm">Strict Director Authority Override <span class="badge badge-ghost badge-xs">locked</span></span>
              </label>
            </div>
            <div class="form-control">
              <label class="cursor-pointer label justify-start gap-3">
                <input type="checkbox" checked disabled class="checkbox checkbox-primary checkbox-sm" />
                <span class="text-sm">Approval required for production deployments & shell execution</span>
              </label>
            </div>
            <div class="divider"></div>
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <i class="fi fi-rr-moon text-primary text-lg"></i>
                <div><strong class="text-sm block">System Theme Detection</strong><span class="text-xs text-base-content/60" id="theme-current">System</span></div>
              </div>
              <div class="flex items-center gap-2">
                <button class="btn btn-ghost btn-sm" id="btn-theme-toggle" title="Toggle theme"><i class="fi fi-rr-sun"></i></button>
                <select class="select select-bordered select-sm" id="theme-select" aria-label="Theme preference">
                  <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
                </select>
              </div>
            </div>
          </div>

          <input type="radio" name="hermes-tabs" class="tab" aria-label="Demo State" />
          <div class="tab-content border-base-300 bg-base-100 p-5 rounded-box" role="tabpanel">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p class="text-xs text-base-content/60">Reset office rooms, agent positions, task board, and seed data.</p>
              <button class="btn btn-error btn-sm" id="btn-reset-state"><i class="fi fi-rr-trash text-xs"></i> Reset Demo State</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.initEvents();
    this.initThemeToggle();
    this.loadStatus();
  }

  async loadStatus() {
    try {
      const res = await api.get('/api/integrations/hermes/status');
      this.status = res;
      const runtime = res.runtime || {};
      const caps = res.capabilities?.features || {};
      const health = res.health || {};

      this.setText('stat-runtime', runtime.status || 'UNKNOWN');
      this.setClass('stat-runtime', runtime.connected ? 'text-success' : 'text-error');
      this.setText('stat-runtime-desc', (runtime.models || []).length + ' model(s) advertised');
      this.setText('stat-health', (health.status || '—').toUpperCase());
      this.setClass('stat-health', health.status === 'ok' ? 'text-success' : 'text-warning');
      this.setText('stat-health-desc', 'readiness: ' + (health.readiness || 'unknown'));
      this.setText('stat-caps', String(Object.values(caps).filter(Boolean).length));
      this.setText('stat-models', `${(res.models || []).length} / ${res.sessions?.total || 0}`);

      const badge = document.getElementById('hermes-badge');
      if (badge) {
        badge.innerText = runtime.status || 'UNKNOWN';
        badge.className = `badge badge-sm font-mono ${runtime.connected ? 'badge-success' : 'badge-error'}`;
      }

      const capBox = document.getElementById('capability-badges');
      if (capBox) {
        capBox.innerHTML = Object.entries(caps).map(([k, v]) =>
          `<span class="tooltip" data-tip="${k}"><span class="badge badge-sm ${v ? 'badge-success' : 'badge-ghost'}">${k}</span></span>`
        ).join('');
      }

      this.renderModels(res.models || []);
      this.renderSessions(res.sessions?.recent || []);
      this.renderJobs(res.jobs || []);
    } catch (err) {
      showToast('error', `Gagal memuat status Hermes: ${err.message}`);
    }
  }

  setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
  setClass(id, cls) { const el = document.getElementById(id); if (el) el.className = `stat-value text-xl ${cls}`; }

  renderModels(models) {
    const tb = document.getElementById('models-tbody');
    if (!tb) return;
    tb.innerHTML = models.length
      ? models.map((m) => `<tr><td class="font-mono text-xs">${m.id}</td><td>${m.provider || '—'}</td><td><span class="badge badge-success badge-sm">active</span></td></tr>`).join('')
      : `<tr><td colspan="3" class="text-center text-base-content/60">No models advertised</td></tr>`;
  }

  renderSessions(sessions) {
    const tb = document.getElementById('sessions-tbody');
    if (!tb) return;
    this.setText('sessions-count', String(this.status?.sessions?.total || 0));
    tb.innerHTML = sessions.length
      ? sessions.map((s) => `<tr><td class="font-mono text-xs">${s.id}</td><td>${s.source || 'api'}</td><td class="text-xs">${s.updated_at ? new Date(s.updated_at).toLocaleString() : '—'}</td></tr>`).join('')
      : `<tr><td colspan="3" class="text-center text-base-content/60">No API sessions</td></tr>`;
  }

  renderJobs(jobs) {
    const tb = document.getElementById('jobs-tbody');
    if (!tb) return;
    tb.innerHTML = jobs.length
      ? jobs.map((j) => `<tr>
          <td class="font-mono text-xs">${j.id}</td>
          <td class="font-mono text-xs">${j.schedule || '—'}</td>
          <td><span class="badge badge-sm ${j.enabled === false ? 'badge-ghost' : 'badge-primary'}">${j.enabled === false ? 'paused' : 'active'}</span></td>
          <td><div class="join">
            <button class="btn btn-xs join-item" data-job="${j.id}" data-action="run" title="Run now"><i class="fi fi-rr-play"></i></button>
            <button class="btn btn-xs join-item" data-job="${j.id}" data-action="pause" title="Pause"><i class="fi fi-rr-pause"></i></button>
            <button class="btn btn-xs join-item" data-job="${j.id}" data-action="resume" title="Resume"><i class="fi fi-rr-play"></i></button>
            <button class="btn btn-xs btn-error join-item" data-job="${j.id}" data-action="delete" title="Delete"><i class="fi fi-rr-trash"></i></button>
          </div></td>
        </tr>`).join('')
      : `<tr><td colspan="4" class="text-center text-base-content/60">No scheduled jobs</td></tr>`;
  }

  initEvents() {
    document.getElementById('btn-toggle-secret')?.addEventListener('click', (e) => {
      const input = document.getElementById('webhook-secret-input');
      input.type = input.type === 'password' ? 'text' : 'password';
      e.target.textContent = input.type === 'password' ? 'Show' : 'Hide';
    });

    document.getElementById('btn-ping-hermes')?.addEventListener('click', async () => {
      const sp = document.getElementById('ping-spinner');
      sp?.classList.remove('hidden');
      await this.loadStatus();
      sp?.classList.add('hidden');
      showToast('success', 'Status Hermes diperbarui');
    });

    document.getElementById('btn-export-status')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(this.status || {}, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'hermes-api-status.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    document.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await navigator.clipboard?.writeText(btn.dataset.copy);
        showToast('success', 'Disalin ke clipboard');
      });
    });

    document.getElementById('btn-refresh-jobs')?.addEventListener('click', async () => {
      const res = await api.get('/api/integrations/hermes/jobs');
      this.renderJobs(res.jobs || []);
    });

    document.getElementById('job-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api.post('/api/integrations/hermes/jobs', { prompt: f.get('prompt'), schedule: f.get('schedule') });
        showToast('success', 'Job dibuat di Hermes');
        e.target.reset();
        const res = await api.get('/api/integrations/hermes/jobs');
        this.renderJobs(res.jobs || []);
      } catch (err) { showToast('error', err.message); }
    });

    document.getElementById('jobs-tbody')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-job]');
      if (!btn) return;
      const { job, action } = btn.dataset;
      try {
        if (action === 'delete') await api.delete(`/api/integrations/hermes/jobs/${job}`);
        else await api.post(`/api/integrations/hermes/jobs/${job}/${action}`);
        showToast('success', `Job ${action} berhasil`);
        const res = await api.get('/api/integrations/hermes/jobs');
        this.renderJobs(res.jobs || []);
      } catch (err) { showToast('error', err.message); }
    });

    document.getElementById('btn-reset-state')?.addEventListener('click', async () => {
      if (confirm('Reset demo state? Tasks dan posisi agent akan di-seed ulang.')) {
        await api.post('/api/demo/reset');
        showToast('success', 'Demo state di-reset');
      }
    });
  }

  initThemeToggle() {
    const select = document.getElementById('theme-select');
    const currentEl = document.getElementById('theme-current');
    const btn = document.getElementById('btn-theme-toggle');
    if (select) {
      select.value = themeManager.currentTheme;
      select.addEventListener('change', (e) => { themeManager.setTheme(e.target.value); this.updateThemeUI(); });
    }
    btn?.addEventListener('click', () => { themeManager.toggleTheme(); this.updateThemeUI(); });
    this.themeUnsubscribe = themeManager.subscribe(() => this.updateThemeUI());
    this.updateThemeUI();
  }

  updateThemeUI() {
    const select = document.getElementById('theme-select');
    const currentEl = document.getElementById('theme-current');
    const btn = document.getElementById('btn-theme-toggle');
    const effective = themeManager.getEffectiveTheme();
    const current = themeManager.currentTheme;
    if (select) select.value = current;
    if (currentEl) currentEl.textContent = current === 'system' ? `System (${effective})` : effective;
    if (btn) btn.title = `Current: ${effective}. Click to toggle.`;
  }

  destroy() { if (this.themeUnsubscribe) this.themeUnsubscribe(); }
}

export default SettingsView;
