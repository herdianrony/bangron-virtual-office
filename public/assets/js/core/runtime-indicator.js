// Resolusi indikator status nav (task t_87db4425).
//
// Indikator di nav memuat dua kanal independen: koneksi WebSocket kantor
// (wsConnected) dan ketersediaan runtime Hermes (runtimeStatus). Fungsi ini
// murni dan deterministik sehingga bisa diuji unit tanpa DOM.
//
// Aturan urutan (yang paling spesifik menang):
//   1. WS ditolak server (4401)                 -> "Unauthorized"
//   2. WS mati + runtime Hermes offline (reason)-> "Runtime Offline"
//   3. WS mati + tamu (tidak ada user)          -> "Offline"
//   4. WS mati + sesi ada                        -> "Reconnecting..."
//   5. WS hidup                                  -> "Live Realtime"
export const RUNTIME_INDICATOR = {
  live: { dotClass: 'status-dot online', text: 'Live Realtime' },
  offline: { dotClass: 'status-dot offline', text: 'Offline' },
  reconnecting: { dotClass: 'status-dot offline', text: 'Reconnecting...' },
  runtimeOffline: { dotClass: 'status-dot offline', text: 'Runtime Offline' },
  unauthorized: { dotClass: 'status-dot offline', text: 'Unauthorized' }
};

export function resolveRuntimeIndicator(state) {
  const wsConnected = Boolean(state?.wsConnected);
  const user = state?.user ?? null;
  const runtimeStatus = state?.runtimeStatus ?? null;
  const runtimeOffline =
    runtimeStatus && runtimeStatus.connected === false && Boolean(runtimeStatus.reason);

  if (!wsConnected) {
    if (runtimeStatus?.reason === 'ws_unauthorized') return RUNTIME_INDICATOR.unauthorized;
    if (runtimeOffline) return RUNTIME_INDICATOR.runtimeOffline;
    if (!user) return RUNTIME_INDICATOR.offline;
    return RUNTIME_INDICATOR.reconnecting;
  }

  if (runtimeOffline) return RUNTIME_INDICATOR.runtimeOffline;
  return RUNTIME_INDICATOR.live;
}

export default resolveRuntimeIndicator;
