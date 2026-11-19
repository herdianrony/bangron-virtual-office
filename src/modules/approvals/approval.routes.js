import { Router } from 'express';
import { approvalController } from './approval.controller.js';
import { authenticate } from '../../middleware/authentication.js';
import { requireDirector } from '../../middleware/authorization.js';

const router = Router();

router.get('/', authenticate, approvalController.getAll);
router.get('/:id', authenticate, approvalController.getById);
router.post('/:id/approve', authenticate, requireDirector, approvalController.approve);
router.post('/:id/reject', authenticate, requireDirector, approvalController.reject);

export default router;
