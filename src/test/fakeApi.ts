import { ApiError } from '../lib/errors';
import type {
  ActivityProgress, DrawResult, LiveStatus, LoveGiftApi, Member, MyPairingResult, Pairing, ProgressSubscription, SignInResult,
} from '../types/loveGift';

type Method = 'listMembers' | 'getProgress' | 'signIn' | 'getMyPairing' | 'drawPartner';

interface Fault {
  kind: 'network' | 'server';
  /** For drawPartner: commit the draw on the "server" but lose the response. */
  afterCommit?: boolean;
}

/**
 * In-memory stand-in for the Supabase RPC API with the same observable
 * semantics as the SQL functions (one pair per member, idempotent draws,
 * session tokens). Lets UI tests inject network faults, delays and realtime events.
 */
export class FakeLoveGiftApi implements LoveGiftApi {
  members: Member[];
  codes = new Map<string, string>();
  sessions = new Map<string, string>();
  pairs = new Map<string, { partnerId: string; pairedAt: string; initiatedBy: string }>();
  drawCalls = 0;
  calls: Record<Method, number> = { listMembers: 0, getProgress: 0, signIn: 0, getMyPairing: 0, drawPartner: 0 };
  private faults = new Map<Method, Fault[]>();
  private gates = new Map<Method, Array<Promise<void>>>();
  private subscribers = new Set<ProgressSubscription>();
  private tokenSeq = 0;

  constructor(names: string[]) {
    this.members = names.map((name, i) => ({ id: `m${i}`, name }));
    this.members.forEach((m, i) => this.codes.set(m.id, `CODE${String(i).padStart(4, '0')}`));
  }

  member(name: string): Member {
    const m = this.members.find((x) => x.name === name);
    if (!m) throw new Error(`no member ${name}`);
    return m;
  }

  codeFor(name: string): string {
    return this.codes.get(this.member(name).id)!;
  }

  failNext(method: Method, fault: Fault) {
    this.faults.set(method, [...(this.faults.get(method) ?? []), fault]);
  }

  /** Hold the next call to `method` until the returned release function is called. */
  holdNext(method: Method): () => void {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    this.gates.set(method, [...(this.gates.get(method) ?? []), gate]);
    return release;
  }

  emitChange() { this.subscribers.forEach((s) => s.onChange()); }
  emitStatus(status: LiveStatus) { this.subscribers.forEach((s) => s.onStatus(status)); }

  /** Server-side pairing, as if another member drew on their own phone. */
  pairOnServer(initiatorName: string, partnerName?: string): Member {
    const me = this.member(initiatorName).id;
    const partnerId = partnerName ? this.member(partnerName).id : this.pool(me)[0];
    const pairedAt = new Date().toISOString();
    this.pairs.set(me, { partnerId, pairedAt, initiatedBy: me });
    this.pairs.set(partnerId, { partnerId: me, pairedAt, initiatedBy: me });
    return this.members.find((m) => m.id === partnerId)!;
  }

  private pool(excludeId: string) {
    return this.members.map((m) => m.id).filter((id) => id !== excludeId && !this.pairs.has(id));
  }

  private async enter(method: Method): Promise<Fault | undefined> {
    this.calls[method]++;
    const gate = this.gates.get(method)?.shift();
    if (gate) await gate;
    await Promise.resolve();
    const fault = this.faults.get(method)?.shift();
    if (fault && !fault.afterCommit) throw new ApiError(fault.kind, `${fault.kind} failure`);
    return fault;
  }

  private pairingOf(id: string): Pairing | null {
    const p = this.pairs.get(id);
    if (!p) return null;
    return { partner: this.members.find((m) => m.id === p.partnerId)!, pairedAt: p.pairedAt, initiatedByMe: p.initiatedBy === id };
  }

  async listMembers() {
    await this.enter('listMembers');
    return [...this.members];
  }

  async getProgress(): Promise<ActivityProgress> {
    await this.enter('getProgress');
    const total = this.members.length;
    const paired = this.pairs.size;
    return {
      totalMembers: total, pairedMembers: paired, unpairedMembers: total - paired,
      pairsCompleted: paired / 2, totalPairs: Math.floor(total / 2), isComplete: total - paired < 2,
    };
  }

  async signIn(memberId: string, accessCode: string): Promise<SignInResult> {
    await this.enter('signIn');
    if (this.codes.get(memberId) !== accessCode) return { status: 'invalid_credentials', attemptsRemaining: 4 };
    const token = `token-${++this.tokenSeq}`;
    this.sessions.set(token, memberId);
    const member = this.members.find((m) => m.id === memberId)!;
    return { status: 'ok', session: { token, member, expiresAt: new Date(Date.now() + 7_200_000).toISOString() } };
  }

  async signOut(token: string) {
    this.sessions.delete(token);
  }

  async getMyPairing(token: string): Promise<MyPairingResult> {
    await this.enter('getMyPairing');
    const id = this.sessions.get(token);
    if (!id) return { status: 'invalid_session' };
    const member = this.members.find((m) => m.id === id)!;
    const pairing = this.pairingOf(id);
    return pairing ? { status: 'paired', member, pairing } : { status: 'unpaired', member };
  }

  async drawPartner(token: string): Promise<DrawResult> {
    const fault = await this.enter('drawPartner');
    this.drawCalls++;
    const id = this.sessions.get(token);
    if (!id) return { status: 'invalid_session' };
    const member = this.members.find((m) => m.id === id)!;
    const existing = this.pairingOf(id);
    let result: DrawResult;
    if (existing) {
      result = { status: 'existing', member, pairing: existing };
    } else {
      const pool = this.pool(id);
      if (!pool.length) return { status: 'no_partner_available', member };
      this.pairOnServer(member.name, this.members.find((m) => m.id === pool[0])!.name);
      result = { status: 'created', member, pairing: this.pairingOf(id)! };
    }
    if (fault?.afterCommit) throw new ApiError(fault.kind, 'response lost');
    return result;
  }

  subscribeToProgress(handlers: ProgressSubscription) {
    this.subscribers.add(handlers);
    return () => { this.subscribers.delete(handlers); };
  }

  get subscriberCount() { return this.subscribers.size; }
}
