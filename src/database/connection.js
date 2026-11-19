import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { databaseConfig } from '../config/index.js';
import logger from '../utils/logger.js';

let dbInstance = null;

export function getDatabase(customPath = null) {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = customPath || databaseConfig.path;

  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  logger.info({ dbPath }, 'Opening SQLite database connection...');

  dbInstance = new Database(dbPath, {
    timeout: databaseConfig.busyTimeout,
    verbose: process.env.NODE_ENV === 'test' ? null : null
  });

  // Enable WAL mode, Foreign keys, and Performance pragmas
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  dbInstance.pragma(`busy_timeout = ${databaseConfig.busyTimeout}`);
  dbInstance.pragma('synchronous = NORMAL');

  return dbInstance;
}

export function closeDatabase() {
  if (dbInstance) {
    try {
      dbInstance.close();
      logger.info('SQLite database connection closed.');
    } catch (err) {
      logger.error({ err }, 'Error closing SQLite database');
    } finally {
      dbInstance = null;
    }
  }
}

export default {
  getDatabase,
  closeDatabase
};
