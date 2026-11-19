import { api } from '../core/api.js';

export class SettingsView {
  constructor(container) {
    this.container = container;
  }

  async render() {
    this.container.innerHTML = `
      <div class="p-4 sm:p-6 max-w-5xl mx-auto space-y-8">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-base-content/10">
          <div>
            <h2 class="text-2xl font-bold tracking-tight text-base-content flex items-center gap-2.5">
              <i class="fi fi-rr-settings-sliders text-primary text-xl"></i>
              System Configuration & Runtime Settings
            </h2>
            <p class="text-xs text-base-content/60 mt-1">Configure Hermes agent integration endpoints, security policies, and demo sandbox parameters.</p>
          </div>
        </div>

        <!-- Hermes Agent Runtime Integration Card -->
        <div class="card bg-base-200 border border-base-content/10 shadow-xl rounded-box overflow-hidden">
          <div class="card-body p-6 space-y-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-info/10 text-info flex items-center justify-center">
                  <i class="fi fi-rr-brain text-xl"></i>
                </div>
                <div>
                  <h3 class="font-bold text-base text-base-content">Hermes Agent Runtime Integration</h3>
                  <p class="text-xs text-base-content/60">External LLM orchestrator webhook bridge and capability verifier.</p>
                </div>
              </div>
              <span id="hermes-badge" class="badge badge-sm badge-info font-mono">Checking...</span>
            </div>

            <div role="alert" class="alert bg-base-300/60 border border-base-content/10 text-xs text-base-content/80 rounded-lg">
              <i class="fi fi-rr-info text-info text-sm"></i>
              <span>
                <strong>Integration Rule:</strong> When Hermes agent CLI or production daemon is unverified, all autonomous operations run via the deterministic mock adapter in safe isolation.
              </span>
            </div>

            <div class="space-y-3 pt-2">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <label class="label text-xs font-semibold text-base-content/80 pb-1">Inbound Webhook URL</label>
                  <input type="text" readonly class="input input-bordered input-sm w-full bg-base-100 font-mono text-primary border-base-content/20" value="http://localhost:3000/api/integrations/hermes/events" />
                </div>
                <div>
                  <label class="label text-xs font-semibold text-base-content/80 pb-1">Verification Endpoint</label>
                  <input type="text" readonly class="input input-bordered input-sm w-full bg-base-100 font-mono text-primary border-base-content/20" value="http://localhost:3000/api/integrations/hermes/status" />
                </div>
              </div>

              <div>
                <label class="label text-xs font-semibold text-base-content/80 pb-1">HMAC Webhook Secret</label>
                <div class="flex gap-2">
                  <input type="password" id="webhook-secret-input" class="input input-bordered input-sm flex-1 bg-base-100 border-base-content/20 text-base-content font-mono text-xs" value="hermes_shared_webhook_secret_key_bangron_2026" />
                  <button class="btn btn-outline btn-sm" id="btn-toggle-secret">Show</button>
                </div>
              </div>
            </div>

            <div class="pt-3 border-t border-base-content/10 flex justify-end">
              <button class="btn btn-primary btn-sm gap-2 shadow" id="btn-ping-hermes">
                <i class="fi fi-rr-refresh text-xs"></i>
                <span>Test Hermes Connection</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Policy Engine & Human-in-the-Loop Governance -->
        <div class="card bg-base-200 border border-base-content/10 shadow-xl rounded-box overflow-hidden">
          <div class="card-body p-6 space-y-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-warning/10 text-warning flex items-center justify-center">
                <i class="fi fi-rr-shield-check text-xl"></i>
              </div>
              <div>
                <h3 class="font-bold text-base text-base-content">Policy Engine & Human-in-the-Loop Governance</h3>
                <p class="text-xs text-base-content/60">Director authority controls for risk classification and approval interception.</p>
              </div>
            </div>

            <div class="space-y-3 pt-2">
              <div class="form-control">
                <label class="cursor-pointer label justify-start gap-3">
                  <input type="checkbox" checked disabled class="checkbox checkbox-primary checkbox-sm" />
                  <div>
                    <strong class="text-sm text-base-content block">Strict Director Authority Override</strong>
                    <span class="text-xs text-base-content/60">The Director is human and the highest authority. Agents cannot self-authorize high-risk actions.</span>
                  </div>
                </label>
              </div>

              <div class="form-control">
                <label class="cursor-pointer label justify-start gap-3">
                  <input type="checkbox" checked disabled class="checkbox checkbox-primary checkbox-sm" />
                  <div>
                    <strong class="text-sm text-base-content block">Enforce Approval on Production Deployments & Shell Execution</strong>
                    <span class="text-xs text-base-content/60">Blocks bash commands, code pushes to production, and financial mutations until approved.</span>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- Sandbox & Demo Data Management -->
        <div class="card bg-base-200 border border-base-content/10 shadow-xl rounded-box overflow-hidden">
          <div class="card-body p-6 space-y-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-error/10 text-error flex items-center justify-center">
                <i class="fi fi-rr-trash text-xl"></i>
              </div>
              <div>
                <h3 class="font-bold text-base text-base-content">Demo Data & State Reset</h3>
                <p class="text-xs text-base-content/60">Reset virtual office state, agent positions, task board, and seed initial demo data.</p>
              </div>
            </div>

            <div class="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p class="text-xs text-base-content/60">Restores all 12 rooms, 7 specialist agents, and sample digital studio tasks.</p>
              <button class="btn btn-error btn-sm gap-2 shadow" id="btn-reset-state">
                <i class="fi fi-rr-refresh text-xs"></i>
                <span>Reset Demo State</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.initEvents();
    await this.checkHermesStatus();
  }

  async checkHermesStatus() {
    try {
      const res = await api.get('/api/integrations/hermes/status');
      const badge = document.getElementById('hermes-badge');
      if (badge) {
        badge.innerText = res.status;
        badge.className = res.connected ? 'badge badge-sm badge-success font-mono' : 'badge badge-sm badge-info font-mono';
      }
    } catch {
      const badge = document.getElementById('hermes-badge');
      if (badge) {
        badge.innerText = 'OFFLINE';
        badge.className = 'badge badge-sm badge-error font-mono';
      }
    }
  }

  initEvents() {
    document.getElementById('btn-toggle-secret')?.addEventListener('click', (e) => {
      const input = document.getElementById('webhook-secret-input');
      if (input.type === 'password') {
        input.type = 'text';
        e.target.innerText = 'Hide';
      } else {
        input.type = 'password';
        e.target.innerText = 'Show';
      }
    });

    document.getElementById('btn-ping-hermes')?.addEventListener('click', async () => {
      await this.checkHermesStatus();
      alert('Hermes adapter verification check complete.');
    });

    document.getElementById('btn-reset-state')?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to re-seed demo data? This will reset all tasks and agent coordinates.')) {
        await api.post('/api/demo/reset');
        alert('Virtual office demo state successfully reset.');
      }
    });
  }

  destroy() {}
}

export default SettingsView;
