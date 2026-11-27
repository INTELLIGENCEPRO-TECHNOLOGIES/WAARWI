import { useId, useState, type ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';
import { Modal } from './Modal';

export interface MoreMenuItem {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  hidden?: boolean;
}

interface MoreMenuProps {
  items: MoreMenuItem[];
  triggerClassName?: string;
}

export function MoreMenu({ items, triggerClassName }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const actionsId = useId();

  const visibleItems = items.filter(item => !item.hidden);
  if (!visibleItems.length) return null;

  return (
    <>
      <button type="button" aria-label="Plus d’actions" title="Plus d’actions" aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? actionsId : undefined}
        onClick={() => setOpen(true)} className={triggerClassName || 'waarwi-window-button'}>
        <MoreVertical aria-hidden="true" className="h-5 w-5" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Plus d’actions" size="sm" layer="top" focusOnOpen>
        <div id={actionsId} className="divide-y divide-[var(--w-separator-l)]">
          {visibleItems.map(item => (
            <button key={item.label} type="button" aria-current={item.active || undefined}
              onClick={() => { setOpen(false); item.onClick(); }}
              className={`flex min-h-10 w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left text-sm focus-visible:outline focus-visible:-outline-offset-2 hover:bg-[var(--w-hover)]
                ${item.active ? 'font-medium text-[var(--w-text)]' : 'text-[var(--w-text-sec)]'}`}>
              <span aria-hidden="true" className="flex shrink-0 items-center text-[var(--w-text-muted)]">{item.icon}</span>
              <span className="min-w-0 break-words">{item.label}</span>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
