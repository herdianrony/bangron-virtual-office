/**
 * Applies the architectural floor plan v2 (office-layout.js) to an existing
 * database: upserts the 14 rooms with door metadata, upserts the 15
 * workstations, and snaps every agent position back onto its workstation so
 * nobody stands inside a wall after the remodel.
 *
 * Usage: node scripts/apply-office-layout.js
 */
import { getDatabase, closeDatabase } from '../src/database/connection.js';
import { OFFICE_ROOMS, OFFICE_WORKSTATIONS } from '../src/services/office-layout.js';
import logger from '../src/utils/logger.js';

async function main() {
  const db = getDatabase();
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    // 1. Rooms (with door metadata)
    for (const r of OFFICE_ROOMS) {
      db.prepare(`
        INSERT INTO office_rooms (id, name, slug, department, description, position_x, position_y, width, height, metadata_json, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, COALESCE((SELECT created_at FROM office_rooms WHERE id = ?), ?), ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, slug = excluded.slug, department = excluded.department,
          description = excluded.description, position_x = excluded.position_x, position_y = excluded.position_y,
          width = excluded.width, height = excluded.height, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
      `).run(
        r.id, r.name, r.slug, r.department, r.description, r.px, r.py, r.w, r.h,
        JSON.stringify({ door: r.door, ...(r.entrance ? { entrance: true } : {}) }),
        r.id, now, now
      );
    }

    // 2. Workstations
    for (const ws of OFFICE_WORKSTATIONS) {
      db.prepare(`
        INSERT INTO office_workstations (id, room_id, name, workstation_type, position_x, position_y, capacity, status, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'available', '{}', COALESCE((SELECT created_at FROM office_workstations WHERE id = ?), ?), ?)
        ON CONFLICT(id) DO UPDATE SET
          room_id = excluded.room_id, name = excluded.name, workstation_type = excluded.workstation_type,
          position_x = excluded.position_x, position_y = excluded.position_y, capacity = excluded.capacity,
          updated_at = excluded.updated_at
      `).run(ws.id, ws.roomId, ws.name, ws.type, ws.px, ws.py, ws.cap, ws.id, now, now);
    }

    // 3. Snap agents onto their (possibly moved) workstations
    const positions = db.prepare('SELECT agent_instance_id, workstation_id FROM office_positions').all();
    const wsById = new Map(OFFICE_WORKSTATIONS.map((w) => [w.id, w]));
    for (const pos of positions) {
      const ws = pos.workstation_id ? wsById.get(pos.workstation_id) : null;
      if (ws) {
        db.prepare(`
          UPDATE office_positions
          SET room_id = ?, position_x = ?, position_y = ?, updated_at = ?
          WHERE agent_instance_id = ?
        `).run(ws.roomId, ws.px, ws.py, now, pos.agent_instance_id);
        db.prepare('UPDATE agent_instances SET current_room_id = ?, updated_at = ? WHERE id = ?')
          .run(ws.roomId, now, pos.agent_instance_id);
        logger.info(`Snapped ${pos.agent_instance_id} onto ${ws.id} (${ws.px}, ${ws.py}) in ${ws.roomId}`);
      } else if (pos.workstation_id) {
        // Workstation no longer exists: park the agent at the lounge sofa spot.
        const lounge = OFFICE_WORKSTATIONS.find((w) => w.id === 'ws_lounge_sofa');
        db.prepare(`
          UPDATE office_positions
          SET workstation_id = ?, room_id = ?, position_x = ?, position_y = ?, updated_at = ?
          WHERE agent_instance_id = ?
        `).run(lounge.id, lounge.roomId, lounge.px, lounge.py, now, pos.agent_instance_id);
        db.prepare('UPDATE agent_instances SET current_room_id = ?, current_workstation_id = ?, updated_at = ? WHERE id = ?')
          .run(lounge.roomId, lounge.id, now, pos.agent_instance_id);
        logger.warn(`Relocated ${pos.agent_instance_id} (stale workstation) to the Lounge Sofa`);
      }
    }

    // 4. Re-sync workstation reservations with office_positions
    db.prepare(`
      UPDATE office_workstations
      SET status = 'available', metadata_json = '{}', updated_at = ?
      WHERE status = 'occupied'
        AND id NOT IN (SELECT workstation_id FROM office_positions WHERE workstation_id IS NOT NULL)
    `).run(now);
    db.prepare(`
      UPDATE office_workstations
      SET status = 'occupied',
          metadata_json = (SELECT json_object('agentInstanceId', agent_instance_id) FROM office_positions WHERE office_positions.workstation_id = office_workstations.id),
          updated_at = ?
      WHERE id IN (SELECT workstation_id FROM office_positions WHERE workstation_id IS NOT NULL)
    `).run(now);
  });

  tx();

  const rooms = db.prepare('SELECT COUNT(*) c FROM office_rooms').get().c;
  const wss = db.prepare('SELECT COUNT(*) c FROM office_workstations').get().c;
  logger.info(`Office layout v2 applied: ${rooms} rooms, ${wss} workstations.`);
  closeDatabase();
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'Layout v2 migration failed');
  closeDatabase();
  process.exit(1);
});
