import { type ReactNode, type RefObject, type PointerEvent, type CSSProperties, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, GripVertical, Check, Trash2 } from 'lucide-react';
import { clayTouchHandlers } from '../lib/clayTouch';
import { useBaseLayer, useBodyScrollLock, useTopLayer } from './modalStack';
import './window-surfaces.css';

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
  focusOnOpen?: boolean;
  clayPreviewActions?: boolean;
};

const dialogWidths = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-xl',
  lg: 'sm:max-w-3xl',
  xl: 'sm:max-w-5xl',
};

function useDialogKeys(open: boolean, isTop: boolean, onClose: () => void, panelRef: RefObject<HTMLDivElement>, trapFocus = false) {
  useLayoutEffect(() => {
    if (!open || !isTop) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      const panel = panelRef.current;
      if (event.key !== 'Tab' || !trapFocus || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
      )).filter(element => element.getClientRects().length > 0 && element.tabIndex >= 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active) || active === (event.shiftKey ? first : last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, isTop, onClose, panelRef, trapFocus]);
}

function WindowHeading({ title, titleId, onClose, closeButtonRef, clayPreviewActions = false }: {
  title: string;
  titleId: string;
  onClose: () => void;
  closeButtonRef?: RefObject<HTMLButtonElement>;
  clayPreviewActions?: boolean;
}) {
  return (
    <div className="waarwi-window-bar">
      <h3 id={titleId} className="waarwi-window-title">{title}</h3>
      <button ref={closeButtonRef} type="button" aria-label="Fermer" title="Fermer" onClick={onClose}
        className={clayPreviewActions ? 'clay-action grid h-9 w-9 shrink-0 place-items-center' : 'waarwi-window-button'}>
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

export function Modal({ open, onClose, title, children, size = 'md', footer, layer = 'base', fullMobile = false, fullscreenMobile = false, variant = 'default', panelClassName = '', focusOnOpen = false, clayPreviewActions = false }: Props) {
  const topLayer = layer === 'top';
  const front = useTopLayer(open && topLayer);
  const base = useBaseLayer(open && !topLayer);
  const { isTop, zIndex } = topLayer ? front : base;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useBodyScrollLock(open);
  useDialogKeys(open, isTop, onClose, panelRef, focusOnOpen);

  useEffect(() => {
    if (!open || (!topLayer && !focusOnOpen)) return;
    const previousFocus = document.activeElement;
    const panel = panelRef.current;
    if (focusOnOpen) closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected &&
        (document.activeElement === document.body || panel?.contains(document.activeElement))) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open, topLayer, focusOnOpen]);

  if (!open) return null;

  const node = (
    <div data-app-overlay className="waarwi-overlay" style={{ zIndex }}>
      <div className="waarwi-overlay-scrim" aria-hidden="true" onClick={() => { if (isTop) onClose(); }} />
      <div ref={panelRef} role="dialog" aria-modal={isTop || undefined} aria-labelledby={titleId}
        data-mobile-layout={fullMobile || fullscreenMobile ? 'screen' : 'sheet'}
        {...(clayPreviewActions ? clayTouchHandlers : {})}
        className={`waarwi-window-surface waarwi-dialog ${dialogWidths[size]} ${variant === 'flat' ? 'flat-modal' : ''} ${panelClassName}`}>
        <WindowHeading title={title} titleId={titleId} onClose={onClose} closeButtonRef={closeButtonRef} clayPreviewActions={clayPreviewActions} />
        <div className="waarwi-window-body">{children}</div>
        {footer && <div className="waarwi-window-footer">{footer}</div>}
      </div>
    </div>
  );

  return topLayer && typeof document !== 'undefined' ? createPortal(node, document.body) : node;
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
  const areaRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const titleId = useId();
  const { isTop, zIndex } = useBaseLayer(open);

  useBodyScrollLock(open);
  useDialogKeys(open, isTop, onClose, panelRef);

  if (!open) return null;

  const resize = (width: number) => {
    const limit = Math.max(0, (areaRef.current?.clientWidth ?? window.innerWidth) - 8);
    setPanelWidth(Math.min(limit, Math.max(500, width)));
  };

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: panelRef.current?.offsetWidth ?? 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const dragResize = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag) resize(drag.startWidth + drag.startX - event.clientX);
  };

  return (
    <div ref={areaRef} data-app-overlay className="waarwi-overlay waarwi-doc-overlay" data-docked={!fullscreen} style={{ zIndex }}>
      <div className="waarwi-overlay-scrim" aria-hidden="true" onClick={() => { if (isTop) onClose(); }} />
      <div ref={panelRef} role="dialog" aria-modal={isTop || undefined} aria-labelledby={titleId}
        data-mobile-layout={fullscreenMobile ? 'screen' : 'sheet'}
        className={`waarwi-window-surface waarwi-dialog waarwi-doc-panel ${dialogWidths[fullscreenMobile ? 'xl' : 'lg']}`}
        style={panelWidth == null ? undefined : { '--waarwi-doc-width': `${panelWidth}px` } as CSSProperties}>
        <div role="separator" aria-orientation="vertical" aria-label="Largeur du document" tabIndex={0}
          aria-valuenow={panelWidth == null ? 100 : Math.round(panelWidth / Math.max(1, (areaRef.current?.clientWidth ?? panelWidth) - 8) * 100)}
          aria-valuetext={panelWidth == null ? 'Pleine largeur disponible' : `${panelWidth} pixels`}
          className="waarwi-window-resizer"
          onPointerDown={startResize}
          onPointerMove={dragResize}
          onLostPointerCapture={() => { dragRef.current = null; }}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            resize((panelRef.current?.offsetWidth ?? 0) + (event.key === 'ArrowLeft' ? 32 : -32));
          }}>
          <GripVertical aria-hidden="true" className="h-3.5 w-2" />
        </div>
        <WindowHeading title={title} titleId={titleId} onClose={onClose} />
        <div className="waarwi-window-body">{children}</div>
        {footer && <div className="waarwi-window-footer">{footer}</div>}
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
        <button type="button" onClick={onClose} className="btn-secondary text-xs">
          <X aria-hidden="true" className="h-4 w-4" /> Annuler
        </button>
        <button type="button" onClick={() => { onConfirm(); onClose(); }} className={`${danger ? 'btn-danger' : 'btn-primary'} text-xs`}>
          {danger ? <Trash2 aria-hidden="true" className="h-4 w-4" /> : <Check aria-hidden="true" className="h-4 w-4" />}
          {confirmLabel}
        </button>
      </>}
    >
      <p className="text-sm text-[var(--w-text-sec)]">{message}</p>
    </Modal>
  );
}
