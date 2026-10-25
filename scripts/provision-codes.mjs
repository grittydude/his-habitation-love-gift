#!/usr/bin/env node
// Generate and register personal access codes.
//
//   npm run codes:provision                      # members who don't have a code yet
//   npm run codes:provision -- --member "Buddy"  # (re)issue one member's code
//   npm run codes:provision -- --all --yes       # re-issue everyone's code
//
// Codes are generated here with a CSPRNG, sent once over HTTPS to the
// service-role-only RPC (which stores a bcrypt hash and discards the
// plaintext). For each member it also builds a personal sign-in link and a
// ready-to-send WhatsApp message, written to ./private/ (git-ignored):
//   access-codes-*.csv   name, code, link, message
//   send-links-*.html    open in a browser: Copy / Open WhatsApp per member
// Optional: ./private/phones.csv ("Exact Name,+234...") makes each WhatsApp
// button open that person's chat directly.
// Re-issuing a code invalidates that member's old code AND link, and signs out
// their existing sessions. Pairings are never affected.
import { randomInt } from 'node:crypto';
import { parseArgs } from 'node:util';
import { adminClient, call, writePrivateCsv } from './lib/admin.mjs';
import { loadPhones, personalLink, whatsappMessage, whatsappUrl, writeSendPage } from './lib/messages.mjs';

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
const siteUrl = process.env.SITE_URL;
if (!siteUrl || !/^https:\/\//.test(siteUrl)) {
  console.error('Set SITE_URL in .env.admin.local to the live https:// address of the site (used to build personal links).');
  process.exit(1);
}
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

const phones = loadPhones();
const entries = issued.map((i) => {
  const link = personalLink(siteUrl, i.member_id, i.code);
  const message = whatsappMessage(i.name, link);
  const phone = phones.get(i.name);
  return { ...i, memberId: i.member_id, link, message, phone, whatsapp: whatsappUrl(message, phone) };
});

const file = writePrivateCsv(
  'access-codes',
  ['name', 'access_code', 'personal_link', 'whatsapp_message'],
  entries.map((e) => [e.name, e.code, e.link, e.message]),
);
const page = file.replace(/access-codes-(.*)\.csv$/, 'send-links-$1.html');
writeSendPage(page, entries);

console.log(`Registered ${result.provisioned} access code(s).`);
console.log(`Send page: ${page}   (open it in your browser)`);
console.log(`Spreadsheet: ${file}`);
if (phones.size) console.log(`Phone numbers found for ${entries.filter((e) => e.phone).length} of ${entries.length} member(s).`);
console.log('Send each member ONLY their own message, then delete both files.');
