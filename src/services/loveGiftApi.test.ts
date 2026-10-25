import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseApi, parseDraw, parseMyPairing, parseSignIn } from './loveGiftApi';
import { ApiError } from '../lib/errors';
import { formatAccessCodeInput, normalizeAccessCode } from '../lib/accessCode';

function clientReturning(result: unknown) {
  const builder = { abortSignal: vi.fn(() => Promise.resolve(result)) };
  return { rpc: vi.fn(() => builder) } as unknown as SupabaseClient & { rpc: ReturnType<typeof vi.fn> };
}

describe('Supabase API adapter', () => {
  it('classifies fetch failures (status 0) as network errors', async () => {
    const api = createSupabaseApi(clientReturning({ data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 }));
    await expect(api.drawPartner('t')).rejects.toMatchObject({ kind: 'network' });
  });

  it('classifies HTTP errors as server errors', async () => {
    const api = createSupabaseApi(clientReturning({ data: null, error: { message: 'boom' }, status: 500 }));
    await expect(api.getProgress()).rejects.toMatchObject({ kind: 'server' });
  });

  it('treats a thrown fetch as a network error', async () => {
    const client = { rpc: vi.fn(() => ({ abortSignal: () => Promise.reject(new Error('aborted')) })) } as unknown as SupabaseClient;
    await expect(createSupabaseApi(client).getProgress()).rejects.toBeInstanceOf(ApiError);
  });

  it('sends only the session token to draw_partner', async () => {
    const client = clientReturning({ data: { status: 'invalid_session' }, error: null, status: 200 });
    await createSupabaseApi(client).drawPartner('abc');
    expect(client.rpc).toHaveBeenCalledWith('draw_partner', { p_session_token: 'abc' });
  });
});

describe('response parsing', () => {
  const member = { id: 'm1', name: 'Hope Bass' };
  const partner = { id: 'm2', name: 'Ime Okon' };

  it('parses created/existing draws', () => {
    expect(parseDraw({ status: 'created', member, partner, paired_at: '2026-10-25T10:00:00Z', initiated_by_me: true })).toEqual({
      status: 'created', member, pairing: { partner, pairedAt: '2026-10-25T10:00:00Z', initiatedByMe: true },
    });
  });

  it('rejects malformed payloads instead of showing a bogus partner', () => {
    expect(() => parseDraw({ status: 'created', member, partner: { id: 1 }, paired_at: 'x' })).toThrow(ApiError);
    expect(() => parseDraw({ status: 'weird' })).toThrow(ApiError);
    expect(() => parseMyPairing({ status: 'paired', member })).toThrow(ApiError);
    expect(() => parseSignIn({ status: 'ok' })).toThrow(ApiError);
  });

  it('parses sign-in outcomes', () => {
    expect(parseSignIn({ status: 'locked', retry_after_seconds: 120 })).toEqual({ status: 'locked', retryAfterSeconds: 120 });
    expect(parseSignIn({ status: 'invalid_credentials', attempts_remaining: 2 })).toEqual({ status: 'invalid_credentials', attemptsRemaining: 2 });
  });
});

describe('access code helpers', () => {
  it('normalises like the server', () => {
    expect(normalizeAccessCode(' abcd-ef gh ')).toBe('ABCDEFGH');
    expect(formatAccessCodeInput('abcdefgh')).toBe('ABCD-EFGH');
    expect(formatAccessCodeInput('abcd')).toBe('ABCD');
  });
});
