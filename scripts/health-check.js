import { getDatabase, closeDatabase } from '../src/database/connection.js';
import logger from '../src/utils/logger.js';

async function main() {
  try {
    const db = getDatabase();
    const quickCheck = db.prepare('PRAGMA quick_check').get();
    const roomsCount = db.prepare('SELECT count(*) as c FROM office_rooms').get().c;
    const profilesCount = db.prepare('SELECT count(*) as c FROM agent_profiles').get().c;
    const instancesCount = db.prepare('SELECT count(*) as c FROM agent_instances').get().c;
    const usersCount = db.prepare('SELECT count(*) as c FROM users').get().c;

    logger.info({
      status: 'healthy',
      quickCheck: quickCheck.quick_check,
      roomsCount,
      profilesCount,
      instancesCount,
      usersCount
    }, 'Health check passed.');

    closeDatabase();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Health check failed');
    closeDatabase();
    process.exit(1);
  }
}

main();
