import { AgentService } from './agent.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export class AgentController {
  constructor() {
    this.agentService = new AgentService();
  }

  getAll = (req, res) => {
    try {
      const data = this.agentService.getAll();
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, 'AGENTS_FETCH_ERROR', err.message, [], 500);
    }
  };

  getCapabilities = (req, res) => {
    try {
      const data = this.agentService.getCapabilities();
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, 'CAPABILITIES_FETCH_ERROR', err.message, [], 500);
    }
  };

  getById = (req, res) => {
    try {
      const agent = this.agentService.getById(req.params.id);
      if (!agent) {
        return sendError(res, 'NOT_FOUND', 'Agent instance not found', [], 404);
      }
      return sendSuccess(res, agent);
    } catch (err) {
      return sendError(res, 'AGENT_FETCH_ERROR', err.message, [], 500);
    }
  };

  createProfile = (req, res) => {
    try {
      const { name, slug, department, description, systemRole, capabilities, allowedTools, defaultRoomId } = req.body;
      if (!name || !slug || !department || !systemRole || !defaultRoomId) {
        return sendError(res, 'VALIDATION_ERROR', 'name, slug, department, systemRole, and defaultRoomId are required', [], 400);
      }
      const profile = this.agentService.createProfile(req.body, req.user ? String(req.user.id) : 'director');
      return sendSuccess(res, profile, 'Agent profile created', null, 201);
    } catch (err) {
      return sendError(res, 'PROFILE_CREATE_ERROR', err.message, [], 500);
    }
  };

  updateProfile = (req, res) => {
    try {
      const profile = this.agentService.updateProfile(req.params.id, req.body, req.user ? String(req.user.id) : 'director');
      if (!profile) {
        return sendError(res, 'NOT_FOUND', 'Agent profile not found', [], 404);
      }
      return sendSuccess(res, profile, 'Agent profile updated');
    } catch (err) {
      return sendError(res, 'PROFILE_UPDATE_ERROR', err.message, [], 500);
    }
  };

  sendCommand = (req, res) => {
    try {
      const { command, parameters } = req.body;
      if (!command) {
        return sendError(res, 'VALIDATION_ERROR', 'command is required', [], 400);
      }
      const result = this.agentService.sendCommand(req.params.id, command, parameters, req.user ? String(req.user.id) : 'director');
      return sendSuccess(res, result, 'Command sent to agent');
    } catch (err) {
      return sendError(res, 'COMMAND_ERROR', err.message, [], 500);
    }
  };
}

export const agentController = new AgentController();
export default agentController;
