import { useId, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, Gift, KeyRound, LoaderCircle, RefreshCw } from 'lucide-react';
import { formatAccessCodeInput, MIN_ACCESS_CODE_LENGTH, normalizeAccessCode } from '../lib/accessCode';
import type { MembersState } from '../hooks/useMembers';
import type { Session } from '../types/loveGift';

interface Props {
  roster: MembersState & { retry: () => void };
  busy: 'signing_in' | 'drawing' | null;
  /** Set when already signed in but not yet paired (e.g. after a dropped connection). */
  session: Session | null;
  activityComplete: boolean;
  onSubmit: (memberId: string, accessCode: string) => void;
  onSignOut: () => void;
}

export function SignInForm({ roster, busy, session, activityComplete, onSubmit, onSignOut }: Props) {
  const [memberId, setMemberId] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ member?: string; code?: string }>({});
  const selectRef = useRef<HTMLSelectElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const ids = { select: useId(), code: useId(), memberErr: useId(), codeErr: useId(), codeHint: useId() };
  const buttonLabel = activityComplete ? 'Show my partner' : 'Choose a Partner';

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (session) {
      onSubmit(session.member.id, '');
      return;
    }
    const next: typeof errors = {};
    if (!memberId) next.member = 'Please select your name.';
    if (normalizeAccessCode(code).length < MIN_ACCESS_CODE_LENGTH) next.code = 'Please enter the access code you were given.';
    setErrors(next);
    if (next.member) { selectRef.current?.focus(); return; }
    if (next.code) { codeRef.current?.focus(); return; }
    onSubmit(memberId, normalizeAccessCode(code));
  }

  const button = (
    <button type="submit" className="button button--primary button--block" disabled={busy !== null} aria-busy={busy !== null}>
      {busy === 'signing_in' && <><LoaderCircle className="spin" size={19} aria-hidden="true" /> Checking your code…</>}
      {busy === 'drawing' && <><LoaderCircle className="spin" size={19} aria-hidden="true" /> Finding your partner…</>}
      {busy === null && <><Gift size={19} aria-hidden="true" /> {buttonLabel}</>}
    </button>
  );

  if (session) {
    return (
      <form className="signin" onSubmit={submit} noValidate>
        <p className="signin__who">
          Signed in as <strong>{session.member.name}</strong>
          <button type="button" className="link-button" onClick={onSignOut}>Not you?</button>
        </p>
        {button}
      </form>
    );
  }

  if (roster.status === 'error') {
    return (
      <div className="state-block" role="alert">
        <p className="state-block__title">We couldn’t load the choir list</p>
        <p className="state-block__body">Please check your connection and try again.</p>
        <button type="button" className="button button--ghost" onClick={roster.retry}>
          <RefreshCw size={16} aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }

  const loading = roster.status === 'loading';
  return (
    <form className="signin" onSubmit={submit} noValidate aria-busy={loading}>
      <div className="field">
        <label className="field__label" htmlFor={ids.select}>Select your name</label>
        <div className="select">
          <select
            ref={selectRef}
            id={ids.select}
            value={memberId}
            disabled={loading || busy !== null}
            aria-invalid={Boolean(errors.member)}
            aria-describedby={errors.member ? ids.memberErr : undefined}
            onChange={(e) => { setMemberId(e.target.value); setErrors((x) => ({ ...x, member: undefined })); }}
          >
            <option value="">{loading ? 'Loading the choir list…' : 'Choose your name'}</option>
            {roster.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <ChevronDown className="select__chevron" size={18} aria-hidden="true" />
        </div>
        {errors.member && <p className="field__error" id={ids.memberErr}>{errors.member}</p>}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={ids.code}>Your access code</label>
        <div className="input-icon">
          <KeyRound size={17} aria-hidden="true" />
          <input
            ref={codeRef}
            id={ids.code}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="XXXX-XXXX"
            maxLength={19}
            value={code}
            disabled={busy !== null}
            aria-invalid={Boolean(errors.code)}
            aria-describedby={[ids.codeHint, errors.code ? ids.codeErr : ''].filter(Boolean).join(' ')}
            onChange={(e) => { setCode(formatAccessCodeInput(e.target.value)); setErrors((x) => ({ ...x, code: undefined })); }}
          />
        </div>
        <p className="field__hint" id={ids.codeHint}>Your personal code was sent to you privately by the choir organiser.</p>
        {errors.code && <p className="field__error" id={ids.codeErr}>{errors.code}</p>}
      </div>
      {button}
    </form>
  );
}
