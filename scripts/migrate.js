import { getDatabase, closeDatabase } from '../src/database/connection.js';
import { runMigrations } from '../src/database/migrations/runner.js';
import logger from '../src/utils/logger.js';

async function main() {
  try {
    const db = getDatabase();
    runMigrations(db);
    logger.info('Migrations completed successfully.');
    closeDatabase();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Migration failed');
    closeDatabase();
    process.exit(1);
  }
}

main();
