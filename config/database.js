import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

export const databaseConfig = {
  path: process.env.DATABASE_PATH || 'storage/database/bangron-virtual-office.sqlite',
  busyTimeout: parseInt(process.env.DATABASE_BUSY_TIMEOUT || '5000', 10),
  wal: true,
  foreignKeys: true
};

export default databaseConfig;
