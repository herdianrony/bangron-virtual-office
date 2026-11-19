import { api } from '../core/api.js';

export class DashboardView {
  constructor(container) {
    this.container = container;
  }

  async render() {
    this.container.innerHTML = `
      <div class="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
        <!-- Dashboard Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-base-content/10">
          <div>
            <h2 class="text-2xl font-bold tracking-tight text-base-content flex items-center gap-2.5">
              <i class="fi fi-rr-dashboard text-primary text-xl"></i>
              Director Operations Center
            </h2>
            <p class="text-xs text-base-content/60 mt-1">Realtime verified agent workloads, execution telemetry, and digital studio operations.</p>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn btn-primary btn-sm gap-2 shadow" id="dash-refresh-btn">
              <i class="fi fi-rr-refresh text-xs"></i>
              <span>Refresh Telemetry</span>
            </button>
          </div>
        </div>

        <!-- Hermes Integration Alert Banner -->
        <div role="alert" class="alert bg-base-200 border border-info/30 shadow-lg flex items-center justify-between rounded-box p-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-info/10 text-info flex items-center justify-center">
              <i class="fi fi-rr-brain text-xl"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <strong class="text-sm font-semibold text-base-content">Hermes Agent Runtime:</strong>
                <span id="hermes-status-text" class="badge badge-sm badge-info font-mono">Checking...</span>
              </div>
              <p class="text-xs text-base-content/60 mt-0.5">Webhook receiver, HMAC signature validator, and event reconciliation engine active.</p>
            </div>
          </div>
          <a href="#/settings" class="btn btn-outline btn-info btn-xs gap-1.5">
            <i class="fi fi-rr-settings text-xs"></i>
            <span>Runtime Settings</span>
          </a>
        </div>

        <!-- DaisyUI Unified Stats Row -->
        <div class="stats stats-vertical lg:stats-horizontal shadow-xl bg-base-200 border border-base-content/10 w-full">
          <!-- Total / Active Agents -->
          <div class="stat">
            <div class="stat-figure text-primary">
              <i class="fi fi-rr-user-robot text-2xl"></i>
            </div>
            <div class="stat-title text-xs font-semibold text-base-content/70 uppercase tracking-wider">Active Agents</div>
            <div class="stat-value text-2xl font-black text-primary font-mono" id="kpi-agents">-</div>
            <div class="stat-desc text-xs text-base-content/60" id="kpi-agents-sub">Online vs Offline</div>
          </div>

          <!-- Working Agents -->
          <div class="stat">
            <div class="stat-figure text-secondary">
              <i class="fi fi-rr-play-circle text-2xl"></i>
            </div>
            <div class="stat-title text-xs font-semibold text-base-content/70 uppercase tracking-wider">Working Now</div>
            <div class="stat-value text-2xl font-black text-secondary font-mono" id="kpi-working">-</div>
            <div class="stat-desc text-xs text-base-content/60">Executing tools & steps</div>
          </div>

          <!-- Active Tasks -->
          <div class="stat">
            <div class="stat-figure text-accent">
              <i class="fi fi-rr-list-check text-2xl"></i>
            </div>
            <div class="stat-title text-xs font-semibold text-base-content/70 uppercase tracking-wider">Active Tasks</div>
            <div class="stat-value text-2xl font-black text-accent font-mono" id="kpi-tasks">-</div>
            <div class="stat-desc text-xs text-base-content/60" id="kpi-tasks-sub">Running & Waiting</div>
          </div>

          <!-- Pending Approvals -->
          <div class="stat">
            <div class="stat-figure text-warning">
              <i class="fi fi-rr-shield-check text-2xl"></i>
            </div>
            <div class="stat-title text-xs font-semibold text-base-content/70 uppercase tracking-wider">Pending Approvals</div>
            <div class="stat-value text-2xl font-black text-warning font-mono" id="kpi-approvals">-</div>
            <div class="stat-desc text-xs">
              <a href="#/approvals" class="text-warning hover:underline flex items-center gap-1 font-medium">
                <span>Review requests</span>
                <i class="fi fi-rr-arrow-right text-[10px]"></i>
              </a>
            </div>
          </div>

          <!-- Completed Tasks -->
          <div class="stat">
            <div class="stat-figure text-success">
              <i class="fi fi-rr-check-circle text-2xl"></i>
            </div>
            <div class="stat-title text-xs font-semibold text-base-content/70 uppercase tracking-wider">Completed Tasks</div>
            <div class="stat-value text-2xl font-black text-success font-mono" id="kpi-completed">-</div>
            <div class="stat-desc text-xs text-base-content/60" id="kpi-failed-sub">0 failed</div>
          </div>
        </div>

        <!-- 2 Columns: Multi-Agent Operations & Digital Studio Feed -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Left 2 Cols: Active Tasks & Projects -->
          <div class="lg:col-span-2 space-y-6">
            <!-- Active Tasks Card -->
            <div class="card bg-base-200 border border-base-content/10 shadow-xl rounded-box overflow-hidden">
              <div class="card-body p-5">
                <div class="flex items-center justify-between mb-3">
                  <div class="flex items-center gap-2">
                    <i class="fi fi-rr-diagram-project text-primary text-base"></i>
                    <h3 class="card-title text-base font-bold text-base-content">Active Multi-Agent Operations</h3>
                  </div>
                  <a href="#/tasks" class="btn btn-ghost btn-xs text-base-content/70 hover:text-base-content gap-1">
                    <span>Manage Tasks</span>
                    <i class="fi fi-rr-arrow-right text-xs"></i>
                  </a>
                </div>

                <div class="overflow-x-auto">
                  <table class="table table-zebra table-sm w-full">
                    <thead>
                      <tr class="bg-base-300/50 text-base-content/70 border-b border-base-content/10">
                        <th>Task Title</th>
                        <th>Project</th>
                        <th>Assigned Specialist</th>
                        <th>Priority</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody id="dash-tasks-table">
                      <tr><td colspan="5" class="text-center text-base-content/50 py-4">Loading active tasks...</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <!-- Digital Studio Projects Portfolio -->
            <div class="card bg-base-200 border border-base-content/10 shadow-xl rounded-box overflow-hidden">
              <div class="card-body p-5">
                <div class="flex items-center justify-between mb-3">
                  <div class="flex items-center gap-2">
                    <i class="fi fi-rr-briefcase text-secondary text-base"></i>
                    <h3 class="card-title text-base font-bold text-base-content">Digital Studio Projects</h3>
                  </div>
                  <a href="#/projects" class="btn btn-ghost btn-xs text-base-content/70 hover:text-base-content gap-1">
                    <span>View All</span>
                    <i class="fi fi-rr-arrow-right text-xs"></i>
                  </a>
                </div>

                <div id="dash-projects-list" class="space-y-3">
                  <!-- Dynamic project cards -->
                </div>
              </div>
            </div>
          </div>

          <!-- Right 1 Col: Realtime Activity Feed -->
          <div class="space-y-6">
            <div class="card bg-base-200 border border-base-content/10 shadow-xl rounded-box overflow-hidden">
              <div class="card-body p-5">
                <div class="flex items-center justify-between mb-3">
                  <div class="flex items-center gap-2">
                    <i class="fi fi-rr-bolt text-warning text-base"></i>
                    <h3 class="card-title text-base font-bold text-base-content">Live Studio Feed</h3>
                  </div>
                  <a href="#/activities" class="btn btn-ghost btn-xs text-base-content/70 hover:text-base-content gap-1">
                    <span>All Events</span>
                    <i class="fi fi-rr-arrow-right text-xs"></i>
                  </a>
                </div>

                <div id="dash-activity-feed" class="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
                  <div class="text-base-content/50 text-xs py-4 text-center">Loading activity telemetry...</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('dash-refresh-btn')?.addEventListener('click', () => this.loadData());
    await this.loadData();
  }

  async loadData() {
    try {
      const data = await api.get('/api/director/dashboard');
      const { metrics, activeTasks, projects, recentActivities, hermesHealth } = data;

      // Update KPIs
      document.getElementById('kpi-agents').innerText = metrics.onlineAgents;
      document.getElementById('kpi-agents-sub').innerText = `${metrics.onlineAgents} Online / ${metrics.offlineAgents} Offline`;
      document.getElementById('kpi-working').innerText = metrics.workingAgents;
      document.getElementById('kpi-tasks').innerText = metrics.runningTasks + metrics.waitingTasks;
      document.getElementById('kpi-tasks-sub').innerText = `${metrics.runningTasks} Running / ${metrics.waitingTasks} Waiting`;
      document.getElementById('kpi-approvals').innerText = metrics.pendingApprovals;
      document.getElementById('kpi-completed').innerText = metrics.completedTasks;
      document.getElementById('kpi-failed-sub').innerText = `${metrics.failedTasks} failed tasks`;

      // Hermes Health Banner
      const statusText = document.getElementById('hermes-status-text');
      if (statusText) {
        statusText.innerText = hermesHealth.status;
        statusText.className = hermesHealth.connected ? 'badge badge-sm badge-success font-mono' : 'badge badge-sm badge-info font-mono';
      }

      // Active Tasks Table
      const tasksTbody = document.getElementById('dash-tasks-table');
      if (tasksTbody) {
        if (!activeTasks || activeTasks.length === 0) {
          tasksTbody.innerHTML = `<tr><td colspan="5" class="text-center text-base-content/50 py-4">No active tasks running.</td></tr>`;
        } else {
          tasksTbody.innerHTML = activeTasks.map((t) => `
            <tr class="hover:bg-base-300/40">
              <td class="font-semibold text-base-content">${t.title}</td>
              <td class="text-xs text-base-content/70">${t.project_name || 'Studio General'}</td>
              <td class="text-xs">
                ${t.assigned_agent_name ? `<span class="badge badge-sm badge-neutral font-medium">${t.assigned_agent_name}</span>` : '<span class="text-base-content/40 italic">Unassigned</span>'}
              </td>
              <td>
                <span class="badge badge-xs font-semibold ${t.priority === 'critical' ? 'badge-error' : t.priority === 'high' ? 'badge-warning' : 'badge-ghost'}">
                  ${t.priority}
                </span>
              </td>
              <td>
                <span class="badge badge-xs font-medium ${t.status === 'running' ? 'badge-primary' : t.status === 'waiting' ? 'badge-warning' : 'badge-ghost'}">
                  ${t.status}
                </span>
              </td>
            </tr>
          `).join('');
        }
      }

      // Projects List with DaisyUI Progress
      const projContainer = document.getElementById('dash-projects-list');
      if (projContainer) {
        if (!projects || projects.length === 0) {
          projContainer.innerHTML = `<div class="text-base-content/50 text-xs py-2">No active projects.</div>`;
        } else {
          projContainer.innerHTML = projects.map((p) => {
            const pct = p.total_tasks > 0 ? Math.round((p.completed_tasks / p.total_tasks) * 100) : 0;
            return `
              <div class="p-3.5 bg-base-300/50 border border-base-content/10 rounded-box space-y-2">
                <div class="flex justify-between items-center text-xs">
                  <span class="font-bold text-base-content">${p.name}</span>
                  <span class="font-mono text-primary font-bold">${pct}% (${p.completed_tasks}/${p.total_tasks} tasks)</span>
                </div>
                <progress class="progress progress-primary w-full h-1.5" value="${pct}" max="100"></progress>
              </div>
            `;
          }).join('');
        }
      }

      // Activities Feed
      const actContainer = document.getElementById('dash-activity-feed');
      if (actContainer) {
        if (!recentActivities || recentActivities.length === 0) {
          actContainer.innerHTML = `<div class="text-base-content/50 text-xs py-4 text-center">No activities recorded yet.</div>`;
        } else {
          actContainer.innerHTML = recentActivities.map((a) => `
            <div class="flex gap-2.5 text-xs p-2.5 rounded-lg bg-base-300/40 border border-base-content/5">
              <span class="font-mono text-[10px] text-accent pt-0.5">
                ${a.occurred_at ? new Date(a.occurred_at).toLocaleTimeString() : ''}
              </span>
              <div class="flex-1 leading-snug">
                <strong class="text-base-content">${a.agent_name}: </strong>
                <span class="text-base-content/70">${a.description}</span>
              </div>
            </div>
          `).join('');
        }
      }
    } catch (err) {
      console.error('Failed to load dashboard metrics:', err);
    }
  }

  destroy() {}
}

export default DashboardView;
