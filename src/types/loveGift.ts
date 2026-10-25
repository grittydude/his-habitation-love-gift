export interface Member {
  id: string;
  name: string;
}

export interface Session {
  token: string;
  member: Member;
  expiresAt: string;
}

export interface Pairing {
  partner: Member;
  pairedAt: string;
  /** True when this member pressed the button; false when their partner drew them first. */
  initiatedByMe: boolean;
}

export interface ActivityProgress {
  totalMembers: number;
  pairedMembers: number;
  unpairedMembers: number;
  pairsCompleted: number;
  totalPairs: number;
  isComplete: boolean;
}

export type SignInResult =
  | { status: 'ok'; session: Session }
  | { status: 'invalid_credentials'; attemptsRemaining?: number }
  | { status: 'locked'; retryAfterSeconds: number };

export type DrawResult =
  | { status: 'created' | 'existing'; member: Member; pairing: Pairing }
  | { status: 'no_partner_available'; member: Member }
  | { status: 'invalid_session' };

export type MyPairingResult =
  | { status: 'paired'; member: Member; pairing: Pairing }
  | { status: 'unpaired'; member: Member }
  | { status: 'invalid_session' };

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

export interface ProgressSubscription {
  onChange: () => void;
  onStatus: (status: LiveStatus) => void;
}

/** Everything the UI needs from the backend. Implemented over Supabase RPC; faked in tests. */
export interface LoveGiftApi {
  listMembers(): Promise<Member[]>;
  getProgress(): Promise<ActivityProgress>;
  signIn(memberId: string, accessCode: string): Promise<SignInResult>;
  signOut(token: string): Promise<void>;
  getMyPairing(token: string): Promise<MyPairingResult>;
  drawPartner(token: string): Promise<DrawResult>;
  /** Returns an unsubscribe function. */
  subscribeToProgress(handlers: ProgressSubscription): () => void;
}
