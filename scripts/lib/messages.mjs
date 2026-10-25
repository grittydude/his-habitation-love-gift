// Personal links and ready-to-send WhatsApp messages for organisers.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Mirrors src/lib/personalLink.ts: credentials go in the URL fragment, which is never sent to servers. */
export function personalLink(siteUrl, memberId, code) {
  const url = new URL(siteUrl);
  url.hash = new URLSearchParams({ m: memberId, k: code.replace(/[^a-z0-9]/gi, '').toUpperCase() }).toString();
  return url.toString();
}

/** "Mrs Patience HOTR" → "Mrs Patience"; "Uche His Habitation" → "Uche". */
export function greetingName(name) {
  return name.replace(/\s+(HOTR|His Habitation)$/i, '').trim() || name;
}

export function whatsappMessage(name, link) {
  return [
    `Hi ${greetingName(name)}! 💚`,
    '',
    'It’s Love Gift Day at His Habitation 🎁 Tap your personal link to find out who your Love Gift partner is:',
    link,
    '',
    'This link is just for you — please don’t share it or forward this message.',
  ].join('\n');
}

/**
 * Optional private/phones.csv with lines "Exact Name,+2348012345678".
 * Returns Map(name → digits only, international format without "+").
 */
export function loadPhones(file = path.join('private', 'phones.csv')) {
  const phones = new Map();
  if (!existsSync(file)) return phones;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const idx = line.lastIndexOf(',');
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim().replace(/^"|"$/g, '');
    const digits = line.slice(idx + 1).replace(/\D/g, '');
    if (name && digits.length >= 8) phones.set(name, digits);
  }
  return phones;
}

export function whatsappUrl(message, phoneDigits) {
  return `https://wa.me/${phoneDigits ?? ''}?text=${encodeURIComponent(message)}`;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A self-contained local HTML page for sending each member their message. */
export function writeSendPage(file, entries) {
  const cards = entries.map((e, i) => `
    <li class="card" data-key="${esc(e.memberId)}">
      <div class="top">
        <label class="sent"><input type="checkbox" data-i="${i}"> Sent</label>
        <h2>${esc(e.name)}</h2>
        ${e.phone ? `<span class="phone">+${esc(e.phone)}</span>` : '<span class="phone none">no number — pick the chat in WhatsApp</span>'}
      </div>
      <pre id="m${i}">${esc(e.message)}</pre>
      <div class="actions">
        <button type="button" data-copy="m${i}">Copy message</button>
        <a href="${esc(e.whatsapp)}" target="_blank" rel="noopener noreferrer">Open WhatsApp</a>
      </div>
    </li>`).join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Send Love Gift links (PRIVATE)</title>
<style>
  :root { color-scheme: light; font-family: system-ui, sans-serif; background: #fbf7ee; color: #1b2620; }
  body { margin: 0 auto; max-width: 860px; padding: 24px 16px 60px; }
  h1 { font-size: 1.5rem; margin: 0 0 6px; color: #173b2c; }
  .warn { background: #fdf3dc; color: #7a5200; padding: 12px 14px; border-radius: 12px; margin: 12px 0 20px; font-size: .92rem; }
  .count { font-weight: 700; color: #173b2c; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; }
  .card { background: #fff; border: 1px solid rgba(23,59,44,.14); border-radius: 16px; padding: 16px; }
  .card.done { opacity: .5; }
  .top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
  h2 { font-size: 1.1rem; margin: 0; flex: 1; }
  .phone { font-size: .85rem; color: #56645b; } .phone.none { font-style: italic; }
  .sent { font-size: .9rem; display: flex; gap: 6px; align-items: center; cursor: pointer; }
  pre { white-space: pre-wrap; word-break: break-word; background: #f3ebdb; border-radius: 10px; padding: 12px; font: .88rem/1.45 system-ui, sans-serif; margin: 12px 0; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; }
  button, .actions a { font: inherit; font-weight: 600; border-radius: 999px; padding: 9px 16px; cursor: pointer; text-decoration: none; }
  button { border: 1px solid rgba(23,59,44,.25); background: #fff; color: #173b2c; }
  .actions a { background: #1f8f4e; color: #fff; border: 0; }
</style></head>
<body>
  <h1>Love Gift Day — personal links</h1>
  <p class="count"><span id="done">0</span> of ${entries.length} sent</p>
  <div class="warn"><b>Private.</b> Each link signs that person in. Send every message only to that person — never to the group — then delete this file and the CSV beside it.</div>
  <ul>${cards}</ul>
<script>
  const KEY = 'love-gift-sent:${esc(path.basename(file))}';
  let sent = {}; try { sent = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
  const boxes = [...document.querySelectorAll('input[type=checkbox]')];
  function paint() {
    boxes.forEach((b) => { const card = b.closest('.card'); b.checked = !!sent[card.dataset.key]; card.classList.toggle('done', b.checked); });
    document.getElementById('done').textContent = boxes.filter((b) => b.checked).length;
  }
  boxes.forEach((b) => b.addEventListener('change', () => {
    sent[b.closest('.card').dataset.key] = b.checked;
    try { localStorage.setItem(KEY, JSON.stringify(sent)); } catch {}
    paint();
  }));
  document.querySelectorAll('[data-copy]').forEach((btn) => btn.addEventListener('click', async () => {
    const text = document.getElementById(btn.dataset.copy).textContent;
    try { await navigator.clipboard.writeText(text); } catch {
      const r = document.createRange(); r.selectNodeContents(document.getElementById(btn.dataset.copy));
      getSelection().removeAllRanges(); getSelection().addRange(r); document.execCommand('copy');
    }
    btn.textContent = 'Copied ✓'; setTimeout(() => (btn.textContent = 'Copy message'), 1500);
  }));
  paint();
</script>
</body></html>
`;
  writeFileSync(file, html, { mode: 0o600 });
}
