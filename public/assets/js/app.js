import { api } from './core/api.js';
import { store } from './core/store.js';
import { resolveRuntimeIndicator } from './core/runtime-indicator.js';
import { commandPalette } from './core/command-palette.js';
import { Accessibility } from './core/accessibility.js';
import Router from './core/router.js';
import { realtimeClient } from './realtime/websocket-client.js';
import { toast } from './core/toast.js';

import OfficeView from './views/office-view.js';
import DashboardView from './views/dashboard-view.js';
import AgentsView from './views/agents-view.js';
import TasksView from './views/tasks-view.js';
import ProjectsView from './views/projects-view.js';
import ApprovalsView from './views/approvals-view.js';
import DeliverablesView from './views/deliverables-view.js';
import ActivitiesView from './views/activities-view.js';
import SettingsView from './views/settings-view.js';
import LoginView from './views/login-view.js';

class App {
  constructor() {
    this.mainContainer = document.getElementById('main-viewport');
    this.currentViewInstance = null;
    this.router = null;
    this.wsOfflineBanner = null;
    this.wsDisconnectedAt = null;
  }

  async init() {
    // Debug/E2E observability hook: expose the reactive store so browser
    // tests can assert authoritative frontend state (runtimeStatus, agents).
    // Read-only by convention; the app never reads window.store.
    window.store = store;

    // 0. Register Service Worker (PWA offline support)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => console.log('[SW] Registered:', reg.scope))
        .catch((err) => console.warn('[SW] Registration failed:', err));
    }

    // 0b. Initialize Theme Manager (system detection + override)
    import('../core/theme-manager.js').then(({ themeManager }) => {
      themeManager.init();
      window.themeManager = themeManager;
    });

    // 0. Initialize DaisyUI Theme Switcher
    this.initThemeController();

    // 1. Fetch CSRF token & check active session
    try {
      const csrfData = await api.get('/api/auth/csrf');
      if (csrfData && csrfData.csrfToken) {
        api.setCsrfToken(csrfData.csrfToken);
        store.setState({ csrfToken: csrfData.csrfToken });
      }

      const meData = await api.get('/api/auth/me');
      if (meData && meData.user) {
        store.setState({ user: meData.user });
        this.updateUserUI(meData.user);
      }
    } catch {
      console.log('No active session found, guest access.');
    }

    // 2. Connect WebSocket Realtime Gateway
    realtimeClient.connect();

    // 3. Setup WebSocket offline banner listener
    this.setupWsOfflineBanner();

    // 4. Setup Routes
    const switchView = (ViewClass) => {
      if (this.currentViewInstance && this.currentViewInstance.destroy) {
        this.currentViewInstance.destroy();
      }
      this.currentViewInstance = new ViewClass(this.mainContainer);
      this.currentViewInstance.render();
    };

    const routes = {
      '#/office': () => switchView(OfficeView),
      '#/dashboard': () => switchView(DashboardView),
      '#/agents': () => switchView(AgentsView),
      '#/tasks': () => switchView(TasksView),
      '#/projects': () => switchView(ProjectsView),
      '#/approvals': () => switchView(ApprovalsView),
      '#/deliverables': () => switchView(DeliverablesView),
      '#/activities': () => switchView(ActivitiesView),
      '#/settings': () => switchView(SettingsView),
      '#/login': () => switchView(LoginView)
    };

    this.router = new Router(routes, '#/office');
    this.router.init();

    // 5. Logout Handler
    document.getElementById('nav-logout-btn')?.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await api.post('/api/auth/logout');
        store.setState({ user: null });

        // Clear Service Worker API cache to prevent cross-account data leakage
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'logout' });
        }

        window.location.hash = '#/login';
      } catch (err) {
        console.error('Logout error:', err);
      }
    });

    // 6. Reactive status updates. The indicator distinguishes TWO independent
    // channels: the office WebSocket gateway (wsConnected) and the Hermes
    // runtime availability (runtimeStatus, fed by runtime.status.changed).
    // When the runtime is explicitly reported disconnected, the UI shows
    // "Runtime Offline" even though the WebSocket itself is still live.
    // Tamu (tidak ada user) tidak punya kanal realtime -> "Offline", bukan
    // "Live Realtime". Logika ada di core/runtime-indicator.js (uji unit).
    const renderRuntimeIndicator = () => {
      const dot = document.getElementById('runtime-dot');
      const text = document.getElementById('runtime-text');
      if (!dot || !text) return;
      const { dotClass, text: label } = resolveRuntimeIndicator(store.state);
      dot.className = dotClass;
      text.innerText = label;
    };
    store.subscribe((key) => {
      if (key === 'state_updated' || key === 'runtime_status_changed') {
        renderRuntimeIndicator();
      }
    });
    // Boot: tamu tidak memicu event store apa pun (connect() return lebih awal;
    // setState({csrfToken}) terjadi sebelum subscribe), jadi render sekali di
    // sini agar indikator tidak tertinggal di default statis "Live Realtime".
    renderRuntimeIndicator();

    // Command Palette - register available commands
    const user = store.state.user;
    const cmds = [
      { id: 'nav-office', label: 'Office View', description: 'Buka tampilan ruang kerja virtual', icon: 'O', shortcut: '#/office', action: () => { window.location.hash = '#/office'; commandPalette.close(); } },
      { id: 'nav-dashboard', label: 'Dashboard', description: 'Ringkasan statistik dan aktivitas', icon: 'D', shortcut: '#/dashboard', action: () => { window.location.hash = '#/dashboard'; commandPalette.close(); } },
      { id: 'nav-tasks', label: 'Task Board', description: 'Kelola task multi-agent', icon: 'T', shortcut: '#/tasks', action: () => { window.location.hash = '#/tasks'; commandPalette.close(); } },
      { id: 'nav-agents', label: 'Agents', description: 'Profile dan status agen', icon: 'A', shortcut: '#/agents', action: () => { window.location.hash = '#/agents'; commandPalette.close(); } },
      { id: 'nav-approvals', label: 'Approvals', description: 'Persetujuan task tertunda', icon: 'P', shortcut: '#/approvals', action: () => { window.location.hash = '#/approvals'; commandPalette.close(); } },
      { id: 'nav-settings', label: 'Settings', description: 'Konfigurasi sistem', icon: 'S', shortcut: '#/settings', action: () => { window.location.hash = '#/settings'; commandPalette.close(); } },
      { id: 'create-task', label: 'Create New Task', description: 'Buat task baru untuk agen', icon: '+' , shortcut: 'Ctrl+N', action: () => { document.getElementById('btn-create-task')?.click(); commandPalette.close(); } },
      { id: 'toggle-theme', label: 'Toggle Theme', description: 'Ganti tema gelap/terang', icon: '🌓', shortcut: '', action: () => { if (window.themeManager) window.themeManager.toggleTheme(); commandPalette.close(); } },
      { id: 'logout', label: 'Logout', description: 'Keluar dari sesi', icon: '🚪', shortcut: '', action: () => { document.getElementById('nav-logout-btn')?.click(); commandPalette.close(); } }
    ];
    commandPalette.register(cmds);
    window.commandPalette = commandPalette;

    // Accessibility: skip link, screen reader regions
    Accessibility.injectSkipLink();
    window.Accessibility = Accessibility;
  }

  setupWsOfflineBanner() {
    store.subscribe((key, state) => {
      if (key !== 'ws_connected') return;

      if (state.wsConnected === false) {
        this.wsDisconnectedAt = Date.now();
        // Show banner after 3 seconds of disconnection
        setTimeout(() => {
          if (this.wsDisconnectedAt && Date.now() - this.wsDisconnectedAt >= 3000) {
            this.showWsOfflineBanner();
          }
        }, 3000);
      } else if (state.wsConnected === true) {
        this.wsDisconnectedAt = null;
        this.hideWsOfflineBanner();
      }
    });
  }

  showWsOfflineBanner() {
    if (this.wsOfflineBanner) return;

    this.wsOfflineBanner = document.createElement('div');
    this.wsOfflineBanner.id = 'ws-offline-banner';
    this.wsOfflineBanner.className = 'fixed top-0 left-0 right-0 z-[200] animate-slide-in';
    this.wsOfflineBanner.innerHTML = `
      <div class="alert alert-warning mx-4 mt-4 rounded-lg shadow-lg border border-warning/30" role="alert" aria-live="assertive">
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <i class="fi fi-rr-wifi-slash text-warning text-xl"></i>
            <div>
              <div class="font-semibold text-warning">Koneksi realtime terputus</div>
              <div class="text-sm text-base-content/80">Mencoba menyambung kembali secara otomatis...</div>
            </div>
          </div>
          <button class="btn btn-sm btn-warning gap-2" id="ws-reconnect-btn">
            <i class="fi fi-rr-refresh text-xs"></i>
            <span>Coba Lagi</span>
          </button>
        </div>
      </div>
    `;
    document.body.prepend(this.wsOfflineBanner);

    document.getElementById('ws-reconnect-btn')?.addEventListener('click', () => {
      realtimeClient.connect();
    });
  }

  hideWsOfflineBanner() {
    if (this.wsOfflineBanner) {
      this.wsOfflineBanner.classList.add('animate-fade-out');
      setTimeout(() => {
        this.wsOfflineBanner?.remove();
        this.wsOfflineBanner = null;
      }, 300);
    }
  }

  initThemeController() {
    const savedTheme = localStorage.getItem('bangron_theme') || 'night';
    this.applyTheme(savedTheme);

    const themeButtons = document.querySelectorAll('.theme-choice');
    themeButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const targetBtn = e.target.closest('.theme-choice');
        if (!targetBtn) return;
        const theme = targetBtn.dataset.theme;
        this.applyTheme(theme);
        localStorage.setItem('bangron_theme', theme);
      });
    });
  }

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    const label = document.getElementById('current-theme-label');
    if (label) {
      label.innerText = theme;
    }

    document.querySelectorAll('.theme-choice').forEach((btn) => {
      if (btn.dataset.theme === theme) {
        btn.classList.add('active', 'bg-primary', 'text-primary-content');
      } else {
        btn.classList.remove('active', 'bg-primary', 'text-primary-content');
      }
    });
  }

  updateUserUI(user) {
    const nameEl = document.getElementById('nav-user-name');
    if (nameEl) {
      nameEl.innerText = user.name || 'Director Bangron';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
