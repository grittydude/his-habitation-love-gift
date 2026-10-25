import { ApiError } from '../lib/errors';
import { RESET_PHRASE, type AdminApi, type AdminOverviewResult, type AdminPairing, type AdminResetResult, type AdminSignInResult } from '../types/admin';

/** In-memory stand-in for the organiser console RPCs. */
export class FakeAdminApi implements AdminApi {
  passphrase: string | null = 'correct horse battery';
  tokens = new Set<string>();
  pairings: AdminPairing[] = [];
  unpaired: string[] = [];
  resets = 0;
  failNext: { method: 'overview' | 'reset' | 'signIn'; afterCommit?: boolean } | null = null;
  private seq = 0;

  constructor(members: string[]) {
    this.unpaired = [...members];
  }

  pair(a: string, b: string) {
    this.unpaired = this.unpaired.filter((n) => n !== a && n !== b);
    this.pairings.push({ pairingId: `p${this.pairings.length}`, memberA: a, memberB: b, drawnBy: a, createdAt: '2026-10-25T18:30:00Z' });
  }

  private maybeFail(method: 'overview' | 'reset' | 'signIn', before: boolean) {
    if (this.failNext?.method === method && Boolean(this.failNext.afterCommit) !== before) {
      this.failNext = null;
      throw new ApiError('network', 'offline');
    }
  }

  async signIn(passphrase: string): Promise<AdminSignInResult> {
    this.maybeFail('signIn', true);
    if (this.passphrase === null) return { status: 'not_configured' };
    if (passphrase !== this.passphrase) return { status: 'invalid_credentials', attemptsRemaining: 4 };
    const token = `admin-${++this.seq}`;
    this.tokens.add(token);
    return { status: 'ok', token, expiresAt: new Date(Date.now() + 1_800_000).toISOString() };
  }

  async signOut(token: string) {
    this.tokens.delete(token);
  }

  async overview(token: string): Promise<AdminOverviewResult> {
    this.maybeFail('overview', true);
    if (!this.tokens.has(token)) return { status: 'invalid_session' };
    const total = this.unpaired.length + this.pairings.length * 2;
    return {
      status: 'ok',
      overview: {
        progress: {
          totalMembers: total, pairedMembers: this.pairings.length * 2, unpairedMembers: this.unpaired.length,
          pairsCompleted: this.pairings.length, totalPairs: Math.floor(total / 2), isComplete: this.unpaired.length < 2,
        },
        pairings: [...this.pairings],
        unpaired: [...this.unpaired].sort(),
        lockedMembers: [],
      },
    };
  }

  async reset(token: string, confirmation: string): Promise<AdminResetResult> {
    this.maybeFail('reset', true);
    if (!this.tokens.has(token)) return { status: 'invalid_session' };
    if (confirmation !== RESET_PHRASE) return { status: 'confirmation_required' };
    const deleted = this.pairings.length;
    for (const p of this.pairings) this.unpaired.push(p.memberA, p.memberB);
    this.pairings = [];
    this.resets++;
    this.maybeFail('reset', false);
    return { status: 'ok', pairingsDeleted: deleted, sessionsEnded: 3 };
  }
}
