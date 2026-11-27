import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/database/migrations/runner.js';
import { HermesAgentProvisioner } from '../../src/integrations/hermes/agent-provisioner.js';

describe('Hermes agent placement by profile name', () => {
  let db; let provisioner;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    provisioner = new HermesAgentProvisioner(db);
  });
  afterEach(() => db.close());

  it.each([
    ['devops', 'DevOps & Automation', 'room_server'],
    ['prof_dev_backend', 'Development', 'room_dev'],
    ['prof-dev-backend', 'Development', 'room_dev'],
    ['sm-scheduler', 'Marketing', 'room_marketing'],
    ['sm-strategist', 'Marketing', 'room_marketing'],
    ['backend', 'Development', 'room_dev'],
    ['tech-lead', 'Operations', 'room_ops'],
    ['ui-ux', 'UI/UX', 'room_uiux']
  ])('places %s in %s / %s', (name, department, roomId) => {
    expect(provisioner.guessPlacement(name)).toEqual({ department, roomId });
  });

  it('falls back to lounge for unknown names', () => {
    expect(provisioner.guessPlacement('mystery-agent')).toEqual({ department: 'General', roomId: 'room_lounge' });
  });
});
