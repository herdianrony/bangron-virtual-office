// Regresi indikator status nav (task t_87db4425):
// Tamu (user null, wsConnected false) TIDAK boleh ditampilkan sebagai
// "Live Realtime". Indikator harus jujur membedakan:
//   - tamu tanpa kanal realtime        -> "Offline"
//   - koneksi WS hidup                  -> "Live Realtime"
//   - runtime Hermes offline (ws hidup)-> "Runtime Offline"
//   - WS ditolak server (4401)          -> "Unauthorized"
//   - terputus & sedang reconnect       -> "Reconnecting..."
import { describe, it, expect } from 'vitest';
import { resolveRuntimeIndicator } from '../../public/assets/js/core/runtime-indicator.js';

const GUEST_STATE = {
  user: null,
  wsConnected: false,
  runtimeStatus: { connected: false, text: 'Disconnected' }
};

describe('resolveRuntimeIndicator', () => {
  it('tamu: wsConnected false -> bukan "Live Realtime"', () => {
    const out = resolveRuntimeIndicator(GUEST_STATE);
    expect(out.text).not.toBe('Live Realtime');
    expect(out.dotClass).not.toMatch(/online/);
  });

  it('tamu: menampilkan "Offline" dengan dot offline', () => {
    const out = resolveRuntimeIndicator(GUEST_STATE);
    expect(out).toEqual({ dotClass: 'status-dot offline', text: 'Offline' });
  });

  it('WS tersambung -> "Live Realtime" dengan dot online', () => {
    const out = resolveRuntimeIndicator({ user: { id: 1 }, wsConnected: true, runtimeStatus: { connected: true } });
    expect(out).toEqual({ dotClass: 'status-dot online', text: 'Live Realtime' });
  });

  it('WS hidup tapi runtime Hermes offline -> "Runtime Offline"', () => {
    const out = resolveRuntimeIndicator({
      user: { id: 1 },
      wsConnected: true,
      runtimeStatus: { connected: false, text: 'Disconnected', reason: 'hermes_disconnected' }
    });
    expect(out).toEqual({ dotClass: 'status-dot offline', text: 'Runtime Offline' });
  });

  it('WS ditolak server (4401) -> "Unauthorized", bukan "Reconnecting..."', () => {
    const out = resolveRuntimeIndicator({
      user: { id: 1 },
      wsConnected: false,
      runtimeStatus: { connected: false, text: 'Unauthorized', reason: 'ws_unauthorized' }
    });
    expect(out).toEqual({ dotClass: 'status-dot offline', text: 'Unauthorized' });
  });

  it('terputus saat reconnect -> "Reconnecting..."', () => {
    const out = resolveRuntimeIndicator({ user: { id: 1 }, wsConnected: false, runtimeStatus: { connected: false } });
    expect(out).toEqual({ dotClass: 'status-dot offline', text: 'Reconnecting...' });
  });

  it('state kosong/null tidak melempar error dan dianggap tamu', () => {
    expect(resolveRuntimeIndicator(null)).toEqual({ dotClass: 'status-dot offline', text: 'Offline' });
    expect(resolveRuntimeIndicator(undefined)).toEqual({ dotClass: 'status-dot offline', text: 'Offline' });
  });
});
