import { Router } from 'express';
import { virtualOfficeController } from './virtual-office.controller.js';
import { authenticate } from '../../middleware/authentication.js';

const router = Router();

router.get('/state', authenticate, virtualOfficeController.getState);
router.get('/rooms', authenticate, virtualOfficeController.getRooms);
router.get('/agents', authenticate, virtualOfficeController.getAgents);
router.patch('/positions/:id', authenticate, virtualOfficeController.updatePosition);

export default router;
