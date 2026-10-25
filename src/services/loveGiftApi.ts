import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../lib/errors';
import type {
  ActivityProgress, DrawResult, LoveGiftApi, Member, MyPairingResult, Pairing, SignInResult,
} from '../types/loveGift';

const REQUEST_TIMEOUT_MS = 15_000;

export type Json = Record<string, unknown>;

function asMember(value: unknown): Member {
  const m = value as Json | null;
  if (!m || typeof m.id !== 'string' || typeof m.name !== 'string') {
    throw new ApiError('server', 'The server returned an unexpected member.');
  }
  return { id: m.id, name: m.name };
}

function asPairing(row: Json): Pairing {
  if (typeof row.paired_at !== 'string') throw new ApiError('server', 'The server returned an unexpected pairing.');
  return { partner: asMember(row.partner), pairedAt: row.paired_at, initiatedByMe: row.initiated_by_me === true };
}

function asNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ApiError('server', 'Unexpected progress data.');
  return value;
}

export function parseProgress(row: Json): ActivityProgress {
  return {
    totalMembers: asNumber(row.total_members),
    pairedMembers: asNumber(row.paired_members),
    unpairedMembers: asNumber(row.unpaired_members),
    pairsCompleted: asNumber(row.pairs_completed),
    totalPairs: asNumber(row.total_pairs),
    isComplete: row.is_complete === true,
  };
}

export function parseSignIn(row: Json): SignInResult {
  switch (row.status) {
    case 'ok':
      if (typeof row.session_token !== 'string' || typeof row.expires_at !== 'string') break;
      return { status: 'ok', session: { token: row.session_token, expiresAt: row.expires_at, member: asMember(row.member) } };
    case 'invalid_credentials':
      return { status: 'invalid_credentials', attemptsRemaining: typeof row.attempts_remaining === 'number' ? row.attempts_remaining : undefined };
    case 'locked':
      return { status: 'locked', retryAfterSeconds: typeof row.retry_after_seconds === 'number' ? row.retry_after_seconds : 900 };
  }
  throw new ApiError('server', 'Unexpected sign-in response.');
}

export function parseDraw(row: Json): DrawResult {
  switch (row.status) {
    case 'created':
    case 'existing':
      return { status: row.status, member: asMember(row.member), pairing: asPairing(row) };
    case 'no_partner_available':
      return { status: 'no_partner_available', member: asMember(row.member) };
    case 'invalid_session':
      return { status: 'invalid_session' };
  }
  throw new ApiError('server', 'Unexpected draw response.');
}

export function parseMyPairing(row: Json): MyPairingResult {
  switch (row.status) {
    case 'paired':
      return { status: 'paired', member: asMember(row.member), pairing: asPairing(row) };
    case 'unpaired':
      return { status: 'unpaired', member: asMember(row.member) };
    case 'invalid_session':
      return { status: 'invalid_session' };
  }
  throw new ApiError('server', 'Unexpected pairing response.');
}

export type Rpc = <T>(fn: string, args?: Json) => Promise<T>;

/** Calls a Postgres function, mapping failures to ApiError('network' | 'server'). */
export function createRpc(client: SupabaseClient): Rpc {
  return async function rpc<T>(fn: string, args?: Json): Promise<T> {
    let result;
    try {
      result = await client.rpc(fn, args).abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
    } catch {
      throw new ApiError('network', 'We could not reach the server.');
    }
    const { data, error, status } = result;
    if (error) {
      // postgrest-js reports fetch failures (offline, DNS, timeout) as status 0.
      if (status === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        throw new ApiError('network', 'We could not reach the server.');
      }
      throw new ApiError('server', error.message || 'The server reported an error.');
    }
    if (data === null || data === undefined) throw new ApiError('server', 'The server returned no data.');
    return data as T;
  };
}

/** Supabase implementation: every call is an RPC; no table is read directly. */
export function createSupabaseApi(client: SupabaseClient): LoveGiftApi {
  const rpc = createRpc(client);

  return {
    async listMembers() {
      const rows = await rpc<unknown[]>('list_members');
      if (!Array.isArray(rows)) throw new ApiError('server', 'Unexpected roster response.');
      return rows.map(asMember);
    },
    async getProgress() {
      return parseProgress(await rpc<Json>('get_activity_progress'));
    },
    async signIn(memberId, accessCode) {
      return parseSignIn(await rpc<Json>('member_sign_in', { p_member_id: memberId, p_access_code: accessCode }));
    },
    async signOut(token) {
      await rpc<Json>('member_sign_out', { p_session_token: token });
    },
    async getMyPairing(token) {
      return parseMyPairing(await rpc<Json>('get_my_pairing', { p_session_token: token }));
    },
    async drawPartner(token) {
      return parseDraw(await rpc<Json>('draw_partner', { p_session_token: token }));
    },
    subscribeToProgress({ onChange, onStatus }) {
      // Realtime only tells us "something changed"; the handler re-reads the
      // authoritative numbers through get_activity_progress.
      const channel = client
        .channel('love-gift-progress')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_progress' }, () => onChange())
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') onStatus('live');
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus('reconnecting');
        });
      return () => {
        void client.removeChannel(channel);
      };
    },
  };
}
