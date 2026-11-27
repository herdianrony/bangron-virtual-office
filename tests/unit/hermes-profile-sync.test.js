import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/database/migrations/runner.js';
import { seedInitialOffice } from '../../src/database/seeds/initial_office.js';
import { HermesProfileSync } from '../../src/integrations/hermes/profile-sync.js';
import { AgentRepository } from '../../src/database/repositories/agent.repository.js';

describe('Hermes profile sync', () => {
  let db; let dir; let sync;
  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    await seedInitialOffice(db);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-profiles-'));
    fs.mkdirSync(path.join(dir, 'backend'));
    fs.mkdirSync(path.join(dir, 'tech-lead'));
    sync = new HermesProfileSync(db, { profilesDir: dir });
  });
  afterEach(() => { if (db) db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('discovers profile directories', () => {
    expect(sync.listProfileNames()).toEqual(['backend', 'tech-lead']);
  });

  it('provisions new profiles from Hermes', () => {
    const r = sync.sync();
    expect(r.discovered).toBe(2);
    expect(r.created).toEqual(['backend', 'tech-lead']);
    const repo = new AgentRepository(db);
    expect(repo.getInstanceById('inst_hermes_backend')).toBeDefined();
    expect(repo.getInstanceById('inst_hermes_tech-lead')).toBeDefined();
  });

  it('is idempotent on repeated sync', () => {
    sync.sync();
    const second = sync.sync();
    expect(second.created).toEqual([]);
    expect(second.existing.sort()).toEqual(['backend', 'tech-lead']);
  });
});
