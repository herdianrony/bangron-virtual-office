import { VirtualOfficeService } from './virtual-office.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export class VirtualOfficeController {
  constructor() {
    this.service = new VirtualOfficeService();
  }

  getState = (req, res) => {
    try {
      const state = this.service.getFullState();
      return sendSuccess(res, state);
    } catch (err) {
      return sendError(res, 'OFFICE_STATE_ERROR', err.message, [], 500);
    }
  };

  getRooms = (req, res) => {
    try {
      const rooms = this.service.getRooms();
      return sendSuccess(res, rooms);
    } catch (err) {
      return sendError(res, 'ROOMS_FETCH_ERROR', err.message, [], 500);
    }
  };

  getAgents = (req, res) => {
    try {
      const agents = this.service.getAgents();
      return sendSuccess(res, agents);
    } catch (err) {
      return sendError(res, 'AGENTS_FETCH_ERROR', err.message, [], 500);
    }
  };

  updatePosition = (req, res) => {
    try {
      const { id } = req.params;
      const { roomId, workstationId, positionX, positionY, direction } = req.body;

      if (!roomId || positionX === undefined || positionY === undefined) {
        return sendError(res, 'VALIDATION_ERROR', 'roomId, positionX, and positionY are required', [], 400);
      }

      const updated = this.service.updateAgentPosition(id, {
        roomId,
        workstationId: workstationId || null,
        positionX: parseFloat(positionX),
        positionY: parseFloat(positionY),
        direction: direction || 'SE'
      });

      return sendSuccess(res, updated, 'Position updated');
    } catch (err) {
      return sendError(res, 'POSITION_UPDATE_ERROR', err.message, [], 500);
    }
  };
}

export const virtualOfficeController = new VirtualOfficeController();
export default virtualOfficeController;
