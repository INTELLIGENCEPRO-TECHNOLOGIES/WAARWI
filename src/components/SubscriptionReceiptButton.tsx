import { useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { callSubscriptionRecords } from '../lib/subscriptionPayments';

export function SubscriptionReceiptButton({ paymentId }: { paymentId: string }) {
  const [busy, setBusy] = useState(false);
  const downloading = useRef(false);
  const { error } = useToast();

  async function download() {
    if (downloading.current) return;
    downloading.current = true;
    setBusy(true);
    try {
      const { pdf } = await callSubscriptionRecords<{ pdf: string }>({ action: 'receipt', payment_id: paymentId });
      const bytes = Uint8Array.from(atob(pdf), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `recu-waarwi-${paymentId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) {
      error(cause instanceof Error ? cause.message : 'Le téléchargement du reçu a échoué.');
    } finally {
      downloading.current = false;
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={() => void download()} disabled={busy}
      className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[var(--w-text)] underline underline-offset-4 disabled:opacity-60">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
      {busy ? 'Préparation du reçu…' : 'Télécharger le reçu PDF'}
    </button>
  );
}
