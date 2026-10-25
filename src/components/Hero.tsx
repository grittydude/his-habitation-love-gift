import { Gift, HeartHandshake } from 'lucide-react';
import { HeartField } from './HeartField';

export function Hero() {
  return (
    <header className="hero">
      <HeartField />
      <div className="hero__glow" aria-hidden="true" />
      <nav className="hero__bar container" aria-label="His Habitation">
        <a className="brand" href="#top">
          <span className="brand__mark"><HeartHandshake size={20} aria-hidden="true" /></span>
          <span className="brand__text">His <b>Habitation</b></span>
        </a>
        <span className="hero__tag">Choir · Love Gift Day</span>
      </nav>
      <div className="hero__body container" id="top">
        <p className="eyebrow eyebrow--light">A celebration of love &amp; fellowship</p>
        <h1 className="hero__title">
          Love Gift <em>Day</em>
        </h1>
        <p className="hero__lead">
          One name, one surprise, one simple way to show a fellow choir member the love we sing about every week.
        </p>
        <a className="button button--gold hero__cta" href="#draw">
          <Gift size={18} aria-hidden="true" /> Find my partner
        </a>
        <p className="hero__verse">
          “Let all that you do be done in love.” <span>1 Corinthians 16:14</span>
        </p>
      </div>
    </header>
  );
}
