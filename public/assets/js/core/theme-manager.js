/**
 * Theme Manager - System theme detection & manual override
 * Handles prefers-color-scheme, localStorage persistence, DaisyUI theme switching
 */

export class ThemeManager {
  constructor() {
    this.currentTheme = 'light';
    this.systemTheme = 'light';
    this.listeners = new Set();
    this.mediaQuery = null;
  }

  init() {
    // Detect system preference
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.systemTheme = this.mediaQuery.matches ? 'dark' : 'light';
    this.mediaQuery.addEventListener('change', this.handleSystemThemeChange.bind(this));

    // Load persisted theme or default to system
    const saved = localStorage.getItem('theme');
    if (saved && ['light', 'dark', 'system'].includes(saved)) {
      this.currentTheme = saved;
    } else {
      this.currentTheme = 'system';
    }

    this.applyTheme();
    return this;
  }

  handleSystemThemeChange(e) {
    this.systemTheme = e.matches ? 'dark' : 'light';
    if (this.currentTheme === 'system') {
      this.applyTheme();
      this.notify();
    }
  }

  getEffectiveTheme() {
    if (this.currentTheme === 'system') return this.systemTheme;
    return this.currentTheme;
  }

  setTheme(theme) {
    if (!['light', 'dark', 'system'].includes(theme)) return false;
    this.currentTheme = theme;
    localStorage.setItem('theme', theme);
    this.applyTheme();
    this.notify();
    return true;
  }

  toggleTheme() {
    const effective = this.getEffectiveTheme();
    const newTheme = effective === 'dark' ? 'light' : 'dark';
    this.setTheme(newTheme);
  }

  applyTheme() {
    const effective = this.getEffectiveTheme();
    document.documentElement.setAttribute('data-theme', effective);
    
    // Also set DaisyUI theme if available
    if (window.daisyUI) {
      window.daisyUI.setTheme(effective);
    }
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify() {
    const effective = this.getEffectiveTheme();
    this.listeners.forEach(cb => cb(effective, this.currentTheme));
  }

  destroy() {
    if (this.mediaQuery) {
      this.mediaQuery.removeEventListener('change', this.handleSystemThemeChange.bind(this));
    }
    this.listeners.clear();
  }
}

// Global singleton
export const themeManager = new ThemeManager();

// Initialize on DOM ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => themeManager.init());
  } else {
    themeManager.init();
  }
}

export default themeManager;