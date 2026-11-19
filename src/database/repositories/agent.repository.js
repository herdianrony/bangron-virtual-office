import { generateId } from '../../utils/crypto.js';

export class AgentRepository {
  constructor(db) {
    this.db = db;
  }

  // --- Profiles ---
  getAllProfiles() {
    return this.db.prepare('SELECT * FROM agent_profiles ORDER BY department, name ASC').all();
  }

  getProfileById(id) {
    return this.db.prepare('SELECT * FROM agent_profiles WHERE id = ?').get(id);
  }

  createProfile({ id, name, slug, department, description, systemRole, capabilities = [], allowedTools = [], defaultRoomId }) {
    const profileId = id || generateId('prof');
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO agent_profiles (
        id, name, slug, department, description, system_role,
        capabilities_json, allowed_tools_json, default_room_id, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      profileId,
      name,
      slug,
      department,
      description || null,
      systemRole,
      JSON.stringify(capabilities),
      JSON.stringify(allowedTools),
      defaultRoomId,
      now,
      now
    );
    return this.getProfileById(profileId);
  }

  updateProfile(id, updates) {
    const now = new Date().toISOString();
    const current = this.getProfileById(id);
    if (!current) return null;

    const name = updates.name !== undefined ? updates.name : current.name;
    const department = updates.department !== undefined ? updates.department : current.department;
    const description = updates.description !== undefined ? updates.description : current.description;
    const systemRole = updates.systemRole !== undefined ? updates.systemRole : current.system_role;
    const capabilities = updates.capabilities !== undefined ? JSON.stringify(updates.capabilities) : current.capabilities_json;
    const allowedTools = updates.allowedTools !== undefined ? JSON.stringify(updates.allowedTools) : current.allowed_tools_json;
    const defaultRoomId = updates.defaultRoomId !== undefined ? updates.defaultRoomId : current.default_room_id;
    const isActive = updates.isActive !== undefined ? (updates.isActive ? 1 : 0) : current.is_active;

    this.db.prepare(`
      UPDATE agent_profiles SET
        name = ?, department = ?, description = ?, system_role = ?,
        capabilities_json = ?, allowed_tools_json = ?, default_room_id = ?,
        is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(name, department, description, systemRole, capabilities, allowedTools, defaultRoomId, isActive, now, id);

    return this.getProfileById(id);
  }

  // --- Instances ---
  getAllInstances() {
    return this.db.prepare(`
      SELECT 
        ai.*,
        ap.name as profile_name,
        ap.slug as profile_slug,
        ap.department,
        ap.system_role,
        ap.capabilities_json,
        ap.allowed_tools_json,
        op.position_x,
        op.position_y,
        op.direction,
        w.name as workstation_name,
        r.name as room_name,
        (SELECT title FROM agent_tasks WHERE assigned_agent_id = ai.id AND status IN ('running', 'assigned', 'waiting') LIMIT 1) as active_task_title,
        (SELECT id FROM agent_tasks WHERE assigned_agent_id = ai.id AND status IN ('running', 'assigned', 'waiting') LIMIT 1) as active_task_id
      FROM agent_instances ai
      JOIN agent_profiles ap ON ai.profile_id = ap.id
      LEFT JOIN office_positions op ON ai.id = op.agent_instance_id
      LEFT JOIN office_workstations w ON ai.current_workstation_id = w.id
      LEFT JOIN office_rooms r ON ai.current_room_id = r.id
      ORDER BY ap.department, ai.display_name ASC
    `).all();
  }

  getInstanceById(id) {
    return this.db.prepare(`
      SELECT 
        ai.*,
        ap.name as profile_name,
        ap.slug as profile_slug,
        ap.department,
        ap.system_role,
        ap.capabilities_json,
        ap.allowed_tools_json,
        op.position_x,
        op.position_y,
        op.direction,
        w.name as workstation_name,
        r.name as room_name
      FROM agent_instances ai
      JOIN agent_profiles ap ON ai.profile_id = ap.id
      LEFT JOIN office_positions op ON ai.id = op.agent_instance_id
      LEFT JOIN office_workstations w ON ai.current_workstation_id = w.id
      LEFT JOIN office_rooms r ON ai.current_room_id = r.id
      WHERE ai.id = ?
    `).get(id);
  }

  createInstance({ id, profileId, runtimeType = 'hermes', runtimeIdentifier = null, displayName, currentRoomId = null, currentWorkstationId = null, status = 'idle' }) {
    const instanceId = id || generateId('inst');
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO agent_instances (
        id, profile_id, runtime_type, runtime_identifier, display_name,
        status, current_room_id, current_workstation_id, last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      instanceId,
      profileId,
      runtimeType,
      runtimeIdentifier,
      displayName,
      status,
      currentRoomId,
      currentWorkstationId,
      now,
      now,
      now
    );

    return this.getInstanceById(instanceId);
  }

  updateInstanceStatus(id, status) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE agent_instances SET status = ?, last_seen_at = ?, updated_at = ? WHERE id = ?
    `).run(status, now, now, id);
    return this.getInstanceById(id);
  }

  updateInstanceLocation(id, roomId, workstationId) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE agent_instances SET current_room_id = ?, current_workstation_id = ?, updated_at = ? WHERE id = ?
    `).run(roomId, workstationId, now, id);
    return this.getInstanceById(id);
  }

  // --- Sessions ---
  createSession({ id, agentInstanceId, parentSessionId = null, externalSessionId = null, taskId = null, metadata = {} }) {
    const sessionId = id || generateId('sess');
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO agent_sessions (
        id, agent_instance_id, parent_session_id, external_session_id,
        task_id, status, started_at, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)
    `).run(
      sessionId,
      agentInstanceId,
      parentSessionId,
      externalSessionId,
      taskId,
      now,
      JSON.stringify(metadata),
      now,
      now
    );
    return this.getSessionById(sessionId);
  }

  getSessionById(id) {
    return this.db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id);
  }

  endSession(id, status = 'completed') {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE agent_sessions SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?
    `).run(status, now, now, id);
    return this.getSessionById(id);
  }
}

export default AgentRepository;
