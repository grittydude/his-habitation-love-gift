import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AdminApp from './AdminApp';
import { FakeAdminApi } from '../test/fakeAdminApi';
import type { ProgressSubscription } from '../types/loveGift';
import { toCsv } from '../lib/csv';

const NAMES = ['Ikechukwu Achom', 'Gladys HOTR', 'Hope Bass', 'Ime Okon'];

function feed() {
  const subs = new Set<ProgressSubscription>();
  return {
    subscribeToProgress: (h: ProgressSubscription) => { subs.add(h); return () => { subs.delete(h); }; },
    emit: () => subs.forEach((s) => s.onChange()),
    get count() { return subs.size; },
  };
}

async function signIn(api: FakeAdminApi, f = feed()) {
  const user = userEvent.setup();
  const view = render(<AdminApp api={api} progressFeed={f} />);
  await user.type(screen.getByLabelText('Organiser passphrase'), 'correct horse battery');
  await user.click(screen.getByRole('button', { name: 'Open console' }));
  await screen.findByRole('heading', { name: 'All pairings' });
  return { user, view, f };
}

describe('organiser console', () => {
  it('rejects a wrong passphrase and shows nothing', async () => {
    const api = new FakeAdminApi(NAMES);
    api.pair('Ikechukwu Achom', 'Gladys HOTR');
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await user.type(screen.getByLabelText('Organiser passphrase'), 'guess');
    await user.click(screen.getByRole('button', { name: 'Open console' }));
    expect(await screen.findByText('Wrong passphrase')).toBeInTheDocument();
    expect(screen.queryByText('Gladys HOTR')).not.toBeInTheDocument();
  });

  it('explains when the passphrase has not been set up', async () => {
    const api = new FakeAdminApi(NAMES);
    api.passphrase = null;
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await user.type(screen.getByLabelText('Organiser passphrase'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Open console' }));
    expect(await screen.findByText(/hasn’t been set/)).toBeInTheDocument();
  });

  it('lists every pairing with who drew and when, plus who is still waiting', async () => {
    const api = new FakeAdminApi(NAMES);
    api.pair('Ikechukwu Achom', 'Gladys HOTR');
    await signIn(api);
    const row = screen.getByRole('row', { name: /Ikechukwu Achom.*Gladys HOTR/ });
    expect(within(row).getByText('Ikechukwu Achom', { selector: 'td' })).toBeInTheDocument();
    expect(within(row).getByRole('time')).toHaveAttribute('dateTime', '2026-10-25T18:30:00Z');
    expect(screen.getByRole('heading', { name: 'Not paired yet (2)' })).toBeInTheDocument();
    expect(screen.getByText('Hope Bass')).toBeInTheDocument();
  });

  it('refreshes by itself when a new pair is made', async () => {
    const api = new FakeAdminApi(NAMES);
    const { f } = await signIn(api);
    expect(screen.getByText('No pairings yet.')).toBeInTheDocument();
    api.pair('Hope Bass', 'Ime Okon');
    await act(async () => { f.emit(); });
    expect(await screen.findByRole('row', { name: /Hope Bass.*Ime Okon/ })).toBeInTheDocument();
  });

  it('only clears after the exact phrase is typed, then shows an empty list', async () => {
    const api = new FakeAdminApi(NAMES);
    api.pair('Ikechukwu Achom', 'Gladys HOTR');
    const { user } = await signIn(api);
    const button = screen.getByRole('button', { name: /clear all pairings/i });
    expect(button).toBeDisabled();
    const input = screen.getByLabelText(/to confirm/);
    await user.type(input, 'reset all pairings');
    expect(button).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'RESET ALL PAIRINGS');
    expect(button).toBeEnabled();
    await user.click(button);
    expect(await screen.findByText('Cleared 1 pairing')).toBeInTheDocument();
    expect(screen.getByText('No pairings yet.')).toBeInTheDocument();
    expect(api.resets).toBe(1);
    expect(input).toHaveValue('');
  });

  it('a dropped reset response re-reads the list instead of guessing', async () => {
    const api = new FakeAdminApi(NAMES);
    api.pair('Ikechukwu Achom', 'Gladys HOTR');
    const { user } = await signIn(api);
    api.failNext = { method: 'reset', afterCommit: true };
    await user.type(screen.getByLabelText(/to confirm/), 'RESET ALL PAIRINGS');
    await user.click(screen.getByRole('button', { name: /clear all pairings/i }));
    expect(await screen.findByText('We couldn’t confirm the reset')).toBeInTheDocument();
    expect(screen.getByText('No pairings yet.')).toBeInTheDocument();
  });

  it('returns to sign-in when the session expires, and after signing out', async () => {
    const api = new FakeAdminApi(NAMES);
    const { user } = await signIn(api);
    api.tokens.clear();
    await user.click(screen.getByRole('button', { name: /refresh/i }));
    expect(await screen.findByText('Please sign in again')).toBeInTheDocument();
    expect(screen.getByLabelText('Organiser passphrase')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('his-habitation:love-gift:admin')).toBeNull();
  });

  it('stays signed in across a refresh of the page, then signs out cleanly', async () => {
    const api = new FakeAdminApi(NAMES);
    const first = await signIn(api);
    first.view.unmount();
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    expect(await screen.findByRole('heading', { name: 'All pairings' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(screen.getByLabelText('Organiser passphrase')).toBeInTheDocument();
    expect(api.tokens.size).toBe(0);
  });

  it('downloads a CSV of the pairings', async () => {
    const api = new FakeAdminApi(NAMES);
    api.pair('Ikechukwu Achom', 'Gladys HOTR');
    const createUrl = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user } = await signIn(api);
    await user.click(screen.getByRole('button', { name: /download csv/i }));
    expect(createUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });
});

describe('csv', () => {
  it('quotes and neutralises spreadsheet formulas', () => {
    expect(toCsv(['a', 'b'], [['=SUM(1)', 'x, "y"']])).toBe('a,b\r\n\'=SUM(1),"x, ""y"""\r\n');
  });
});
