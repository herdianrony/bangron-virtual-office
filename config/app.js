import dotenv from 'dotenv';
dotenv.config();

export const appConfig = {
  name: process.env.APP_NAME || 'Bangron Virtual Office',
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  url: process.env.APP_URL || 'http://localhost:3000'
};

export default appConfig;
