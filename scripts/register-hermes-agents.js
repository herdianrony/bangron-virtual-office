#!/usr/bin/env node
/**
 * Mendaftarkan agen dengan NAMA ASLI Hermes ke Bangron Virtual Office
 * lewat endpoint POST /api/integrations/hermes/agents (dilindungi HMAC).
 *
 * Pemakaian:
 *   node scripts/register-hermes-agents.js "Nama Agen 1" "Nama Agen 2"
 *   node scripts/register-hermes-agents.js --department=Development "Koder Backend"
 *   OFFICE_URL=https://office.example.com node scripts/register-hermes-agents.js "Riset Pasar"
 *
 * Office dibaca dari OFFICE_URL atau PORT (.env). Secret dari HERMES_WEBHOOK_SECRET (.env).
 */
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const PORT = process.env.PORT || 3000;
const BASE = (process.env.OFFICE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const SECRET = process.env.HERMES_WEBHOOK_SECRET || 'bangron-hermes-webhook-secret-key-2026';

const args = process.argv.slice(2);
let department = null;
const names = [];
for (const a of args) {
  const m = a.match(/^--department=(.+)$/i);
  if (m) department = m[1];
  else names.push(a);
}

if (names.length === 0) {
  console.log('Pemakaian: node scripts/register-hermes-agents.js [--department=Ruangan] "Nama Agen 1" "Nama Agen 2" ...');
  console.log('Contoh   : node scripts/register-hermes-agents.js --department=Development "Koder Backend" "Arsitek Sistem"');
  process.exit(1);
}

const body = { agents: names.map((name) => (department ? { name, department } : { name })) };
const raw = JSON.stringify(body);
const signature = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');

const res = await fetch(`${BASE}/api/integrations/hermes/agents`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Hermes-Signature-256': signature,
    'X-Hermes-Event': 'agent_registration'
  },
  body: raw
});

let json = null;
try { json = await res.json(); } catch { /* respons bukan JSON */ }

if (res.ok && json?.success) {
  console.log(`Berhasil menghubungi office di ${BASE}\n`);
  for (const r of json.data.registered) {
    if (r.ok) {
      console.log(`+ ${r.name.padEnd(28)} -> ${r.agent_instance_id} (${r.room || '-'}${r.workstation ? ' / ' + r.workstation : ''})${r.already_registered ? ' [sudah terdaftar]' : ''}`);
    } else {
      console.log(`- ${r.name || '(tanpa nama)'} -> GAGAL (${r.reason || 'alasan tidak diketahui'})`);
    }
  }
  process.exit(0);
} else {
  console.error(`Gagal (HTTP ${res.status}):`, JSON.stringify(json, null, 2));
  console.error('Periksa: office sedang berjalan? HERMES_WEBHOOK_SECRET di .env sama dengan sisi Hermes?');
  process.exit(1);
}
