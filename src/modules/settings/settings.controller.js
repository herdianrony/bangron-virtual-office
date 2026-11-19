import { getDatabase } from '../../database/connection.js';
import { SettingsRepository } from '../../database/repositories/settings.repository.js';
import { AuditRepository } from '../../database/repositories/audit.repository.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export class SettingsController {
  constructor(db = null) {
    this.db = db || getDatabase();
    this.settingsRepo = new SettingsRepository(this.db);
    this.auditRepo = new AuditRepository(this.db);
  }

  getAll = (req, res) => {
    try {
      const settings = this.settingsRepo.getAllSettings(false); // Secrets masked
      return sendSuccess(res, settings);
    } catch (err) {
      return sendError(res, 'SETTINGS_FETCH_ERROR', err.message, [], 500);
    }
  };

  updateSetting = (req, res) => {
    try {
      const { key, value, isSecret } = req.body;
      if (!key || value === undefined) {
        return sendError(res, 'VALIDATION_ERROR', 'key and value are required', [], 400);
      }

      this.settingsRepo.setSetting(key, String(value), isSecret ? 1 : 0);

      this.auditRepo.log({
        actorType: 'user',
        actorId: req.user ? String(req.user.id) : 'director',
        action: 'system_setting.updated',
        resourceType: 'system_setting',
        resourceId: key,
        after: { key, value: isSecret ? '********' : value }
      });

      return sendSuccess(res, { key, value: isSecret ? '********' : value }, 'Setting updated successfully');
    } catch (err) {
      return sendError(res, 'SETTING_UPDATE_ERROR', err.message, [], 500);
    }
  };
}

export const settingsController = new SettingsController();
export default settingsController;
