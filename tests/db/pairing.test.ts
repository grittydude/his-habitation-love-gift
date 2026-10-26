import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  createTestDb, PAIRING_LOCK_SQL, provisionAll, signIn, startServer, testCode,
  type Member, type TestDb, type TestServer,
} from './harness';

const ROSTER = [
  'Ikechukwu Achom',
  'Bassey Edoho',
  'Emmanuel Frank',
  'Imaobong Tommy',
  'Uyime HOTR',
  'Abia Sunday',
  'Akpan Mkpouto',
  'Asuquo Great',
  'Hilda Joseph',
  'Miracle Nsima',
  'Faith Musa',
  'Fortune Promise',
  'Gladys Nyanor',
  'Hope Akpan',
  'Ime Okon',
  'Kenneth Osaru',
  'Inyang, Mkpongke-obong',
  'Mrs Patience',
  'Mrs Ruth',
  'Nsisong Udofia',
  'Samuel Mbang',
  'Uche Kingston',
  'Victoria Abas',
  'Victory Ogarekpe',
  'Benjamin Udom',
  'Utibe Meshach',
  'Mrs Victoria Itoro Umoh',
  'Precious',
  'Godwin Edoho',
  'Victor Emmanuel',
];
const N = ROSTER.length;          // 30
const PAIRS = Math.floor(N / 2);  // 15

interface DrawResult {
  status: 'created' | 'existing' | 'no_partner_available' | 'invalid_session';
  member?: Member;
  partner?: Member;
  paired_at?: string;
  initiated_by_me?: boolean;
}

let server: TestServer;
let db: TestDb;
let members: Member[];

beforeAll(async () => { server = await startServer(); }, 120_000);
afterAll(async () => { await server?.stop(); });

beforeEach(async () => {
  db = await createTestDb(server);
  members = await provisionAll(db);
}, 60_000);
afterEach(async () => { await db?.close(); });

const draw = (token: string) => db.rpc<DrawResult>('draw_partner', [token]);
const myPairing = (token: string) => db.rpc<DrawResult & { status: string }>('get_my_pairing', [token]);
const indexOf = (name: string) => members.findIndex((m) => m.name === name);

async function allPairs() {
  return (await db.as<{ member_a_id: string; member_b_id: string }>('postgres',
    'select member_a_id, member_b_id from public.pairings')).rows;
}

async function assertLedgerConsistent() {
  const pairs = await allPairs();
  const seen = new Set<string>();
  for (const p of pairs) {
    expect(p.member_a_id).not.toBe(p.member_b_id);
    expect(seen.has(p.member_a_id) || seen.has(p.member_b_id)).toBe(false);
    seen.add(p.member_a_id); seen.add(p.member_b_id);
  }
  const memberships = await db.as('postgres', 'select count(*)::int as n from public.pair_memberships');
  expect(memberships.rows[0].n).toBe(pairs.length * 2);
  return pairs;
}

describe('roster and schema', () => {
  it('seeds exactly the approved roster, each name once', async () => {
    expect(members.map((m) => m.name).sort()).toEqual([...ROSTER].sort());
    expect(new Set(members.map((m) => m.id)).size).toBe(N);
    expect(N % 2).toBe(0);
  });

  it('re-running migrations is idempotent and preserves pairings', async () => {
    const t = await signIn(db, members, 0);
    const first = await draw(t);
    await db.migrate();
    await db.migrate();
    const again = (await db.as('anon', 'select * from public.list_members()')).rows;
    expect(again).toHaveLength(N);
    expect(again.map((m) => m.id).sort()).toEqual(members.map((m) => m.id).sort());
    expect(await allPairs()).toHaveLength(1);
    expect((await myPairing(t)).partner).toEqual(first.partner);
  });

  it('has RLS enabled on every table', async () => {
    const res = await db.as<{ relname: string; relrowsecurity: boolean }>('postgres', `
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'private') and c.relkind = 'r'`);
    expect(res.rows.length).toBeGreaterThanOrEqual(7);
    for (const row of res.rows) expect(row.relrowsecurity, row.relname).toBe(true);
  });
});

describe('pairing behaviour', () => {
  it('1–2: an unpaired member receives a partner who is not themselves', async () => {
    const t = await signIn(db, members, 0);
    const res = await draw(t);
    expect(res.status).toBe('created');
    expect(res.partner?.id).toBeDefined();
    expect(res.partner?.id).not.toBe(members[0].id);
    expect(res.member?.id).toBe(members[0].id);
    expect(res.initiated_by_me).toBe(true);
    expect(Date.now() - new Date(res.paired_at!).getTime()).toBeLessThan(60_000);
  });

  it('3: both members leave the pool immediately', async () => {
    const t0 = await signIn(db, members, 0);
    const { partner } = await draw(t0);
    const progress = await db.rpc<Record<string, unknown>>('get_activity_progress');
    expect(progress).toMatchObject({ paired_members: 2, unpaired_members: N - 2, pairs_completed: 1, total_pairs: PAIRS, is_complete: false });
    const taken = new Set([members[0].id, partner!.id]);
    for (let i = 0; i < members.length; i++) {
      if (taken.has(members[i].id)) continue;
      const res = await draw(await signIn(db, members, i));
      if (res.status === 'created') {
        expect(taken.has(res.partner!.id)).toBe(false);
        taken.add(members[i].id); taken.add(res.partner!.id);
      }
    }
  });

  it('4: the partner who never visited gets the existing pairing later (Ike example)', async () => {
    const ike = indexOf('Ikechukwu Achom');
    const ikeToken = await signIn(db, members, ike);
    const ikeDraw = await draw(ikeToken);
    const partnerIdx = members.findIndex((m) => m.id === ikeDraw.partner!.id);

    const partnerToken = await signIn(db, members, partnerIdx);
    const before = await myPairing(partnerToken);
    expect(before.status).toBe('paired');
    expect(before.partner?.id).toBe(members[ike].id);

    const partnerDraw = await draw(partnerToken);
    expect(partnerDraw.status).toBe('existing');
    expect(partnerDraw.partner?.id).toBe(members[ike].id);
    expect(partnerDraw.initiated_by_me).toBe(false);
    expect(partnerDraw.paired_at).toBe(ikeDraw.paired_at);
    expect(await allPairs()).toHaveLength(1);
  });

  it('5: repeating a request never creates a second pairing', async () => {
    const t = await signIn(db, members, 3);
    const first = await draw(t);
    for (let i = 0; i < 5; i++) {
      const again = await draw(t);
      expect(again.status).toBe('existing');
      expect(again.partner).toEqual(first.partner);
    }
    expect(await allPairs()).toHaveLength(1);
  });

  it('6: a fresh sign-in (refresh / new browser / new device) recovers the same assignment', async () => {
    const t1 = await signIn(db, members, 5);
    const first = await draw(t1);
    const t2 = await signIn(db, members, 5);
    expect(t2).not.toBe(t1);
    const recovered = await myPairing(t2);
    expect(recovered).toMatchObject({ status: 'paired', partner: first.partner, paired_at: first.paired_at });
  });

  it('10–11: all members form exactly N/2 disjoint pairs, then the activity is complete', async () => {
    for (let i = 0; i < members.length; i++) await draw(await signIn(db, members, i));
    const pairs = await assertLedgerConsistent();
    expect(pairs).toHaveLength(PAIRS);
    const progress = await db.rpc<Record<string, unknown>>('get_activity_progress');
    expect(progress).toMatchObject({ pairs_completed: PAIRS, unpaired_members: 0, is_complete: true });
    // Every member's view agrees with their partner's view.
    for (let i = 0; i < members.length; i++) {
      const mine = await myPairing(await signIn(db, members, i));
      const j = members.findIndex((m) => m.id === mine.partner!.id);
      const theirs = await myPairing(await signIn(db, members, j));
      expect(theirs.partner!.id).toBe(members[i].id);
    }
  });

  it('reports no_partner_available when the pool is exhausted (odd roster)', async () => {
    await db.as('postgres', `update public.members set is_active = false where id = $1`, [members[N - 1].id]);
    for (let i = 0; i < N - 2; i++) await draw(await signIn(db, members, i));
    const res = await draw(await signIn(db, members, N - 2));
    expect(res.status === 'existing' || res.status === 'no_partner_available').toBe(true);
    const progress = await db.rpc<Record<string, unknown>>('get_activity_progress');
    expect(progress).toMatchObject({ total_members: N - 1, unpaired_members: 1, is_complete: true });
  });
});

describe('concurrency', () => {
  it('7: every member drawing at once (separate connections) produces N/2 consistent pairs', async () => {
    const tokens = await Promise.all(members.map((_, i) => signIn(db, members, i)));
    const results = await Promise.all(tokens.map(draw));
    const pairs = await assertLedgerConsistent();
    expect(pairs).toHaveLength(PAIRS);
    expect(results.filter((r) => r.status === 'created')).toHaveLength(PAIRS);
    results.forEach((r, i) => {
      const j = members.findIndex((m) => m.id === r.partner!.id);
      expect(results[j].partner!.id).toBe(members[i].id);
    });
  });

  it('8: simultaneous requests for the same member resolve to the same assignment', async () => {
    const tokens = [await signIn(db, members, 7), await signIn(db, members, 7)];
    const results = await Promise.all(Array.from({ length: 12 }, (_, k) => draw(tokens[k % 2])));
    expect(new Set(results.map((r) => r.partner!.id)).size).toBe(1);
    expect(results.filter((r) => r.status === 'created')).toHaveLength(1);
    expect(await allPairs()).toHaveLength(1);
  });

  it('9: requests queued behind the lock for different members never overlap', async () => {
    // Deterministically force contention: hold the pairing lock, queue draws
    // for several members, then release it so they all race the same pool.
    for (let round = 0; round < 5; round++) {
      await db.as('postgres', `select private.admin_reset_pairings('RESET ALL PAIRINGS')`);
      const idx = [0, 1, 2, 3, 4, 5].map((k) => (k + round * 3) % N);
      const tokens = await Promise.all(idx.map((i) => signIn(db, members, i)));
      const holder = await db.pool.connect();
      try {
        await holder.query('begin');
        await holder.query(PAIRING_LOCK_SQL);
        const pending = tokens.map(draw);
        await waitForLockWaiters(db.pool, tokens.length);
        await holder.query('commit');
        const results = await Promise.all(pending);
        await assertLedgerConsistent();
        results.forEach((r, k) => {
          expect(r.partner!.id).not.toBe(members[idx[k]].id);
          const j = idx.findIndex((i) => members[i].id === r.partner!.id);
          if (j >= 0) expect(results[j].partner!.id).toBe(members[idx[k]].id);
        });
      } finally {
        await holder.query('rollback').catch(() => {});
        holder.release();
      }
    }
  });

  it('the database rejects an overlapping pair even if a writer bypasses the function', async () => {
    await db.as('postgres', `insert into public.pairings (member_a_id, member_b_id, initiated_by)
      select least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), $1::uuid`, [members[0].id, members[1].id]);
    // Put an already-paired member into the *other* column of a new pair —
    // unique(member_a_id) + unique(member_b_id) alone would allow this.
    const [lo, hi] = [members[0].id, members[1].id].sort();
    const rest = members.slice(2).map((m) => m.id);
    const above = rest.find((id) => id > hi);
    const [x, y] = above ? [hi, above] : [rest.find((id) => id < lo)!, lo];
    await expect(db.as('postgres', `insert into public.pairings (member_a_id, member_b_id, initiated_by)
      values ($1, $2, $1)`, [x, y])).rejects.toThrow(/pair_memberships_pkey/);
    await expect(db.as('postgres', `insert into public.pairings (member_a_id, member_b_id, initiated_by)
      values ($1, $1, $1)`, [members[3].id])).rejects.toThrow();
  });
});

describe('integrity of history', () => {
  it('timestamps are server-generated and history is append-only', async () => {
    await db.as('postgres', `insert into public.pairings (member_a_id, member_b_id, initiated_by, created_at)
      values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), $1::uuid, '2000-01-01')`, [members[0].id, members[1].id]);
    const row = (await db.as('postgres', 'select created_at from public.pairings')).rows[0];
    expect(new Date(row.created_at).getFullYear()).toBeGreaterThan(2020);
    await expect(db.as('postgres', 'update public.pairings set created_at = now()')).rejects.toThrow(/append-only/);
    await expect(db.as('postgres', 'delete from public.pairings')).rejects.toThrow(/append-only/);
    await expect(db.as('postgres', 'truncate public.pairings cascade')).rejects.toThrow(/append-only/);
    await expect(db.as('postgres', 'update public.pair_memberships set partner_id = member_id')).rejects.toThrow(/append-only/);
  });

  it('the owner-only rehearsal reset requires the exact phrase', async () => {
    await draw(await signIn(db, members, 0));
    await expect(db.as('postgres', `select private.admin_reset_pairings('yes')`)).rejects.toThrow(/exact phrase/);
    await db.as('postgres', `select private.admin_reset_pairings('RESET ALL PAIRINGS')`);
    expect(await allPairs()).toHaveLength(0);
    expect(await db.rpc('get_activity_progress')).toMatchObject({ paired_members: 0 });
  });
});

describe('authentication and authorisation', () => {
  it('13: unauthenticated callers cannot create pairings', async () => {
    for (const bad of [null, '', 'x'.repeat(64), 'f'.repeat(64), "'; drop table public.pairings; --"]) {
      expect((await db.rpc<DrawResult>('draw_partner', [bad])).status).toBe('invalid_session');
    }
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(db.as(role, `insert into public.pairings (member_a_id, member_b_id, initiated_by)
        values ($1, $2, $1)`, [members[0].id, members[1].id])).rejects.toThrow(/permission denied/);
      await expect(db.as(role, 'select public.choose_love_gift_partner($1)', [members[0].id])).rejects.toThrow();
    }
    expect(await allPairs()).toHaveLength(0);
  });

  it('14: a member cannot read anyone else’s result', async () => {
    const tA = await signIn(db, members, 0);
    const a = await draw(tA);
    const others = members.filter((m) => m.id !== members[0].id && m.id !== a.partner!.id);
    const cIdx = members.indexOf(others[0]);
    const c = await myPairing(await signIn(db, members, cIdx));
    expect(c).toMatchObject({ status: 'unpaired', member: { id: members[cIdx].id } });
    expect(c.partner).toBeUndefined();
    for (const role of ['anon', 'authenticated'] as const) {
      for (const table of ['public.pairings', 'public.pair_memberships', 'public.members',
        'private.sessions', 'private.member_credentials', 'private.auth_events']) {
        await expect(db.as(role, `select * from ${table}`), `${role} ${table}`).rejects.toThrow(/permission denied/);
      }
      await expect(db.as(role, 'select private.pairing_json($1)', [members[0].id])).rejects.toThrow(/permission denied/);
      await expect(db.as(role, 'select private.session_member($1)', ['a'.repeat(64)])).rejects.toThrow(/permission denied/);
    }
    // The only public table is the counters row.
    const progress = await db.as('anon', 'select * from public.activity_progress');
    expect(Object.keys(progress.rows[0]).sort()).toEqual(['id', 'paired_members', 'total_members', 'updated_at']);
  });

  it('15: participants cannot access administrator functions', async () => {
    await draw(await signIn(db, members, 0));
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(db.as(role, 'select * from public.admin_pairing_history()')).rejects.toThrow(/permission denied/);
      await expect(db.as(role, 'select * from public.admin_access_code_status()')).rejects.toThrow(/permission denied/);
      await expect(db.as(role, `select public.admin_provision_access_codes('[]'::jsonb)`)).rejects.toThrow(/permission denied/);
      await expect(db.as(role, `select private.admin_reset_pairings('RESET ALL PAIRINGS')`)).rejects.toThrow(/permission denied/);
    }
    const history = await db.as('service_role', 'select * from public.admin_pairing_history()');
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]).toHaveProperty('created_at');
  });

  it('16: wrong codes are rejected, rate-limited and never leak hashes', async () => {
    const id = members[0].id;
    const wrong = await db.rpc<Record<string, unknown>>('member_sign_in', [id, 'WRONG-CODE']);
    expect(wrong).toEqual({ status: 'invalid_credentials', attempts_remaining: 4 });
    // Another member's valid code is not valid for this member.
    expect((await db.rpc<Record<string, unknown>>('member_sign_in', [id, testCode(1)])).status).toBe('invalid_credentials');
    for (let k = 0; k < 2; k++) await db.rpc('member_sign_in', [id, 'WRONG-CODE']);
    const locked = await db.rpc<Record<string, unknown>>('member_sign_in', [id, 'WRONG-CODE']);
    expect(locked.status).toBe('locked');
    // Even the right code is refused while locked.
    expect((await db.rpc<Record<string, unknown>>('member_sign_in', [id, testCode(0)])).status).toBe('locked');
    // Codes are compared case/format-insensitively once the lock expires.
    await db.as('postgres', `update private.member_credentials set locked_until = now() - interval '1 second' where member_id = $1`, [id]);
    const ok = await db.rpc<Record<string, unknown>>('member_sign_in', [id, 'code-0000']);
    expect(ok.status).toBe('ok');
    expect(JSON.stringify(ok)).not.toMatch(/\$2[aby]\$/);
    const stored = await db.as('postgres', `select code_hash from private.member_credentials where member_id = $1`, [id]);
    expect(stored.rows[0].code_hash).toMatch(/^\$2a\$10\$/);
    expect(stored.rows[0].code_hash).not.toContain(testCode(0));
    const tokenRows = await db.as('postgres', 'select token_hash from private.sessions');
    expect(tokenRows.rows.every((r) => r.token_hash.toString('hex') !== ok.session_token)).toBe(true);
    // Unknown member ids and malformed input fail the same way.
    expect((await db.rpc<Record<string, unknown>>('member_sign_in', ['00000000-0000-0000-0000-000000000000', testCode(0)])).status).toBe('invalid_credentials');
    expect((await db.rpc<Record<string, unknown>>('member_sign_in', [id, ''])).status).toBe('invalid_credentials');
  });

  it('16: signed-out, expired and re-provisioned sessions are rejected', async () => {
    const t1 = await signIn(db, members, 0);
    await db.rpc('member_sign_out', [t1]);
    expect((await draw(t1)).status).toBe('invalid_session');
    expect((await myPairing(t1)).status).toBe('invalid_session');

    const t2 = await signIn(db, members, 0);
    await db.as('postgres', `update private.sessions set expires_at = now() - interval '1 second'`);
    expect((await draw(t2)).status).toBe('invalid_session');

    const t3 = await signIn(db, members, 0);
    await db.rpc('admin_provision_access_codes', [JSON.stringify([{ member_id: members[0].id, code: 'NEWC-ODE9' }])], 'service_role');
    expect((await myPairing(t3)).status).toBe('invalid_session');
    expect((await db.rpc<Record<string, unknown>>('member_sign_in', [members[0].id, testCode(0)])).status).toBe('invalid_credentials');
    expect((await db.rpc<Record<string, unknown>>('member_sign_in', [members[0].id, 'newc ode9'])).status).toBe('ok');
  });

  it('concurrent wrong guesses cannot exceed the failure limit', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () =>
      db.rpc<Record<string, unknown>>('member_sign_in', [members[2].id, 'BADBADBAD'])));
    expect(results.filter((r) => r.status === 'invalid_credentials')).toHaveLength(4);
    expect(results.filter((r) => r.status === 'locked')).toHaveLength(8);
  });
});

async function waitForLockWaiters(pool: pg.Pool, count: number) {
  for (let i = 0; i < 200; i++) {
    const res = await pool.query(`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`);
    if (res.rows[0].n >= count) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`expected ${count} draws waiting on the pairing lock`);
}
