import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';
import { FakeLoveGiftApi } from './test/fakeApi';

const NAMES = ['Ikechukwu Achom', 'Gladys HOTR', 'Hope Bass', 'Ime Okon'];

async function setup(api = new FakeLoveGiftApi(NAMES)) {
  const user = userEvent.setup();
  const view = render(<App api={api} />);
  await screen.findByRole('option', { name: NAMES[0] });
  return { api, user, view };
}

async function signInAndChoose(user: ReturnType<typeof userEvent.setup>, api: FakeLoveGiftApi, name: string, code = api.codeFor(name)) {
  await user.selectOptions(screen.getByLabelText('Select your name'), api.member(name).id);
  await user.clear(screen.getByLabelText('Your access code'));
  await user.type(screen.getByLabelText('Your access code'), code);
  await user.click(screen.getByRole('button', { name: /choose a partner/i }));
}

const reveal = async () => (await screen.findByText(/your partner is$/)).closest('section') as HTMLElement;
const noReveal = () => expect(screen.queryByText(/your partner is$/)).not.toBeInTheDocument();

describe('partner selection', () => {
  it('validates that a name is selected before contacting the server', async () => {
    const { api, user } = await setup();
    await user.click(screen.getByRole('button', { name: /choose a partner/i }));
    expect(screen.getByText('Please select your name.')).toBeInTheDocument();
    expect(screen.getByLabelText('Select your name')).toHaveFocus();
    expect(api.calls.signIn).toBe(0);
  });

  it('requires an access code', async () => {
    const { api, user } = await setup();
    await user.selectOptions(screen.getByLabelText('Select your name'), api.member('Hope Bass').id);
    await user.click(screen.getByRole('button', { name: /choose a partner/i }));
    expect(screen.getByText(/enter the access code/i)).toBeInTheDocument();
    expect(api.calls.signIn).toBe(0);
  });

  it('1: reveals a newly drawn partner and offers no second draw', async () => {
    const { api, user } = await setup();
    await signInAndChoose(user, api, 'Ikechukwu Achom');
    const card = await reveal();
    expect(within(card).getByText('Your Love Gift partner has been chosen!')).toBeInTheDocument();
    const partner = api.pairs.get(api.member('Ikechukwu Achom').id)!.partnerId;
    expect(within(card).getByRole('heading', { name: api.members.find((m) => m.id === partner)!.name })).toHaveFocus();
    expect(screen.queryByRole('button', { name: /choose a partner/i })).not.toBeInTheDocument();
    expect(api.drawCalls).toBe(1);
  });

  it('4: a member drawn by someone else sees that existing partner (Ike → Gladys)', async () => {
    const api = new FakeLoveGiftApi(NAMES);
    api.pairOnServer('Ikechukwu Achom', 'Gladys HOTR');
    const { user } = await setup(api);
    await signInAndChoose(user, api, 'Gladys HOTR');
    const card = await reveal();
    expect(within(card).getByText('Your partner was already chosen')).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'Ikechukwu Achom' })).toBeInTheDocument();
    expect(within(card).getByText(/drew your name before you arrived/)).toBeInTheDocument();
    expect(api.pairs.size).toBe(2);
  });

  it('shows a clear error for a wrong access code', async () => {
    const { api, user } = await setup();
    await signInAndChoose(user, api, 'Hope Bass', 'WRONG123');
    expect(await screen.findByRole('alert')).toHaveTextContent(/don’t match/);
    expect(screen.getByText(/4 attempts left/)).toBeInTheDocument();
    expect(api.drawCalls).toBe(0);
  });

  it('6: after a refresh the partner is recovered from the server, not from local state', async () => {
    const api = new FakeLoveGiftApi(NAMES);
    const first = await setup(api);
    await signInAndChoose(first.user, api, 'Hope Bass');
    const partnerName = (await reveal()).querySelector('h3')!.textContent;
    first.view.unmount();

    render(<App api={api} />);
    const card = await reveal();
    expect(within(card).getByText(/Welcome back/)).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: partnerName! })).toBeInTheDocument();
    expect(api.calls.getMyPairing).toBeGreaterThan(0);
    expect(api.drawCalls).toBe(1);
  });

  it('6: a stored session the server no longer accepts falls back to sign-in', async () => {
    const api = new FakeLoveGiftApi(NAMES);
    const first = await setup(api);
    await signInAndChoose(first.user, api, 'Hope Bass');
    await reveal();
    first.view.unmount();
    api.sessions.clear();
    render(<App api={api} />);
    expect(await screen.findByLabelText('Select your name')).toBeInTheDocument();
    noReveal();
  });
});

describe('network failures', () => {
  it('12: a dropped draw request never reports success', async () => {
    const { api, user } = await setup();
    api.failNext('drawPartner', { kind: 'network' });
    await signInAndChoose(user, api, 'Ime Okon');
    expect(await screen.findByText('We couldn’t confirm your draw')).toBeInTheDocument();
    expect(screen.queryByText(/has been chosen/)).not.toBeInTheDocument();
    noReveal();
    expect(screen.getByText('Welcome, Ime Okon!')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /choose a partner/i }));
    expect(await reveal()).toHaveTextContent('Your Love Gift partner has been chosen!');
    expect(api.pairs.size).toBe(2);
  });

  it('12: if the draw committed but the response was lost, retrying shows the same saved partner', async () => {
    const { api, user } = await setup();
    api.failNext('drawPartner', { kind: 'network', afterCommit: true });
    await signInAndChoose(user, api, 'Ime Okon');
    expect(await screen.findByText('We couldn’t confirm your draw')).toBeInTheDocument();
    const saved = api.pairs.get(api.member('Ime Okon').id)!.partnerId;

    await user.click(screen.getByRole('button', { name: /choose a partner/i }));
    const card = await reveal();
    expect(within(card).getByText('Your partner was already chosen')).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: api.members.find((m) => m.id === saved)!.name })).toBeInTheDocument();
    expect(api.pairs.size).toBe(2);
  });

  it('shows a connection error when sign-in cannot reach the server', async () => {
    const { api, user } = await setup();
    api.failNext('signIn', { kind: 'network' });
    await signInAndChoose(user, api, 'Ime Okon');
    expect(await screen.findByText('No connection')).toBeInTheDocument();
    expect(api.drawCalls).toBe(0);
  });

  it('offers a retry when the roster fails to load', async () => {
    const api = new FakeLoveGiftApi(NAMES);
    api.failNext('listMembers', { kind: 'network' });
    const user = userEvent.setup();
    render(<App api={api} />);
    expect(await screen.findByText('We couldn’t load the choir list')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('option', { name: 'Hope Bass' })).toBeInTheDocument();
  });
});

describe('progress and realtime', () => {
  it('shows database totals without exposing any names or pairings', async () => {
    const api = new FakeLoveGiftApi(NAMES);
    api.pairOnServer('Ikechukwu Achom', 'Gladys HOTR');
    await setup(api);
    const panel = screen.getByRole('complementary', { name: 'Activity progress' });
    await waitFor(() => expect(within(panel).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1'));
    expect(panel).toHaveTextContent('1 of 2 pairs made');
    for (const name of NAMES) expect(panel).not.toHaveTextContent(name);
  });

  it('updates when a realtime event arrives', async () => {
    const { api } = await setup();
    const panel = screen.getByRole('complementary', { name: 'Activity progress' });
    await waitFor(() => expect(panel).toHaveTextContent('0 of 2 pairs made'));
    api.pairOnServer('Hope Bass', 'Ime Okon');
    act(() => api.emitChange());
    await waitFor(() => expect(panel).toHaveTextContent('1 of 2 pairs made'));
  });

  it('17: reconnecting re-reads the database, and late stale responses are ignored', async () => {
    const { api } = await setup();
    const panel = screen.getByRole('complementary', { name: 'Activity progress' });
    await waitFor(() => expect(panel).toHaveTextContent('0 of 2 pairs made'));

    act(() => api.emitStatus('reconnecting'));
    expect(panel).toHaveTextContent('Reconnecting…');

    // A refresh is in flight with the old numbers and gets delayed…
    const releaseStale = api.holdNext('getProgress');
    act(() => api.emitChange());
    // …meanwhile a pair is made and the reconnect triggers a newer read.
    api.pairOnServer('Hope Bass', 'Ime Okon');
    act(() => api.emitStatus('live'));
    await waitFor(() => expect(panel).toHaveTextContent('1 of 2 pairs made'));
    expect(panel).toHaveTextContent('Live');

    // The delayed response finally lands (computed now, but from an older request) — it must not regress the UI.
    api.pairs.clear();
    await act(async () => { releaseStale(); await Promise.resolve(); });
    await new Promise((r) => setTimeout(r, 20));
    expect(panel).toHaveTextContent('1 of 2 pairs made');
  });

  it('a waiting member is shown their partner as soon as someone else draws them', async () => {
    const { api, user } = await setup();
    api.failNext('drawPartner', { kind: 'network' });
    await signInAndChoose(user, api, 'Gladys HOTR');
    await screen.findByText('We couldn’t confirm your draw');

    api.pairOnServer('Ikechukwu Achom', 'Gladys HOTR');
    act(() => api.emitChange());
    const card = await reveal();
    expect(within(card).getByText('You’ve just been chosen!')).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'Ikechukwu Achom' })).toBeInTheDocument();
  });

  it('unsubscribes from realtime on unmount', async () => {
    const { api, view } = await setup();
    expect(api.subscriberCount).toBe(1);
    view.unmount();
    expect(api.subscriberCount).toBe(0);
  });
});

describe('configuration', () => {
  it('explains when the site is not connected to a database', () => {
    render(<App api={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This site isn’t connected yet');
  });
});

describe('personal links', () => {
  async function openLink(api: FakeLoveGiftApi, name: string, code = api.codeFor(name)) {
    const user = userEvent.setup();
    render(<App api={api} personalLink={{ memberId: api.member(name).id, code }} />);
    return user;
  }

  it('signs the member in from their link — no name or code to enter', async () => {
    const api = new FakeLoveGiftApi(NAMES);
    const user = await openLink(api, 'Hope Bass');
    expect(await screen.findByText('Welcome, Hope Bass!')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your access code')).not.toBeInTheDocument();
    expect(api.drawCalls).toBe(0);
    await user.click(screen.getByRole('button', { name: /choose a partner/i }));
    expect(await reveal()).toHaveTextContent('Your Love Gift partner has been chosen!');
    expect(api.calls.signIn).toBe(1);
  });

  it('goes straight to the reveal when their partner already drew them', async () => {
    const api = new FakeLoveGiftApi(NAMES);
    api.pairOnServer('Ikechukwu Achom', 'Gladys HOTR');
    await openLink(api, 'Gladys HOTR');
    const card = await reveal();
    expect(within(card).getByText('Your partner was already chosen')).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'Ikechukwu Achom' })).toBeInTheDocument();
    expect(api.drawCalls).toBe(0);
  });

  it('explains an old or wrong link and falls back to the normal form', async () => {
    const api = new FakeLoveGiftApi(NAMES);
    await openLink(api, 'Hope Bass', 'OLDCODE99');
    expect(await screen.findByText('This link didn’t work')).toBeInTheDocument();
    expect(screen.getByLabelText('Select your name')).toBeInTheDocument();
  });

  it('a link opened offline does not pretend to sign in', async () => {
    const api = new FakeLoveGiftApi(NAMES);
    api.failNext('signIn', { kind: 'network' });
    await openLink(api, 'Hope Bass');
    expect(await screen.findByText('No connection')).toBeInTheDocument();
    expect(screen.getByText(/tap your link again/)).toBeInTheDocument();
    noReveal();
  });

  it('a link wins over a different member’s saved session on the same phone', async () => {
    const api = new FakeLoveGiftApi(NAMES);
    const first = await setup(api);
    await signInAndChoose(first.user, api, 'Ime Okon');
    await reveal();
    first.view.unmount();
    await openLink(api, 'Hope Bass');
    expect(await screen.findByText('Welcome, Hope Bass!')).toBeInTheDocument();
  });
});
