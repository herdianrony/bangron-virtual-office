import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
dotenv.config({ path: '/home/herdianrony/bangron-virtual-office/.env' });

const DIRECTOR_EMAIL = process.env.INITIAL_DIRECTOR_EMAIL || 'director@bangron.office';
const DIRECTOR_PASSWORD = process.env.INITIAL_DIRECTOR_PASSWORD || 'TestPass123456';

test('debug login', async ({ context }) => {
  const loginRes = await context.request.post('http://localhost:3002/api/auth/login', {
    data: { email: DIRECTOR_EMAIL, password: DIRECTOR_PASSWORD }
  });
  console.log('Login status:', loginRes.status());
  console.log('Login headers:', loginRes.headers());
  const loginBody = await loginRes.json();
  console.log('Login body:', JSON.stringify(loginBody, null, 2));
  
  const cookies = await context.cookies();
  console.log('Browser context cookies:', JSON.stringify(cookies, null, 2));
});
