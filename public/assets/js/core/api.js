export class ApiClient {
  constructor() {
    this.csrfToken = null;
  }

  setCsrfToken(token) {
    this.csrfToken = token;
  }

  // Verifikasi sesi ke server (dipakai untuk membedakan race condition
  // sesaat setelah login vs. logout/session expiry yang benar-benar terjadi)
  async isSessionValid() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!res.ok) return false;
      const json = await res.json();
      return !!(json && json.success && json.data);
    } catch (err) {
      return false;
    }
  }

  async request(endpoint, options = {}, _retryCount = 0) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (this.csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method)) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }

    try {
      const res = await fetch(endpoint, {
        ...options,
        headers,
        credentials: 'same-origin'
      });

      if (res.status === 401) {
        if (endpoint.includes('/api/auth/me')) {
          return null;
        }
        if (!endpoint.includes('/api/auth/')) {
          // Race condition guard: sesaat setelah login (yang melakukan full page
          // reload), fetch pertama bisa 401 karena cookie sesi belum sepenuhnya
          // ter-commit di browser. Jangan langsung melempar user ke halaman login:
          // tunggu lalu ulangi request beberapa kali, dan hanya redirect jika
          // /api/auth/me mengonfirmasi sesi benar-benar habis.
          const MAX_RETRIES = 3;
          if ((_retryCount || 0) < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 400 * ((_retryCount || 0) + 1)));
            return this.request(endpoint, options, (_retryCount || 0) + 1);
          }
          if (!(await this.isSessionValid())) {
            window.location.hash = '#/login';
            throw new Error('Session expired. Please log in.');
          }
          throw new Error(`Request ke ${endpoint} gagal setelah beberapa kali percobaan.`);
        }
      }

      const json = await res.json();
      if (!res.ok || !json.success) {
        const errorMsg = json.error ? json.error.message : `HTTP ${res.status}`;
        throw new Error(errorMsg);
      }

      return json.data;
    } catch (err) {
      if (!endpoint.includes('/api/auth/me')) {
        console.error(`API Error [${endpoint}]:`, err.message);
      }
      throw err;
    }
  }

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  }

  post(endpoint, data = {}) {
    return this.request(endpoint, { method: 'POST', body: JSON.stringify(data) });
  }

  patch(endpoint, data = {}) {
    return this.request(endpoint, { method: 'PATCH', body: JSON.stringify(data) });
  }

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
export default api;
