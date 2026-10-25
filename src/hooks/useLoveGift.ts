import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { isNetworkError } from '../lib/errors';
import type { PersonalLink } from '../lib/personalLink';
import { clearSession, loadSession, saveSession } from '../lib/sessionStore';
import type { LoveGiftApi, Pairing, Session, SignInResult } from '../types/loveGift';

export type RevealOrigin = 'created' | 'existing' | 'restored' | 'live';

export type Phase =
  | { kind: 'restoring' }
  | { kind: 'idle' }
  | { kind: 'signing_in'; viaLink?: boolean }
  | { kind: 'ready'; session: Session }
  | { kind: 'drawing'; session: Session }
  | { kind: 'revealed'; session: Session; pairing: Pairing; origin: RevealOrigin }
  | { kind: 'no_partner'; session: Session };

export interface UiMessage {
  tone: 'error' | 'warning' | 'info';
  title: string;
  body?: string;
}

interface State {
  phase: Phase;
  message: UiMessage | null;
}

type Action =
  | { type: 'phase'; phase: Phase; message?: UiMessage | null }
  | { type: 'message'; message: UiMessage | null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'phase':
      return { phase: action.phase, message: action.message === undefined ? null : action.message };
    case 'message':
      return { ...state, message: action.message };
  }
}

const NETWORK_DRAW_MESSAGE: UiMessage = {
  tone: 'warning',
  title: 'We couldn’t confirm your draw',
  body: 'The connection dropped before the server answered. Your partner may already be saved — tap “Choose a Partner” again. It will show the same partner and can never create a second pair.',
};

const SESSION_EXPIRED: UiMessage = {
  tone: 'info',
  title: 'Please sign in again',
  body: 'Your session expired. Select your name and enter your access code to see your partner.',
};

function serverMessage(): UiMessage {
  return { tone: 'error', title: 'Something went wrong on our side', body: 'Please try again in a moment. If it keeps happening, let the choir organiser know.' };
}

function signInFailure(res: Exclude<SignInResult, { status: 'ok' }>, viaLink: boolean): UiMessage {
  if (res.status === 'locked') {
    const minutes = Math.max(1, Math.ceil(res.retryAfterSeconds / 60));
    return { tone: 'error', title: 'Too many attempts', body: `For safety, sign-in for this name is paused. Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}, or ask the choir organiser for help.` };
  }
  if (viaLink) {
    return { tone: 'error', title: 'This link didn’t work', body: 'It may be an old link. Please ask the choir organiser to send you a new one.' };
  }
  return {
    tone: 'error',
    title: 'That name and access code don’t match',
    body: res.attemptsRemaining !== undefined
      ? `Please check your code and try again. ${res.attemptsRemaining} attempt${res.attemptsRemaining === 1 ? '' : 's'} left before a short pause.`
      : 'Please check your code and try again.',
  };
}

const OFFLINE_SIGN_IN: UiMessage = { tone: 'warning', title: 'No connection', body: 'We couldn’t reach the server. Check your internet connection and try again.' };

/**
 * @param personalLink credentials from a personal sign-in link, read from the
 *   URL once at start-up; signs the member in automatically.
 */
export function useLoveGift(api: LoveGiftApi, personalLink: PersonalLink | null = null) {
  const [state, dispatch] = useReducer(reducer, { phase: { kind: 'restoring' }, message: null });
  // Latest phase for async callbacks (which must not capture a stale render).
  const phaseRef = useRef<Phase>(state.phase);
  useLayoutEffect(() => { phaseRef.current = state.phase; }, [state.phase]);
  const busy = useRef(false);

  const resetToSignIn = useCallback((message: UiMessage | null) => {
    clearSession();
    dispatch({ type: 'phase', phase: { kind: 'idle' }, message });
  }, []);

  const runDraw = useCallback(async (session: Session) => {
    dispatch({ type: 'phase', phase: { kind: 'drawing', session } });
    try {
      const res = await api.drawPartner(session.token);
      switch (res.status) {
        case 'created':
        case 'existing':
          dispatch({ type: 'phase', phase: { kind: 'revealed', session, pairing: res.pairing, origin: res.status } });
          return;
        case 'no_partner_available':
          dispatch({ type: 'phase', phase: { kind: 'no_partner', session } });
          return;
        case 'invalid_session':
          resetToSignIn(SESSION_EXPIRED);
          return;
      }
    } catch (error) {
      // Never assume success: the draw may or may not have committed. Retrying
      // is safe because the server returns the existing pair.
      dispatch({ type: 'phase', phase: { kind: 'ready', session }, message: isNetworkError(error) ? NETWORK_DRAW_MESSAGE : serverMessage() });
    }
  }, [api, resetToSignIn]);

  // Ask the server (never local state) whether this member is already paired.
  const showPairing = useCallback(async (session: Session, isCurrent: () => boolean, origin: RevealOrigin = 'restored') => {
    try {
      const res = await api.getMyPairing(session.token);
      if (!isCurrent()) return;
      if (res.status === 'paired') dispatch({ type: 'phase', phase: { kind: 'revealed', session, pairing: res.pairing, origin } });
      else if (res.status === 'unpaired') dispatch({ type: 'phase', phase: { kind: 'ready', session } });
      else resetToSignIn(null);
    } catch (error) {
      if (!isCurrent()) return;
      dispatch({
        type: 'phase',
        phase: { kind: 'ready', session },
        message: isNetworkError(error)
          ? { tone: 'warning', title: 'You seem to be offline', body: 'We couldn’t check your pairing. Reconnect and tap “Choose a Partner” — it will show your saved partner if you already have one.' }
          : serverMessage(),
      });
    }
  }, [api, resetToSignIn]);

  // Personal link: sign in once. A ref (not the effect's cleanup) guards it,
  // so React StrictMode's double effect run can't spend two sign-in attempts.
  const linkHandled = useRef(false);
  useEffect(() => {
    if (!personalLink || linkHandled.current) return;
    linkHandled.current = true;
    dispatch({ type: 'phase', phase: { kind: 'signing_in', viaLink: true } });
    api.signIn(personalLink.memberId, personalLink.code).then(
      (res) => {
        if (res.status !== 'ok') {
          resetToSignIn(signInFailure(res, true));
          return;
        }
        saveSession(res.session);
        void showPairing(res.session, () => true, 'existing');
      },
      (error) => {
        dispatch({ type: 'phase', phase: { kind: 'idle' }, message: isNetworkError(error) ? { ...OFFLINE_SIGN_IN, body: 'We couldn’t reach the server. Check your internet connection, then tap your link again.' } : serverMessage() });
      },
    );
  }, [api, personalLink, resetToSignIn, showPairing]);

  // No link: recover this browser's session, if any.
  useEffect(() => {
    if (personalLink) return;
    let cancelled = false;
    const session = loadSession();
    if (!session) {
      dispatch({ type: 'phase', phase: { kind: 'idle' } });
      return;
    }
    void showPairing(session, () => !cancelled);
    return () => { cancelled = true; };
  }, [personalLink, showPairing]);

  /** Sign in with name + code, then draw (or recover the existing pair). */
  const start = useCallback(async (memberId: string, accessCode: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const current = phaseRef.current;
      if (current.kind === 'ready' && current.session.member.id === memberId) {
        await runDraw(current.session);
        return;
      }
      dispatch({ type: 'phase', phase: { kind: 'signing_in' } });
      let res;
      try {
        res = await api.signIn(memberId, accessCode);
      } catch (error) {
        dispatch({
          type: 'phase',
          phase: { kind: 'idle' },
          message: isNetworkError(error) ? OFFLINE_SIGN_IN : serverMessage(),
        });
        return;
      }
      if (res.status !== 'ok') {
        dispatch({ type: 'phase', phase: { kind: 'idle' }, message: signInFailure(res, false) });
        return;
      }
      saveSession(res.session);
      await runDraw(res.session);
    } finally {
      busy.current = false;
    }
  }, [api, runDraw]);

  /** Called when live progress changes: a waiting member may just have been drawn by someone else. */
  const recheck = useCallback(async () => {
    const current = phaseRef.current;
    if (current.kind !== 'ready' && current.kind !== 'no_partner') return;
    if (busy.current) return;
    try {
      const res = await api.getMyPairing(current.session.token);
      const now = phaseRef.current;
      if (now.kind !== current.kind || now.session.token !== current.session.token) return;
      if (res.status === 'paired') {
        dispatch({ type: 'phase', phase: { kind: 'revealed', session: current.session, pairing: res.pairing, origin: 'live' } });
      } else if (res.status === 'invalid_session') {
        resetToSignIn(SESSION_EXPIRED);
      }
    } catch {
      // Background reconciliation only; the next progress tick retries.
    }
  }, [api, resetToSignIn]);

  const signOut = useCallback(async () => {
    const current = phaseRef.current;
    resetToSignIn(null);
    if ('session' in current) {
      try { await api.signOut(current.session.token); } catch { /* best effort */ }
    }
  }, [api, resetToSignIn]);

  const dismissMessage = useCallback(() => dispatch({ type: 'message', message: null }), []);

  return { phase: state.phase, message: state.message, start, recheck, signOut, dismissMessage };
}
