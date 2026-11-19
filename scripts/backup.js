import fs from 'fs';
import path from 'path';
import { getDatabase, closeDatabase } from '../src/database/connection.js';
import logger from '../src/utils/logger.js';

async function main() {
  try {
    const backupDir = 'storage/database/backups';
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `backup_${timestamp}.sqlite`);

    logger.info({ backupPath }, 'Starting SQLite database backup...');
    const db = getDatabase();

    // SQLite online backup via vacuum into
    db.prepare(`VACUUM INTO ?`).run(backupPath);

    logger.info({ backupPath }, 'Backup created successfully.');
    closeDatabase();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Backup failed');
    closeDatabase();
    process.exit(1);
  }
}

main();
