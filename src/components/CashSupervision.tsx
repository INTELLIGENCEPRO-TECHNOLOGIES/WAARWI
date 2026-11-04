import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, BarChart3, HandCoins, Loader2, Lock, LogOut, ReceiptText, RefreshCw, Undo2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { formatDateTime, formatFCFA } from '../lib/format';
import { registerText } from '../lib/cashSession';
import { buildPrintTenantForSite } from '../lib/print';
import type { Customer, PaymentMethod } from '../lib/types';
import type { CashOpContext, CashSessionSnapshot } from './cash/cashOpContext';
import { CashMovementModal } from './cash/CashMovementModal';
import { CustomerPaymentModal } from './cash/CustomerPaymentModal';
import { SaleReturnModal } from './cash/SaleReturnModal';
import { CashCloseModal } from './cash/CashCloseModal';
import { SessionTicketsModal } from './cash/SessionTicketsModal';
import { SessionStatsModal } from './cash/SessionStatsModal';

const SUPERVISION_DENIED_MSG = "Vous n'avez pas l'autorisation de superviser cette caisse.";

type Scope = 'open' | 'closed';
type Rights = Partial<Record<'movement' | 'withdrawal' | 'loan' | 'customer_payment' | 'returns' | 'close' | 'reprint' | 'stats' | 'summary' | 'x_report', boolean>>;
type ModalKind = 'movement' | 'customer' | 'return' | 'close' | 'tickets' | 'stats';

type SupervisedSession = {
  id: string; site_id: string; site_name: string;
  cash_register_id: string; register_name: string; register_code: string;
  user_id: string; operator_name: string; status: string;
  opened_at: string; closed_at: string | null;
  opening_amount: number; theoretical_amount: number | null; closed_by_name: string | null;
};

interface Props {
  tenantId: string;
  methods: PaymentMethod[];
  customers: Customer[];
  onExit: () => void;
}

export function CashSupervision({ tenantId, methods, customers, onExit }: Props) {
  const { tenant, sites, profile } = useApp();
  const [scope, setScope] = useState<Scope>('open');
  const [siteFilter, setSiteFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [rights, setRights] = useState<Rights>({});
  const [sessions, setSessions] = useState<SupervisedSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ kind: ModalKind; ctx: CashOpContext; session: CashSessionSnapshot } | null>(null);
  const [opening, setOpening] = useState<ModalKind | null>(null);
  const [actionError, setActionError] = useState('');

  const loadSessions = useCallback(async (s: Scope) => {
    setLoading(true); setLoadError('');
    const { data, error: e } = await supabase.rpc('cash_supervision_sessions', { p_scope: s });
    setLoading(false);
    const d = data as { can_supervise?: boolean; rights?: Rights; sessions?: SupervisedSession[] } | null;
    if (e || !d || !Array.isArray(d.sessions)) { setLoadError(e?.message || 'Impossible de charger les caisses'); setSessions([]); return; }
    if (!d.can_supervise) { setLoadError(SUPERVISION_DENIED_MSG); setSessions([]); return; }
    setRights(d.rights || {});
    setSessions(d.sessions);
  }, []);

  useEffect(() => { loadSessions(scope); }, [scope, loadSessions]);

  const selected = sessions.find(s => s.id === selectedId) || null;
  const isOpen = selected?.status === 'open';
  const siteOptions = useMemo(() => {
    const m = new Map<string, string>();
    sessions.forEach(s => m.set(s.site_id, s.site_name));
    return Array.from(m.entries());
  }, [sessions]);
  const visible = siteFilter ? sessions.filter(s => s.site_id === siteFilter) : sessions;

  const changeScope = (s: Scope) => { if (s === scope) return; setSelectedId(null); setActionError(''); setSiteFilter(''); setScope(s); };

  const openModal = async (kind: ModalKind) => {
    if (!selected || opening) return;
    setActionError('');
    const site = sites.find(x => x.id === selected.site_id) || null;
    const ctx: CashOpContext = {
      mode: 'supervision', sessionId: selected.id, siteId: selected.site_id,
      registerLabel: registerText(selected.register_code, selected.register_name),
      operatorName: selected.operator_name, siteName: selected.site_name,
      userName: profile?.full_name || profile?.email || '',
      printTenant: buildPrintTenantForSite(tenant, site ?? { name: selected.site_name }),
      methods, customers,
    };
    const num = (v: unknown) => (v == null ? null : Number(v));
    let session: CashSessionSnapshot = {
      id: selected.id, tenant_id: tenantId, site_id: selected.site_id, user_id: selected.user_id,
      opened_at: selected.opened_at, closed_at: selected.closed_at,
      opening_amount: Number(selected.opening_amount) || 0, closing_amount: null,
      theoretical_amount: num(selected.theoretical_amount), variance: null, status: selected.status,
    };
    if (selected.status !== 'open') {
      setOpening(kind);
      try {
        const { data, error: e } = await supabase.from('cash_sessions')
          .select('id, tenant_id, site_id, user_id, opened_at, closed_at, opening_amount, closing_amount, theoretical_amount, variance, status, closing_note')
          .eq('id', selected.id).eq('tenant_id', tenantId).eq('site_id', selected.site_id).maybeSingle();
        if (e) { setActionError(e.message || 'Impossible de charger la clôture de cette session.'); return; }
        if (!data) { setActionError(SUPERVISION_DENIED_MSG); return; }
        session = {
          ...session, opened_at: data.opened_at, closed_at: data.closed_at, status: data.status,
          opening_amount: Number(data.opening_amount) || 0,
          closing_amount: num(data.closing_amount), theoretical_amount: num(data.theoretical_amount),
          variance: num(data.variance), closing_note: data.closing_note ?? null,
        };
      } catch (e) {
        setActionError((e as { message?: string })?.message || 'Impossible de charger la clôture de cette session.');
        return;
      } finally {
        setOpening(null);
      }
    }
    setModal({ kind, ctx, session });
  };

  const afterOperation = () => { setModal(null); loadSessions(scope); };
  const afterClose = () => { setModal(null); setSelectedId(null); loadSessions(scope); };

  const actions: { kind: ModalKind; label: string; icon: typeof Lock; show: boolean }[] = [
    { kind: 'movement', label: 'Mouvement', icon: ArrowLeftRight, show: isOpen && !!rights.movement },
    { kind: 'customer', label: 'Encaisser client', icon: HandCoins, show: isOpen && !!rights.customer_payment },
    { kind: 'return', label: 'Retour', icon: Undo2, show: isOpen && !!rights.returns },
    { kind: 'tickets', label: 'Tickets', icon: ReceiptText, show: true },
    { kind: 'stats', label: 'Statistiques · Rapport X', icon: BarChart3, show: !!(rights.stats || rights.summary || rights.x_report) },
    { kind: 'close', label: 'Compter · Clôturer', icon: Lock, show: isOpen && !!rights.close },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <div className="w-full px-3 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center gap-2 pb-3 border-b border-neutral-200">
          {selected && (
            <button onClick={() => { setSelectedId(null); setActionError(''); }} className="p-1.5 -ml-1.5 text-neutral-700 hover:text-black" title="Retour à la liste">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            {selected ? (
              <p className="text-sm sm:text-base font-semibold text-black truncate">
                Supervision · {registerText(selected.register_code, selected.register_name)} · {selected.operator_name} · {selected.site_name}
              </p>
            ) : (
              <p className="text-sm sm:text-base font-semibold text-black">Superviser les caisses</p>
            )}
            <p className="text-xs text-neutral-500 truncate">
              {selected
                ? `${isOpen ? 'Ouverte' : 'Clôturée'} · ouverture ${formatDateTime(selected.opened_at)}${selected.closed_at ? ` · clôture ${formatDateTime(selected.closed_at)}` : ''}${selected.closed_by_name ? ` par ${selected.closed_by_name}` : ''} · la session reste à ${selected.operator_name}`
                : 'Sessions de vos collaborateurs. Aucune vente ne peut être créée en supervision.'}
            </p>
          </div>
          <button onClick={() => loadSessions(scope)} className="p-1.5 text-neutral-600 hover:text-black" title="Actualiser">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onExit} className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-neutral-700 hover:text-black">
            <LogOut className="w-3.5 h-3.5" />Quitter
          </button>
        </div>

        {selected ? (
          <>
            <div className="flex flex-wrap items-center gap-x-1 gap-y-1 py-2 border-b border-neutral-200">
              {actions.filter(a => a.show).map(a => (
                <button key={a.kind} onClick={() => openModal(a.kind)} disabled={!!opening}
                  className="flex items-center gap-1.5 px-2.5 py-2 text-sm text-neutral-800 hover:text-black hover:underline underline-offset-4 transition-colors disabled:opacity-50">
                  {opening === a.kind ? <Loader2 className="w-4 h-4 animate-spin" /> : <a.icon className="w-4 h-4" />}{a.label}
                </button>
              ))}
            </div>
            {actionError && <p className="py-2 text-xs text-red-700">{actionError}</p>}
            {!isOpen && <p className="py-2 text-xs text-neutral-500">Session clôturée : consultation uniquement.</p>}
            <dl className="divide-y divide-neutral-200">
              <Row label="Magasin" value={selected.site_name} />
              <Row label="Caisse" value={registerText(selected.register_code, selected.register_name)} />
              <Row label="Opérateur" value={selected.operator_name} />
              <Row label="Fonds d'ouverture" value={formatFCFA(Number(selected.opening_amount) || 0)} />
              {selected.theoretical_amount != null && !isOpen && <Row label="Solde théorique à la clôture" value={formatFCFA(Number(selected.theoretical_amount) || 0)} />}
            </dl>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-4 border-b border-neutral-200">
              {(['open', 'closed'] as const).map(s => (
                <button key={s} onClick={() => changeScope(s)}
                  className={`py-2.5 text-sm -mb-px border-b-2 transition-colors ${scope === s ? 'border-black text-black font-semibold' : 'border-transparent text-neutral-500 hover:text-black'}`}>
                  {s === 'open' ? 'Ouvertes' : 'Clôturées (30 j)'}
                </button>
              ))}
              <div className="flex-1" />
              {siteOptions.length > 1 && (
                <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}
                  className="mb-1.5 text-sm bg-transparent border-0 border-b border-neutral-300 focus:border-black focus:ring-0 py-1 pr-7">
                  <option value="">Tous les magasins</option>
                  {siteOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              )}
            </div>

            {loading && sessions.length === 0 ? (
              <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>
            ) : loadError ? (
              <p className="py-6 text-sm text-red-700">{loadError}</p>
            ) : visible.length === 0 ? (
              <p className="py-12 text-center text-sm text-neutral-500">
                {scope === 'open' ? 'Aucune caisse ouverte à superviser.' : 'Aucune session clôturée sur les 30 derniers jours.'}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-neutral-500 border-b border-neutral-200">
                    <th className="py-2 pr-3 font-medium">Magasin</th>
                    <th className="py-2 pr-3 font-medium">Caisse</th>
                    <th className="py-2 pr-3 font-medium">Opérateur</th>
                    <th className="py-2 pr-3 font-medium">État</th>
                    <th className="py-2 font-medium text-right">{scope === 'open' ? 'Ouverture' : 'Clôture'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {visible.map(s => (
                    <tr key={s.id} onClick={() => { setSelectedId(s.id); setActionError(''); }} className="cursor-pointer hover:bg-neutral-50 transition-colors">
                      <td className="py-2.5 pr-3 text-neutral-700">{s.site_name}</td>
                      <td className="py-2.5 pr-3 font-medium text-black">{registerText(s.register_code, s.register_name)}</td>
                      <td className="py-2.5 pr-3 text-neutral-800">{s.operator_name}</td>
                      <td className="py-2.5 pr-3 text-neutral-600">{s.status === 'open' ? 'Ouverte' : 'Clôturée'}</td>
                      <td className="py-2.5 text-right text-neutral-600 tabular-nums">{formatDateTime(scope === 'open' ? s.opened_at : (s.closed_at || s.opened_at))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {modal?.kind === 'movement' && <CashMovementModal ctx={modal.ctx} onClose={() => setModal(null)} onDone={afterOperation} />}
      {modal?.kind === 'customer' && <CustomerPaymentModal ctx={modal.ctx} onClose={() => setModal(null)} onDone={afterOperation} />}
      {modal?.kind === 'return' && <SaleReturnModal ctx={modal.ctx} onClose={() => setModal(null)} onDone={afterOperation} />}
      {modal?.kind === 'tickets' && <SessionTicketsModal ctx={modal.ctx} onClose={() => { setModal(null); loadSessions(scope); }} />}
      {modal?.kind === 'stats' && <SessionStatsModal ctx={modal.ctx} session={modal.session} onClose={() => setModal(null)} />}
      {modal?.kind === 'close' && <CashCloseModal ctx={modal.ctx} session={modal.session} multiEnabled onClose={() => setModal(null)} onClosed={afterClose} />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-black font-medium text-right truncate">{value}</dd>
    </div>
  );
}
