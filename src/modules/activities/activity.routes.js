import { Router } from 'express';
import { activityController } from './activity.controller.js';
import { authenticate } from '../../middleware/authentication.js';

const router = Router();

router.get('/', authenticate, activityController.getAll);

export default router;
