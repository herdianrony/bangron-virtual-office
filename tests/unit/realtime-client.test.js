import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealtimeClient } from '../../public/assets/js/realtime/websocket-client.js';
import { store } from '../../public/assets/js/core/store.js';

// WebSocket palsu: menangkap instance yang dibuat klien tanpa jaringan nyata.
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  send() {}
}

describe('RealtimeClient — penjaga koneksi', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('window', { location: { protocol: 'https:', host: 'studio.example' } });
    store.setState({
      user: null,
      wsConnected: false,
      runtimeStatus: { connected: false, text: 'Disconnected' }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('tidak membuka WebSocket sama sekali bila belum terautentikasi', () => {
    const client = new RealtimeClient();
    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(store.state.wsConnected).toBe(false);
  });

  it('membuka WebSocket dan menandai terhubung bila sudah login', () => {
    store.setState({ user: { id: 1, name: 'Director', role: 'director' } });
    const client = new RealtimeClient();
    client.connect();

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].onopen();
    expect(store.state.wsConnected).toBe(true);
  });

  it('berhenti reconnect saat server menutup dengan 4401', () => {
    vi.useFakeTimers();
    store.setState({ user: { id: 1, name: 'Director', role: 'director' } });
    const client = new RealtimeClient();
    client.connect();

    const ws = FakeWebSocket.instances[0];
    ws.onopen();
    ws.onclose({ code: 4401, reason: 'Authentication required' });

    expect(store.state.wsConnected).toBe(false);
    expect(store.state.runtimeStatus.reason).toBe('ws_unauthorized');

    // Penjadwal reconnect tidak boleh membuat koneksi baru dalam 60 detik.
    vi.advanceTimersByTime(60000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('tetap reconnect untuk penutupan abnormal (1006)', () => {
    vi.useFakeTimers();
    store.setState({ user: { id: 1, name: 'Director', role: 'director' } });
    const client = new RealtimeClient();
    client.connect();

    const ws = FakeWebSocket.instances[0];
    ws.onopen();
    ws.onclose({ code: 1006 });

    vi.advanceTimersByTime(3000);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
  });
});
