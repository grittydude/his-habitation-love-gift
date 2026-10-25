#!/usr/bin/env node
// Set (or change) the organiser passphrase for the /admin console.
//
//   npm run admin:passphrase                              # generate a strong one
//   npm run admin:passphrase -- --passphrase "my own phrase here"
//
// Only a bcrypt hash is stored in the database. A generated passphrase is
// written to ./private/admin-passphrase.txt (git-ignored) instead of the
// terminal. Changing it signs out any open console sessions.
import { randomInt } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { adminClient, call } from './lib/admin.mjs';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generate() {
  // 4 groups of 5 from 31 symbols ≈ 99 bits.
  return Array.from({ length: 4 }, () =>
    Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''),
  ).join('-');
}

const { values } = parseArgs({ options: { passphrase: { type: 'string' } } });
const passphrase = values.passphrase ?? generate();
if (passphrase.length < 12) {
  console.error('Choose a passphrase of at least 12 characters (a short sentence works well).');
  process.exit(1);
}

const client = adminClient();
await call(client, 'admin_set_console_passphrase', { p_passphrase: passphrase });

if (values.passphrase) {
  console.log('Organiser passphrase updated. Any open console sessions were signed out.');
} else {
  mkdirSync('private', { recursive: true });
  const file = path.join('private', 'admin-passphrase.txt');
  writeFileSync(file, `${passphrase}\n`, { mode: 0o600 });
  console.log(`Organiser passphrase set. It is saved in ${file}`);
  console.log('Keep it in your password manager, then delete that file.');
}
console.log('Console: <your site>/admin');
