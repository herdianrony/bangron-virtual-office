import dotenv from 'dotenv';
dotenv.config();

export const hermesConfig = {
  apiUrl: process.env.HERMES_API_URL || '',
  apiKey: process.env.HERMES_API_KEY || '',
  webhookSecret: process.env.HERMES_WEBHOOK_SECRET || '',
  // This flag alone does not prove a live Hermes transport is supported.
  runtimeVerified: process.env.HERMES_RUNTIME_VERIFIED === 'true'
};

export default hermesConfig;
