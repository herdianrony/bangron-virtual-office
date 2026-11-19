import { Router } from 'express';
import { auditController } from './audit.controller.js';
import { authenticate } from '../../middleware/authentication.js';
import { requireDirector } from '../../middleware/authorization.js';

const router = Router();

router.get('/', authenticate, requireDirector, auditController.getAll);

export default router;
