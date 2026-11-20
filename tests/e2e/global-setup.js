// Playwright globalSetup: provision a FRESH, isolated E2E database.
//
// - Deletes any previous E2E database (including WAL/SHM sidecars).
// - Runs migrations + the initial office seed (rooms, workstations, profiles,
//   director user from INITIAL_DIRECTOR_* environment variables).
// - Creates one dedicated 'idle' agent per lifecycle test, positioned at a
//   real workstation, so tests never share or fight over agent state.
//
// The development database on port 3002 is never touched.
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/database/migrations/runner.js';
import { seedInitialOffice } from '../../src/database/seeds/initial_office.js';
import { AgentRepository } from '../../src/database/repositories/agent.repository.js';
import { OfficeRepository } from '../../src/database/repositories/office.repository.js';
import { E2E_DB_PATH, E2E_AGENTS } from './e2e-env.js';

dotenv.config(); // repo-root .env; real environment variables take precedence

export default async function globalSetup() {
  for (const key of ['INITIAL_DIRECTOR_EMAIL', 'INITIAL_DIRECTOR_PASSWORD', 'HERMES_WEBHOOK_SECRET']) {
    if (!process.env[key]) {
      throw new Error(
        `E2E setup requires ${key} in the environment (or repo-root .env). ` +
        'Hardcoded fallback credentials are not allowed.'
      );
    }
  }

  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(E2E_DB_PATH + suffix, { force: true });
  }
  fs.mkdirSync(path.dirname(E2E_DB_PATH), { recursive: true });

  const db = new Database(E2E_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  try {
    runMigrations(db);
    await seedInitialOffice(db);

    const agentRepo = new AgentRepository(db);
    const officeRepo = new OfficeRepository(db);

    for (const spec of E2E_AGENTS) {
      agentRepo.createInstance({
        id: spec.id,
        profileId: spec.profileId,
        displayName: spec.displayName,
        status: 'idle',
        currentRoomId: spec.roomId
      });
      const ws = db
        .prepare('SELECT * FROM office_workstations WHERE room_id = ? ORDER BY id LIMIT 1')
        .get(spec.roomId);
      officeRepo.upsertPosition({
        agentInstanceId: spec.id,
        roomId: spec.roomId,
        workstationId: ws ? ws.id : null,
        positionX: ws ? Number(ws.position_x) : 300,
        positionY: ws ? Number(ws.position_y) : 300,
        direction: 'SE'
      });
      if (ws) {
        agentRepo.updateInstanceLocation(spec.id, spec.roomId, ws.id);
      }
    }
  } finally {
    db.close();
  }
}