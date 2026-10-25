import { useCallback, useEffect, useState } from 'react';
import type { LoveGiftApi, Member } from '../types/loveGift';

export interface MembersState {
  members: Member[];
  status: 'loading' | 'ready' | 'error';
}

export function useMembers(api: LoveGiftApi): MembersState & { retry: () => void } {
  const [state, setState] = useState<MembersState>({ members: [], status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.listMembers().then(
      (members) => { if (!cancelled) setState({ members, status: 'ready' }); },
      () => { if (!cancelled) setState((s) => ({ ...s, status: 'error' })); },
    );
    return () => { cancelled = true; };
  }, [api, attempt]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }));
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, retry };
}
