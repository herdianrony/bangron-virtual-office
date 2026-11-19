import { Router } from 'express';
import { projectController } from './project.controller.js';
import { authenticate } from '../../middleware/authentication.js';
import { requireDirector } from '../../middleware/authorization.js';

const router = Router();

router.get('/', authenticate, projectController.getAll);
router.get('/:id', authenticate, projectController.getById);
router.post('/', authenticate, requireDirector, projectController.create);

export default router;
