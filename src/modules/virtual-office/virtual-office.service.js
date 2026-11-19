import { getDatabase } from '../../database/connection.js';
import { OfficeRepository } from '../../database/repositories/office.repository.js';
import { AgentRepository } from '../../database/repositories/agent.repository.js';
import { eventPublisher } from '../../realtime/event-publisher.js';
import { buildOfficeGraph, computeRoute } from '../../services/navigation.js';
import { OFFICE_CORRIDORS, BUILDING_BOUNDS } from '../../services/office-layout.js';

export class VirtualOfficeService {
  constructor(db = null) {
    this.db = db || getDatabase();
    this.officeRepo = new OfficeRepository(this.db);
    this.agentRepo = new AgentRepository(this.db);
  }

  getFullState() {
    const rooms = this.officeRepo.getAllRooms();
    const workstations = this.officeRepo.getAllWorkstations();
    const agents = this.agentRepo.getAllInstances();
    const positions = this.officeRepo.getAllPositions();

    return {
      rooms,
      workstations,
      agents,
      positions,
      corridors: OFFICE_CORRIDORS,
      building: BUILDING_BOUNDS
    };
  }

  getRooms() {
    return this.officeRepo.getAllRooms();
  }

  getAgents() {
    return this.agentRepo.getAllInstances();
  }

  /**
   * Computes a waypoint route between two office points based on the
   * architectural floor plan (corridor-aware, wall-safe walking).
   * @param {Object} [options] forwarded to navigation.computeRoute
   *   (e.g. { laneOffset: 8 } for a keep-left walking lane)
   */
  computeWalkRoute(fromX, fromY, toX, toY, options = {}) {
    const rooms = this.officeRepo.getAllRooms();
    const graph = buildOfficeGraph(rooms, OFFICE_CORRIDORS);
    return computeRoute(graph, fromX, fromY, toX, toY, options);
  }

  /**
   * Updates an agent's position, reserves/releases workstations, and
   * broadcasts a waypoint path so the frontend walks the agent leg by leg.
   */
  updateAgentPosition(agentInstanceId, { roomId, workstationId, positionX, positionY, direction = 'SE', path = null, moveNote = null, arriveStatus = null, reserve = true }) {
    if (reserve && workstationId) {
      const previous = this.officeRepo.getAgentPosition(agentInstanceId);
      if (previous && previous.workstation_id && previous.workstation_id !== workstationId) {
        this.officeRepo.releaseWorkstation(previous.workstation_id);
      }
      this.officeRepo.reserveWorkstation(workstationId, agentInstanceId);
    }

    const posId = this.officeRepo.upsertPosition({
      agentInstanceId,
      roomId,
      workstationId,
      positionX,
      positionY,
      direction
    });

    if (workstationId) {
      this.agentRepo.updateInstanceLocation(agentInstanceId, roomId, workstationId);
    }

    eventPublisher.publishAgentPosition(agentInstanceId, roomId, workstationId, positionX, positionY, direction, {
      path,
      moveNote,
      arriveStatus
    });

    return { id: posId, agentInstanceId, roomId, workstationId, positionX, positionY, direction, path, moveNote, arriveStatus };
  }
}

export default VirtualOfficeService;
