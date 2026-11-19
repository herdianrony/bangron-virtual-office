import { api } from './core/api.js';
import { store } from './core/store.js';
import Router from './core/router.js';
import { realtimeClient } from './realtime/websocket-client.js';

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
  }

  async init() {
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

    // 3. Setup Routes
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

    // 4. Logout Handler
    document.getElementById('nav-logout-btn')?.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await api.post('/api/auth/logout');
        store.setState({ user: null });
        window.location.hash = '#/login';
      } catch (err) {
        console.error('Logout error:', err);
      }
    });

    // 5. Reactive status updates
    store.subscribe((key) => {
      if (key === 'state_updated') {
        const dot = document.getElementById('runtime-dot');
        const text = document.getElementById('runtime-text');
        if (dot && text) {
          dot.className = `status-dot ${store.state.wsConnected ? 'online' : 'offline'}`;
          text.innerText = store.state.wsConnected ? 'Live Realtime' : 'Reconnecting...';
        }
      }
    });
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
