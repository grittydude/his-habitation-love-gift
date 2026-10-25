import { normalizeAccessCode } from './accessCode';

// Personal sign-in links look like  https://site/#m=<member uuid>&k=<access code>
//
// The credentials live in the URL *fragment* on purpose: browsers never send
// the fragment to the web server, in the Referer header, or to WhatsApp's
// link-preview fetcher. The app reads it once at start-up and immediately
// removes it from the address bar and history entry.

export interface PersonalLink {
  memberId: string;
  code: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePersonalLink(hash: string): PersonalLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const memberId = params.get('m') ?? '';
  const code = normalizeAccessCode(params.get('k') ?? '');
  if (!UUID.test(memberId) || code.length < 8 || code.length > 64) return null;
  return { memberId: memberId.toLowerCase(), code };
}

export function buildPersonalLink(siteUrl: string, memberId: string, code: string): string {
  const url = new URL(siteUrl);
  url.hash = new URLSearchParams({ m: memberId, k: normalizeAccessCode(code) }).toString();
  return url.toString();
}

/** Read a personal link from the current URL (once, at start-up) and strip it from the address bar. */
export function takePersonalLinkFromLocation(): PersonalLink | null {
  try {
    const link = parsePersonalLink(window.location.hash);
    if (window.location.hash.includes('k=')) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#draw`);
    }
    return link;
  } catch {
    return null;
  }
}
