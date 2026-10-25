import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../lib/errors';
import type { AdminApi, AdminOverview, AdminOverviewResult, AdminResetResult, AdminSignInResult } from '../types/admin';
import { createRpc, parseProgress, type Json } from './loveGiftApi';

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError('server', 'Unexpected console data.');
  return value;
}

const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.map(asString) : []);

export function parseAdminSignIn(row: Json): AdminSignInResult {
  switch (row.status) {
    case 'ok':
      return { status: 'ok', token: asString(row.session_token), expiresAt: asString(row.expires_at) };
    case 'invalid_credentials':
      return { status: 'invalid_credentials', attemptsRemaining: typeof row.attempts_remaining === 'number' ? row.attempts_remaining : undefined };
    case 'locked':
      return { status: 'locked', retryAfterSeconds: typeof row.retry_after_seconds === 'number' ? row.retry_after_seconds : 900 };
    case 'not_configured':
      return { status: 'not_configured' };
  }
  throw new ApiError('server', 'Unexpected console sign-in response.');
}

export function parseAdminOverview(row: Json): AdminOverviewResult {
  if (row.status === 'invalid_session') return { status: 'invalid_session' };
  if (row.status !== 'ok') throw new ApiError('server', 'Unexpected console response.');
  const overview: AdminOverview = {
    progress: parseProgress(row.progress as Json),
    pairings: (Array.isArray(row.pairings) ? row.pairings : []).map((p: Json) => ({
      pairingId: asString(p.pairing_id),
      memberA: asString(p.member_a),
      memberB: asString(p.member_b),
      drawnBy: asString(p.drawn_by),
      createdAt: asString(p.created_at),
    })),
    unpaired: asStrings(row.unpaired),
    lockedMembers: asStrings(row.locked_members),
  };
  return { status: 'ok', overview };
}

export function parseAdminReset(row: Json): AdminResetResult {
  switch (row.status) {
    case 'ok':
      return { status: 'ok', pairingsDeleted: Number(row.pairings_deleted ?? 0), sessionsEnded: Number(row.sessions_ended ?? 0) };
    case 'invalid_session':
    case 'confirmation_required':
      return { status: row.status };
  }
  throw new ApiError('server', 'Unexpected reset response.');
}

export function createSupabaseAdminApi(client: SupabaseClient): AdminApi {
  const rpc = createRpc(client);
  return {
    async signIn(passphrase) {
      return parseAdminSignIn(await rpc<Json>('admin_console_sign_in', { p_passphrase: passphrase }));
    },
    async signOut(token) {
      await rpc<Json>('admin_console_sign_out', { p_token: token });
    },
    async overview(token) {
      return parseAdminOverview(await rpc<Json>('admin_console_overview', { p_token: token }));
    },
    async reset(token, confirmation) {
      return parseAdminReset(await rpc<Json>('admin_console_reset', { p_token: token, p_confirm: confirmation }));
    },
  };
}
