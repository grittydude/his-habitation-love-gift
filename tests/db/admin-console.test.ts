import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, provisionAll, signIn, startServer, type Member, type TestDb, type TestServer } from './harness';

const PASSPHRASE = 'organiser-test-passphrase';

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

type Json = Record<string, unknown>;
const setPassphrase = (p = PASSPHRASE) => db.rpc('admin_set_console_passphrase', [p], 'service_role');
const consoleSignIn = (p: string | null) => db.rpc<Json>('admin_console_sign_in', [p]);
async function adminToken() {
  await setPassphrase();
  const res = await consoleSignIn(PASSPHRASE);
  expect(res.status).toBe('ok');
  return res.session_token as string;
}
const draw = async (i: number) => db.rpc<Json>('draw_partner', [await signIn(db, members, i)]);

describe('organiser console', () => {
  it('reports not_configured until a passphrase is set, and only the service role can set it', async () => {
    expect((await consoleSignIn('anything-at-all')).status).toBe('not_configured');
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(db.as(role, `select public.admin_set_console_passphrase('a-new-passphrase')`)).rejects.toThrow(/permission denied/);
    }
    await expect(db.rpc('admin_set_console_passphrase', ['short'], 'service_role')).rejects.toThrow(/12/);
    await setPassphrase();
    expect((await consoleSignIn(PASSPHRASE)).status).toBe('ok');
    const stored = await db.as('postgres', 'select passphrase_hash from private.admin_credentials');
    expect(stored.rows[0].passphrase_hash).toMatch(/^\$2a\$10\$/);
  });

  it('shows every pairing, the unpaired members and progress — only with a valid session', async () => {
    const token = await adminToken();
    const a = await draw(0);
    const overview = await db.rpc<Json>('admin_console_overview', [token]);
    expect(overview.status).toBe('ok');
    const pairings = overview.pairings as Json[];
    expect(pairings).toHaveLength(1);
    expect([pairings[0].member_a, pairings[0].member_b].sort()).toEqual([members[0].name, (a.partner as Member).name].sort());
    expect(pairings[0].drawn_by).toBe(members[0].name);
    expect(pairings[0].created_at).toBeTruthy();
    expect(overview.unpaired).toHaveLength(22);
    expect(overview.progress).toMatchObject({ pairs_completed: 1, total_pairs: 12 });

    for (const bad of [null, '', 'f'.repeat(64)]) {
      expect((await db.rpc<Json>('admin_console_overview', [bad])).status).toBe('invalid_session');
    }
    // A member's session token is not a console token.
    expect((await db.rpc<Json>('admin_console_overview', [await signIn(db, members, 5)])).status).toBe('invalid_session');
  });

  it('reset needs a session and the exact phrase, then clears pairings, member sessions and lockouts', async () => {
    const token = await adminToken();
    const memberToken = await signIn(db, members, 3);
    await draw(0);
    await draw(1);
    for (let k = 0; k < 5; k++) await db.rpc('member_sign_in', [members[9].id, 'WRONGWRONG']);

    expect((await db.rpc<Json>('admin_console_reset', ['f'.repeat(64), 'RESET ALL PAIRINGS'])).status).toBe('invalid_session');
    expect((await db.rpc<Json>('admin_console_reset', [token, 'reset'])).status).toBe('confirmation_required');
    expect((await db.as('postgres', 'select count(*)::int as n from public.pairings')).rows[0].n).toBeGreaterThan(0);

    const res = await db.rpc<Json>('admin_console_reset', [token, 'RESET ALL PAIRINGS']);
    expect(res).toMatchObject({ status: 'ok' });
    expect(Number(res.pairings_deleted)).toBeGreaterThanOrEqual(1);
    expect((await db.as('postgres', 'select count(*)::int as n from public.pairings')).rows[0].n).toBe(0);
    expect(await db.rpc('get_activity_progress')).toMatchObject({ paired_members: 0, pairs_completed: 0 });
    expect((await db.rpc<Json>('get_my_pairing', [memberToken])).status).toBe('invalid_session');
    // Lockout cleared and codes still work; the event can start again.
    expect((await db.rpc<Json>('member_sign_in', [members[9].id, 'CODE0009'])).status).toBe('ok');
    expect((await draw(0)).status).toBe('created');
    // Console session survives so the organiser can keep watching.
    expect((await db.rpc<Json>('admin_console_overview', [token])).status).toBe('ok');
    const events = await db.as('postgres', `select action from private.admin_events where action = 'reset'`);
    expect(events.rows).toHaveLength(1);
  });

  it('rate-limits wrong passphrases and rejects signed-out or expired sessions', async () => {
    await setPassphrase();
    const wrong = await consoleSignIn('not-the-passphrase');
    expect(wrong).toEqual({ status: 'invalid_credentials', attempts_remaining: 4 });
    for (let k = 0; k < 3; k++) await consoleSignIn('not-the-passphrase');
    expect((await consoleSignIn('not-the-passphrase')).status).toBe('locked');
    expect((await consoleSignIn(PASSPHRASE)).status).toBe('locked');
    await db.as('postgres', `update private.admin_credentials set locked_until = now() - interval '1 second'`);

    const token = (await consoleSignIn(PASSPHRASE)).session_token as string;
    await db.rpc('admin_console_sign_out', [token]);
    expect((await db.rpc<Json>('admin_console_overview', [token])).status).toBe('invalid_session');

    const t2 = (await consoleSignIn(PASSPHRASE)).session_token as string;
    await db.as('postgres', `update private.admin_sessions set expires_at = now() - interval '1 second'`);
    expect((await db.rpc<Json>('admin_console_overview', [t2])).status).toBe('invalid_session');

    // Changing the passphrase signs out existing console sessions.
    const t3 = (await consoleSignIn(PASSPHRASE)).session_token as string;
    await setPassphrase('a-brand-new-passphrase');
    expect((await db.rpc<Json>('admin_console_overview', [t3])).status).toBe('invalid_session');
    expect((await consoleSignIn(PASSPHRASE)).status).toBe('invalid_credentials');
  });

  it('keeps console tables private', async () => {
    await adminToken();
    for (const role of ['anon', 'authenticated'] as const) {
      for (const t of ['private.admin_credentials', 'private.admin_sessions', 'private.admin_events']) {
        await expect(db.as(role, `select * from ${t}`)).rejects.toThrow(/permission denied/);
      }
      await expect(db.as(role, `select private.admin_session_valid('${'a'.repeat(64)}')`)).rejects.toThrow(/permission denied/);
    }
  });
});
