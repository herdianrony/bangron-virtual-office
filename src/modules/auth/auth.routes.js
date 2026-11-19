import { Router } from 'express';
import { authController } from './auth.controller.js';
import { authenticate } from '../../middleware/authentication.js';
import { authLimiter } from '../../middleware/rate-limit.js';

const router = Router();

router.post('/login', authLimiter, authController.login);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.getMe);
router.get('/csrf', authController.getCsrf);

export default router;
