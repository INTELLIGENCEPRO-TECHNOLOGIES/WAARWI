import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
  layer?: 'base' | 'top';
};

export function Modal({ open, onClose, title, children, size = 'md', footer, layer = 'base' }: Props) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [open, onClose]);

  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  const z = layer === 'top' ? 'z-[70]' : 'z-50';

  return (
    <div className={`fixed inset-0 ${z} flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in`}>
      <div className="scrim" onClick={onClose} />
      <div className={`relative w-full ${w} bg-white rounded-t-3xl sm:rounded-3xl shadow-premium animate-sheet-up sm:animate-scale-in max-h-[92vh] flex flex-col`}>
        <div className="sm:hidden sheet-handle" />
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="px-4 sm:px-5 py-3 border-t border-slate-100 bg-slate-50/70 sm:rounded-b-3xl flex items-center justify-end gap-2 flex-wrap [&>div.grid]:w-full pb-safe">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirmer', danger = false }: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; message: string; confirmLabel?: string; danger?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Annuler</button>
        <button onClick={() => { onConfirm(); onClose(); }} className={danger ? 'btn-danger' : 'btn-primary'}>{confirmLabel}</button>
      </>}
    >
      <p className="text-slate-600">{message}</p>
    </Modal>
  );
}
