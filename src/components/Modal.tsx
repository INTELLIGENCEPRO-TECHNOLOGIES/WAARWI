import { ReactNode, useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, GripVertical, Check, Trash2 } from 'lucide-react';
import { useTopLayer } from './modalStack';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
  layer?: 'base' | 'top';
  fullMobile?: boolean;
  fullscreenMobile?: boolean;
  variant?: 'default' | 'flat';
  panelClassName?: string;
};

export function Modal({ open, onClose, title, children, size = 'md', footer, layer = 'base', fullMobile = false, fullscreenMobile = false, variant = 'default', panelClassName = '' }: Props & { panelClassName?: string }) {
  const isTopLayer = layer === 'top';
  const { isTop, zIndex } = useTopLayer(open && isTopLayer);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (isTopLayer) {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
    }
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      if (isTopLayer && returnFocusRef.current && document.body.contains(returnFocusRef.current)) {
        try { returnFocusRef.current.focus(); } catch { /* noop */ }
      }
    };
  }, [open, isTopLayer]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isTopLayer && !isTop) return;
      onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose, isTopLayer, isTop]);

  if (!open) return null;
  const wBase = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  const w = fullscreenMobile ? wBase.replace('max-w-', 'sm:max-w-') : wBase;
  const zCls = isTopLayer ? '' : 'z-50';
  const zStyle = isTopLayer ? { zIndex } : undefined;
  const handleScrim = () => {
    if (isTopLayer && !isTop) return;
    onClose();
  };

  const node = (
    <div className={`fixed inset-0 ${zCls} flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in`} style={zStyle}>
      <div className="scrim" onClick={handleScrim} />
      <div className={`relative w-full ${w} bg-[var(--w-surface)] ${variant === 'flat' ? 'flat-modal' : ''} ${fullscreenMobile ? 'rounded-none h-full sm:h-auto sm:max-h-[92vh] sm:rounded-xl' : fullMobile ? 'rounded-none sm:rounded-xl h-full sm:h-auto sm:max-h-[92vh]' : 'rounded-t-xl sm:rounded-xl h-[92vh] sm:h-auto max-h-[92vh]'} shadow-premium animate-sheet-up sm:animate-scale-in flex flex-col ${panelClassName}`}>
        {!fullMobile && !fullscreenMobile && <div className="sm:hidden sheet-handle" />}
        <div className={`flex items-center justify-between border-b border-[var(--w-separator)] bg-[var(--w-surface-el)] ${fullscreenMobile ? 'px-4 py-3 sm:px-5 sm:py-4 rounded-none sm:rounded-t-xl' : fullMobile ? 'px-3 py-2.5 sm:px-5 sm:py-4 rounded-none sm:rounded-t-xl' : 'px-4 py-3 sm:px-5 sm:py-4 rounded-t-xl'}`}>
          <h3 className={`font-bold text-[var(--w-text)] tracking-tight ${fullscreenMobile ? 'text-base sm:text-lg' : fullMobile ? 'text-sm sm:text-lg' : 'text-base sm:text-lg'}`}>{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-[var(--w-hover)] text-[var(--w-text-muted)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto ${fullscreenMobile ? 'px-4 py-3 sm:px-5 sm:py-4' : fullMobile ? 'px-2.5 py-2 sm:px-5 sm:py-4' : 'px-3 py-3 sm:px-5 sm:py-4'}`}>{children}</div>
        {footer && <div className={`border-t border-[var(--w-separator-l)] bg-[var(--w-surface-el)] sm:rounded-b-xl flex items-center justify-end gap-2 flex-wrap [&>div.grid]:w-full pb-safe ${fullscreenMobile ? 'px-4 py-3 sm:px-5 sm:py-3' : fullMobile ? 'px-2.5 py-2 sm:px-5 sm:py-3' : 'px-4 sm:px-5 py-3'}`}>{footer}</div>}
      </div>
    </div>
  );

  return isTopLayer && typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}

export function DocPanel({ open, onClose, title, children, footer, fullscreen = false, fullscreenMobile = false }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  fullscreen?: boolean;
  fullscreenMobile?: boolean;
}) {
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [open, onClose]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startWidth = panelRef.current?.offsetWidth || window.innerWidth - 256;
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const diff = startX - ev.clientX;
      setPanelWidth(Math.max(500, Math.min(window.innerWidth - 64, startWidth + diff)));
    };
    const onUp = () => { resizing.current = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  if (!open) return null;

  if (!isDesktop) {
    return (
      <Modal open={open} onClose={onClose} title={title} size={fullscreenMobile ? 'xl' : 'lg'} footer={footer} fullscreenMobile={fullscreenMobile}>
        {children}
      </Modal>
    );
  }

  return (
    <div className={`fixed inset-0 ${fullscreen ? '' : 'lg:left-64'} z-50 flex animate-fade-in`}>
      <div
        className="hidden lg:flex items-center justify-center w-2 cursor-col-resize hover:bg-teal-100 transition-colors group flex-shrink-0 relative z-10"
        style={{ marginLeft: panelWidth ? `calc(100% - ${panelWidth}px - 8px)` : '0' }}
        onMouseDown={startResize}
      >
        <GripVertical className="w-3 h-3 text-[var(--w-text-disabled)] group-hover:text-teal-500 transition-colors" />
      </div>

      <div
        ref={panelRef}
        className="bg-[var(--w-surface)] h-full flex flex-col shadow-2xl flex-1 w-full"
        style={panelWidth ? { width: `${panelWidth}px`, flex: 'none' } : undefined}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--w-separator)] bg-[var(--w-surface-el)] flex-shrink-0">
          <h3 className="text-base font-bold text-[var(--w-text)] tracking-tight">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-[var(--w-hover)] text-[var(--w-text-muted)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-[var(--w-separator)] bg-[var(--w-surface-el)] flex items-center justify-end gap-2 flex-wrap [&>div.grid]:w-full">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirmer', danger = false, layer }: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; message: string; confirmLabel?: string; danger?: boolean; layer?: 'top';
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" layer={layer}
      footer={<>
        <button onClick={onClose} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
        <button onClick={() => { onConfirm(); onClose(); }} className={danger ? 'btn-icon-danger-solid' : 'btn-icon-primary'} title={confirmLabel}>
          {danger ? <Trash2 className="w-4 h-4" /> : <Check className="w-4 h-4" />}
        </button>
      </>}
    >
      <p className="text-[var(--w-text-sec)]">{message}</p>
    </Modal>
  );
}
