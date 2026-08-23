import { useEffect, useRef, useState } from 'react';
import { MoreVertical, X } from 'lucide-react';

export interface MoreMenuItem {
  icon: React.ReactNode;
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
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const visibleItems = items.filter(i => !i.hidden);
  if (visibleItems.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={triggerClassName || 'flex flex-col items-center gap-1 text-neutral-600 active:scale-95 transition-transform'}
      >
        <MoreVertical className="w-5 h-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
          <div
            ref={sheetRef}
            onClick={e => e.stopPropagation()}
            className="relative w-full sm:w-80 bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl animate-[slideUp_0.2s_ease] overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-neutral-100">
              <span className="text-sm font-semibold text-neutral-900">Plus d'actions</span>
              <button onClick={() => setOpen(false)} className="p-1 text-neutral-400 hover:text-neutral-700 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="py-2 max-h-[60vh] overflow-y-auto">
              {visibleItems.map((item, i) => (
                <button
                  key={i}
                  onClick={() => { item.onClick(); setOpen(false); }}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-neutral-50 active:bg-neutral-100 ${item.active ? 'text-neutral-900 font-medium' : 'text-neutral-700'}`}
                >
                  <span className="shrink-0 text-neutral-500">{item.icon}</span>
                  <span className="text-sm">{item.label}</span>
                </button>
              ))}
            </div>
            <div className="h-safe-bottom" />
          </div>
        </div>
      )}
    </>
  );
}
