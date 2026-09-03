import { useEffect, useMemo, useState } from 'react';
import { Lock, Loader2, ArrowUpRight, ArrowDownRight, Plus, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { formatFCFA, formatDateTime } from '../lib/format';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';

type Movement = {
  id: string;
  effective_at: string;
  kind: string;
  direction: 'in' | 'out';
  amount: number;
  balance_before: number;
  balance_after: number;
  reference: string | null;
  note: string | null;
  created_by_name: string | null;
};

type VaultReport = {
  vault_id: string | null;
  prior_balance: number;
  total_in: number;
  total_out: number;
  balance: number;
  total_movements: number;
  breakdown: { kind: string; direction: 'in' | 'out'; total: number }[];
  movements: Movement[];
};

const KIND_LABELS: Record<string, string> = {
  opening: 'Solde initial',
  cash_deposit: 'Versement depuis la caisse',
  cash_withdrawal: 'Transfert vers la caisse',
  supplier_payment: 'Règlement fournisseur',
  adjustment: 'Ajustement',
};

const kindLabel = (k: string) => KIND_LABELS[k] || k;

function newIdempotencyKey() {
  return (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

export function Coffre() {
  const { tenant, currentSite, dataTick } = useApp();
  const { can } = usePermissions();
  const { success, error } = useToast();

  const [report, setReport] = useState<VaultReport | null>(null);
  const [loading, setLoading] = useState(true);

  const [initOpen, setInitOpen] = useState(false);
  const [initAmount, setInitAmount] = useState('');
  const [initNote, setInitNote] = useState('');

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferRef, setTransferRef] = useState('');
  const [transferNote, setTransferNote] = useState('');

  const [payOpen, setPayOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; balance: number }[]>([]);
  const [methods, setMethods] = useState<{ id: string; name: string; payment_type: string }[]>([]);
  const [paySupplier, setPaySupplier] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');

  const [busy, setBusy] = useState(false);

  const load = async (silent = false) => {
    if (!tenant || !currentSite) return;
    if (!silent) setLoading(true);
    const { data, error: e } = await supabase.rpc('get_vault_report', {
      p_site_id: currentSite.id,
      p_limit: 200,
      p_offset: 0,
    });
    if (e) {
      if (!silent) error(e.message || 'Chargement du coffre impossible');
      setReport(null);
    } else {
      setReport(data as VaultReport);
    }
    if (!silent) setLoading(false);
  };

  useEffect(() => { load(); }, [tenant?.id, currentSite?.id]);
  useEffect(() => {
    if (dataTick > 0) { const t = setTimeout(() => load(true), 400); return () => clearTimeout(t); }
  }, [dataTick]);

  const hasVault = !!report?.vault_id;
  const balance = report?.balance ?? 0;

  const openPay = async () => {
    if (!tenant) return;
    setPayOpen(true);
    const [sup, pm] = await Promise.all([
      supabase.from('suppliers').select('id, name, balance').eq('tenant_id', tenant.id).eq('is_active', true).order('name'),
      supabase.from('payment_methods').select('id, name, payment_type').eq('tenant_id', tenant.id).eq('is_active', true).order('sort_order'),
    ]);
    const supRows = (sup.data || []) as { id: string; name: string; balance: number }[];
    const pmRows = (pm.data || []) as { id: string; name: string; payment_type: string }[];
    setSuppliers(supRows);
    setMethods(pmRows);
    if (!payMethod && pmRows.length) setPayMethod(pmRows[0].id);
  };

  const submitInit = async () => {
    if (!currentSite) return;
    const amt = Number(initAmount);
    if (!Number.isFinite(amt) || amt < 0) { error('Montant invalide'); return; }
    setBusy(true);
    const { error: e } = await supabase.rpc('initialize_site_vault', {
      p_site_id: currentSite.id,
      p_opening_amount: amt,
      p_note: initNote || null,
      p_idempotency_key: newIdempotencyKey(),
    });
    setBusy(false);
    if (e) { error(e.message || 'Initialisation impossible'); return; }
    success('Coffre initialisé');
    setInitOpen(false); setInitAmount(''); setInitNote('');
    load(true);
  };

  const submitTransfer = async () => {
    if (!currentSite) return;
    const amt = Number(transferAmount);
    if (!Number.isFinite(amt) || amt <= 0) { error('Montant invalide'); return; }
    if (amt > balance) { error('Montant supérieur au solde du coffre'); return; }
    const { data: session } = await supabase
      .from('cash_sessions')
      .select('id')
      .eq('tenant_id', tenant!.id)
      .eq('site_id', currentSite.id)
      .eq('status', 'open')
      .maybeSingle();
    if (!session?.id) { error('Ouvrez une session de caisse avant d’effectuer ce transfert.'); return; }
    setBusy(true);
    const { error: e } = await supabase.rpc('transfer_vault_to_cash', {
      p_site_id: currentSite.id,
      p_cash_session_id: session.id,
      p_amount: amt,
      p_reference: transferRef || null,
      p_note: transferNote || null,
      p_idempotency_key: newIdempotencyKey(),
    });
    setBusy(false);
    if (e) { error(e.message || 'Transfert impossible'); return; }
    success('Transfert vers la caisse effectué');
    setTransferOpen(false); setTransferAmount(''); setTransferRef(''); setTransferNote('');
    load(true);
  };

  const submitPay = async () => {
    if (!currentSite) return;
    const amt = Number(payAmount);
    if (!paySupplier) { error('Sélectionnez un fournisseur'); return; }
    if (!payMethod) { error('Sélectionnez un mode de paiement'); return; }
    if (!Number.isFinite(amt) || amt <= 0) { error('Montant invalide'); return; }
    if (amt > balance) { error('Montant supérieur au solde du coffre'); return; }
    const pm = methods.find(m => m.id === payMethod);
    setBusy(true);
    const { error: e } = await supabase.rpc('register_supplier_payment_from_vault', {
      p_supplier_id: paySupplier,
      p_payment_method_id: payMethod,
      p_method_name: pm?.name ?? '',
      p_amount: amt,
      p_reference: payRef || '',
      p_site_id: currentSite.id,
      p_idempotency_key: newIdempotencyKey(),
    });
    setBusy(false);
    if (e) { error(e.message || 'Règlement impossible'); return; }
    success('Règlement fournisseur réglé depuis le coffre');
    setPayOpen(false); setPaySupplier(''); setPayAmount(''); setPayRef('');
    load(true);
  };

  const movements = report?.movements ?? [];
  const canView = can('view_vault') || can('access_vault');

  const summary = useMemo(() => ({
    entrees: report?.total_in ?? 0,
    sorties: report?.total_out ?? 0,
    count: report?.total_movements ?? 0,
  }), [report]);

  if (!canView) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState icon={Lock} title="Accès restreint" description="Vous n’avez pas l’autorisation de consulter le coffre." />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center">
            <Lock className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-neutral-900">Coffre</h1>
            <p className="text-sm text-neutral-500">{currentSite?.name || 'Point de vente'}</p>
          </div>
        </div>
        <button onClick={() => load()} className="btn-ghost" title="Actualiser">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-neutral-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : !hasVault ? (
        <div className="card p-8 text-center space-y-4">
          <EmptyState
            icon={Lock}
            title="Aucun coffre pour ce point de vente"
            description="Initialisez le coffre pour commencer à suivre les entrées et les sorties d’espèces."
          />
          {can('vault_adjust') || can('access_vault') ? (
            <button onClick={() => setInitOpen(true)} className="btn mx-auto">
              <Plus className="w-4 h-4" /> Initialiser le coffre
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="card p-6">
            <p className="text-sm text-neutral-500">Solde du coffre</p>
            <p className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900 mt-1">{formatFCFA(balance)}</p>
            <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-neutral-200">
              <div>
                <p className="text-xs text-neutral-500">Entrées (période)</p>
                <p className="text-base font-semibold text-neutral-900 mt-0.5">+ {formatFCFA(summary.entrees)}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Sorties (période)</p>
                <p className="text-base font-semibold text-neutral-900 mt-0.5">− {formatFCFA(summary.sorties)}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Mouvements</p>
                <p className="text-base font-semibold text-neutral-900 mt-0.5">{summary.count}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {can('vault_transfer_to_cash') && (
              <button onClick={() => setTransferOpen(true)} className="btn-secondary">
                <ArrowUpRight className="w-4 h-4" /> Transférer vers la caisse
              </button>
            )}
            {can('vault_pay_supplier') && (
              <button onClick={openPay} className="btn-secondary">
                <ArrowUpRight className="w-4 h-4" /> Régler un fournisseur
              </button>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-200">
              <h2 className="text-sm font-semibold text-neutral-900">Journal du coffre</h2>
            </div>
            {movements.length === 0 ? (
              <div className="p-8">
                <EmptyState icon={Lock} title="Aucun mouvement" description="Les entrées et sorties du coffre apparaîtront ici." />
              </div>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {movements.map(m => {
                  const isIn = m.direction === 'in';
                  return (
                    <li key={m.id} className="px-4 py-3 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg border border-neutral-200 flex items-center justify-center shrink-0">
                        {isIn ? <ArrowDownRight className="w-4 h-4 text-neutral-700" /> : <ArrowUpRight className="w-4 h-4 text-neutral-700" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-neutral-900 truncate">{kindLabel(m.kind)}</p>
                        <p className="text-xs text-neutral-500 truncate">
                          {formatDateTime(m.effective_at)}
                          {m.reference ? ` · ${m.reference}` : ''}
                          {m.created_by_name ? ` · ${m.created_by_name}` : ''}
                        </p>
                        {m.note ? <p className="text-xs text-neutral-400 truncate">{m.note}</p> : null}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-neutral-900 tabular-nums">
                          {isIn ? '+' : '−'} {formatFCFA(m.amount)}
                        </p>
                        <p className="text-xs text-neutral-400 tabular-nums">{formatFCFA(m.balance_after)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      <Modal open={initOpen} onClose={() => setInitOpen(false)} title="Initialiser le coffre" size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setInitOpen(false)} className="btn-secondary">Annuler</button>
            <button onClick={submitInit} disabled={busy} className="btn">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Initialiser
            </button>
          </div>
        }>
        <div className="space-y-4">
          <div>
            <label className="label">Solde initial</label>
            <input type="number" min={0} value={initAmount} onChange={e => setInitAmount(e.target.value)} className="input" placeholder="0" />
          </div>
          <div>
            <label className="label">Note (facultatif)</label>
            <input value={initNote} onChange={e => setInitNote(e.target.value)} className="input" placeholder="Motif de l’initialisation" />
          </div>
        </div>
      </Modal>

      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="Transférer vers la caisse" size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setTransferOpen(false)} className="btn-secondary">Annuler</button>
            <button onClick={submitTransfer} disabled={busy} className="btn">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Transférer
            </button>
          </div>
        }>
        <div className="space-y-4">
          <p className="text-sm text-neutral-500">Solde disponible : <span className="font-semibold text-neutral-900">{formatFCFA(balance)}</span></p>
          <div>
            <label className="label">Montant</label>
            <input type="number" min={0} value={transferAmount} onChange={e => setTransferAmount(e.target.value)} className="input" placeholder="0" />
          </div>
          <div>
            <label className="label">Référence (facultatif)</label>
            <input value={transferRef} onChange={e => setTransferRef(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Note (facultatif)</label>
            <input value={transferNote} onChange={e => setTransferNote(e.target.value)} className="input" />
          </div>
        </div>
      </Modal>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Régler un fournisseur depuis le coffre" size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setPayOpen(false)} className="btn-secondary">Annuler</button>
            <button onClick={submitPay} disabled={busy} className="btn">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Régler
            </button>
          </div>
        }>
        <div className="space-y-4">
          <p className="text-sm text-neutral-500">Solde disponible : <span className="font-semibold text-neutral-900">{formatFCFA(balance)}</span></p>
          <div>
            <label className="label">Fournisseur</label>
            <select value={paySupplier} onChange={e => setPaySupplier(e.target.value)} className="input">
              <option value="">Sélectionner…</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}{s.balance ? ` — ${formatFCFA(s.balance)}` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Mode de paiement</label>
            <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="input">
              {methods.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Montant</label>
            <input type="number" min={0} value={payAmount} onChange={e => setPayAmount(e.target.value)} className="input" placeholder="0" />
          </div>
          <div>
            <label className="label">Référence (facultatif)</label>
            <input value={payRef} onChange={e => setPayRef(e.target.value)} className="input" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
