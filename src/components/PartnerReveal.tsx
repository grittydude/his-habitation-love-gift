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

// Never mentions who drew whom: from each member's point of view, they chose.
function copy(origin: RevealOrigin): { kicker: string; body: string } {
  if (origin === 'restored') {
    return { kicker: 'Welcome back — here is your partner', body: 'Your pairing is saved. Keep it a lovely surprise.' };
  }
  return { kicker: 'Your Love Gift partner has been chosen!', body: 'This pairing is saved and final. Keep it a lovely surprise.' };
}

const BURST = Array.from({ length: 10 }, (_, i) => i);

export function PartnerReveal({ pairing, origin, memberName, onSignOut }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { kicker, body } = copy(origin);

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
      {/* No timestamp here: a time before the member pressed the button would
          give away that their partner drew them first. Organisers see times in /admin. */}
      <p className="reveal__saved"><Check size={14} aria-hidden="true" /> Saved · only you can see this</p>
      <p className="reveal__note"><Heart size={14} aria-hidden="true" fill="currentColor" /> Pray for them, plan something thoughtful, and let love lead.</p>
      <button type="button" className="link-button reveal__signout" onClick={onSignOut}>
        <LogOut size={14} aria-hidden="true" /> Sign out on this device
      </button>
    </section>
  );
}
