export class SettingsRepository {
  constructor(db) {
    this.db = db;
  }

  getSetting(key) {
    const row = this.db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get(key);
    return row ? row.setting_value : null;
  }

  getAllSettings(includeSecrets = false) {
    const query = includeSecrets
      ? 'SELECT setting_key, setting_value, is_secret, updated_at FROM system_settings'
      : "SELECT setting_key, CASE WHEN is_secret = 1 THEN '********' ELSE setting_value END as setting_value, is_secret, updated_at FROM system_settings";
    return this.db.prepare(query).all();
  }

  setSetting(key, value, isSecret = 0) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO system_settings (setting_key, setting_value, is_secret, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        is_secret = excluded.is_secret,
        updated_at = excluded.updated_at
    `).run(key, value, isSecret ? 1 : 0, now);
  }
}

export default SettingsRepository;
