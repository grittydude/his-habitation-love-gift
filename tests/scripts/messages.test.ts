import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { greetingName, loadPhones, personalLink, whatsappMessage, whatsappUrl, writeSendPage } from '../../scripts/lib/messages.mjs';
import { parsePersonalLink } from '../../src/lib/personalLink';

const ID = '3f0c2b8e-1d2a-4c7b-9e5f-0a1b2c3d4e5f';

describe('organiser messages', () => {
  it('builds links the site itself parses', () => {
    const link = personalLink('https://his-habitation-love-gift.vercel.app', ID, 'WXYZ-2345');
    expect(link).toBe(`https://his-habitation-love-gift.vercel.app/#m=${ID}&k=WXYZ2345`);
    expect(parsePersonalLink(new URL(link).hash)).toEqual({ memberId: ID, code: 'WXYZ2345' });
  });

  it('greets people naturally', () => {
    expect(greetingName('Mrs Patience HOTR')).toBe('Mrs Patience');
    expect(greetingName('Uche His Habitation')).toBe('Uche');
    expect(greetingName('Kenneth Drummer 2')).toBe('Kenneth Drummer 2');
    const msg = whatsappMessage('Gladys HOTR', 'https://x.app/#m=1&k=2');
    expect(msg).toMatch(/^Hi Gladys!/);
    expect(msg).toContain('https://x.app/#m=1&k=2');
    expect(msg).toMatch(/don’t share/);
  });

  it('pre-fills WhatsApp with or without a phone number', () => {
    expect(whatsappUrl('Hi & bye', '2348012345678')).toBe('https://wa.me/2348012345678?text=Hi%20%26%20bye');
    expect(whatsappUrl('Hi', undefined)).toBe('https://wa.me/?text=Hi');
  });

  it('reads an optional phones file', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'phones-'));
    const file = path.join(dir, 'phones.csv');
    writeFileSync(file, 'Gladys HOTR,+234 801 234 5678\n"Hope Bass", 0803-111-2222\nbad line\nAbia,12\n');
    const phones = loadPhones(file);
    expect(phones.get('Gladys HOTR')).toBe('2348012345678');
    expect(phones.get('Hope Bass')).toBe('08031112222');
    expect(phones.has('Abia')).toBe(false);
  });

  it('writes a send page that escapes names and messages', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'send-'));
    const file = path.join(dir, 'send-links-test.html');
    writeSendPage(file, [{
      memberId: ID, name: '<img src=x onerror=alert(1)>', message: 'Hi "you" & <b>', phone: undefined, whatsapp: 'https://wa.me/?text=Hi',
    }]);
    const html = readFileSync(file, 'utf8');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Hi &quot;you&quot; &amp; &lt;b&gt;');
    expect(html).toContain('0</span> of 1 sent');
  });
});
