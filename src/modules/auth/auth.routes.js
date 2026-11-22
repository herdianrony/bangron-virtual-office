import { Router } from 'express';
import { authController } from './auth.controller.js';
import { authenticate, optionalAuthenticate } from '../../middleware/authentication.js';
import { authLimiter } from '../../middleware/rate-limit.js';

const router = Router();

router.post('/login', authLimiter, authController.login);
router.post('/logout', authController.logout);
// `/me` dipanggil SPA setiap boot, termasuk untuk pengunjung anonim. Dengan
// `authenticate` anonim selalu mendapat 401 (konsol penuh entri 401). Pakai
// `optionalAuthenticate`: 200 { user:null, isAuthenticated:false } untuk tamu.
// Endpoint terproteksi lain tetap memakai `authenticate`.
router.get('/me', optionalAuthenticate, authController.getMe);
router.get('/csrf', authController.getCsrf);

export default router;
