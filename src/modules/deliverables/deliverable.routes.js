import { Router } from 'express';
import { deliverableController } from './deliverable.controller.js';
import { authenticate } from '../../middleware/authentication.js';

const router = Router();

router.get('/', authenticate, deliverableController.getAll);
router.get('/:id', authenticate, deliverableController.getById);
router.get('/:id/download', authenticate, deliverableController.download);

export default router;
