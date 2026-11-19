import { test } from '@playwright/test';
import dotenv from 'dotenv';
dotenv.config({ path: '/home/herdianrony/bangron-virtual-office/.env' });

const DIRECTOR_EMAIL = process.env.INITIAL_DIRECTOR_EMAIL || 'director@bangron.office';
const DIRECTOR_PASSWORD = process.env.INITIAL_DIRECTOR_PASSWORD || 'TestPass123456';

test('debug fetch with cookie v2', async ({ context }) => {
  // Login
  const loginRes = await context.request.post('http://localhost:3002/api/auth/login', {
    data: { email: DIRECTOR_EMAIL, password: DIRECTOR_PASSWORD }
  });
  console.log('Login status:', loginRes.status());
  const loginBody = await loginRes.json();
  console.log('Login body:', loginBody);
  
  // Extract cookie using headersArray
  const headersArray = loginRes.headersArray() || [];
  console.log('Headers array:', headersArray);
  
  let sessionCookie = '';
  for (const h of headersArray) {
    if (h.name.toLowerCase() === 'set-cookie') {
      console.log('Found set-cookie header:', h.value);
      const match = h.value.match(/bvo_session=([^;]+)/);
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
