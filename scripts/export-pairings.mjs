#!/usr/bin/env node
// Organiser-only export of the complete pairing history (with UTC timestamps).
//
//   npm run pairings:export
//
// Writes ./private/pairings-*.csv (git-ignored). Requires the service-role key.
import { adminClient, call, writePrivateCsv } from './lib/admin.mjs';

const client = adminClient();
const rows = await call(client, 'admin_pairing_history');
const status = await call(client, 'admin_access_code_status');

const file = writePrivateCsv(
  'pairings',
  ['pairing_id', 'member_a', 'member_b', 'drawn_by', 'created_at_utc'],
  rows.map((r) => [r.pairing_id, r.member_a, r.member_b, r.drawn_by, new Date(r.created_at).toISOString()]),
);

const paired = new Set(rows.flatMap((r) => [r.member_a, r.member_b]));
const waiting = status.filter((s) => !paired.has(s.name)).map((s) => s.name);
console.log(`${rows.length} pair(s) exported to ${file}`);
console.log(waiting.length ? `Not yet paired (${waiting.length}): ${waiting.join(', ')}` : 'Every member is paired.');
