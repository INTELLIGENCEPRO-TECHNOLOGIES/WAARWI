import { useState, type ReactNode } from 'react';
import { MoreHorizontal } from './Icons';
import { Modal } from './Modal';

export function AccountingMobileFilters({ open, title = 'Filtres', children, onClose, onReset, onApply }: {
  open: boolean;
  title?: string;
  children: ReactNode;
  onClose: () => void;
  onReset: () => void;
  onApply: () => void;
}) {
  return <Modal open={open} title={title} onClose={onClose} size="sm" layer="top" variant="flat" focusOnOpen
    panelClassName="accounting-workspace acc-mobile-sheet acc-mobile-filter-sheet"
    footer={<>
      <button type="button" className="btn-secondary" onClick={onReset}>Réinitialiser</button>
      <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
      <button type="button" className="btn-primary" onClick={onApply}>Appliquer</button>
    </>}>
    <div className="acc-mobile-filter-fields">{children}</div>
  </Modal>;
}

type MobileAction = { label: string; run: () => void; icon?: ReactNode; disabled?: boolean };

export function AccountingMobileActions({ actions, title }: {
  actions: MobileAction[];
  title: string;
}) {
  const [open, setOpen] = useState(false);
  if (!actions.length) return null;
  return <>
    <button type="button" className="btn-secondary acc-mobile-more"
      aria-label={title} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <MoreHorizontal size={18} aria-hidden="true" />
    </button>
    <Modal open={open} onClose={() => setOpen(false)} title={title} size="sm" layer="top" variant="flat" focusOnOpen
      panelClassName="accounting-workspace acc-mobile-sheet">
      <div className="acc-mobile-action-list">
        {actions.map(action => <button type="button" key={action.label} disabled={action.disabled} onClick={() => {
          setOpen(false);
          action.run();
        }}>{action.icon}<span>{action.label}</span></button>)}
      </div>
    </Modal>
  </>;
}
