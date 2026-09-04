import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Lock, Loader2, Printer, Calendar, ChevronDown, RefreshCw,
  PlusCircle, MinusCircle, ArrowUpRight, Wallet, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { formatFCFA, formatDateTime } from '../lib/format';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import {
  MetricStrip, SectionTitle, ReportTable, ReportSkeleton, DASH,
  thCls, thR, tdCls, tdR, tdMuted,
} from '../components/reports/reportPrimitives';
import {
  a4Style, docHeader, docFooter, printDoc, esc, fmtMoney, labelRange,
  type DateRange, type TenantMeta,
} from '../components/reports/reportEngine';

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
  opening_balance: 'Solde initial',
  manual_deposit: 'Dépôt manuel',
  cash_deposit: 'Versement depuis la caisse',
  cash_withdrawal: 'Transfert vers la caisse',
  supplier_payment: 'Règlement fournisseur',
  manual_withdrawal: 'Retrait manuel',
  adjustment_in: 'Ajustement entrant',
  adjustment_out: 'Ajustement sortant',
};

const kindLabel = (k: string) => KIND_LABELS[k] || k;

const PAGE_SIZE = 50;

function newIdempotencyKey() {
  return (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

// Bornes de période en dates locales Dakar (UTC+0), fin exclusive (< jour suivant 00:00).
function localISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function periodBounds(range: DateRange) {
  const next = new Date(range.to);
  next.setDate(next.getDate() + 1);
  return {
    from: `${localISODate(range.from)}T00:00:00+00:00`,
    toExclusive: `${localISODate(next)}T00:00:00+00:00`,
  };
}

export function Coffre() {
  const { tenant, currentSite, dataTick } = useApp();
  const { can } = usePermissions();
  const { success, error } = useToast();

  const [report, setReport] = useState<VaultReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const reqToken = useRef(0);

  const [range, setRange] = useState<DateRange>(() => {
    const now = new Date();
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  const [initOpen, setInitOpen] = useState(false);
  const [initAmount, setInitAmount] = useState('');
  const [initNote, setInitNote] = useState('');

  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositDate, setDepositDate] = useState(() => localISODate(new Date()));
  const [depositRef, setDepositRef] = useState('');
  const [depositNote, setDepositNote] = useState('');

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferRef, setTransferRef] = useState('');
  const [transferNote, setTransferNote] = useState('');

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawDate, setWithdrawDate] = useState(() => localISODate(new Date()));
  const [withdrawReason, setWithdrawReason] = useState('');
  const [withdrawBeneficiary, setWithdrawBeneficiary] = useState('');
  const [withdrawRef, setWithdrawRef] = useState('');
  const [withdrawNote, setWithdrawNote] = useState('');

  const [payOpen, setPayOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; balance: number }[]>([]);
  const [methods, setMethods] = useState<{ id: string; name: string; payment_type: string }[]>([]);
  const [paySupplier, setPaySupplier] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');

  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);

  const load = async (silent = false) => {
    if (!tenant || !currentSite) return;
    const token = ++reqToken.current;
    if (!silent) setLoading(true);
    const { from, toExclusive } = periodBounds(range);
    const { data, error: e } = await supabase.rpc('get_vault_report', {
      p_site_id: currentSite.id,
      p_from: from,
      p_to: toExclusive,
      p_as_of: toExclusive,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    });
    if (token !== reqToken.current) return;
    if (e) {
      if (!silent) error(e.message || 'Chargement du coffre impossible');
      setReport(null);
    } else {
      setReport(data as VaultReport);
    }
    if (!silent) setLoading(false);
  };

  useEffect(() => { setPage(0); }, [tenant?.id, currentSite?.id, range.from, range.to]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenant?.id, currentSite?.id, range.from, range.to, page]);
  useEffect(() => {
    if (dataTick > 0) { const t = setTimeout(() => load(true), 400); return () => clearTimeout(t); }
    // eslint-disable-next-line
  }, [dataTick]);

  const hasVault = !!report?.vault_id;
  const balance = report?.balance ?? 0;
  const movements = report?.movements ?? [];
  const total = report?.total_movements ?? 0;
  const canView = can('view_vault') || can('access_vault');

  const tenantMeta: TenantMeta = {
    name: tenant?.name || '',
    legal_name: (tenant as any)?.legal_name,
    ninea: (tenant as any)?.ninea,
    rccm: (tenant as any)?.rccm,
    address: (tenant as any)?.address,
    phone: (tenant as any)?.phone,
    email: (tenant as any)?.email,
    website: (tenant as any)?.website,
    logo_url: (tenant as any)?.logo_url,
    business_type: (tenant as any)?.business_type,
  };

  const metrics = useMemo(() => ([
    { label: 'Solde antérieur', value: formatFCFA(report?.prior_balance ?? 0) },
    { label: 'Entrées (période)', value: formatFCFA(report?.total_in ?? 0) },
    { label: 'Sorties (période)', value: formatFCFA(report?.total_out ?? 0) },
    { label: 'Solde à date', value: formatFCFA(balance) },
  ]), [report, balance]);

  const BREAKDOWN_ORDER = ['opening_balance', 'manual_deposit', 'cash_deposit', 'cash_withdrawal', 'manual_withdrawal', 'supplier_payment', 'adjustment_in', 'adjustment_out'];
  const breakdownRows = useMemo(() => {
    const totals: Record<string, { direction: 'in' | 'out'; total: number }> = {};
    (report?.breakdown ?? []).forEach(b => { totals[b.kind] = { direction: b.direction, total: (totals[b.kind]?.total ?? 0) + Number(b.total) }; });
    return BREAKDOWN_ORDER.filter(k => totals[k]).map(k => ({ kind: k, ...totals[k] }));
  }, [report]);

  const openPay = async () => {
    if (!tenant) return;
    setPayOpen(true);
    const [sup, pm] = await Promise.all([
      supabase.from('suppliers').select('id, name, balance').eq('tenant_id', tenant.id).eq('is_active', true).order('name'),
      supabase.from('payment_methods').select('id, name, payment_type').eq('tenant_id', tenant.id).eq('is_active', true).order('sort_order'),
    ]);
    setSuppliers((sup.data || []) as any);
    const pmRows = (pm.data || []) as { id: string; name: string; payment_type: string }[];
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

  const submitDeposit = async () => {
    if (!currentSite) return;
    const amt = Number(depositAmount);
    if (!Number.isFinite(amt) || amt <= 0) { error('Montant invalide'); return; }
    setBusy(true);
    const effectiveAt = depositDate ? `${depositDate}T12:00:00+00:00` : null;
    const { error: e } = await supabase.rpc('record_manual_vault_deposit', {
      p_site_id: currentSite.id,
      p_amount: amt,
      p_effective_at: effectiveAt,
      p_reference: depositRef || null,
      p_note: depositNote || null,
      p_idempotency_key: newIdempotencyKey(),
    });
    setBusy(false);
    if (e) { error(e.message || 'Dépôt impossible'); return; }
    success('Dépôt manuel enregistré');
    setDepositOpen(false);
    setDepositAmount(''); setDepositRef(''); setDepositNote(''); setDepositDate(localISODate(new Date()));
    load(true);
  };

  const submitTransfer = async () => {
    if (!currentSite) return;
    const amt = Number(transferAmount);
    if (!Number.isFinite(amt) || amt <= 0) { error('Montant invalide'); return; }
    if (amt > balance) { error('Montant supérieur au solde du coffre'); return; }
    const { data: session } = await supabase
      .from('cash_sessions').select('id')
      .eq('tenant_id', tenant!.id).eq('site_id', currentSite.id).eq('status', 'open')
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

  const submitWithdraw = async () => {
    if (!currentSite) return;
    const amt = Number(withdrawAmount);
    if (!Number.isFinite(amt) || amt <= 0) { error('Montant invalide'); return; }
    if (amt > balance) { error('Montant supérieur au solde du coffre'); return; }
    if (!withdrawReason.trim()) { error('Indiquez un motif ou une destination'); return; }
    setBusy(true);
    const effectiveAt = withdrawDate ? `${withdrawDate}T12:00:00+00:00` : null;
    const { error: e } = await supabase.rpc('record_manual_vault_withdrawal', {
      p_site_id: currentSite.id,
      p_amount: amt,
      p_effective_at: effectiveAt,
      p_reason: withdrawReason.trim(),
      p_beneficiary: withdrawBeneficiary || null,
      p_reference: withdrawRef || null,
      p_note: withdrawNote || null,
      p_idempotency_key: newIdempotencyKey(),
    });
    setBusy(false);
    if (e) { error(e.message || 'Retrait impossible'); return; }
    success('Retrait manuel enregistré');
    setWithdrawOpen(false);
    setWithdrawAmount(''); setWithdrawReason(''); setWithdrawBeneficiary(''); setWithdrawRef(''); setWithdrawNote('');
    setWithdrawDate(localISODate(new Date()));
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

  const handlePrint = async () => {
    if (!currentSite || !report?.vault_id) return;
    setPrinting(true);
    const { from, toExclusive } = periodBounds(range);
    // Récupération de TOUS les mouvements de la période (au-delà de la page affichée).
    const { data, error: e } = await supabase.rpc('get_vault_report', {
      p_site_id: currentSite.id,
      p_from: from,
      p_to: toExclusive,
      p_as_of: toExclusive,
      p_limit: Math.max(total, 1),
      p_offset: 0,
    });
    setPrinting(false);
    if (e || !data) { error('Impression impossible'); return; }
    const full = data as VaultReport;
    const period = labelRange(range);
    const kpi = `
      <div class="kpi-row">
        <div class="kpi-cell"><div class="kpi-label">Solde antérieur</div><div class="kpi-value num">${fmtMoney(full.prior_balance)} FCFA</div></div>
        <div class="kpi-cell"><div class="kpi-label">Entrées (période)</div><div class="kpi-value num">${fmtMoney(full.total_in)} FCFA</div></div>
        <div class="kpi-cell"><div class="kpi-label">Sorties (période)</div><div class="kpi-value num">${fmtMoney(full.total_out)} FCFA</div></div>
        <div class="kpi-cell"><div class="kpi-label">Solde à date</div><div class="kpi-value num">${fmtMoney(full.balance)} FCFA</div></div>
      </div>`;
    const bdTotals: Record<string, { direction: 'in' | 'out'; total: number }> = {};
    (full.breakdown || []).forEach(b => { bdTotals[b.kind] = { direction: b.direction, total: (bdTotals[b.kind]?.total ?? 0) + Number(b.total) }; });
    const bdRows = BREAKDOWN_ORDER.filter(k => bdTotals[k]).map(k => {
      const b = bdTotals[k];
      return `<tr>
        <td>${esc(kindLabel(k))}</td>
        <td class="r num">${b.direction === 'in' ? fmtMoney(b.total) : ''}</td>
        <td class="r num">${b.direction === 'out' ? fmtMoney(b.total) : ''}</td>
      </tr>`;
    }).join('');
    const breakdownTable = bdRows ? `
      <div class="section-title">Totaux par nature</div>
      <table>
        <thead><tr><th>Nature</th><th class="r">Entrées</th><th class="r">Sorties</th></tr></thead>
        <tbody>${bdRows}
          <tr><td class="b">Total</td><td class="r num b">${fmtMoney(full.total_in)}</td><td class="r num b">${fmtMoney(full.total_out)}</td></tr>
        </tbody>
      </table>` : '';
    const rows = (full.movements || []).map(m => {
      const refNote = [m.reference, m.note].filter(Boolean).join(' · ');
      return `<tr>
        <td class="num">${esc(formatDateTime(m.effective_at))}</td>
        <td>${esc(kindLabel(m.kind))}</td>
        <td class="muted">${esc(refNote || '')}</td>
        <td>${esc(m.created_by_name || '')}</td>
        <td class="r num">${m.direction === 'in' ? fmtMoney(m.amount) : ''}</td>
        <td class="r num">${m.direction === 'out' ? fmtMoney(m.amount) : ''}</td>
        <td class="r num b">${fmtMoney(m.balance_after)}</td>
      </tr>`;
    }).join('');
    const table = `
      <div class="section-title">Journal du coffre</div>
      <table>
        <thead><tr>
          <th>Date</th><th>Opération</th><th>Référence / note</th><th>Utilisateur</th>
          <th class="r">Entrée</th><th class="r">Sortie</th><th class="r">Solde après</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="muted c">Aucun mouvement sur la période.</td></tr>`}</tbody>
      </table>`;
    const html =
      docHeader(tenantMeta, 'Rapport du coffre', currentSite.name || '', period, currentSite.name) +
      kpi + breakdownTable + table +
      docFooter(new Date().toLocaleString('fr-FR'));
    printDoc(html);
  };

  if (!canView) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState icon={Lock} title="Accès restreint" description="Vous n’avez pas l’autorisation de consulter le coffre." />
      </div>
    );
  }

  const canDeposit = can('vault_receive_from_cash') || can('access_vault');
  const from = page * PAGE_SIZE;
  const shownTo = Math.min(from + movements.length, total);

  return (
    <div className="flex flex-col gap-0" style={{ minHeight: 'calc(100vh - 160px)' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 -mt-3 sm:-mt-4 lg:-mt-6 pt-3 sm:pt-4 lg:pt-6 bg-white shrink-0">
        <div className="flex items-center gap-3 pb-3 border-b border-neutral-200">
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-neutral-900 leading-none">Coffre</h1>
            <p className="mt-1 text-[11px] sm:text-xs text-neutral-500 truncate">{currentSite?.name || 'Point de vente'}</p>
          </div>
          <div className="flex-1" />
          {hasVault && canDeposit && (
            <button onClick={() => setDepositOpen(true)} className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1.5 text-[12px] font-medium text-neutral-700 hover:text-neutral-900 transition-colors">
              <PlusCircle className="w-4 h-4" /><span className="hidden sm:inline">Dépôt manuel</span>
            </button>
          )}
          {hasVault && canDeposit && (
            <button onClick={() => setWithdrawOpen(true)} className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1.5 text-[12px] font-medium text-neutral-700 hover:text-neutral-900 transition-colors">
              <MinusCircle className="w-4 h-4" /><span className="hidden sm:inline">Retrait manuel</span>
            </button>
          )}
          {hasVault && can('vault_transfer_to_cash') && (
            <button onClick={() => setTransferOpen(true)} className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1.5 text-[12px] font-medium text-neutral-700 hover:text-neutral-900 transition-colors">
              <ArrowUpRight className="w-4 h-4" /><span className="hidden md:inline">Transférer vers la caisse</span>
            </button>
          )}
          {hasVault && can('vault_pay_supplier') && (
            <button onClick={openPay} className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1.5 text-[12px] font-medium text-neutral-700 hover:text-neutral-900 transition-colors">
              <Wallet className="w-4 h-4" /><span className="hidden md:inline">Régler un fournisseur</span>
            </button>
          )}
          {hasVault && (
            <button onClick={handlePrint} disabled={printing} className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1.5 text-[12px] font-medium text-neutral-700 hover:text-neutral-900 transition-colors disabled:opacity-40">
              {printing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              <span className="hidden sm:inline">Imprimer</span>
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 py-2.5 flex-wrap">
          <button
            onClick={() => setPickerOpen(v => !v)}
            className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-600 hover:text-neutral-900 transition-colors whitespace-nowrap border-b border-transparent hover:border-neutral-300 pb-0.5"
          >
            <Calendar className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            <span>{labelRange(range)}</span>
            <ChevronDown className={`w-3 h-3 text-neutral-400 shrink-0 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
          </button>
          <button onClick={() => load()} className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-600 hover:text-neutral-900 transition-colors">
            <RefreshCw className="w-3.5 h-3.5 text-neutral-400" /><span className="hidden sm:inline">Actualiser</span>
          </button>
          {loading && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-neutral-400">
              <Loader2 className="w-3 h-3 animate-spin" /> Actualisation…
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 pt-5 pb-10">
        {loading && !report ? (
          <ReportSkeleton />
        ) : !hasVault ? (
          <div className="pt-6">
            <EmptyState
              icon={Lock}
              title="Aucun coffre pour ce point de vente"
              description="Initialisez le coffre pour commencer à suivre les entrées et les sorties d’espèces."
            />
            {(can('vault_adjust') || can('access_vault')) && (
              <div className="flex justify-center mt-4">
                <button onClick={() => setInitOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-neutral-700 hover:text-neutral-900 border-b border-neutral-300">
                  <PlusCircle className="w-4 h-4" /> Initialiser le coffre
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <MetricStrip items={metrics} />

            {breakdownRows.length > 0 && (
              <>
                <SectionTitle>Totaux par nature</SectionTitle>
                <ReportTable minWidth={480}>
                  <thead>
                    <tr>
                      <th className={thCls}>Nature</th>
                      <th className={thR}>Entrées</th>
                      <th className={thR}>Sorties</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdownRows.map(b => (
                      <tr key={b.kind}>
                        <td className={tdCls}>{kindLabel(b.kind)}</td>
                        <td className={tdR}>{b.direction === 'in' ? formatFCFA(b.total) : DASH}</td>
                        <td className={tdR}>{b.direction === 'out' ? formatFCFA(b.total) : DASH}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className={tdCls + ' font-semibold text-neutral-900'}>Total</td>
                      <td className={tdR + ' font-semibold text-neutral-900'}>{formatFCFA(report?.total_in ?? 0)}</td>
                      <td className={tdR + ' font-semibold text-neutral-900'}>{formatFCFA(report?.total_out ?? 0)}</td>
                    </tr>
                  </tbody>
                </ReportTable>
              </>
            )}

            <SectionTitle note={total > 0 ? `${total} mouvement${total > 1 ? 's' : ''}` : undefined}>
              Journal du coffre
            </SectionTitle>

            {movements.length === 0 ? (
              <div className="py-10 text-center text-[12px] text-neutral-400">Aucun mouvement sur la période.</div>
            ) : (
              <>
                <ReportTable minWidth={720}>
                  <thead>
                    <tr>
                      <th className={thCls}>Date</th>
                      <th className={thCls}>Opération</th>
                      <th className={thCls}>Référence / note</th>
                      <th className={thCls}>Utilisateur</th>
                      <th className={thR}>Entrée</th>
                      <th className={thR}>Sortie</th>
                      <th className={thR}>Solde après</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map(m => {
                      const refNote = [m.reference, m.note].filter(Boolean).join(' · ');
                      return (
                        <tr key={m.id}>
                          <td className={tdCls + ' whitespace-nowrap tabular-nums'}>{formatDateTime(m.effective_at)}</td>
                          <td className={tdCls}>{kindLabel(m.kind)}</td>
                          <td className={tdMuted}>{refNote || DASH}</td>
                          <td className={tdCls}>{m.created_by_name || DASH}</td>
                          <td className={tdR}>{m.direction === 'in' ? formatFCFA(m.amount) : DASH}</td>
                          <td className={tdR}>{m.direction === 'out' ? formatFCFA(m.amount) : DASH}</td>
                          <td className={tdR + ' font-semibold text-neutral-900'}>{formatFCFA(m.balance_after)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </ReportTable>

                {total > PAGE_SIZE && (
                  <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-neutral-200">
                    <span className="text-[11px] text-neutral-400 tabular-nums">{from + 1}–{shownTo} sur {total}</span>
                    <div className="flex items-center gap-1">
                      <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[12px] font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-30">
                        <ChevronLeft className="w-3.5 h-3.5" /> Précédent
                      </button>
                      <button disabled={from + PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[12px] font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-30">
                        Suivant <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <PremiumDateRangePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        from={localISODate(range.from)}
        to={localISODate(range.to)}
        onApply={(f, t) => { setRange({ from: new Date(f), to: new Date(t) }); setPickerOpen(false); }}
      />

      {/* Init modal */}
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

      {/* Manual deposit modal */}
      <Modal open={depositOpen} onClose={() => setDepositOpen(false)} title="Dépôt manuel au coffre" size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setDepositOpen(false)} className="btn-secondary">Annuler</button>
            <button onClick={submitDeposit} disabled={busy} className="btn">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Enregistrer
            </button>
          </div>
        }>
        <div className="space-y-4">
          <p className="text-sm text-neutral-500">Ce dépôt crédite uniquement le coffre. Aucun mouvement de caisse n’est créé.</p>
          <div>
            <label className="label">Montant</label>
            <input type="number" min={0} value={depositAmount} onChange={e => setDepositAmount(e.target.value)} className="input" placeholder="0" />
          </div>
          <div>
            <label className="label">Date effective</label>
            <input type="date" value={depositDate} onChange={e => setDepositDate(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Provenance / référence (facultatif)</label>
            <input value={depositRef} onChange={e => setDepositRef(e.target.value)} className="input" placeholder="Ex. apport propriétaire" />
          </div>
          <div>
            <label className="label">Note (facultatif)</label>
            <input value={depositNote} onChange={e => setDepositNote(e.target.value)} className="input" />
          </div>
        </div>
      </Modal>

      {/* Transfer modal */}
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

      {/* Manual withdrawal modal */}
      <Modal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} title="Retrait manuel du coffre" size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setWithdrawOpen(false)} className="btn-secondary">Annuler</button>
            <button onClick={submitWithdraw} disabled={busy} className="btn">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Enregistrer
            </button>
          </div>
        }>
        <div className="space-y-4">
          <p className="text-sm text-neutral-500">Ce retrait débite uniquement le coffre. Aucun mouvement de caisse n’est créé.</p>
          <p className="text-sm text-neutral-500">Solde disponible : <span className="font-semibold text-neutral-900">{formatFCFA(balance)}</span></p>
          <div>
            <label className="label">Montant</label>
            <input type="number" min={0} value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} className="input" placeholder="0" />
          </div>
          <div>
            <label className="label">Date effective</label>
            <input type="date" value={withdrawDate} onChange={e => setWithdrawDate(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Motif ou destination</label>
            <input value={withdrawReason} onChange={e => setWithdrawReason(e.target.value)} className="input" placeholder="Ex. dépôt à la banque" />
          </div>
          <div>
            <label className="label">Bénéficiaire (facultatif)</label>
            <input value={withdrawBeneficiary} onChange={e => setWithdrawBeneficiary(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Référence (facultatif)</label>
            <input value={withdrawRef} onChange={e => setWithdrawRef(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Note (facultatif)</label>
            <input value={withdrawNote} onChange={e => setWithdrawNote(e.target.value)} className="input" />
          </div>
        </div>
      </Modal>

      {/* Supplier payment modal */}
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
