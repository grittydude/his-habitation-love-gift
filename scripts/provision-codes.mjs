#!/usr/bin/env node
// Generate and register personal access codes.
//
//   npm run codes:provision                      # members who don't have a code yet
//   npm run codes:provision -- --member "Buddy"  # (re)issue one member's code
//   npm run codes:provision -- --all --yes       # re-issue everyone's code
//
// Codes are generated here with a CSPRNG, sent once over HTTPS to the
// service-role-only RPC (which stores a bcrypt hash and discards the
// plaintext), and written to ./private/access-codes-*.csv for you to
// distribute privately. Re-issuing a code invalidates that member's old code
// and signs out their existing sessions. Pairings are never affected.
import { randomInt } from 'node:crypto';
import { parseArgs } from 'node:util';
import { adminClient, call, writePrivateCsv } from './lib/admin.mjs';

// No 0/O, 1/I/L: easy to read aloud and type on a phone. 31^8 ≈ 8.5e11 codes.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode() {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

const { values } = parseArgs({
  options: {
    all: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    member: { type: 'string', multiple: true },
  },
});

const client = adminClient();
const status = await call(client, 'admin_access_code_status');

let targets;
if (values.member?.length) {
  targets = values.member.map((name) => {
    const m = status.find((s) => s.name === name);
    if (!m) {
      console.error(`No active member named "${name}". Names must match the roster exactly.`);
      process.exit(1);
    }
    return m;
  });
} else if (values.all) {
  if (!values.yes) {
    console.error('--all re-issues EVERY member\'s code and invalidates the old ones. Re-run with --all --yes to confirm.');
    process.exit(1);
  }
  targets = status;
} else {
  targets = status.filter((s) => !s.has_code);
}

if (targets.length === 0) {
  console.log('Every member already has an access code. Use --member "Name" to re-issue one.');
  process.exit(0);
}

const used = new Set();
const issued = targets.map((m) => {
  let code;
  do code = generateCode(); while (used.has(code));
  used.add(code);
  return { member_id: m.member_id, name: m.name, code };
});

const result = await call(client, 'admin_provision_access_codes', {
  p_codes: issued.map(({ member_id, code }) => ({ member_id, code })),
});

const file = writePrivateCsv('access-codes', ['name', 'access_code'], issued.map((i) => [i.name, i.code]));
console.log(`Registered ${result.provisioned} access code(s).`);
console.log(`Codes saved to ${file}`);
console.log('Send each member ONLY their own code (e.g. a private WhatsApp message), then delete the file.');
