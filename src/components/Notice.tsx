import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import type { UiMessage } from '../hooks/useLoveGift';

const ICONS = { error: CircleAlert, warning: TriangleAlert, info: Info } as const;

export function Notice({ message, onDismiss }: { message: UiMessage; onDismiss?: () => void }) {
  const Icon = ICONS[message.tone];
  return (
    <div className={`notice notice--${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
      <Icon className="notice__icon" size={18} aria-hidden="true" />
      <div className="notice__text">
        <p className="notice__title">{message.title}</p>
        {message.body && <p className="notice__body">{message.body}</p>}
      </div>
      {onDismiss && (
        <button type="button" className="notice__close" onClick={onDismiss} aria-label="Dismiss message">
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
