// Shared helpers for organiser-only scripts. These run on the organiser's
// computer with the Supabase service-role key; they are never part of the
// browser bundle (Vite only exposes VITE_-prefixed variables).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

export function adminClient() {
  if (existsSync('.env.admin.local')) process.loadEnvFile('.env.admin.local');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\nCopy .env.admin.example to .env.admin.local and fill it in.');
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function call(client, fn, args) {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    console.error(`${fn} failed: ${error.message}`);
    process.exit(1);
  }
  return data;
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Writes a CSV into the git-ignored ./private folder, readable only by the current user where supported. */
export function writePrivateCsv(prefix, header, rows) {
  mkdirSync('private', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join('private', `${prefix}-${stamp}.csv`);
  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
  writeFileSync(file, body, { mode: 0o600 });
  return file;
}
