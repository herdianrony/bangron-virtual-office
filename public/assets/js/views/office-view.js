import { store } from '../core/store.js';
import { api } from '../core/api.js';
import { topdownRenderer } from '../office/topdown-renderer.js';
import { movementEngine } from '../office/movement-engine.js';
import CameraController from '../office/camera.js';
import { PixiOfficeScene } from '../office/pixi-office-scene.js';

export class OfficeView {
  constructor(container) {
    this.container = container;
    this.camera = null;
    this.cleanupListener = null;
    // Single view: the realistic top-down floor plan (PixiJS agent layer).
    this.viewMode = 'top';
    try {
      this.nightMode = localStorage.getItem('bangron_topdown_night') === '1';
    } catch {
      this.nightMode = false;
    }
  }

  async render() {
    this.container.innerHTML = `
      <div class="office-container td-mode bg-base-300">
        <!-- Demo Control Ribbon (DaisyUI Component) -->
        <div class="demo-ribbon card bg-base-100/95 backdrop-blur border border-info/30 shadow-2xl p-2.5 flex-row items-center gap-3">
          <span class="badge badge-info badge-sm font-mono font-bold tracking-wider">DEMO PIPELINE</span>
          <span class="demo-title hidden xl:inline text-xs font-semibold text-base-content flex items-center gap-1.5" id="demo-step-text">
            <i class="fi fi-rr-diagram-project text-info"></i>
            Simulated Multi-Agent Pipeline
          </span>
          <button class="btn btn-primary btn-xs gap-1.5 shadow" id="btn-demo-step">
            <span>Next Step</span>
            <i class="fi fi-rr-arrow-right text-[10px]"></i>
          </button>
          <button class="btn btn-accent btn-xs gap-1.5 shadow" id="btn-demo-auto" title="Toggle automatic task-driven walks">
            <i class="fi fi-rr-play text-xs"></i>
            <span>Auto-Play: On</span>
          </button>
          <button class="btn btn-ghost btn-xs text-base-content/70 hover:text-base-content" id="btn-demo-reset">
            <i class="fi fi-rr-refresh text-xs"></i>
            <span>Reset</span>
          </button>
        </div>

        <!-- Floating HUD Controls (DaisyUI Join Component) -->
        <div class="office-hud">
          <!-- Day/Night toggle -->
          <div class="tooltip tooltip-left" data-tip="Mode malam / siang">
            <button class="btn btn-sm btn-ghost btn-square shadow-2xl bg-base-100/90 backdrop-blur border border-base-content/10" id="hud-night" title="Mode malam / siang">
              <i class="fi fi-rr-moon text-xs"></i>
            </button>
          </div>

          <!-- Viewport Navigation Controls -->
          <div class="join join-vertical shadow-2xl bg-base-100/70 backdrop-blur border border-base-content/10 rounded-box">
            <button class="btn btn-sm btn-ghost join-item tooltip tooltip-left" data-tip="Perbesar" id="hud-zoom-in" title="Zoom In"><i class="fi fi-rr-zoom-in text-xs"></i></button>
            <button class="btn btn-sm btn-ghost join-item tooltip tooltip-left" data-tip="Perkecil" id="hud-zoom-out" title="Zoom Out"><i class="fi fi-rr-zoom-out text-xs"></i></button>
            <button class="btn btn-sm btn-ghost join-item tooltip tooltip-left" data-tip="Reset tampilan" id="hud-reset" title="Reset View"><i class="fi fi-rr-crosshairs text-xs"></i></button>
            <button class="btn btn-sm btn-ghost join-item tooltip tooltip-left" data-tip="Ikuti agen" id="hud-follow" title="Toggle Follow Agent"><i class="fi fi-rr-eye text-xs"></i></button>
            <button class="btn btn-sm btn-ghost join-item tooltip tooltip-left" data-tip="Layar penuh" id="hud-fullscreen" title="Fullscreen"><i class="fi fi-rr-expand-arrows text-xs"></i></button>
          </div>

          <!-- Speed Controls -->
          <div class="join shadow-2xl bg-base-100/90 backdrop-blur border border-base-content/10 p-1">
            <span class="text-[10px] text-base-content/60 font-bold uppercase tracking-wider px-2 flex items-center">Speed</span>
            <button class="btn btn-xs join-item speed-btn active btn-primary" data-speed="1">1x</button>
            <button class="btn btn-xs join-item speed-btn btn-ghost" data-speed="2">2x</button>
            <button class="btn btn-xs join-item speed-btn btn-ghost" data-speed="4">4x</button>
          </div>
        </div>

        <!-- PixiJS scene host: one canvas renders the entire office -->
        <div id="office-scene-host" class="absolute inset-0 z-0"></div>

        <!-- Hover Tooltip -->
        <div id="office-tooltip"></div>

        <!-- Mobile Inspector Backdrop -->
        <div class="agent-inspector-backdrop" id="inspector-backdrop"></div>
        
        <!-- Floating Agent Inspector Drawer (DaisyUI Card) -->
        <div class="agent-inspector card bg-base-100/95 backdrop-blur border border-base-content/15 shadow-2xl p-4" id="agent-inspector">
          <div class="flex items-center justify-between pb-2.5 border-b border-base-content/10">
            <div class="flex items-center gap-2">
              <span class="status-dot online" id="insp-dot"></span>
              <span id="insp-name" class="font-bold text-base-content text-sm">Agent Name</span>
            </div>
            <button class="btn btn-ghost btn-circle btn-xs text-base-content/60 hover:text-base-content" id="insp-close">
              <i class="fi fi-rr-cross-small text-sm"></i>
            </button>
          </div>
          <div class="space-y-2 py-2 text-xs">
            <div class="flex justify-between py-1 border-b border-base-content/5">
              <span class="text-base-content/60">Department</span>
              <span class="font-medium text-base-content" id="insp-dept">-</span>
            </div>
            <div class="flex justify-between py-1 border-b border-base-content/5">
              <span class="text-base-content/60">Operational Status</span>
              <span class="badge badge-sm font-mono" id="insp-status">-</span>
            </div>
            <div class="flex justify-between py-1 border-b border-base-content/5">
              <span class="text-base-content/60">Assigned Room</span>
              <span class="font-medium text-base-content" id="insp-room">-</span>
            </div>
            <div class="flex justify-between py-1 border-b border-base-content/5">
              <span class="text-base-content/60">Current Task</span>
              <span class="font-semibold text-primary truncate max-w-[180px]" id="insp-task">None</span>
            </div>
            <div class="flex flex-col gap-1 pt-1.5">
              <span class="text-base-content/60 text-[10px] uppercase tracking-wider font-bold">Capabilities</span>
              <div id="insp-caps" class="text-xs text-base-content/80 leading-relaxed bg-base-200/60 p-2.5 rounded-lg border border-base-content/10">-</div>
            </div>
            <div class="grid grid-cols-2 gap-2 pt-2">
              <button class="btn btn-outline btn-xs gap-1.5" id="insp-follow-btn">
                <i class="fi fi-rr-eye text-xs"></i>
                <span>Follow</span>
              </button>
              <button class="btn btn-warning btn-xs gap-1.5 shadow" id="insp-pause-btn">
                <i class="fi fi-rr-pause text-xs"></i>
                <span>Pause</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Compact live status (DaisyUI badges) -->
        <div class="office-status absolute bottom-16 left-4 z-20 flex flex-wrap items-center gap-2" id="office-status">
          <span class="badge badge-sm badge-ghost font-mono"><i class="fi fi-rr-user-robot mr-1"></i><span id="os-agents">0</span> agents</span>
          <span class="badge badge-sm badge-ghost font-mono"><i class="fi fi-rr-building mr-1"></i><span id="os-rooms">0</span> rooms</span>
          <span class="badge badge-sm badge-success font-mono" id="os-runtime">LIVE</span>
        </div>

        <!-- Realtime Activity Ticker HUD (DaisyUI Alert) -->
        <div class="bottom-ticker alert bg-base-100/90 backdrop-blur border border-base-content/10 shadow-xl py-2 px-3.5 rounded-box flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 overflow-hidden">
            <i class="fi fi-rr-bolt text-warning text-xs shrink-0"></i>
            <span class="ticker-text text-xs text-base-content/80 font-medium" id="live-ticker-text">Bangron Virtual Office initialized. Monitoring AI agent telemetry...</span>
          </div>
          <span class="badge badge-xs badge-neutral font-mono text-[10px] shrink-0">WEBSOCKET</span>
        </div>
      </div>
    `;

    // PixiJS-first scene: satu canvas untuk seluruh kantor.
    const host = document.getElementById('office-scene-host');
    this.scene = new PixiOfficeScene();
    await this.scene.init(host);
    this.scene.onAgentClick = (id) => this.openAgentInspector(id);
    this.scene.setNight(this.nightMode);

    // Camera adapter: CameraController tetap dipakai untuk logika pan/zoom/follow,
    // tetapi output transform-nya kini masuk ke scene PixiJS (bukan SVG).
    this.camera = new CameraController(host, null, topdownRenderer.projection);
    this.camera.onTransformChange = (t) => this.scene.applyCamera(t);
    this.scene.setState({
      rooms: [], workstations: [],
      corridors: [{ id: 'corr_main', x: 30, y: 295, w: 940, h: 45 }],
      building: topdownRenderer.BOUNDS
    });
    this.camera.fitBounds(this.scene.getBounds());

    // Bind Controls
    this.initControls();
    this.setupScene();

    // Load State from Backend API
    await this.loadInitialOfficeState();

    // Start movement engine. The callback receives (agents, deltaSec) from
    // MovementEngine.tick(); deltaSec is the elapsed seconds since the last
    // frame and is required by CameraController.updateFollow() for time-based
    // lerp smoothing. Without it, dt is ReferenceError'd and animation dies.
    movementEngine.setUpdateCallback((agents, deltaSec) => {
      this.renderAvatars(agents);
      this.camera.updateFollow(agents, deltaSec);
    });
    movementEngine.start();

    // Subscribe to store updates
    this.renderOfficeStatus();
    this.cleanupListener = store.subscribe((eventKey, payload) => {
      if (eventKey === 'agents_loaded' || eventKey === 'agent_updated' || eventKey === 'state_updated' || eventKey === 'runtime_status_changed') {
        this.renderOfficeStatus();
      }
      if (eventKey === 'agents_loaded' || eventKey === 'agent_updated') {
        movementEngine.syncAgents(store.getAllAgents());
      }
      if (eventKey === 'runtime_status_changed' || eventKey === 'state_updated') {
        // Runtime availability is a VISUAL overlay only: when the Hermes
        // runtime is explicitly disconnected, avatars render with the
        // 'offline' halo while their lifecycle status stays untouched in
        // the store and the database.
        const container = this.container.querySelector('.office-container');
        container?.classList.toggle('runtime-offline', this.isRuntimeOffline());
        if (eventKey === 'runtime_status_changed') {
          movementEngine.syncAgents(store.getAllAgents());
        }
      }
      if (eventKey === 'activity_added' && payload) {
        const ticker = document.getElementById('live-ticker-text');
        if (ticker) {
          ticker.innerText = `${payload.occurred_at ? new Date(payload.occurred_at).toLocaleTimeString() : ''} — ${payload.description}`;
        }
      }
    });
  }

  async loadInitialOfficeState() {
    try {
      const state = await api.get('/api/virtual-office/state');
      store.setState({
        rooms: state.rooms,
        workstations: state.workstations,
        corridors: state.corridors || null
      });

      // Scene PixiJS menggambar seluruh kantor dari state kanonik backend.
      this.scene.setState({
        rooms: state.rooms,
        workstations: state.workstations,
        corridors: state.corridors,
        building: state.building || topdownRenderer.BOUNDS
      });

      // Sync agents to movement engine
      store.setAgents(state.agents);
      movementEngine.syncAgents(state.agents);
    } catch (err) {
      console.error('Failed to load virtual office state:', err);
    }
  }

  /** @deprecated SVG layers replaced by PixiOfficeScene. Kept as a no-op for compatibility. */
  addFurnitureHitTest() {}
  /** @deprecated SVG layers replaced by PixiOfficeScene. Kept as a no-op for compatibility. */
  renderStaticLayers() {}

  setupScene() {
    const container = this.container.querySelector('.office-container');
    container?.classList.toggle('td-night', this.nightMode);
    this.scene.setNight(this.nightMode);
    this.scene.resize();
  }

  setNight(enabled) {
    this.nightMode = !!enabled;
    try {
      localStorage.setItem('bangron_topdown_night', this.nightMode ? '1' : '0');
    } catch { /* private mode */ }
    const container = this.container.querySelector('.office-container');
    container?.classList.toggle('td-night', this.nightMode);
    const icon = document.querySelector('#hud-night i');
    if (icon) icon.className = this.nightMode ? 'fi fi-rr-sun text-xs' : 'fi fi-rr-moon text-xs';
    const btn = document.getElementById('hud-night');
    btn?.setAttribute('title', this.nightMode ? 'Ganti ke mode siang' : 'Ganti ke mode malam');
    this.scene.setNight(this.nightMode);
  }

  initControls() {
    // Zoom & Reset
    document.getElementById('hud-zoom-in')?.addEventListener('click', () => this.camera.zoomIn());
    document.getElementById('hud-zoom-out')?.addEventListener('click', () => this.camera.zoomOut());
    document.getElementById('hud-reset')?.addEventListener('click', () => {
      this.camera.reset();
      this.camera.fitBounds(this.scene.getBounds());
    });

    // Follow Agent toggle
    document.getElementById('hud-follow')?.addEventListener('click', () => {
      const agents = store.getAllAgents();
      if (agents.length > 0) {
        const nextId = store.state.followAgentId ? null : agents[0].id;
        store.setState({ followAgentId: nextId });
        alert(nextId ? `Following agent: ${agents[0].display_name}` : 'Follow mode disabled.');
      }
    });

    // Fullscreen toggle (Fullscreen API with webkit fallback)
    document.getElementById('hud-fullscreen')?.addEventListener('click', () => this.toggleFullscreen());
    this.onFullscreenChange = () => this.syncFullscreenButton();
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this.onFullscreenChange);

    // Demo auto-play toggle: agents walk according to their active tasks
    const autoBtn = document.getElementById('btn-demo-auto');
    if (autoBtn) {
      autoBtn.addEventListener('click', async () => {
        try {
          const current = autoBtn.dataset.enabled === 'true';
          const result = await api.post('/api/demo/autoplay', { enabled: !current });
          this.syncAutoplayButton(!!result.enabled);
        } catch (err) {
          alert('Auto-play error: ' + err.message);
        }
      });
      api
        .get('/api/demo/status')
        .then((status) => this.syncAutoplayButton(!!(status && status.autoplay && status.autoplay.enabled)))
        .catch(() => {});
    }

    // Speed Selector
    document.querySelectorAll('.speed-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.speed-btn').forEach((b) => {
          b.classList.remove('active', 'btn-primary');
          b.classList.add('btn-ghost');
        });
        e.target.classList.add('active', 'btn-primary');
        e.target.classList.remove('btn-ghost');
        const speed = parseInt(e.target.dataset.speed, 10);
        store.setState({ simulationSpeed: speed });
      });
    });

    // Demo Step
    document.getElementById('btn-demo-step')?.addEventListener('click', async () => {
      try {
        const result = await api.post('/api/demo/step');
        const text = document.getElementById('demo-step-text');
        if (text) {
          text.innerHTML = `<i class="fi fi-rr-bolt text-info"></i> [Step ${result.step}] ${result.action}`;
        }
      } catch (err) {
        alert('Demo step error: ' + err.message);
      }
    });

    // Demo Reset
    document.getElementById('btn-demo-reset')?.addEventListener('click', async () => {
      if (confirm('Reset demo state to baseline?')) {
        await api.post('/api/demo/reset');
        await this.loadInitialOfficeState();
      }
    });

    // Inspector close button
    const closeInspector = () => {
      const inspector = document.getElementById('agent-inspector');
      const backdrop = document.getElementById('inspector-backdrop');
      inspector?.classList.remove('open', 'mobile-open');
      backdrop?.classList.remove('open');
      store.setState({ selectedAgentId: null });
    };
    
    document.getElementById('insp-close')?.addEventListener('click', closeInspector);
    document.getElementById('inspector-backdrop')?.addEventListener('click', closeInspector);

    // Day/night toggle
    document.getElementById('hud-night')?.addEventListener('click', () => this.setNight(!this.nightMode));

    // Hover tooltips (data-name attributes on rooms/furniture/decor)
    this.initTooltip();

    // Agent interaction: ceiling lamps toggle night; agents are hit-tested on
    // the PixiJS layer (client coords -> world coords via the camera transform).
    // If no agent is hit, check the SVG hit-test layer for rooms/furniture/decor.
    this.container.addEventListener('click', (e) => {
      const lampNode = e.target.closest('.td-lamp');
      if (lampNode) {
        this.setNight(!this.nightMode);
        return;
      }
      const hit = this.scene.pick(e.clientX, e.clientY);
      if (hit?.kind === 'agent') {
        this.openAgentInspector(hit.id);
        return;
      }
      if (hit?.name) {
        const tip = document.getElementById('office-tooltip');
        if (tip) {
          tip.textContent = hit.name;
          tip.style.display = 'block';
          tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 290) + 'px';
          tip.style.top = e.clientY + 14 + 'px';
          setTimeout(() => { tip.style.display = 'none'; }, 3000);
        }
      }
    });

    // Inspector action buttons
    document.getElementById('insp-follow-btn')?.addEventListener('click', () => {
      const id = store.state.selectedAgentId;
      if (id) {
        store.setState({ followAgentId: id });
      }
    });

    document.getElementById('insp-pause-btn')?.addEventListener('click', async () => {
      const id = store.state.selectedAgentId;
      if (id) {
        const current = store.getAgent(id);
        const terminalStatuses = ['completed', 'failed', 'cancelled', 'idle', 'offline'];
        if (terminalStatuses.includes(current?.status)) {
          toast.warning(`${current.status.charAt(0).toUpperCase() + current.status.slice(1)} agent cannot be paused or resumed`);
          return;
        }
        const cmd = current?.status === 'waiting' ? 'resume' : 'pause';
        await api.post(`/api/agents/${id}/commands`, { command: cmd });
        this.openAgentInspector(id);
      }
    });
  }

  /** Converts client coordinates to world coordinates via the camera transform. */
  clientToWorld(clientX, clientY) {
    const host = document.getElementById('office-scene-host');
    if (!host || !this.camera) return null;
    const rect = host.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.camera.panX) / this.camera.scale,
      y: (clientY - rect.top - this.camera.panY) / this.camera.scale
    };
  }

  pickAgentAt(clientX, clientY) {
    const hit = this.scene.pick(clientX, clientY);
    return hit?.kind === 'agent' ? hit.id : null;
  }

  toggleFullscreen() {
    const el = this.container;
    const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (!fsElement) {
        const request = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (request) request.call(el);
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        if (exit) exit.call(document);
      }
    } catch (err) {
      console.warn('Fullscreen is not available:', err);
    }
  }

  syncFullscreenButton() {
    const btn = document.getElementById('hud-fullscreen');
    if (!btn) return;
    const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
    const icon = btn.querySelector('i');
    if (icon) icon.className = fsElement ? 'fi fi-rr-compress text-xs' : 'fi fi-rr-expand-arrows text-xs';
    btn.title = fsElement ? 'Exit fullscreen (Esc)' : 'Fullscreen';
  }

  syncAutoplayButton(enabled) {
    const btn = document.getElementById('btn-demo-auto');
    if (!btn) return;
    btn.dataset.enabled = String(enabled);
    const icon = btn.querySelector('i');
    const label = btn.querySelector('span');
    if (icon) icon.className = enabled ? 'fi fi-rr-pause text-xs' : 'fi fi-rr-play text-xs';
    if (label) label.textContent = enabled ? 'Auto-Play: On' : 'Auto-Play: Off';
    btn.classList.toggle('btn-accent', enabled);
    btn.classList.toggle('btn-ghost', !enabled);
    btn.title = enabled ? 'Pause automatic task-driven walks' : 'Resume automatic task-driven walks';
  }

  /**
   * True only when an explicit runtime.status.changed event reported the
   * Hermes runtime disconnected. The initial store default (connected:false
   * with no reason) and plain WebSocket reconnects do NOT gray out agents.
   */
  renderOfficeStatus() {
    const a = document.getElementById('os-agents');
    const r = document.getElementById('os-rooms');
    const rt = document.getElementById('os-runtime');
    if (a) a.textContent = String(store.getAllAgents().length || 0);
    if (r) r.textContent = String(store.state.rooms?.length || 0);
    if (rt) {
      const offline = this.isRuntimeOffline();
      rt.textContent = offline ? 'OFFLINE' : 'LIVE';
      rt.className = `badge badge-sm font-mono ${offline ? 'badge-error' : 'badge-success'}`;
    }
  }

  isRuntimeOffline() {
    const rs = store.state.runtimeStatus;
    return Boolean(rs && rs.connected === false && rs.reason);
  }

  renderAvatars(agents, opts = {}) {
    // Agents render on the PixiJS WebGL layer (diffed transforms, no DOM churn).
    // Offline is a render-time overlay: lifecycle status in the store/DB is
    // never modified by runtime availability.
    const rendered = this.isRuntimeOffline()
      ? agents.map((a) => ({ ...a, status: 'offline' }))
      : agents;
    this.scene.setAgents(rendered);
  }

  initTooltip() {
    const host = document.getElementById('office-scene-host');
    const tip = document.getElementById('office-tooltip');
    if (!host || !tip) return;
    this._onTipMove = (e) => {
      const hit = this.scene?.pick(e.clientX, e.clientY);
      if (hit?.name) {
        tip.textContent = hit.name;
        tip.style.display = 'block';
        tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 290) + 'px';
        tip.style.top = e.clientY + 14 + 'px';
      } else {
        tip.style.display = 'none';
      }
    };
    this._onTipLeave = () => { tip.style.display = 'none'; };
    host.addEventListener('pointermove', this._onTipMove);
    host.addEventListener('pointerleave', this._onTipLeave);
  }

  openAgentInspector(agentId) {
    const agent = store.getAgent(agentId);
    if (!agent) return;

    store.setState({ selectedAgentId: agentId });
    const inspector = document.getElementById('agent-inspector');
    const backdrop = document.getElementById('inspector-backdrop');
    if (!inspector) return;

    const isMobile = window.innerWidth < 640;
    
    if (isMobile) {
      inspector.classList.add('mobile-open');
      if (backdrop) backdrop.classList.add('open');
    } else {
      inspector.classList.add('open');
    }

    document.getElementById('insp-name').innerText = agent.display_name;
    document.getElementById('insp-dept').innerText = agent.department || 'General';

    const statusBadge = document.getElementById('insp-status');
    if (statusBadge) {
      statusBadge.innerText = agent.status;
      statusBadge.className = `badge badge-sm font-mono ${agent.status === 'working' ? 'badge-primary' : agent.status === 'waiting' ? 'badge-warning' : agent.status === 'completed' ? 'badge-success' : 'badge-ghost'}`;
    }

    document.getElementById('insp-room').innerText = agent.room_name || agent.current_room_id || 'Office Floor';
    document.getElementById('insp-task').innerText = agent.active_task_title || 'No active task';

    try {
      const caps = JSON.parse(agent.capabilities_json || '[]');
      document.getElementById('insp-caps').innerText = caps.join(', ') || 'General agent';
    } catch {
      document.getElementById('insp-caps').innerText = '-';
    }

    const pauseBtn = document.getElementById('insp-pause-btn');
    if (pauseBtn) {
      const terminalStatuses = ['completed', 'failed', 'cancelled', 'idle', 'offline'];
      const isTerminal = terminalStatuses.includes(agent.status);
      const isWaiting = agent.status === 'waiting';
      if (isTerminal) {
        pauseBtn.disabled = true;
        pauseBtn.classList.add('btn-disabled', 'text-base-content/40');
        pauseBtn.innerHTML = '<i class="fi fi-rr-pause text-xs"></i><span>N/A</span>';
        pauseBtn.title = 'Terminal status: cannot pause/resume';
      } else {
        pauseBtn.disabled = false;
        pauseBtn.classList.remove('btn-disabled', 'text-base-content/40');
        pauseBtn.innerHTML = isWaiting
          ? '<i class="fi fi-rr-play text-xs"></i><span>Resume</span>'
          : '<i class="fi fi-rr-pause text-xs"></i><span>Pause</span>';
        pauseBtn.title = isWaiting ? 'Resume agent' : 'Pause agent';
      }
    }
  }

  destroy() {
    movementEngine.stop();
    this.scene?.destroy();
    const host = document.getElementById('office-scene-host');
    if (host) {
      if (this._onTipMove) host.removeEventListener('pointermove', this._onTipMove);
      if (this._onTipLeave) host.removeEventListener('pointerleave', this._onTipLeave);
    }
    if (this.onFullscreenChange) {
      document.removeEventListener('fullscreenchange', this.onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', this.onFullscreenChange);
    }
    if (this.cleanupListener) {
      this.cleanupListener();
    }
  }
}

export default OfficeView;
