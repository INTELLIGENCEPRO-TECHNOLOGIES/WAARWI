import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  footerLeft?: ReactNode;
  layer?: 'base' | 'top';
};

export function CashModal({ open, onClose, title, children, footer, footerLeft, layer = 'base' }: Props) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [open, onClose]);

  if (!open) return null;
  const z = layer === 'top' ? 'z-[70]' : 'z-50';

  return (
    <div className={`fixed inset-0 ${z} flex items-center justify-center p-0 sm:p-4 animate-fade-in`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full h-full sm:w-[520px] sm:h-[540px] bg-white sm:rounded-xl shadow-premium flex flex-col animate-scale-in sm:animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-black sm:rounded-t-xl shrink-0">
          <h3 className="text-[15px] font-bold text-white tracking-tight truncate">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
          {children}
        </div>
        {/* Footer */}
        {(footer || footerLeft) && (
          <div className="border-t border-neutral-100 px-4 py-2.5 flex items-center gap-2 shrink-0">
            {footerLeft && <div className="flex-1 min-w-0">{footerLeft}</div>}
            {!footerLeft && <div className="flex-1" />}
            <div className="flex items-center gap-2 shrink-0">{footer}</div>
          </div>
        )}
      </div>
    </div>
  );
}
