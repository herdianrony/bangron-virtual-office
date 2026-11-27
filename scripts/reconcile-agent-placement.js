/**
 * Idempotent relocation of already-provisioned Hermes agents whose stored
 * profile/room no longer matches their real profile name.
 *
 * Run: node scripts/reconcile-agent-placement.js
 */
import path from 'node:path';
import Database from 'better-sqlite3';
import { HermesAgentProvisioner } from '../src/integrations/hermes/agent-provisioner.js';

const dbPath = process.env.DATABASE_PATH
  || path.resolve('storage/database/bangron-virtual-office.sqlite');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
const provisioner = new HermesAgentProvisioner(db);
const now = new Date().toISOString();

const agents = db.prepare(`
  SELECT ai.id, ai.display_name, ai.profile_id, ai.current_room_id, ai.current_workstation_id,
         ap.name AS profile_name, ap.department, ap.default_room_id,
         op.id AS position_id, op.workstation_id AS position_workstation_id
  FROM agent_instances ai
  JOIN agent_profiles ap ON ap.id = ai.profile_id
  LEFT JOIN office_positions op ON op.agent_instance_id = ai.id
  ORDER BY ai.id
`).all();

let changed = 0;
const roomOccupancy = new Map();
for (const agent of agents) {
  const name = agent.display_name || agent.profile_name;
  const target = provisioner.guessPlacement(name);
  const profileChanged = agent.department !== target.department || agent.default_room_id !== target.roomId;
  const positionChanged = agent.current_room_id !== target.roomId;
  const offset = roomOccupancy.get(target.roomId) || 0;
  roomOccupancy.set(target.roomId, offset + 1);
  if (!profileChanged && !positionChanged) continue;

  // Release previous workstation so the old room is no longer falsely occupied.
  if (agent.position_workstation_id) {
    db.prepare(`UPDATE office_workstations SET status='available', updated_at=? WHERE id=? AND status='occupied'`)
      .run(now, agent.position_workstation_id);
  }

  db.prepare(`UPDATE agent_profiles SET department=?, default_room_id=?, updated_at=? WHERE id=?`)
    .run(target.department, target.roomId, now, agent.profile_id);

  // Place at an open spot inside the target room (derived from room bounds).
  const room = db.prepare('SELECT id, position_x, position_y, width, height FROM office_rooms WHERE id=?').get(target.roomId);
  if (!room) { console.error('Missing room', target.roomId); continue; }
  const px = Number(room.position_x) + Number(room.width) / 2 + (offset % 3) * 24 - 24;
  const py = Number(room.position_y) + Number(room.height) / 2 + Math.floor(offset / 3) * 22 - 11;

  db.prepare(`UPDATE office_positions SET room_id=?, workstation_id=NULL, position_x=?, position_y=?, updated_at=? WHERE agent_instance_id=?`)
    .run(target.roomId, px, py, now, agent.id);
  db.prepare(`UPDATE agent_instances SET current_room_id=?, current_workstation_id=NULL, updated_at=? WHERE id=?`)
    .run(target.roomId, now, agent.id);

  console.log(`${agent.id}: ${agent.current_room_id} -> ${target.roomId} (${target.department})`);
  changed++;
}
console.log(`Reconciled ${changed}/${agents.length} agents`);
db.close();
