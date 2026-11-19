import { Router } from 'express';
import { taskController } from './task.controller.js';
import { authenticate } from '../../middleware/authentication.js';
import { requireDirector } from '../../middleware/authorization.js';

const router = Router();

router.get('/', authenticate, taskController.getAll);
router.get('/:id', authenticate, taskController.getById);
router.post('/', authenticate, requireDirector, taskController.create);
router.post('/:id/assign', authenticate, requireDirector, taskController.assign);
router.post('/:id/cancel', authenticate, requireDirector, taskController.cancel);
router.post('/:id/retry', authenticate, requireDirector, taskController.retry);
router.post('/:id/dependencies', authenticate, requireDirector, taskController.addDependency);

export default router;
