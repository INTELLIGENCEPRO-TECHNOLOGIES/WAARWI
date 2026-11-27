import { useEffect, useState } from 'react';
import { formatCurrency } from '../lib/format';
import { supabase } from '../lib/supabase';
import { SearchableSelect } from './SearchableSelect';

type Document = {
  id: string;
  kind: 'customer_prepayment' | 'refund';
  label: string;
  reference: string | null;
  amount: number;
  used_amount: number | null;
  sale_number: string | null;
  customer_name: string | null;
  journal: string;
  treasury: string;
};

type Review = { eligible: false; reason: string } | {
  eligible: true;
  document: Document;
  accounts: { code: string; name: string }[];
};

type Props = {
  tenantId: string;
  movementId: string;
  onClose: () => void;
  onSavingChange: (saving: boolean) => void;
  onPosted: () => void;
};

export function AccountingCashDocument({ tenantId, movementId, onClose, onSavingChange, onPosted }: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [reference, setReference] = useState('');
  const [account, setAccount] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const { data, error: fetchError } = await supabase.rpc('review_cash_accounting_document', {
          p_tenant_id: tenantId, p_movement_id: movementId,
        });
        if (fetchError) throw fetchError;
        if (!current) return;
        const next = data as Review;
        setReview(next);
        if (next.eligible) setReference(next.document.reference ?? '');
      } catch (failure) {
        if (current) setError(failure instanceof Error ? failure.message
          : 'Impossible de vérifier le justificatif. Réessayez.');
      }
    })();
    return () => { current = false; };
  }, [tenantId, movementId]);

  const post = async () => {
    if (!review?.eligible || !account || !reference.trim() || saving) return;
    setSaving(true);
    onSavingChange(true);
    setError('');
    try {
      const { error: postError } = await supabase.rpc('post_cash_accounting_document', {
        p_tenant_id: tenantId, p_movement_id: movementId,
        p_document: review.document, p_counterpart: account, p_reference: reference.trim(),
      });
      if (postError) {
        setError(postError.message);
        return;
      }
      onPosted();
    } catch {
      setError('Impossible de confirmer l’écriture. Réessayez.');
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  };

  const document = review?.eligible ? review.document : null;
  return (
    <div className="space-y-3 border-t border-neutral-200 py-3">
      {!review && !error && <p role="status" className="text-sm text-neutral-500">Vérification du justificatif…</p>}
      {review && !review.eligible && <p className="text-sm text-neutral-700">{review.reason}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {review?.eligible && document && (
        <>
          <p className="break-words text-sm font-medium text-neutral-900">{document.label}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
            {document.customer_name && <span>{document.customer_name}</span>}
            {document.sale_number && <span>Vente {document.sale_number}</span>}
            {document.used_amount != null && <span>Montant déjà utilisé {formatCurrency(Number(document.used_amount))}</span>}
          </div>
          <div className="acc-fields acc-fields-2">
            <SearchableSelect variant="underline" label="Compte de contrepartie" value={account} onChange={setAccount}
              disabled={saving} options={review.accounts.map(option => ({
                value: option.code, label: `${option.code} │ ${option.name}`,
              }))} />
            <label className="min-w-0 text-xs text-neutral-600">
              Référence du justificatif
              <input className="input mt-1" maxLength={120} value={reference} disabled={saving}
                onChange={event => setReference(event.target.value)} />
            </label>
          </div>
          <p className="break-words text-xs text-neutral-600">
            {document.journal} │ Débit {document.kind === 'refund' ? (account || 'à sélectionner') : document.treasury}
            {' │ '}Crédit {document.kind === 'refund' ? document.treasury : (account || 'à sélectionner')}
          </p>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>Fermer</button>
        {document && <button type="button" className="btn-primary" onClick={() => void post()}
          disabled={saving || !account || !reference.trim()}>
          {saving ? 'Comptabilisation…' : 'Confirmer l’écriture'}
        </button>}
      </div>
    </div>
  );
}
