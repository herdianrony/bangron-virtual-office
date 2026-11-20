export const version = 2;
export const name = '002_add_hermes_run_id';

export function up(db) {
  db.exec(`
    ALTER TABLE agent_tasks ADD COLUMN hermes_run_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_hermes_run ON agent_tasks(hermes_run_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_agent_tasks_hermes_run;
    -- Note: SQLite doesn't support DROP COLUMN directly, would need table rebuild
  `);
}