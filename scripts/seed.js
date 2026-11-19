import { getDatabase, closeDatabase } from '../src/database/connection.js';
import { runMigrations } from '../src/database/migrations/runner.js';
import { seedInitialOffice } from '../src/database/seeds/initial_office.js';
import { seedDemoData } from '../src/database/seeds/demo_seed.js';
import logger from '../src/utils/logger.js';

async function main() {
  try {
    const db = getDatabase();
    runMigrations(db);
    await seedInitialOffice(db);
    seedDemoData(db);
    logger.info('Database seeding completed successfully.');
    closeDatabase();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Seeding failed');
    closeDatabase();
    process.exit(1);
  }
}

main();
