import dotenv from 'dotenv';
dotenv.config();

export const hermesConfig = {
  apiUrl: process.env.HERMES_API_URL || 'http://localhost:8000',
  apiKey: process.env.HERMES_API_KEY || '',
  webhookSecret: process.env.HERMES_WEBHOOK_SECRET || 'bangron-hermes-webhook-secret-key-2026',
  runtimeVerified: process.env.HERMES_RUNTIME_VERIFIED === 'true'
};

export default hermesConfig;
