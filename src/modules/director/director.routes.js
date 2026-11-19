import { Router } from 'express';
import { directorController } from './director.controller.js';
import { authenticate } from '../../middleware/authentication.js';
import { requireDirector } from '../../middleware/authorization.js';

const router = Router();

router.get('/dashboard', authenticate, requireDirector, directorController.getDashboardMetrics);

export default router;
