# His Habitation · Love Gift Day

A single-page React + Vite site for the His Habitation choir's Love Gift Day. Each of the 24 members signs in with a personal access code and is randomly paired with exactly one other member, giving 12 unique pairs. A pair is saved for **both** people the moment either of them draws. If your partner drew you before you visited, signing in just shows you who it is.

- **Frontend:** React 18, TypeScript, plain CSS (no UI framework), `lucide-react` icons.
- **Backend:** Supabase Postgres. All logic lives in SQL functions called over RPC. There are no Edge Functions (see [why](#why-no-edge-function)).
- **Realtime:** Supabase Realtime on a counters-only table, always reconciled against the database.

---

## Contents

1. [How it works](#how-it-works)
2. [Security design](#security-design)
3. [Project layout](#project-layout)
4. [Setup: Supabase](#1-create-the-supabase-project)
5. [Access codes](#3-issue-access-codes)
6. [Run locally](#4-run-locally)
7. [Tests](#tests)
8. [Deploy (Vercel / Netlify)](#5-deploy)
9. [Production verification checklist](#production-verification-checklist)
10. [Organiser operations](#organiser-operations)
11. [Troubleshooting & recovery](#troubleshooting--recovery)

---

## How it works

1. A member picks their name, enters their access code and taps **Choose a Partner**.
2. `member_sign_in` checks the code against its bcrypt hash and returns a random 256-bit session token (2-hour lifetime). The database stores only the token's SHA-256 digest.
3. `draw_partner(token)` works out the member **from the token** (never from an id the browser sends) and then:
   - if the member is already paired, possibly by someone else, it returns that partner (`existing`);
   - otherwise it takes a transaction-scoped advisory lock, re-checks, picks a random unpaired member on the server, inserts one `pairings` row, and returns the partner (`created`).
4. A trigger writes one `pair_memberships` row per person. Its primary key on `member_id` means **no member can ever be in two pairs**, even if some future code skipped the lock.
5. The page subscribes to `activity_progress`, a single row of totals. On any change, reconnect, focus or coming back online, and on a 30-second fallback poll, it re-reads the real totals with `get_activity_progress()`.
6. Refreshing the page re-asks the server via `get_my_pairing(token)`. On a new phone or browser, the member signs in again and sees the same partner.

### Why the pairing can't race

Every write to `pairings` goes through `draw_partner`, and every call takes the same `pg_advisory_xact_lock` before reading the pool. The function is `VOLATILE`, so under `READ COMMITTED` each statement after the lock gets a fresh snapshot. That snapshot includes the pair committed by the previous lock holder, because the lock is only released at its `COMMIT`. A second simultaneous request therefore re-checks and either gets the same pair back (same member) or draws from the smaller pool (different member). With 24 people, serialising draws costs milliseconds. The `pair_memberships` primary key, the `member_a < member_b` check and the `member_a <> member_b` check are hard database backstops.

## Security design

| Threat | Mitigation |
|---|---|
| Picking someone else's name | A name alone does nothing. Every action needs a session obtained with that member's own access code. No public function accepts a member id except sign-in, which also needs the code. |
| Reading the pairing ledger | `anon`/`authenticated` have **no** privileges on `members`, `pairings`, `pair_memberships` or anything in `private`, and RLS is on with no policies. The only public table is `activity_progress` (counts only). |
| Reading another member's result | `get_my_pairing` resolves the member from the token. There is no parameter to ask about anyone else. |
| Stolen database rows | Codes are stored as bcrypt (`$2a$10$…`); session tokens only as SHA-256. Neither is ever returned. |
| Code guessing | Codes are 8 characters from a 31-symbol alphabet (~8.5 × 10¹¹ possibilities). Five wrong attempts lock that name for 15 minutes (row-locked, so parallel guesses can't skip past the limit). Every attempt is audited in `private.auth_events` (no secrets stored). |
| Replay / double taps | Draws are idempotent: repeating a request returns the same pair. Signed-out, expired and re-issued sessions are rejected. |
| Service-role key leak | It's used only by organiser scripts reading `.env.admin.local` (git-ignored). Vite only bundles `VITE_*` variables. `npm run build` output contains no service-role reference. |
| Tampering with history | No participant write access. A trigger also makes `pairings`/`pair_memberships` append-only for privileged roles (guards against accidental dashboard edits). Timestamps are forced to `now()` by trigger. |

**Known trade-offs (acceptable for a choir event):**

- Someone who knows a member's name could make five wrong guesses to lock that name for 15 minutes. The organiser can unlock it instantly (see [Organiser operations](#organiser-operations)).
- Codes are only as private as the channel used to send them. Send each person only their own code.
- Pair selection uses PostgreSQL `random()`, which is unpredictable to participants but not a cryptographic RNG. That's fine for a gift exchange.

### Why no Edge Function

An Edge Function was considered for authentication. It isn't needed: Postgres can verify bcrypt hashes (`pgcrypto`), mint and verify session tokens, rate-limit, and pair atomically, all inside `SECURITY DEFINER` functions that the anon key can call but can't look inside. Keeping everything in SQL means one deployment artefact, no extra secrets, and the whole thing can be tested against a real Postgres locally.

## Project layout

```
src/
  components/      UI only (Hero, DrawCard, SignInForm, PartnerReveal, ProgressPanel, …)
  hooks/           useLoveGift (session + draw state machine), useActivityProgress, useMembers
  services/        loveGiftApi.ts: the only code that talks to Supabase (RPC + realtime)
  lib/             supabase client, error types, access-code helpers, sessionStorage helper
  types/           shared TypeScript types
  styles/          global.css
  test/            jsdom test setup + in-memory fake API
supabase/
  migrations/      20261025000100_love_gift_schema.sql  (schema, RLS, functions)
                   20261025000200_love_gift_roster.sql  (the 24 names; idempotent)
  drop_v1_starter.sql   one-off cleanup if the old starter setup.sql was ever run
scripts/           organiser-only: provision-codes.mjs, export-pairings.mjs
tests/db/          real-PostgreSQL integration tests
```

---

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**. Choose a region close to the choir (e.g. `eu-west`) and save the database password somewhere safe.
2. **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up". The site doesn't use Supabase Auth.

## 2. Create the database

**Option A: SQL Editor (no tools needed)**

1. Open **SQL Editor → New query**.
2. Paste all of `supabase/migrations/20261025000100_love_gift_schema.sql` and click **Run**.
3. New query: paste all of `supabase/migrations/20261025000200_love_gift_roster.sql` and click **Run**.

**Option B: Supabase CLI**

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

```bash
npx supabase db push
```

Both files are safe to re-run. They never duplicate members or touch existing pairings.

**Check it worked** (SQL Editor):

```sql
select count(*) from public.members;                          -- 24
select * from public.get_activity_progress();                 -- 0 of 12 pairs
select pubname, tablename from pg_publication_tables
 where tablename = 'activity_progress';                        -- 1 row (realtime on)
```

If the realtime row is missing, go to **Database → Publications → supabase_realtime** and enable `activity_progress`.

## 3. Issue access codes

1. Copy `.env.admin.example` to `.env.admin.local` and fill in `SUPABASE_URL` and the **service_role** (or **secret**) key from **Project Settings → API**. This file is git-ignored. Never upload it to Vercel/Netlify and never prefix it with `VITE_`.
2. Install dependencies, then generate codes for every member who doesn't have one yet:

   ```bash
   npm install
   ```

   ```bash
   npm run codes:provision
   ```

3. The codes are written to `private/access-codes-<timestamp>.csv` (git-ignored). Send each member **only their own** code in a private message, then delete the file.
4. Lost or leaked code? Re-issue just that person's. Their old code and sessions stop working; their pairing is unaffected:

   ```bash
   npm run codes:provision -- --member "Hope Bass"
   ```

## 4. Run locally

```bash
cp .env.example .env
```

Put your project URL and **anon/publishable** key in `.env`, then:

```bash
npm run dev
```

Without a `.env`, the site shows a "not connected yet" notice instead of failing.

## Tests

```bash
npm test
```

This runs both suites:

- **`ui`** (jsdom, ~20 s): app flows against an in-memory fake API: validation, new and existing reveals, refresh recovery, dropped connections (including "the draw committed but the response was lost"), wrong codes, realtime updates, reconnects, and out-of-order responses.
- **`db`** (~2.5 min): boots a real throwaway **PostgreSQL 18** from the `embedded-postgres` npm binaries (no Docker), applies the migrations with Supabase-style roles and default grants, and tests pairing, concurrency (24 simultaneous draws, same-member races, lock-contention races), integrity constraints, append-only history, RLS, authorisation, rate limiting and session handling.

Run one suite with `npm run test:ui` or `npm run test:db`. To run the DB suite against another Postgres (e.g. `npx supabase start`), set a superuser URL:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db
```

> On Linux CI, Postgres refuses to run as `root`. Run tests as a normal user, or use `TEST_DATABASE_URL`.

Also available: `npm run lint`, `npm run typecheck`, `npm run build`.

## 5. Deploy

The site is static (`dist/`). Both configs ship security headers (CSP, `X-Frame-Options`, `nosniff`, `no-referrer`).

**Vercel**

1. Push the project to a GitHub repo (the `.gitignore` keeps `.env*`, `private/` and `node_modules` out).
2. Vercel → **Add New → Project** → import the repo. `vercel.json` sets the build settings.
3. **Settings → Environment Variables**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Production + Preview). Nothing else.
4. Deploy. Vercel serves it over HTTPS.

**Netlify**

1. Netlify → **Add new site → Import an existing project** → pick the repo. `netlify.toml` sets the build command, publish dir and Node 22.
2. **Site configuration → Environment variables**: add the same two `VITE_*` variables.
3. Deploy.

If you use a **custom Supabase domain**, add it to `connect-src` in `vercel.json` / `netlify.toml`.

## Production verification checklist

Do this on the live HTTPS URL **before** sending codes. Use the [rehearsal reset](#organiser-operations) afterwards.

- [ ] Page loads on an Android phone (Chrome) and on a desktop browser; the name list shows all 24 names.
- [ ] Progress shows **0 of 12 pairs made** and a green **Live** chip.
- [ ] Wrong code → "don't match" message; five wrong codes → "Too many attempts".
- [ ] Member A signs in → sees a partner (B). The progress on a *second* device goes to 1 of 12 without refreshing.
- [ ] Refresh on A's device → "Welcome back" with B.
- [ ] B signs in on another phone → sees A with "drew your name before you arrived". Pairs stay at 1.
- [ ] In the browser devtools Network tab, responses never contain other members' pairings, hashes or the service-role key.
- [ ] With the anon key, `GET https://<project>.supabase.co/rest/v1/pairings` returns a permission error, not data.
- [ ] `npm run pairings:export` lists the test pair with a UTC timestamp.
- [ ] Run the rehearsal reset, re-issue codes if they were shared during testing, then distribute.

## Organiser operations

Run these in the Supabase **SQL Editor** (they run as the database owner and are not reachable through the public API):

```sql
-- Full history with timestamps
select * from private.pairing_history;

-- Who has a code / who is locked out
select * from public.admin_access_code_status();

-- Unlock a member after too many wrong attempts
select private.admin_unlock_member((select id from public.members where display_name = 'Hope Bass'));

-- Rehearsal only: delete ALL pairings (refuses without the exact phrase)
select private.admin_reset_pairings('RESET ALL PAIRINGS');
```

From your computer: `npm run pairings:export` writes the full history to `private/pairings-<timestamp>.csv` and lists who isn't paired yet.

**Changing the roster:** edit `20261025000200_love_gift_roster.sql` *before* the event and re-run it (it only adds missing names). To remove someone, set `is_active = false` rather than deleting them. Keep the active count even, or one person will end up with no one to pair with (the site then says so clearly).

## Troubleshooting & recovery

| Symptom | Fix |
|---|---|
| Site says "This site isn't connected yet" | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` missing at **build** time. Add them in the host's settings and redeploy (a restart isn't enough). |
| "We couldn't load the choir list" | Wrong URL or key, project paused (free tier pauses after inactivity: **Restore** in the dashboard), or migrations not run. |
| `function public.list_members() does not exist` | Run the schema migration (step 2). |
| Migration error: "old v1 starter schema is installed" | The previous `setup.sql` was run. Run `supabase/drop_v1_starter.sql`, then both migrations. It refuses to drop a non-empty v1 pairings table. |
| Everyone's code is "invalid" | Codes not provisioned on *this* project (check `admin_access_code_status()`), or `.env.admin.local` pointed at another project. |
| Progress shows "Reconnecting…" forever | `activity_progress` isn't in the `supabase_realtime` publication (see step 2 check). The numbers still update via polling. |
| CSP errors in the console | You're using a custom Supabase domain: add it to `connect-src`. |
| `provision-codes` says "permission denied" | You used the anon key; use the service-role / secret key. |
| A member is locked out | `select private.admin_unlock_member(...)` (above). |
| A member lost their code | `npm run codes:provision -- --member "Exact Name"`. |
| `npm run test:db` fails on Linux CI as root | Run as a non-root user or set `TEST_DATABASE_URL`. |
