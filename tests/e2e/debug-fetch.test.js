import { test } from '@playwright/test';
import dotenv from 'dotenv';
dotenv.config({ path: '/home/herdianrony/bangron-virtual-office/.env' });

const DIRECTOR_EMAIL = process.env.INITIAL_DIRECTOR_EMAIL || 'director@bangron.office';
const DIRECTOR_PASSWORD = process.env.INITIAL_DIRECTOR_PASSWORD || 'TestPass123456';

test('debug fetch with cookie', async ({ context }) => {
  // Login
  const loginRes = await context.request.post('http://localhost:3002/api/auth/login', {
    data: { email: DIRECTOR_EMAIL, password: DIRECTOR_PASSWORD }
  });
  console.log('Login status:', loginRes.status());
  const loginBody = await loginRes.json();
  console.log('Login body:', loginBody);
  
  const setCookie = loginRes.headers()['set-cookie'] || loginRes.headers()['Set-Cookie'];
  console.log('Set-Cookie header:', setCookie);
  
  let sessionCookie = '';
  if (setCookie) {
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const c of cookies) {
      const match = c.match(/bvo_session=([^;]+)/);
      if (match) {
        sessionCookie = `bvo_session=${match[1]}`;
        break;
      }
    }
  }
  console.log('Extracted sessionCookie:', sessionCookie);
  
  // Test with Node.js fetch
  const res = await fetch('http://localhost:3002/api/virtual-office/state', {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
      'cookie': sessionCookie
    },
    credentials: 'include'
  });
  console.log('Fetch status:', res.status);
  console.log('Fetch ok:', res.ok);
  const text = await res.text();
  console.log('Fetch response:', text);
});
