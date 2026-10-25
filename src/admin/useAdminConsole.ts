import { useCallback, useEffect, useRef, useState } from 'react';
import { isNetworkError } from '../lib/errors';
import type { UiMessage } from '../hooks/useLoveGift';
import type { AdminApi, AdminOverview } from '../types/admin';
import { RESET_PHRASE } from '../types/admin';

// The console token lives in sessionStorage only (forgotten when the tab
// closes). It expires on the server after 30 minutes regardless.
const KEY = 'his-habitation:love-gift:admin';

function loadToken(): string | null {
  try { return window.sessionStorage.getItem(KEY); } catch { return null; }
}
function saveToken(token: string | null) {
  try {
    if (token) window.sessionStorage.setItem(KEY, token);
    else window.sessionStorage.removeItem(KEY);
  } catch { /* storage blocked: sign in again after refresh */ }
}

export type ConsolePhase = 'checking' | 'signed_out' | 'signing_in' | 'ready';

const OFFLINE: UiMessage = { tone: 'warning', title: 'No connection', body: 'We couldn’t reach the server. Check your connection and try again.' };
const EXPIRED: UiMessage = { tone: 'info', title: 'Please sign in again', body: 'Your organiser session expired (sessions last 30 minutes).' };

export function useAdminConsole(api: AdminApi) {
  const [phase, setPhase] = useState<ConsolePhase>(() => (loadToken() ? 'checking' : 'signed_out'));
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const token = useRef<string | null>(null);
  const seq = useRef(0);

  const expire = useCallback((msg: UiMessage | null) => {
    token.current = null;
    saveToken(null);
    setOverview(null);
    setPhase('signed_out');
    setMessage(msg);
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!token.current) return false;
    const id = ++seq.current;
    setRefreshing(true);
    try {
      const res = await api.overview(token.current);
      if (id !== seq.current) return false;
      if (res.status === 'invalid_session') {
        expire(EXPIRED);
        return false;
      }
      setOverview(res.overview);
      setPhase('ready');
      return true;
    } catch (error) {
      if (id === seq.current) setMessage(isNetworkError(error) ? OFFLINE : { tone: 'error', title: 'Couldn’t load the pairings', body: 'Please try again.' });
      return false;
    } finally {
      if (id === seq.current) setRefreshing(false);
    }
  }, [api, expire]);

  useEffect(() => {
    const saved = loadToken();
    if (!saved) return;
    token.current = saved;
    // Load the console from the server on open. On a network failure, show the
    // sign-in card (with the offline notice) rather than spin forever.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- only the spinner flag is set before the await
    void refresh().then((ok) => { if (!ok) setPhase((p) => (p === 'checking' ? 'signed_out' : p)); });
  }, [refresh]);

  const signIn = useCallback(async (passphrase: string) => {
    setPhase('signing_in');
    setMessage(null);
    try {
      const res = await api.signIn(passphrase);
      if (res.status === 'ok') {
        token.current = res.token;
        saveToken(res.token);
        if (!(await refresh())) setPhase('signed_out');
        return;
      }
      setPhase('signed_out');
      if (res.status === 'not_configured') {
        setMessage({ tone: 'info', title: 'The organiser passphrase hasn’t been set', body: 'Run “npm run admin:passphrase” on the organiser computer first (see the README).' });
      } else if (res.status === 'locked') {
        const minutes = Math.max(1, Math.ceil(res.retryAfterSeconds / 60));
        setMessage({ tone: 'error', title: 'Too many attempts', body: `The console is paused for about ${minutes} minute${minutes === 1 ? '' : 's'}.` });
      } else {
        setMessage({ tone: 'error', title: 'Wrong passphrase', body: res.attemptsRemaining !== undefined ? `${res.attemptsRemaining} attempt${res.attemptsRemaining === 1 ? '' : 's'} left before a 15-minute pause.` : undefined });
      }
    } catch (error) {
      setPhase('signed_out');
      setMessage(isNetworkError(error) ? OFFLINE : { tone: 'error', title: 'Something went wrong', body: 'Please try again.' });
    }
  }, [api, refresh]);

  const signOut = useCallback(async () => {
    const t = token.current;
    expire(null);
    if (t) { try { await api.signOut(t); } catch { /* best effort */ } }
  }, [api, expire]);

  const reset = useCallback(async (confirmation: string) => {
    if (!token.current || confirmation !== RESET_PHRASE) return;
    setResetting(true);
    setMessage(null);
    try {
      const res = await api.reset(token.current, confirmation);
      if (res.status === 'invalid_session') { expire(EXPIRED); return; }
      if (res.status === 'confirmation_required') {
        setMessage({ tone: 'error', title: 'Confirmation phrase didn’t match', body: `Type ${RESET_PHRASE} exactly.` });
        return;
      }
      await refresh();
      setMessage({
        tone: 'info',
        title: `Cleared ${res.pairingsDeleted} pairing${res.pairingsDeleted === 1 ? '' : 's'}`,
        body: `Everyone has been signed out (${res.sessionsEnded} session${res.sessionsEnded === 1 ? '' : 's'}). Members’ links still work, so the real draw can start whenever you’re ready.`,
      });
    } catch (error) {
      // The reset may or may not have happened — re-read rather than guess.
      await refresh();
      setMessage(isNetworkError(error)
        ? { tone: 'warning', title: 'We couldn’t confirm the reset', body: 'The connection dropped. Check the pairings list below to see whether it was cleared.' }
        : { tone: 'error', title: 'The reset failed', body: 'Nothing was changed. Please try again.' });
    } finally {
      setResetting(false);
    }
  }, [api, expire, refresh]);

  return { phase, overview, message, refreshing, resetting, signIn, signOut, refresh, reset, dismissMessage: () => setMessage(null) };
}
