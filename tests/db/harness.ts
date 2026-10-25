/**
 * Real-PostgreSQL test harness.
 *
 * By default it boots a throwaway PostgreSQL 18 cluster from the
 * `embedded-postgres` platform binaries (no Docker needed). Set
 * TEST_DATABASE_URL to a superuser connection string (for example the local
 * stack from `supabase start`: postgresql://postgres:postgres@127.0.0.1:54322/postgres)
 * to run against that server instead.
 *
 * Each test suite gets its own freshly migrated database.
 */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';

const run = promisify(execFile);
const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));

export type Role = 'anon' | 'authenticated' | 'service_role' | 'postgres';

export interface TestServer {
  adminConfig: pg.ClientConfig;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

async function platformBinaries(): Promise<{ initdb: string; pg_ctl: string }> {
  const plat = process.platform === 'win32' ? 'windows' : process.platform;
  const pkg = `@embedded-postgres/${plat}-${process.arch}`;
  return (await import(pkg)) as { initdb: string; pg_ctl: string };
}

export async function startServer(): Promise<TestServer> {
  if (process.env.TEST_DATABASE_URL) {
    return { adminConfig: { connectionString: process.env.TEST_DATABASE_URL }, stop: async () => {} };
  }
  const { initdb, pg_ctl } = await platformBinaries();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lovegift-pg-'));
  const dataDir = path.join(dir, 'data');
  const port = await freePort();
  await run(initdb, ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale']);
  // pg_ctl (rather than invoking postgres directly) drops administrator
  // privileges on Windows, which postgres otherwise refuses to run with.
  // stdio must be ignored: the server inherits pg_ctl's handles, so a piped
  // stdout would never close and the start command would appear to hang.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(pg_ctl, [
      '-D', dataDir, '-l', path.join(dir, 'server.log'), '-w', '-t', '60',
      '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=120`,
      'start',
    ], { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pg_ctl start exited with ${code}`))));
  });
  return {
    adminConfig: { host: '127.0.0.1', port, user: 'postgres', database: 'postgres' },
    async stop() {
      await run(pg_ctl, ['-D', dataDir, '-w', '-m', 'fast', 'stop']).catch(() => {});
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export async function migrationSql(): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(files.map((f) => readFile(path.join(MIGRATIONS_DIR, f), 'utf8')));
}

/** Cluster-wide Supabase-like roles and default privileges. */
const SUPABASE_BOOTSTRAP = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
-- Mirror Supabase's permissive defaults so our explicit REVOKEs are really exercised.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

let dbCounter = 0;

export interface TestDb {
  pool: pg.Pool;
  /** Run one statement as the given database role. */
  as<T extends pg.QueryResultRow = pg.QueryResultRow>(role: Role, sql: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
  /** Call a jsonb-returning RPC as anon, the way the browser does. */
  rpc<T = Record<string, unknown>>(fn: string, args?: unknown[], role?: Role): Promise<T>;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestDb(server: TestServer): Promise<TestDb> {
  const name = `lovegift_test_${process.pid}_${Date.now()}_${dbCounter++}`;
  const admin = new pg.Client(server.adminConfig);
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const baseConfig: pg.PoolConfig = { ...server.adminConfig, max: 60 };
  if (baseConfig.connectionString) {
    const url = new URL(baseConfig.connectionString);
    url.pathname = `/${name}`;
    baseConfig.connectionString = url.toString();
  } else {
    baseConfig.database = name;
  }
  const pool = new pg.Pool(baseConfig);
  await pool.query(SUPABASE_BOOTSTRAP);

  const db: TestDb = {
    pool,
    async as(role, sql, params) {
      const client = await pool.connect();
      try {
        if (role !== 'postgres') await client.query(`set role ${role}`);
        return await client.query(sql, params);
      } finally {
        await client.query('reset role').catch(() => {});
        client.release();
      }
    },
    async rpc(fn, args = [], role = 'anon') {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
      const res = await db.as(role, `select public.${fn}(${placeholders}) as r`, args);
      return res.rows[0].r;
    },
    async migrate() {
      for (const sql of await migrationSql()) await pool.query(sql);
    },
    async close() {
      await pool.end();
      const a = new pg.Client(server.adminConfig);
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
  await db.migrate();
  return db;
}

export const PAIRING_LOCK_SQL = `select pg_advisory_xact_lock(hashtextextended('his-habitation-love-gift:pairing', 0))`;

export function testCode(index: number): string {
  return `CODE${String(index).padStart(4, '0')}`;
}

export interface Member {
  id: string;
  name: string;
}

/** Provision deterministic test codes (via the service-role API) for every member. */
export async function provisionAll(db: TestDb): Promise<Member[]> {
  const members = (await db.as<Member>('anon', 'select * from public.list_members()')).rows;
  const payload = members.map((m, i) => ({ member_id: m.id, code: testCode(i) }));
  await db.rpc('admin_provision_access_codes', [JSON.stringify(payload)], 'service_role');
  return members;
}

export async function signIn(db: TestDb, members: Member[], index: number): Promise<string> {
  const res = await db.rpc<{ status: string; session_token: string }>('member_sign_in', [members[index].id, testCode(index)]);
  if (res.status !== 'ok') throw new Error(`sign-in failed for ${members[index].name}: ${JSON.stringify(res)}`);
  return res.session_token;
}
