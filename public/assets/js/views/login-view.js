import { api } from '../core/api.js';
import { toast } from '../core/toast.js';
import { store } from '../core/store.js';
import { realtimeClient } from '../realtime/websocket-client.js';

export class LoginView {
  constructor(container) {
    this.container = container;
  }

  async render() {
    this.container.innerHTML = `
      <div class="min-h-[80vh] flex items-center justify-center p-4">
        <div class="card w-full max-w-md bg-base-200 border border-base-content/10 shadow-2xl rounded-box overflow-hidden">
          <div class="card-body p-8 space-y-5">
            <div class="text-center space-y-2">
              <div class="inline-flex p-3 rounded-2xl bg-primary/10 text-primary">
                <i class="fi fi-rr-shield-check text-3xl"></i>
              </div>
              <h2 class="text-2xl font-bold tracking-tight text-base-content">Director Portal</h2>
              <p class="text-xs text-base-content/60">Authenticated access for Bangron digital studio leadership.</p>
            </div>

            <form id="login-form" class="space-y-4 pt-2">
              <div id="login-error-alert" class="alert alert-error text-xs hidden py-2.5 rounded-lg">
                <i class="fi fi-rr-cross-circle"></i>
                <span id="login-error-msg">Invalid credentials</span>
              </div>

              <div>
                <label class="label text-xs font-semibold text-base-content/80 pb-1">Director Email or Username</label>
                <div class="relative">
                  <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-base-content/40">
                    <i class="fi fi-rr-user text-xs"></i>
                  </span>
                  <input type="text" id="login-username" placeholder="director@example.com" autocomplete="username" required class="input input-bordered input-sm w-full pl-8 bg-base-100 border-base-content/20 text-base-content" />
                </div>
              </div>

              <div>
                <label class="label text-xs font-semibold text-base-content/80 pb-1">Director Password</label>
                <div class="relative">
                  <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-base-content/40">
                    <i class="fi fi-rr-lock text-xs"></i>
                  </span>
                  <input type="password" id="login-password" placeholder="••••••••••••" autocomplete="current-password" required class="input input-bordered input-sm w-full pl-8 bg-base-100 border-base-content/20 text-base-content" />
                </div>
              </div>

              <div class="pt-2">
                <button type="submit" class="btn btn-primary btn-sm w-full gap-2 shadow-lg" id="login-submit-btn">
                  <i class="fi fi-rr-sign-in-alt text-xs"></i>
                  <span>Authenticate Director Access</span>
                </button>
              </div>
            </form>

            <div class="text-[11px] text-base-content/70 bg-base-300/60 p-3.5 rounded-lg border border-base-content/10 space-y-1.5">
              <div class="font-bold text-base-content flex items-center gap-1.5">
                <i class="fi fi-rr-info text-info text-xs"></i>
                Access Notice:
              </div>
              <div>Credentials are provisioned by the studio administrator. Contact the Director if you need access.</div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.initEvents();
  }

  initEvents() {
    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('login-error-alert');
      const errMsg = document.getElementById('login-error-msg');
      const submitBtn = document.getElementById('login-submit-btn');

      try {
        errBox.classList.add('hidden');
        submitBtn.disabled = true;

        const identifier = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;

        const res = await api.post('/api/auth/login', {
          email: identifier,
          username: identifier,
          password
        });

        if (res && res.user) {
          if (res.csrfToken) {
            api.setCsrfToken(res.csrfToken);
            store.setState({ csrfToken: res.csrfToken });
          }
          store.setState({ user: res.user });
          // Re-establish WebSocket now that user is authenticated
          realtimeClient.connect();
          // Restore previous view hash without full page reload
          const preLoginHash = sessionStorage.getItem('preLoginHash') || '#/office';
          sessionStorage.removeItem('preLoginHash');
          toast.success('Login berhasil. Selamat datang, Director.');
          window.location.hash = preLoginHash;
        }
      } catch (err) {
        errMsg.innerText = err.message || 'Login failed';
        errBox.classList.remove('hidden');
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  destroy() {}
}

export default LoginView;
