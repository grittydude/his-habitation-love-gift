import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityProgress, LiveStatus, LoveGiftApi } from '../types/loveGift';

const FALLBACK_POLL_MS = 30_000;

export interface ProgressState {
  progress: ActivityProgress | null;
  status: 'loading' | 'ready' | 'error';
  live: LiveStatus;
}

/**
 * Progress always comes from the database (get_activity_progress). Realtime
 * events, reconnects, focus, coming back online and a slow poll all just
 * trigger a re-read, so missed or late events can't leave stale numbers.
 * Responses are sequence-numbered and older ones are dropped, so overlapping
 * refreshes (e.g. a burst of events during a reconnect) can't apply out of order.
 */
export function useActivityProgress(api: LoveGiftApi): ProgressState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<ProgressState>({ progress: null, status: 'loading', live: 'connecting' });
  const requested = useRef(0);
  const applied = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requested.current;
    try {
      const progress = await api.getProgress();
      if (id < applied.current) return;
      applied.current = id;
      setState((s) => ({ ...s, progress, status: 'ready' }));
    } catch {
      if (id < applied.current) return;
      // Keep showing the last known numbers if we have them.
      setState((s) => ({ ...s, status: s.progress ? 'ready' : 'error' }));
    }
  }, [api]);

  useEffect(() => {
    // refresh() only sets state after awaiting the server, i.e. this effect
    // subscribes to an external system rather than setting state synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const unsubscribe = api.subscribeToProgress({
      onChange: () => void refresh(),
      onStatus: (live) => {
        setState((s) => ({ ...s, live }));
        // (Re)subscribed: events may have been missed while disconnected.
        if (live === 'live') void refresh();
      },
    });
    const poll = window.setInterval(() => void refresh(), FALLBACK_POLL_MS);
    const onWake = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    window.addEventListener('online', onWake);
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
      window.removeEventListener('online', onWake);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [api, refresh]);

  return { ...state, refresh };
}
