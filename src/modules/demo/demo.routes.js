import { Router } from 'express';
import { demoController } from './demo.controller.js';
import { authenticate } from '../../middleware/authentication.js';
import { requireDirector } from '../../middleware/authorization.js';

const router = Router();

router.get('/status', authenticate, demoController.getStatus);
router.post('/reset', authenticate, requireDirector, demoController.reset);
router.post('/step', authenticate, requireDirector, demoController.step);
router.post('/autoplay', authenticate, requireDirector, demoController.setAutoplay);

export default router;
