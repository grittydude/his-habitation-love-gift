import { PartyPopper, RefreshCw, UsersRound } from 'lucide-react';
import type { ProgressState } from '../hooks/useActivityProgress';

export function ProgressPanel({ progress, status, live, refresh }: ProgressState & { refresh: () => void }) {
  const liveLabel = live === 'live' ? 'Live' : live === 'connecting' ? 'Connecting…' : 'Reconnecting…';
  return (
    <aside className="progress-card" aria-labelledby="progress-heading">
      <div className="progress-card__head">
        <span className="progress-card__icon"><UsersRound size={20} aria-hidden="true" /></span>
        <h2 id="progress-heading" className="progress-card__title">Activity progress</h2>
        <span className={`live-chip live-chip--${live}`} title="Updates arrive automatically">
          <span className="live-chip__dot" aria-hidden="true" /> {liveLabel}
        </span>
      </div>

      {status === 'loading' && (
        <div className="progress-card__skeleton" aria-busy="true" aria-label="Loading progress">
          <span /><span /><span />
        </div>
      )}

      {status === 'error' && (
        <div className="state-block state-block--compact" role="status">
          <p className="state-block__body">Progress is unavailable right now.</p>
          <button type="button" className="button button--ghost button--small" onClick={refresh}>
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {status === 'ready' && progress && (
        <div aria-live="polite">
          <p className="progress-card__big">
            {progress.pairsCompleted}<span> of {progress.totalPairs} pairs made</span>
          </p>
          <div
            className="meter"
            role="progressbar"
            aria-label="Pairs made"
            aria-valuemin={0}
            aria-valuemax={progress.totalPairs}
            aria-valuenow={progress.pairsCompleted}
          >
            <span style={{ width: `${progress.totalPairs ? (progress.pairsCompleted / progress.totalPairs) * 100 : 0}%` }} />
          </div>
          <dl className="progress-card__stats">
            <div><dt>Members in the circle</dt><dd>{progress.totalMembers}</dd></div>
            <div><dt>Still waiting for a partner</dt><dd>{progress.unpairedMembers}</dd></div>
          </dl>
          {progress.isComplete ? (
            <p className="progress-card__done"><PartyPopper size={16} aria-hidden="true" /> Every member has a partner. Thank you, His Habitation!</p>
          ) : (
            <p className="progress-card__note">Only totals are shown here — every pairing stays private to the two people in it.</p>
          )}
        </div>
      )}
    </aside>
  );
}
