import type { ActivityProgress } from './loveGift';

export interface AdminPairing {
  pairingId: string;
  memberA: string;
  memberB: string;
  drawnBy: string;
  createdAt: string;
}

export interface AdminOverview {
  progress: ActivityProgress;
  pairings: AdminPairing[];
  unpaired: string[];
  lockedMembers: string[];
}

export type AdminSignInResult =
  | { status: 'ok'; token: string; expiresAt: string }
  | { status: 'invalid_credentials'; attemptsRemaining?: number }
  | { status: 'locked'; retryAfterSeconds: number }
  | { status: 'not_configured' };

export type AdminOverviewResult = { status: 'ok'; overview: AdminOverview } | { status: 'invalid_session' };

export type AdminResetResult =
  | { status: 'ok'; pairingsDeleted: number; sessionsEnded: number }
  | { status: 'invalid_session' }
  | { status: 'confirmation_required' };

export const RESET_PHRASE = 'RESET ALL PAIRINGS';

/** Organiser console backend. Implemented over Supabase RPC; faked in tests. */
export interface AdminApi {
  signIn(passphrase: string): Promise<AdminSignInResult>;
  signOut(token: string): Promise<void>;
  overview(token: string): Promise<AdminOverviewResult>;
  reset(token: string, confirmation: string): Promise<AdminResetResult>;
}
