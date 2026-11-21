import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../../public/assets/js/core/api.js';

// Helper: Response-like object Minimal yang dipakai isSessionValid().
const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});

describe('api.isSessionValid()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tamu: 200 { user:null, isAuthenticated:false } -> false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, { success: true, data: { user: null, isAuthenticated: false } })
      )
    );
    expect(await api.isSessionValid()).toBe(false);
  });

  it('pengguna login: 200 { isAuthenticated:true, user } -> true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, {
          success: true,
          data: { isAuthenticated: true, user: { id: 1, name: 'Director', role: 'director' } }
        })
      )
    );
    expect(await api.isSessionValid()).toBe(true);
  });

  it('payload lama tanpa isAuthenticated tetapi ada user -> true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, { success: true, data: { user: { id: 1, name: 'Director' } } })
      )
    );
    expect(await api.isSessionValid()).toBe(true);
  });

  it('data null -> false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { success: true, data: null })));
    expect(await api.isSessionValid()).toBe(false);
  });

  it('HTTP 401 -> false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, { success: false, error: { message: 'Authentication required.' } }))
    );
    expect(await api.isSessionValid()).toBe(false);
  });

  it('network error -> false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    expect(await api.isSessionValid()).toBe(false);
  });
});
