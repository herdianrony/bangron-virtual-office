import { HermesProfileSync } from './profile-sync.js';

/**
 * Singleton dipakai route dan startup. DB diambil lazy agar modul bisa diimpor
 * sebelum koneksi database dibuka (mis. oleh test).
 */
export const hermesProfileSync = {
  instance: null,
  get() {
    if (!this.instance) {
      // lazy import menghindari circular dependency dengan database connection
      // eslint-disable-next-line no-undef
      this.instance = new HermesProfileSync(globalThis.__voDb || null);
    }
    return this.instance;
  },
  sync() { return this.get().sync(); },
  setDb(db) { this.instance = new HermesProfileSync(db); }
};

export default hermesProfileSync;
