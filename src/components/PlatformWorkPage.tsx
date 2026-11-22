import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { useToast } from '../context/ToastContext';

export function PlatformWorkPage({ title, backLabel, onBack, actions, children, busy }: {
  title: string;
  backLabel: string;
  onBack: () => void;
  actions?: ReactNode;
  children: ReactNode;
  busy?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    const element = heading.current;
    const scroll = element?.closest('.pa-scroll');
    if (scroll) scroll.scrollTop = 0;
    element?.focus({ preventScroll: true });
  }, []);

  return (
    <section className="pa-work-page" aria-label={title}>
      <header className="pa-work-header">
        <button type="button" className="pa-link pa-back" onClick={onBack} disabled={busy}>
          <ArrowLeft size={16} aria-hidden="true" /> {backLabel}
        </button>
        <div className="pa-section-head">
          <h2 ref={heading} tabIndex={-1} className="pa-work-title">{title}</h2>
          {actions && <div className="pa-inline">{actions}</div>}
        </div>
      </header>
      {children}
    </section>
  );
}

export function PlatformConfirmation({ title, message, backLabel, onBack, onConfirm, label, danger }: {
  title: string;
  message: string;
  backLabel: string;
  onBack: () => void;
  onConfirm: () => void | Promise<void>;
  label: string;
  danger?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const { error } = useToast();

  const confirm = async () => {
    setPending(true);
    try { await onConfirm(); }
    catch (cause) { error((cause as Error).message); }
    finally { setPending(false); }
  };

  return (
    <PlatformWorkPage title={title} backLabel={backLabel} onBack={onBack} busy={pending}>
      <p className="pa-copy">{message}</p>
      <div className="pa-form-actions">
        <button type="button" className={danger ? 'pa-link pa-danger' : 'pa-link'} disabled={pending} onClick={() => void confirm()}>
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {label}
        </button>
      </div>
    </PlatformWorkPage>
  );
}
