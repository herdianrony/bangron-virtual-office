import { store } from '../core/store.js';

export class RealtimeClient {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelayMs = 2000;
  }

  connect() {
    // Tamu (belum terautentikasi) tidak boleh membuka koneksi WS: server
    // menolak dengan close code 4401 dan klien akan menjadwalkan reconnect
    // berulang tanpa henti. Setelah login, login-view memuat ulang halaman
    // sehingga store.state.user sudah terisi sebelum connect() dipanggil.
    if (!store.state.user) {
      console.log('[Realtime] Skip: belum terautentikasi.');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        store.setState({
          wsConnected: true,
          runtimeStatus: { connected: true, text: 'Connected', reason: 'websocket_connected', timestamp: new Date().toISOString() }
        });
        console.log('[Realtime] WebSocket connected to Bangron Virtual Office Gateway.');
      };

      this.ws.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data);
          this.handleEvent(envelope);
        } catch (err) {
          console.error('[Realtime] Failed to parse message:', err);
        }
      };

      this.ws.onclose = (event) => {
        store.setState({ wsConnected: false });
        // 4401 = server menolak koneksi karena autentikasi (tamu/sesi habis).
        // Reconnect hanya akan menghasilkan penolakan yang sama; hentikan.
        if (event.code === 4401) {
          console.warn('[Realtime] 4401: koneksi ditolak server, reconnect dihentikan.');
          store.setState({
            runtimeStatus: {
              connected: false,
              text: 'Unauthorized',
              reason: 'ws_unauthorized',
              timestamp: new Date().toISOString()
            }
          });
          return;
        }
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn('[Realtime] WebSocket error:', err);
        this.ws.close();
      };
    } catch (err) {
      console.error('[Realtime] Connection initiation error:', err);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(this.reconnectDelayMs * Math.pow(1.5, this.reconnectAttempts - 1), 20000);
      console.log(`[Realtime] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts})...`);
      setTimeout(() => this.connect(), delay);
    }
  }

  handleEvent(envelope) {
    const { type, data } = envelope;

    switch (type) {
      case 'office.state.snapshot':
        store.setState({
          rooms: data.rooms || [],
          workstations: data.workstations || [],
          tasks: data.activeTasks || []
        });
        if (data.agents) {
          store.setAgents(data.agents);
        }
        break;

      case 'agent.status.updated':
        if (data.agent_instance_id) {
          store.updateAgent(data.agent_instance_id, { status: data.status, ...data });
        }
        break;

      case 'agent.created':
        // Agen baru hasil auto-provisioning Hermes: masukkan ke store agar
        // avatar langsung dirender tanpa reload halaman.
        if (data && data.id) {
          store.updateAgent(data.id, data);
        }
        break;

      case 'agent.position.updated':
        if (data.agent_instance_id) {
          store.updateAgent(data.agent_instance_id, {
            room_id: data.room_id,
            workstation_id: data.workstation_id,
            position_x: data.position_x,
            position_y: data.position_y,
            target_x: data.position_x,
            target_y: data.position_y,
            direction: data.direction,
            path: data.path || null,
            move_note: data.move_note || null,
            arrive_status: data.arrive_status || null
          });
        }
        break;

      case 'task.status.updated':
        // Update task list in store
        const tasks = [...store.state.tasks];
        const idx = tasks.findIndex((t) => t.id === data.id);
        if (idx >= 0) {
          tasks[idx] = data;
        } else {
          tasks.unshift(data);
        }
        store.setState({ tasks });
        break;

      case 'approval.updated':
        store.notify('approval_updated', data);
        break;

      case 'agent.activity.created':
        store.addActivity(data);
        break;

      case 'demo.reset':
        // Request fresh snapshot
        this.send({ type: 'request_snapshot' });
        break;

      case 'runtime.status.changed':
        // Runtime availability changed (connect/disconnect). This is
        // SEPARATE from agent lifecycle status — the frontend derives
        // "Offline" avatar appearance from runtimeStatus while preserving
        // the actual lifecycle state (queued/working/etc.).
        store.setState({
          runtimeStatus: {
            connected: !!data.connected,
            text: data.connected ? 'Connected' : 'Disconnected',
            reason: data.reason,
            timestamp: data.timestamp
          }
        });
        store.notify('runtime_status_changed', data);
        break;
    }
  }

  send(msgObj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msgObj));
    }
  }
}

export const realtimeClient = new RealtimeClient();
export default realtimeClient;
