import { useEffect, useRef } from 'react';
import { Check, Heart, LogOut } from 'lucide-react';
import type { RevealOrigin } from '../hooks/useLoveGift';
import type { Pairing } from '../types/loveGift';

interface Props {
  pairing: Pairing;
  origin: RevealOrigin;
  memberName: string;
  onSignOut: () => void;
}

function copy(origin: RevealOrigin, pairing: Pairing): { kicker: string; body: string } {
  const name = pairing.partner.name;
  if (origin === 'created') {
    return { kicker: 'Your Love Gift partner has been chosen!', body: 'This pairing is saved and final. Keep it a lovely surprise.' };
  }
  if (origin === 'live') {
    return { kicker: 'You’ve just been chosen!', body: `${name} drew your name a moment ago, so your pairing is now saved.` };
  }
  return {
    kicker: origin === 'restored' ? 'Welcome back — here is your partner' : 'Your partner was already chosen',
    body: pairing.initiatedByMe
      ? 'You drew this name earlier. Your pairing is saved and can’t be drawn again.'
      : `${name} drew your name before you arrived, so your pairing was already saved.`,
  };
}

const BURST = Array.from({ length: 10 }, (_, i) => i);

export function PartnerReveal({ pairing, origin, memberName, onSignOut }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { kicker, body } = copy(origin, pairing);
  const pairedAt = new Date(pairing.pairedAt);

  useEffect(() => { headingRef.current?.focus(); }, [pairing.partner.id]);

  return (
    <section className={`reveal ${origin === 'restored' ? 'reveal--calm' : ''}`} aria-labelledby="reveal-heading">
      <div className="reveal__burst" aria-hidden="true">
        {BURST.map((i) => <span key={i} style={{ ['--i' as string]: i }} />)}
      </div>
      <p className="reveal__kicker">{kicker}</p>
      <p className="reveal__for">For {memberName}, your partner is</p>
      <h3 className="reveal__name" id="reveal-heading" ref={headingRef} tabIndex={-1}>
        {pairing.partner.name}
      </h3>
      <p className="reveal__body">{body}</p>
      <p className="reveal__saved">
        <Check size={14} aria-hidden="true" /> Saved{' '}
        <time dateTime={pairing.pairedAt}>
          {pairedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        </time>
      </p>
      <p className="reveal__note"><Heart size={14} aria-hidden="true" fill="currentColor" /> Pray for them, plan something thoughtful, and let love lead.</p>
      <button type="button" className="link-button reveal__signout" onClick={onSignOut}>
        <LogOut size={14} aria-hidden="true" /> Sign out on this device
      </button>
    </section>
  );
}
