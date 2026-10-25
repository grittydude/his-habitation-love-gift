import type { Session } from '../types/loveGift';

// The session token is kept in sessionStorage purely so a page refresh does
// not force the member to re-enter their code. It is NOT a record of the
// pairing: on load the app always asks the server what the pairing is.
// sessionStorage (not localStorage) so a shared phone forgets it when the tab closes.
const KEY = 'his-habitation:love-gift:session';

export function loadSession(): Session | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.token !== 'string' || !parsed.member || typeof parsed.expiresAt !== 'string') return null;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      clearSession();
      return null;
    }
    return parsed as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Private mode / blocked storage: the app still works, refresh just asks for the code again.
  }
}

export function clearSession(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
