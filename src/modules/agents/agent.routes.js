import { Router } from 'express';
import { agentController } from './agent.controller.js';
import { authenticate } from '../../middleware/authentication.js';
import { requireDirector } from '../../middleware/authorization.js';

const router = Router();

router.get('/', authenticate, agentController.getAll);
router.get('/capabilities', authenticate, agentController.getCapabilities);
router.get('/:id', authenticate, agentController.getById);
router.post('/', authenticate, requireDirector, agentController.createProfile);
router.patch('/:id', authenticate, requireDirector, agentController.updateProfile);
router.post('/:id/commands', authenticate, requireDirector, agentController.sendCommand);

export default router;
