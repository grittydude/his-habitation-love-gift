import { useEffect, useId, useState, type FormEvent } from 'react';
import { Download, HeartHandshake, LoaderCircle, LockKeyhole, LogOut, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { Notice } from '../components/Notice';
import { downloadText, toCsv } from '../lib/csv';
import { RESET_PHRASE, type AdminApi, type AdminOverview } from '../types/admin';
import type { LoveGiftApi } from '../types/loveGift';
import { useAdminConsole } from './useAdminConsole';

const formatTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function SignInCard({ busy, onSignIn }: { busy: boolean; onSignIn: (p: string) => void }) {
  const [passphrase, setPassphrase] = useState('');
  const id = useId();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (passphrase && !busy) onSignIn(passphrase);
  }
  return (
    <form className="signin" onSubmit={submit}>
      <div className="field">
        <label className="field__label" htmlFor={id}>Organiser passphrase</label>
        <div className="input-icon">
          <LockKeyhole size={17} aria-hidden="true" />
          <input
            id={id}
            type="password"
            className="input--plain"
            autoComplete="current-password"
            value={passphrase}
            disabled={busy}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </div>
      </div>
      <button type="submit" className="button button--primary button--block" disabled={busy || !passphrase}>
        {busy ? <><LoaderCircle className="spin" size={18} aria-hidden="true" /> Signing in…</> : 'Open console'}
      </button>
    </form>
  );
}

function PairingsTable({ overview }: { overview: AdminOverview }) {
  if (overview.pairings.length === 0) {
    return <p className="admin-empty">No pairings yet.</p>;
  }
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <caption className="sr-only">All pairings, oldest first</caption>
        <thead>
          <tr><th scope="col">#</th><th scope="col">Pair</th><th scope="col">Drawn by</th><th scope="col">Time</th></tr>
        </thead>
        <tbody>
          {overview.pairings.map((p, i) => (
            <tr key={p.pairingId}>
              <td>{i + 1}</td>
              <td><strong>{p.memberA}</strong> <span aria-hidden="true">♥</span><span className="sr-only">and</span> <strong>{p.memberB}</strong></td>
              <td data-label="Drawn by">{p.drawnBy}</td>
              <td data-label="Time"><time dateTime={p.createdAt}>{formatTime(p.createdAt)}</time></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DangerZone({ count, busy, onReset }: { count: number; busy: boolean; onReset: (phrase: string) => void }) {
  const [phrase, setPhrase] = useState('');
  const id = useId();
  const ready = phrase === RESET_PHRASE;
  return (
    <section className="admin-card admin-danger" aria-labelledby="danger-heading">
      <h2 id="danger-heading"><ShieldAlert size={18} aria-hidden="true" /> Clear all pairings</h2>
      <p>
        Deletes all {count} pairing{count === 1 ? '' : 's'}, signs every member out and clears wrong-code pauses.
        Members’ links keep working. <strong>This can’t be undone</strong>, so download the CSV first if you want a record.
        Use this after testing, never during the real event.
      </p>
      <form
        className="admin-danger__form"
        onSubmit={(e) => { e.preventDefault(); if (ready && !busy) { onReset(phrase); setPhrase(''); } }}
      >
        <label className="field__label" htmlFor={id}>Type <code>{RESET_PHRASE}</code> to confirm</label>
        <input
          id={id}
          className="admin-input"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={phrase}
          disabled={busy}
          onChange={(e) => setPhrase(e.target.value)}
        />
        <button type="submit" className="button button--danger" disabled={!ready || busy}>
          {busy ? <><LoaderCircle className="spin" size={18} aria-hidden="true" /> Clearing…</> : <><Trash2 size={17} aria-hidden="true" /> Clear all pairings</>}
        </button>
      </form>
    </section>
  );
}

interface Props {
  api: AdminApi | null;
  /** Live progress events, used to refresh the list automatically. */
  progressFeed?: Pick<LoveGiftApi, 'subscribeToProgress'> | null;
}

export default function AdminApp({ api, progressFeed }: Props) {
  return (
    <div className="admin">
      <header className="admin-bar">
        <span className="brand admin-brand">
          <span className="brand__mark"><HeartHandshake size={18} aria-hidden="true" /></span>
          <span className="brand__text">His <b>Habitation</b></span>
        </span>
        <span className="admin-bar__title">Organiser console</span>
      </header>
      <main className="admin-main">
        {api ? <Console api={api} progressFeed={progressFeed ?? null} /> : (
          <div className="admin-card" role="alert"><p>This site isn’t connected to its database yet.</p></div>
        )}
      </main>
    </div>
  );
}

function Console({ api, progressFeed }: { api: AdminApi; progressFeed: Pick<LoveGiftApi, 'subscribeToProgress'> | null }) {
  const c = useAdminConsole(api);
  const { refresh, phase } = c;

  // Refresh automatically whenever a pair is made elsewhere.
  useEffect(() => {
    if (phase !== 'ready' || !progressFeed) return;
    return progressFeed.subscribeToProgress({ onChange: () => void refresh(), onStatus: () => {} });
  }, [phase, progressFeed, refresh]);

  if (phase === 'checking') {
    return <p className="loading-line"><LoaderCircle className="spin" size={18} aria-hidden="true" /> Loading…</p>;
  }

  if (phase === 'signed_out' || phase === 'signing_in') {
    return (
      <div className="admin-card admin-signin">
        <h1 className="draw-card__title">Organiser sign-in</h1>
        <p className="admin-muted">This page shows every pairing. Don’t open it where others can see your screen.</p>
        <SignInCard busy={phase === 'signing_in'} onSignIn={(p) => void c.signIn(p)} />
        {c.message && <Notice message={c.message} onDismiss={c.dismissMessage} />}
      </div>
    );
  }

  const o = c.overview!;
  const download = () => downloadText(
    `love-gift-pairings-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(['#', 'Member A', 'Member B', 'Drawn by', 'Time (UTC)'],
      o.pairings.map((p, i) => [i + 1, p.memberA, p.memberB, p.drawnBy, new Date(p.createdAt).toISOString()])),
  );

  return (
    <>
      <div className="admin-head">
        <h1 className="draw-card__title">All pairings</h1>
        <div className="admin-actions">
          <button type="button" className="button button--ghost button--small" onClick={() => void refresh()} disabled={c.refreshing}>
            <RefreshCw size={15} aria-hidden="true" className={c.refreshing ? 'spin' : undefined} /> Refresh
          </button>
          <button type="button" className="button button--ghost button--small" onClick={download} disabled={o.pairings.length === 0}>
            <Download size={15} aria-hidden="true" /> Download CSV
          </button>
          <button type="button" className="button button--ghost button--small" onClick={() => void c.signOut()}>
            <LogOut size={15} aria-hidden="true" /> Sign out
          </button>
        </div>
      </div>

      {c.message && <Notice message={c.message} onDismiss={c.dismissMessage} />}

      <dl className="admin-stats" aria-live="polite">
        <div><dt>Pairs made</dt><dd>{o.progress.pairsCompleted} <span>of {o.progress.totalPairs}</span></dd></div>
        <div><dt>Waiting for a partner</dt><dd>{o.progress.unpairedMembers}</dd></div>
        <div><dt>Members</dt><dd>{o.progress.totalMembers}</dd></div>
      </dl>

      <section className="admin-card" aria-labelledby="pairs-heading">
        <h2 id="pairs-heading" className="sr-only">Pairings</h2>
        <PairingsTable overview={o} />
      </section>

      {o.unpaired.length > 0 && (
        <section className="admin-card" aria-labelledby="unpaired-heading">
          <h2 id="unpaired-heading">Not paired yet ({o.unpaired.length})</h2>
          <ul className="admin-chips">{o.unpaired.map((n) => <li key={n}>{n}</li>)}</ul>
        </section>
      )}

      {o.lockedMembers.length > 0 && (
        <section className="admin-card" aria-labelledby="locked-heading">
          <h2 id="locked-heading">Paused after wrong codes</h2>
          <p className="admin-muted">These members typed a wrong code five times and are paused for 15 minutes: {o.lockedMembers.join(', ')}.</p>
        </section>
      )}

      <DangerZone count={o.pairings.length} busy={c.resetting} onReset={(p) => void c.reset(p)} />
    </>
  );
}
