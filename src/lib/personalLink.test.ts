import { afterEach, describe, expect, it } from 'vitest';
import { buildPersonalLink, parsePersonalLink, takePersonalLinkFromLocation } from './personalLink';

const ID = '3f0c2b8e-1d2a-4c7b-9e5f-0a1b2c3d4e5f';

describe('personal links', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('round-trips member id and code through the URL fragment', () => {
    const link = buildPersonalLink('https://example.app/', ID, 'abcd-efgh');
    expect(link).toBe(`https://example.app/#m=${ID}&k=ABCDEFGH`);
    expect(parsePersonalLink(new URL(link).hash)).toEqual({ memberId: ID, code: 'ABCDEFGH' });
  });

  it('ignores missing, malformed or partial links', () => {
    for (const hash of ['', '#draw', `#m=${ID}`, '#m=not-a-uuid&k=ABCDEFGH', `#m=${ID}&k=SHORT`, `#k=ABCDEFGH`]) {
      expect(parsePersonalLink(hash)).toBeNull();
    }
  });

  it('removes the credentials from the address bar after reading them', () => {
    window.history.replaceState(null, '', `/?utm=x#m=${ID}&k=ABCD-EFGH`);
    expect(takePersonalLinkFromLocation()).toEqual({ memberId: ID, code: 'ABCDEFGH' });
    expect(window.location.hash).toBe('#draw');
    expect(window.location.href).not.toContain('ABCD');
    expect(window.location.search).toBe('?utm=x');
  });

  it('strips a broken link too, and leaves ordinary anchors alone', () => {
    window.history.replaceState(null, '', '/#m=bad&k=ABCDEFGH');
    expect(takePersonalLinkFromLocation()).toBeNull();
    expect(window.location.href).not.toContain('ABCDEFGH');
    window.history.replaceState(null, '', '/#draw');
    expect(takePersonalLinkFromLocation()).toBeNull();
    expect(window.location.hash).toBe('#draw');
  });
});
