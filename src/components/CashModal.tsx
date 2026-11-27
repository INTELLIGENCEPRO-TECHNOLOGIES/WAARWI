import type { ReactNode } from 'react';
import { Modal } from './Modal';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  footerLeft?: ReactNode;
};

export function CashModal({ open, onClose, title, children, footer, footerLeft }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="md" layer="top" fullscreenMobile
      footer={(footer || footerLeft) && (
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {footerLeft && <div className="mr-auto min-w-0">{footerLeft}</div>}
          {footer}
        </div>
      )}
    >
      {children}
    </Modal>
  );
}
