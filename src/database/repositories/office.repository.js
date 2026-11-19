import { generateId } from '../../utils/crypto.js';

export class OfficeRepository {
  constructor(db) {
    this.db = db;
  }

  // --- Rooms ---
  getAllRooms() {
    return this.db.prepare(`
      SELECT 
        r.*,
        (SELECT COUNT(*) FROM office_workstations WHERE room_id = r.id) as workstation_count,
        (SELECT COUNT(*) FROM agent_instances WHERE current_room_id = r.id) as agent_count
      FROM office_rooms r
      WHERE r.is_active = 1
      ORDER BY r.name ASC
    `).all();
  }

  getRoomById(id) {
    return this.db.prepare('SELECT * FROM office_rooms WHERE id = ?').get(id);
  }

  getRoomBySlug(slug) {
    return this.db.prepare('SELECT * FROM office_rooms WHERE slug = ?').get(slug);
  }

  createRoom({ id, name, slug, department, description = '', positionX, positionY, width, height, metadata = {} }) {
    const roomId = id || generateId('room');
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO office_rooms (id, name, slug, department, description, position_x, position_y, width, height, metadata_json, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(roomId, name, slug, department, description, positionX, positionY, width, height, JSON.stringify(metadata), now, now);
    return this.getRoomById(roomId);
  }

  // --- Workstations ---
  getAllWorkstations(roomId = null) {
    let query = `
      SELECT 
        w.*,
        r.name as room_name,
        ai.id as occupied_by_agent_id,
        ai.display_name as occupied_by_agent_name
      FROM office_workstations w
      JOIN office_rooms r ON w.room_id = r.id
      LEFT JOIN agent_instances ai ON ai.current_workstation_id = w.id
    `;
    const params = [];
    if (roomId) {
      query += ' WHERE w.room_id = ?';
      params.push(roomId);
    }
    query += ' ORDER BY w.room_id, w.name ASC';
    return this.db.prepare(query).all(...params);
  }

  getWorkstationById(id) {
    return this.db.prepare('SELECT * FROM office_workstations WHERE id = ?').get(id);
  }

  reserveWorkstation(id, agentInstanceId) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE office_workstations
      SET status = 'occupied', metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify({ occupied_by: agentInstanceId }), now, id);
    return this.getWorkstationById(id);
  }

  releaseWorkstation(id) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE office_workstations
      SET status = 'available', metadata_json = '{}', updated_at = ?
      WHERE id = ?
    `).run(now, id);
    return this.getWorkstationById(id);
  }

  createWorkstation({ id, roomId, name, workstationType = 'desk', positionX, positionY, capacity = 1, metadata = {} }) {
    const wsId = id || generateId('ws');
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO office_workstations (id, room_id, name, workstation_type, position_x, position_y, capacity, status, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?)
    `).run(wsId, roomId, name, workstationType, positionX, positionY, capacity, JSON.stringify(metadata), now, now);
    return this.db.prepare('SELECT * FROM office_workstations WHERE id = ?').get(wsId);
  }

  // --- Positions ---
  getAllPositions() {
    return this.db.prepare(`
      SELECT 
        p.*,
        ai.display_name,
        ai.status as agent_status,
        ap.name as profile_name,
        ap.department,
        r.name as room_name,
        w.name as workstation_name
      FROM office_positions p
      JOIN agent_instances ai ON p.agent_instance_id = ai.id
      JOIN agent_profiles ap ON ai.profile_id = ap.id
      JOIN office_rooms r ON p.room_id = r.id
      LEFT JOIN office_workstations w ON p.workstation_id = w.id
    `).all();
  }

  getAgentPosition(agentInstanceId) {
    return this.db.prepare('SELECT * FROM office_positions WHERE agent_instance_id = ?').get(agentInstanceId);
  }

  upsertPosition({ agentInstanceId, roomId, workstationId = null, positionX, positionY, direction = 'SE' }) {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT id FROM office_positions WHERE agent_instance_id = ?').get(agentInstanceId);

    if (existing) {
      this.db.prepare(`
        UPDATE office_positions SET
          room_id = ?, workstation_id = ?, position_x = ?, position_y = ?, direction = ?, updated_at = ?
        WHERE agent_instance_id = ?
      `).run(roomId, workstationId, positionX, positionY, direction, now, agentInstanceId);
      return existing.id;
    } else {
      const posId = generateId('pos');
      this.db.prepare(`
        INSERT INTO office_positions (id, agent_instance_id, room_id, workstation_id, position_x, position_y, direction, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(posId, agentInstanceId, roomId, workstationId, positionX, positionY, direction, now);
      return posId;
    }
  }
}

export default OfficeRepository;
