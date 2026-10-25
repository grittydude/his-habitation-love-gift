import { Heart, LoaderCircle, Users } from 'lucide-react';
import type { MembersState } from '../hooks/useMembers';
import type { Phase, UiMessage } from '../hooks/useLoveGift';
import { Notice } from './Notice';
import { PartnerReveal } from './PartnerReveal';
import { SignInForm } from './SignInForm';

interface Props {
  phase: Phase;
  message: UiMessage | null;
  roster: MembersState & { retry: () => void };
  activityComplete: boolean;
  onStart: (memberId: string, accessCode: string) => void;
  onSignOut: () => void;
  onDismissMessage: () => void;
}

export function DrawCard({ phase, message, roster, activityComplete, onStart, onSignOut, onDismissMessage }: Props) {
  return (
    <div className="draw-card">
      <div className="draw-card__head">
        <div>
          <p className="eyebrow">Your moment</p>
          <h2 className="draw-card__title">Choose your Love Gift partner</h2>
        </div>
        <span className="draw-card__stamp" aria-hidden="true"><Heart size={20} /></span>
      </div>

      <div aria-live="polite">
        {phase.kind === 'restoring' && (
          <p className="loading-line"><LoaderCircle className="spin" size={18} aria-hidden="true" /> Checking for your saved pairing…</p>
        )}

        {phase.kind === 'signing_in' && phase.viaLink && (
          <p className="loading-line"><LoaderCircle className="spin" size={18} aria-hidden="true" /> Opening your personal link…</p>
        )}

        {(phase.kind === 'idle' || (phase.kind === 'signing_in' && !phase.viaLink) || phase.kind === 'ready' || phase.kind === 'drawing') && (
          <>
            {phase.kind === 'drawing' && (
              <div className="shuffle" aria-hidden="true">
                <Heart className="shuffle__heart" size={30} fill="currentColor" />
              </div>
            )}
            <SignInForm
              roster={roster}
              busy={phase.kind === 'signing_in' ? 'signing_in' : phase.kind === 'drawing' ? 'drawing' : null}
              session={phase.kind === 'ready' || phase.kind === 'drawing' ? phase.session : null}
              activityComplete={activityComplete}
              onSubmit={onStart}
              onSignOut={onSignOut}
            />
          </>
        )}

        {phase.kind === 'revealed' && (
          <PartnerReveal pairing={phase.pairing} origin={phase.origin} memberName={phase.session.member.name} onSignOut={onSignOut} />
        )}

        {phase.kind === 'no_partner' && (
          <div className="state-block" role="status">
            <Users size={22} aria-hidden="true" />
            <p className="state-block__title">No partner is available right now</p>
            <p className="state-block__body">
              Everyone else has already been paired, {phase.session.member.name}. Please let the choir organiser know so they can help. If someone draws your name, this page will update by itself.
            </p>
            <button type="button" className="link-button" onClick={onSignOut}>Sign out</button>
          </div>
        )}
      </div>

      {message && <Notice message={message} onDismiss={onDismissMessage} />}

      {phase.kind !== 'revealed' && (
        <p className="draw-card__privacy">
          One draw per person. Pairings are made and saved on the server, and only you can see yours.
        </p>
      )}
    </div>
  );
}
