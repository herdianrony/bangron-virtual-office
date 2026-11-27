import { Router } from 'express';
import { agentController } from './agent.controller.js';
import { authenticate } from '../../middleware/authentication.js';
import { requireDirector } from '../../middleware/authorization.js';
import { hermesProfileSync } from '../../integrations/hermes/profile-sync-instance.js';

const router = Router();

router.get('/', authenticate, agentController.getAll);
router.get('/capabilities', authenticate, agentController.getCapabilities);
router.get('/:id', authenticate, agentController.getById);
router.post('/', authenticate, requireDirector, agentController.createProfile);
router.patch('/:id', authenticate, requireDirector, agentController.updateProfile);
router.post('/:id/commands', authenticate, requireDirector, agentController.sendCommand);
router.post('/sync-hermes', authenticate, requireDirector, (req, res) => {
  try {
    const result = hermesProfileSync.sync();
    return res.json({ success: true, data: result, message: 'Hermes profile sync completed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: err.message } });
  }
});

export default router;
