import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { isNetworkError } from '../lib/errors';
import { clearSession, loadSession, saveSession } from '../lib/sessionStore';
import type { LoveGiftApi, Pairing, Session } from '../types/loveGift';

export type RevealOrigin = 'created' | 'existing' | 'restored' | 'live';

export type Phase =
  | { kind: 'restoring' }
  | { kind: 'idle' }
  | { kind: 'signing_in' }
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

export function useLoveGift(api: LoveGiftApi) {
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

  // On load, recover from the server (never from local state) who this
  // browser's member is paired with.
  useEffect(() => {
    let cancelled = false;
    const session = loadSession();
    if (!session) {
      dispatch({ type: 'phase', phase: { kind: 'idle' } });
      return;
    }
    api.getMyPairing(session.token).then(
      (res) => {
        if (cancelled) return;
        if (res.status === 'paired') dispatch({ type: 'phase', phase: { kind: 'revealed', session, pairing: res.pairing, origin: 'restored' } });
        else if (res.status === 'unpaired') dispatch({ type: 'phase', phase: { kind: 'ready', session } });
        else resetToSignIn(null);
      },
      (error) => {
        if (cancelled) return;
        dispatch({
          type: 'phase',
          phase: { kind: 'ready', session },
          message: isNetworkError(error)
            ? { tone: 'warning', title: 'You seem to be offline', body: 'We couldn’t check your pairing. Reconnect and tap “Choose a Partner” — it will show your saved partner if you already have one.' }
            : serverMessage(),
        });
      },
    );
    return () => { cancelled = true; };
  }, [api, resetToSignIn]);

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
          message: isNetworkError(error)
            ? { tone: 'warning', title: 'No connection', body: 'We couldn’t reach the server. Check your internet connection and try again.' }
            : serverMessage(),
        });
        return;
      }
      if (res.status === 'invalid_credentials') {
        dispatch({
          type: 'phase',
          phase: { kind: 'idle' },
          message: {
            tone: 'error',
            title: 'That name and access code don’t match',
            body: res.attemptsRemaining !== undefined
              ? `Please check your code and try again. ${res.attemptsRemaining} attempt${res.attemptsRemaining === 1 ? '' : 's'} left before a short pause.`
              : 'Please check your code and try again.',
          },
        });
        return;
      }
      if (res.status === 'locked') {
        const minutes = Math.max(1, Math.ceil(res.retryAfterSeconds / 60));
        dispatch({
          type: 'phase',
          phase: { kind: 'idle' },
          message: { tone: 'error', title: 'Too many attempts', body: `For safety, sign-in for this name is paused. Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}, or ask the choir organiser for help.` },
        });
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
