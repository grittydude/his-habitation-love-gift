import { useEffect } from 'react';
import { LockKeyhole } from 'lucide-react';
import { DrawCard } from './components/DrawCard';
import { Hero } from './components/Hero';
import { HowItWorks } from './components/HowItWorks';
import { ProgressPanel } from './components/ProgressPanel';
import { SiteFooter } from './components/SiteFooter';
import { useActivityProgress } from './hooks/useActivityProgress';
import { useLoveGift } from './hooks/useLoveGift';
import { useMembers } from './hooks/useMembers';
import type { PersonalLink } from './lib/personalLink';
import type { LoveGiftApi } from './types/loveGift';

function Activity({ api, personalLink, drawSuspenseMs }: { api: LoveGiftApi; personalLink: PersonalLink | null; drawSuspenseMs?: number }) {
  const roster = useMembers(api);
  const progress = useActivityProgress(api);
  const gift = useLoveGift(api, personalLink, drawSuspenseMs);
  const { recheck } = gift;
  const { refresh } = progress;
  const pairedMembers = progress.progress?.pairedMembers;
  const revealed = gift.phase.kind === 'revealed';

  // Someone else's draw may have just paired the member who is waiting here.
  useEffect(() => {
    if (pairedMembers !== undefined) void recheck();
  }, [pairedMembers, recheck]);

  // Our own draw changed the totals; don't wait for the realtime event.
  useEffect(() => {
    if (revealed) void refresh();
  }, [revealed, refresh]);

  return (
    <div className="draw-layout container">
      <DrawCard
        phase={gift.phase}
        message={gift.message}
        roster={roster}
        activityComplete={progress.progress?.isComplete ?? false}
        onStart={(id, code) => void gift.start(id, code)}
        onSignOut={() => void gift.signOut()}
        onDismissMessage={gift.dismissMessage}
      />
      <ProgressPanel {...progress} refresh={() => void progress.refresh()} />
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="container">
      <div className="draw-card setup-card" role="alert">
        <LockKeyhole size={22} aria-hidden="true" />
        <h2 className="draw-card__title">This site isn’t connected yet</h2>
        <p>
          The Love Gift database hasn’t been configured for this deployment. Organisers: set
          <code> VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> and redeploy (see the README).
        </p>
      </div>
    </div>
  );
}

interface AppProps {
  api: LoveGiftApi | null;
  personalLink?: PersonalLink | null;
  /** Minimum draw-animation time; tests pass 0. */
  drawSuspenseMs?: number;
}

export default function App({ api, personalLink = null, drawSuspenseMs }: AppProps) {
  return (
    <>
      <a className="skip-link" href="#draw">Skip to partner selection</a>
      <Hero />
      <main>
        <section id="draw" className="draw-section" aria-label="Choose your Love Gift partner">
          {api ? <Activity api={api} personalLink={personalLink} drawSuspenseMs={drawSuspenseMs} /> : <SetupNotice />}
        </section>
        <HowItWorks />
      </main>
      <SiteFooter />
    </>
  );
}
