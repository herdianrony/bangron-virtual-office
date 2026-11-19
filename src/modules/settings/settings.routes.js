import { Router } from 'express';
import { settingsController } from './settings.controller.js';
import { authenticate } from '../../middleware/authentication.js';
import { requireDirector } from '../../middleware/authorization.js';

const router = Router();

router.get('/', authenticate, settingsController.getAll);
router.patch('/', authenticate, requireDirector, settingsController.updateSetting);

export default router;
