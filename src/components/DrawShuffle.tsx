import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * The "draw" moment: names flicker past like a raffle drum until the server's
 * answer arrives. Purely decorative — the real choice is made on the server —
 * and it only uses names already shown in the public dropdown.
 */
export function DrawShuffle({ names }: { names: string[] }) {
  const [index, setIndex] = useState(0);
  const [still] = useState(prefersReducedMotion);

  useEffect(() => {
    if (still || names.length < 2) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % names.length), 90);
    return () => window.clearInterval(id);
  }, [names.length, still]);

  const showNames = !still && names.length >= 2;
  return (
    <div className="shuffle-card" role="status" aria-live="polite">
      <p className="reveal__kicker">Choosing your Love Gift partner…</p>
      <div className="shuffle-card__drum" aria-hidden="true">
        {showNames ? <span key={index} className="shuffle-card__name">{names[index]}</span> : <Heart className="shuffle__heart" size={34} fill="currentColor" />}
      </div>
      <p className="shuffle-card__hint">Hold on — your partner is being picked at random.</p>
    </div>
  );
}
