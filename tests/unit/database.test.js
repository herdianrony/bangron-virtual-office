import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/database/migrations/runner.js';
import { seedInitialOffice } from '../../src/database/seeds/initial_office.js';

// Set required env for seedInitialOffice
process.env.INITIAL_DIRECTOR_PASSWORD = 'TestPass123456';
process.env.INITIAL_DIRECTOR_EMAIL = 'director@bangron.office';
process.env.INITIAL_DIRECTOR_NAME = 'Test Director';

describe('Database & Migrations', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('creates all required schema tables and indexes', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all().map(t => t.name);

    expect(tables).toContain('users');
    expect(tables).toContain('office_rooms');
    expect(tables).toContain('office_workstations');
    expect(tables).toContain('agent_profiles');
    expect(tables).toContain('agent_instances');
    expect(tables).toContain('office_positions');
    expect(tables).toContain('projects');
    expect(tables).toContain('agent_tasks');
    expect(tables).toContain('agent_dependencies');
    expect(tables).toContain('agent_sessions');
    expect(tables).toContain('agent_activities');
    expect(tables).toContain('agent_events');
    expect(tables).toContain('deliverables');
    expect(tables).toContain('approval_requests');
    expect(tables).toContain('audit_logs');
    expect(tables).toContain('system_settings');
    expect(tables).toContain('sessions');
  });

  it('enforces foreign key constraints', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO agent_instances (id, profile_id, display_name, status, created_at, updated_at)
        VALUES ('inst_1', 'non_existent_profile', 'Test Agent', 'idle', datetime('now'), datetime('now'))
      `).run();
    }).toThrow();
  });

  it('successfully seeds the 14 rooms and default profiles', async () => {
    await seedInitialOffice(db);
    const roomCount = db.prepare('SELECT count(*) as count FROM office_rooms').get().count;
    expect(roomCount).toBe(14);

    const profileCount = db.prepare('SELECT count(*) as count FROM agent_profiles').get().count;
    expect(profileCount).toBeGreaterThanOrEqual(8);
  });
});
