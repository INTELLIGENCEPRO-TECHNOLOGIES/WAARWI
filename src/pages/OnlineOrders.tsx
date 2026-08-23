import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Filter, Globe, Phone, MessageCircle, Printer, X, Clock, CheckCircle2,
  Package, Truck, Ban, RefreshCw, ChevronRight, MapPin, CreditCard,
  ShoppingBag, FileText,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { formatFCFA, formatDateTime, formatDate } from '../lib/format';
import { Modal, ConfirmDialog, DocPanel } from '../components/Modal';

type OrderStatus = 'nouvelle' | 'confirmee' | 'en_preparation' | 'prete' | 'livree' | 'annulee';
type PaymentStatus = 'non_paye' | 'en_attente' | 'paye' | 'rembourse';

type OnlineOrder = {
  id: string; order_number: string;
  customer_name: string; customer_phone: string; customer_whatsapp: string;
  customer_email: string; customer_address: string; customer_note: string;
  delivery_mode: string; delivery_address: string; delivery_fee: number;
  payment_mode: string; payment_status: PaymentStatus;
  subtotal: number; total: number; status: OrderStatus;
  internal_note: string; sale_id: string | null;
  created_at: string; updated_at: string;
};
type OrderItem = { id: string; article_name: string; internal_ref: string; quantity: number; unit_price: number; line_total: number };
type HistoryEntry = { id: string; old_status: string; new_status: string; note: string; created_at: string };

const STATUS_META: Record<OrderStatus, { label: string; short: string; cls: string; dot: string; text: string; bg: string; icon: any }> = {
  nouvelle:       { label: 'Nouvelle',       short: 'Nouvelles',  cls: 'bg-amber-50 text-amber-800 border-amber-200',       dot: 'bg-amber-500',   text: 'text-amber-600',   bg: 'bg-amber-50',   icon: ShoppingBag },
  confirmee:      { label: 'Confirmée',      short: 'Confirmées', cls: 'bg-neutral-50 text-neutral-800 border-neutral-200',             dot: 'bg-neutral-900',     text: 'text-neutral-700',     bg: 'bg-neutral-50',     icon: CheckCircle2 },
  en_preparation: { label: 'En préparation', short: 'En prépa',   cls: 'bg-neutral-50 text-neutral-800 border-neutral-200',          dot: 'bg-neutral-900',    text: 'text-neutral-700',    bg: 'bg-neutral-50',    icon: Package },
  prete:          { label: 'Prête',          short: 'Prêtes',     cls: 'bg-teal-50 text-teal-800 border-teal-200',          dot: 'bg-teal-500',    text: 'text-teal-600',    bg: 'bg-teal-50',    icon: ShoppingBag },
  livree:         { label: 'Livrée',         short: 'Livrées',    cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', icon: Truck },
  annulee:        { label: 'Annulée',        short: 'Annulées',   cls: 'bg-rose-50 text-rose-700 border-rose-200',          dot: 'bg-rose-500',    text: 'text-rose-600',    bg: 'bg-rose-50',    icon: Ban },
};

const PAYMENT_META: Record<PaymentStatus, { label: string; cls: string }> = {
  non_paye:   { label: 'Non payé',   cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  en_attente: { label: 'En attente', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  paye:       { label: 'Payé',       cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  rembourse:  { label: 'Remboursé',  cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

const STATUS_FLOW: OrderStatus[] = ['nouvelle', 'confirmee', 'en_preparation', 'prete', 'livree'];
const STATUS_ORDER: OrderStatus[] = ['nouvelle', 'confirmee', 'en_preparation', 'prete', 'livree', 'annulee'];

export function OnlineOrders() {
  const { tenant, dataTick } = useApp();
  const { can } = usePermissions();
  const { success, error } = useToast();

  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
  const [payFilter, setPayFilter] = useState<'all' | PaymentStatus>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<OnlineOrder | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!tenant) return;
    if (!silent) setLoading(true);
    const { data, error: err } = await supabase
      .from('online_orders').select('id, order_number, customer_name, customer_phone, customer_whatsapp, customer_email, customer_address, customer_note, delivery_mode, delivery_address, delivery_fee, payment_mode, payment_status, subtotal, total, status, internal_note, sale_id, created_at, updated_at')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false }).limit(500);
    if (err) error(err.message);
    setOrders((data || []) as OnlineOrder[]);
    if (!silent) setLoading(false);
  }, [tenant, error]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (dataTick > 0) { const t = setTimeout(() => load(true), 400); return () => clearTimeout(t); } }, [dataTick]);

  const [flashList, setFlashList] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    import('../lib/navHighlight').then(({ consumeNavContext }) => {
      const ctx = consumeNavContext();
      if (!ctx) return;
      if (ctx.highlightId) {
        setHighlightId(ctx.highlightId);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => setHighlightId(null), 6800);
      }
      if (ctx.target === 'webNew') setStatusFilter('nouvelle');
      else if (ctx.target === 'webPrep') setStatusFilter('en_preparation');
      else if (ctx.target === 'webReady') setStatusFilter('prete');
      else if (!ctx.highlightId) return;
      if (ctx.target) {
        setFlashList(true);
        setTimeout(() => setFlashList(false), 6800);
      }
    });
  }, []);

  useEffect(() => {
    if (!highlightId || loading) return;
    let raf: number;
    let tries = 0;
    const tryScroll = () => {
      const el = document.querySelector(`[data-row-id="${highlightId}"]`);
      if (el) {
        el.classList.remove('waarwi-flash');
        void el.offsetWidth;
        el.classList.add('waarwi-flash');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (++tries < 20) raf = requestAnimationFrame(tryScroll);
    };
    raf = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(raf);
  }, [highlightId, orders, loading]);

  useEffect(() => {
    if (!tenant) return;
    const chan = supabase.channel(`online_orders_${tenant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'online_orders', filter: `tenant_id=eq.${tenant.id}` }, () => load(true))
      .subscribe();
    return () => { supabase.removeChannel(chan); };
  }, [tenant, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    return orders.filter(o => {
      if (q && !o.order_number.toLowerCase().includes(q) && !o.customer_phone.toLowerCase().includes(q) && !o.customer_name.toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (payFilter !== 'all' && o.payment_status !== payFilter) return false;
      if (dateFilter !== 'all') {
        const created = new Date(o.created_at).getTime();
        const days = dateFilter === 'today' ? 1 : dateFilter === '7d' ? 7 : 30;
        if (now - created > days * 86400000) return false;
      }
      return true;
    });
  }, [orders, query, statusFilter, payFilter, dateFilter]);

  const counts = useMemo(() => {
    const c: Record<OrderStatus, number> = { nouvelle: 0, confirmee: 0, en_preparation: 0, prete: 0, livree: 0, annulee: 0 };
    orders.forEach(o => { if (o.status in c) c[o.status]++; });
    return c;
  }, [orders]);

  const openOrder = async (o: OnlineOrder) => {
    setSelected(o);
    setDetailLoading(true);
    const [{ data: its }, { data: hs }] = await Promise.all([
      supabase.from('online_order_items').select('*').eq('order_id', o.id).order('created_at'),
      supabase.from('online_order_status_history').select('*').eq('order_id', o.id).order('created_at'),
    ]);
    setItems((its || []) as OrderItem[]);
    setHistory((hs || []) as HistoryEntry[]);
    setDetailLoading(false);
  };

  const updateStatus = async (newStatus: OrderStatus) => {
    if (!selected || !tenant) return;
    if (!can('manage_online_orders')) { error('Vous n\'avez pas la permission de gerer les commandes en ligne'); return; }
    const { error: err } = await supabase.from('online_orders').update({ status: newStatus }).eq('id', selected.id).eq('tenant_id', tenant.id);
    if (err) { error(err.message); return; }
    success(`Statut : ${STATUS_META[newStatus].label}`);
    setSelected({ ...selected, status: newStatus });
    setOrders(prev => prev.map(o => o.id === selected.id ? { ...o, status: newStatus } : o));
    const { data: hs } = await supabase.from('online_order_status_history').select('*').eq('order_id', selected.id).order('created_at');
    setHistory((hs || []) as HistoryEntry[]);
  };

  const updatePayment = async (newStatus: PaymentStatus) => {
    if (!selected || !tenant) return;
    if (!can('manage_online_orders')) { error('Vous n\'avez pas la permission de gerer les commandes en ligne'); return; }
    const { error: err } = await supabase.from('online_orders').update({ payment_status: newStatus }).eq('id', selected.id).eq('tenant_id', tenant.id);
    if (err) { error(err.message); return; }
    success(`Paiement : ${PAYMENT_META[newStatus].label}`);
    setSelected({ ...selected, payment_status: newStatus });
    setOrders(prev => prev.map(o => o.id === selected.id ? { ...o, payment_status: newStatus } : o));
  };

  const openWhatsApp = (o: OnlineOrder) => {
    const phone = (o.customer_whatsapp || o.customer_phone || '').replace(/[^0-9]/g, '');
    if (!phone) { error('Aucun numéro WhatsApp/téléphone'); return; }
    const intl = phone.startsWith('221') ? phone : phone.length === 9 ? `221${phone}` : phone;
    const msg = `Bonjour ${o.customer_name || ''},\n\nVotre commande *${o.order_number}* est actuellement : *${STATUS_META[o.status].label}*.\nMontant : *${formatFCFA(o.total)}*.\n\nMerci pour votre confiance.`;
    window.open(`https://wa.me/${intl}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const printOrder = (o: OnlineOrder) => {
    const w = window.open('', '_blank', 'width=760,height=900');
    if (!w) return;
    const t: any = tenant || {};
    const fmtMoney = (n: number) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
    const rows = items.map(i => `<tr>
      <td><span class="item-name">${escapeHtml(i.article_name)}</span>${i.internal_ref ? `<br/><span class="item-ref">Réf : ${escapeHtml(i.internal_ref)}</span>` : ''}</td>
      <td class="center">${i.quantity}</td>
      <td class="right">${fmtMoney(i.unit_price)} FCFA</td>
      <td class="right bold">${fmtMoney(i.line_total)} FCFA</td>
    </tr>`).join('');
    const tenantInfoLines: string[] = [];
    if (t.address) tenantInfoLines.push(escapeHtml(t.address));
    if (t.phone) tenantInfoLines.push('Tél : ' + escapeHtml(t.phone));
    if (t.email) tenantInfoLines.push(escapeHtml(t.email));
    if (t.website) tenantInfoLines.push(escapeHtml(t.website));
    const idLines: string[] = [];
    if (t.ninea) idLines.push('NINEA : ' + escapeHtml(t.ninea));
    if (t.rccm) idLines.push('RCCM : ' + escapeHtml(t.rccm));
    const logoHtml = t.logo_url ? `<img src="${escapeHtml(t.logo_url)}" alt="" style="max-width:80px;max-height:70px;object-fit:contain;margin-bottom:6px" onerror="this.style.display='none'"/>` : '';
    const printStyle = `
      @page { margin: 14mm; size: A4; }
      @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #000000; padding: 24px; max-width: 720px; margin: auto; font-size: 12px; background: #fff; line-height: 1.45; }
      .hdr { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 14px; border-bottom: 2.5px solid #000000; margin-bottom: 18px; }
      h1 { font-size: 22px; font-weight: 900; color: #000000; margin: 0 0 2px 0; }
      .legal { font-size: 11px; font-weight: 700; color: #000000; }
      .info { font-size: 11px; font-weight: 600; color: #000000; line-height: 1.6; margin-top: 5px; }
      .ids { font-size: 10.5px; font-weight: 700; color: #000000; margin-top: 4px; }
      .doc-tag { text-transform: uppercase; font-size: 10px; letter-spacing: 1.5px; font-weight: 900; color: #000000; }
      .doc-num { font-weight: 900; font-size: 20px; color: #000000; margin-top: 3px; }
      .doc-date { font-size: 11px; font-weight: 600; color: #000000; margin-top: 2px; }
      .section { border: 1.5px solid #000000; border-radius: 4px; padding: 10px 14px; margin: 14px 0; }
      .section-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #000000; border-bottom: 1px solid #000000; padding-bottom: 5px; margin-bottom: 8px; }
      .cust-name { font-weight: 800; font-size: 13px; color: #000000; }
      .cust-info { font-size: 11.5px; font-weight: 600; color: #000000; margin-top: 2px; }
      .note { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #000000; font-size: 11px; font-weight: 600; color: #000000; font-style: italic; }
      table { width: 100%; border-collapse: collapse; margin-top: 14px; }
      thead tr { background: #000000; color: #ffffff; }
      th { padding: 9px 10px; text-align: left; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; color: #ffffff; }
      th.center { text-align: center; }
      th.right { text-align: right; }
      td { padding: 9px 10px; border-bottom: 1px solid #000000; font-size: 11px; font-weight: 500; color: #000000; vertical-align: top; }
      tbody tr:nth-child(even) td { background: #f5f5f5; }
      td.center { text-align: center; font-weight: 700; }
      td.right { text-align: right; }
      td.bold { font-weight: 800; }
      .item-name { font-weight: 700; color: #000000; }
      .item-ref { font-size: 10px; font-weight: 600; font-family: 'Courier New', monospace; color: #000000; }
      .total-row { display: flex; justify-content: flex-end; margin-top: 14px; }
      .total-box { border: 2px solid #000000; border-radius: 4px; overflow: hidden; min-width: 280px; }
      .total-grand { display: flex; justify-content: space-between; padding: 12px 16px; background: #000000; color: #ffffff; font-size: 15px; font-weight: 900; }
      .payment-info { display: flex; justify-content: space-between; padding: 9px 16px; font-size: 11.5px; font-weight: 600; color: #000000; border-bottom: 1px solid #000000; }
      .footer { margin-top: 24px; padding-top: 12px; border-top: 1.5px solid #000000; display: flex; justify-content: space-between; font-size: 10px; font-weight: 600; color: #000000; }
      .waarwi { margin-top: 10px; padding-top: 8px; border-top: 1px dashed #000000; text-align: center; font-size: 9.5px; font-weight: 600; color: #000000; }
    `;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(o.order_number)}</title>
      <style>${printStyle}</style>
      </head><body>
      <div class="hdr">
        <div style="flex:1">
          ${logoHtml}
          <h1>${escapeHtml(t.name || '')}</h1>
          ${t.legal_name ? `<div class="legal">${escapeHtml(t.legal_name)}</div>` : ''}
          <div class="info">${tenantInfoLines.join('<br/>')}</div>
          ${idLines.length ? `<div class="ids">${idLines.join(' · ')}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div class="doc-tag">Commande en ligne</div>
          <div class="doc-num">${escapeHtml(o.order_number)}</div>
          <div class="doc-date">${formatDateTime(o.created_at)}</div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">Client</div>
        <div class="cust-name">${escapeHtml(o.customer_name || '-')}</div>
        ${o.customer_phone ? `<div class="cust-info">${escapeHtml(o.customer_phone)}</div>` : ''}
        <div class="cust-info">${o.delivery_mode === 'livraison' ? `Livraison : ${escapeHtml(o.delivery_address || '')}` : 'Retrait en boutique'}</div>
        ${o.customer_note ? `<div class="note">${escapeHtml(o.customer_note)}</div>` : ''}
      </div>
      <table>
        <thead><tr>
          <th>Article</th>
          <th class="center">Qté</th>
          <th class="right">Prix unitaire</th>
          <th class="right">Total</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="total-row">
        <div class="total-box">
          <div class="payment-info"><span>Mode de paiement</span><span>${escapeHtml(o.payment_mode)}</span></div>
          <div class="payment-info"><span>Statut</span><span>${PAYMENT_META[o.payment_status].label}</span></div>
          <div class="total-grand"><span>TOTAL</span><span>${fmtMoney(o.total)} FCFA</span></div>
        </div>
      </div>
      <div class="footer">
        <span>${escapeHtml(t.name || '')}${t.ninea ? ` — NINEA : ${escapeHtml(t.ninea)}` : ''}</span>
        <span>Imprimé le ${new Date().toLocaleString('fr-FR')}</span>
      </div>
      <div class="waarwi">Propulsée par <strong>WAARWI</strong> — Plateforme Business 2.0 made in Sénégal</div>
      </body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 300);
  };

  const doCancel = async () => { setConfirmCancel(false); await updateStatus('annulee'); };

  const totalActive = filtered.length;

  return (
    <div className="space-y-3 pb-6">
      {/* ── Header unifié : titre intégré + recherche + filtre + refresh ─── */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-4 sm:px-5 lg:px-8 pb-3 pt-4 -mt-3 sm:-mt-4 lg:-mt-6 bg-white space-y-3 border-b border-neutral-100">
        <h1 className="text-lg font-bold text-neutral-900 leading-tight">Commandes en ligne</h1>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="N°, nom ou téléphone…"
              className="bare-input w-full text-sm py-1.5"
            />
            <div className="h-px bg-neutral-200 mt-1" />
          </div>
          {query && (
            <button onClick={() => setQuery('')} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`shrink-0 inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors ${
              payFilter !== 'all' || dateFilter !== 'all' || showFilters
                ? 'text-brand-700'
                : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            <Filter className="w-4 h-4" />
            <span className="hidden md:inline">Filtres</span>
          </button>
          <button
            onClick={() => load(true)}
            className="shrink-0 p-1.5 text-neutral-400 hover:text-neutral-600 transition-colors active:scale-95"
            aria-label="Actualiser"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="py-3 border-b border-neutral-100 grid grid-cols-1 sm:grid-cols-2 gap-2.5 animate-slide-down">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1">Paiement</label>
            <select value={payFilter} onChange={e => setPayFilter(e.target.value as any)} className="input h-9 text-xs">
              <option value="all">Tous paiements</option>
              {Object.entries(PAYMENT_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1">Période</label>
            <select value={dateFilter} onChange={e => setDateFilter(e.target.value as any)} className="input h-9 text-xs">
              <option value="all">Toutes périodes</option>
              <option value="today">Aujourd'hui</option>
              <option value="7d">7 derniers jours</option>
              <option value="30d">30 derniers jours</option>
            </select>
          </div>
        </div>
      )}

      {/* ── KPI chips compact scrollable ──────────────────────────────── */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar whitespace-nowrap -mx-1 px-1">
        <StatusChip
          label="Tous"
          value={orders.length}
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
          neutral
        />
        {STATUS_ORDER.map(st => {
          const meta = STATUS_META[st];
          return (
            <StatusChip
              key={st}
              label={meta.short}
              value={counts[st]}
              active={statusFilter === st}
              dot={meta.dot}
              onClick={() => setStatusFilter(statusFilter === st ? 'all' : st)}
            />
          );
        })}
      </div>

      {/* Inline summary */}
      <div className="flex items-center justify-between text-[11px] text-neutral-500 font-semibold px-1">
        <span>{totalActive} commande{totalActive > 1 ? 's' : ''}{statusFilter !== 'all' ? ` · ${STATUS_META[statusFilter as OrderStatus].label}` : ''}</span>
        {(statusFilter !== 'all' || payFilter !== 'all' || dateFilter !== 'all' || query) && (
          <button onClick={() => { setStatusFilter('all'); setPayFilter('all'); setDateFilter('all'); setQuery(''); }} className="text-brand-600 hover:text-brand-700 flex items-center gap-0.5">
            Réinitialiser <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* ── Liste ───────────────────────────────────────────────────── */}
      {loading ? (
        <div className="py-10 text-center text-sm text-neutral-500">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center">
          <Globe className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <div className="text-neutral-800 font-semibold text-sm">Aucune commande</div>
          <p className="text-xs text-neutral-500 mt-1">Les commandes de votre boutique en ligne apparaîtront ici.</p>
        </div>
      ) : (
        <div className={`divide-y divide-neutral-100 ${flashList ? 'waarwi-flash waarwi-flash-scroll' : ''}`}>
          {/* Thin header row */}
          <div className="flex items-center gap-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            <span className="w-20 shrink-0">N°</span>
            <span className="flex-1 min-w-0">Client</span>
            <span className="hidden sm:block w-20 shrink-0 text-right">Statut</span>
            <span className="w-24 shrink-0 text-right">Montant</span>
            <span className="w-5 shrink-0" />
          </div>
          {filtered.map(o => {
            const meta = STATUS_META[o.status];
            const pay = PAYMENT_META[o.payment_status];
            return (
              <button
                key={o.id}
                data-row-id={o.id}
                onClick={() => openOrder(o)}
                className="w-full py-2.5 px-0.5 text-left transition-colors hover:bg-neutral-50/60 active:bg-neutral-100/60"
              >
                {/* Line 1: number + status + amount */}
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-extrabold text-neutral-900 shrink-0 w-20 truncate">{o.order_number}</span>
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span className="font-semibold text-neutral-800 text-xs truncate">{o.customer_name || '—'}</span>
                    {o.customer_phone && (
                      <span className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-medium text-neutral-400 shrink-0">
                        <Phone className="w-2.5 h-2.5" />
                        {o.customer_phone}
                      </span>
                    )}
                  </div>
                  <span className={`hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${meta.cls} shrink-0 w-20 justify-center`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                    {meta.short}
                  </span>
                  <span className="text-[13px] font-extrabold text-neutral-900 num whitespace-nowrap shrink-0 w-24 text-right">{formatFCFA(o.total)}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                </div>
                {/* Line 2: date + payment + delivery (mobile-only compact) */}
                <div className="flex items-center gap-1.5 mt-1 flex-wrap sm:hidden">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${meta.cls}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                    {meta.label}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold ${pay.cls}`}>
                    <CreditCard className="w-2.5 h-2.5" />
                    {pay.label}
                  </span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-neutral-50 border border-neutral-100 text-[10px] font-semibold text-neutral-600">
                    {o.delivery_mode === 'livraison' ? <Truck className="w-2.5 h-2.5" /> : <ShoppingBag className="w-2.5 h-2.5" />}
                    {o.delivery_mode === 'livraison' ? 'Livraison' : 'Retrait'}
                  </span>
                  <span className="text-neutral-400 font-medium text-[10px] whitespace-nowrap shrink-0 ml-auto">{formatDate(o.created_at)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Panel detail ─────────────────────────────────────────── */}
      <DocPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `Commande ${selected.order_number}` : ''}
        footer={selected && (
          <div className="flex flex-wrap gap-1.5 w-full" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <button onClick={() => openWhatsApp(selected)} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm active:scale-95 transition-all">
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
            </button>
            <button onClick={() => printOrder(selected)} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-bold active:scale-95 transition-all">
              <Printer className="w-3.5 h-3.5" /> Imprimer
            </button>
            {selected.status !== 'annulee' && selected.status !== 'livree' && (
              <button onClick={() => setConfirmCancel(true)} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 text-xs font-bold active:scale-95 transition-all">
                <Ban className="w-3.5 h-3.5" /> Annuler
              </button>
            )}
            <div className="flex-1 min-w-0" />
            {nextStatus(selected.status) && (
              <button onClick={() => updateStatus(nextStatus(selected.status)!)} className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 hover:from-brand-700 hover:to-brand-900 text-white text-xs font-bold shadow-glow active:scale-95 transition-all">
                {STATUS_META[nextStatus(selected.status)!].label}
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      >
        {selected && (
          <div className="space-y-3">
            {/* Status + payment pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold border ${STATUS_META[selected.status].cls}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[selected.status].dot}`} />
                {STATUS_META[selected.status].label}
              </span>
              <span className={`inline-flex items-center px-2 py-1 rounded-md text-[11px] font-bold border ${PAYMENT_META[selected.payment_status].cls}`}>
                {PAYMENT_META[selected.payment_status].label}
              </span>
              <span className="text-[10px] text-neutral-400 font-semibold ml-auto">{formatDateTime(selected.created_at)}</span>
            </div>

            {/* Stepper */}
            {selected.status !== 'annulee' && (
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar -mx-0.5 px-0.5">
                {STATUS_FLOW.map((s, i) => {
                  const idx = STATUS_FLOW.indexOf(selected.status);
                  const done = idx >= i;
                  const active = idx === i;
                  return (
                    <div key={s} className="flex items-center gap-1 shrink-0">
                      <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${active ? 'bg-brand-700 text-white shadow-sm' : done ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'bg-neutral-100 text-neutral-400'}`}>
                        <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] ${active ? 'bg-white/30' : done ? 'bg-brand-600 text-white' : 'bg-slate-300 text-white'}`}>{i + 1}</span>
                        <span className="whitespace-nowrap">{STATUS_META[s].label}</span>
                      </div>
                      {i < STATUS_FLOW.length - 1 && <div className={`h-0.5 w-3 rounded-full ${done && idx > i ? 'bg-brand-500' : 'bg-slate-200'}`} />}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Info cards grid — compact */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <InfoCard icon={Phone} title="Client">
                <div className="font-semibold text-neutral-900 text-xs truncate">{selected.customer_name || '—'}</div>
                <div className="text-[11px] text-neutral-600 truncate">{selected.customer_phone}</div>
                {selected.customer_whatsapp && selected.customer_whatsapp !== selected.customer_phone && <div className="text-[11px] text-neutral-500 truncate">WA: {selected.customer_whatsapp}</div>}
                {selected.customer_email && <div className="text-[11px] text-neutral-500 truncate">{selected.customer_email}</div>}
              </InfoCard>
              <InfoCard icon={MapPin} title={selected.delivery_mode === 'livraison' ? 'Livraison' : 'Retrait'}>
                <div className="text-[11px] text-neutral-700 break-words">
                  {selected.delivery_mode === 'livraison' ? (selected.delivery_address || '—') : 'Retrait en boutique'}
                </div>
                {selected.delivery_fee > 0 && <div className="text-[10px] text-neutral-500 mt-0.5 num">Frais : {formatFCFA(selected.delivery_fee)}</div>}
              </InfoCard>
              <InfoCard icon={CreditCard} title="Paiement">
                <div className="text-[11px] font-semibold text-neutral-900 capitalize truncate">{selected.payment_mode.replace(/_/g, ' ')}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(Object.keys(PAYMENT_META) as PaymentStatus[]).map(p => (
                    <button key={p} onClick={() => updatePayment(p)}
                      className={`text-[9px] px-1.5 py-0.5 rounded-md border font-bold transition-colors ${selected.payment_status === p ? PAYMENT_META[p].cls + ' ring-1 ring-brand-600/30' : 'bg-white border-neutral-200 text-neutral-500 hover:bg-neutral-50'}`}>
                      {PAYMENT_META[p].label}
                    </button>
                  ))}
                </div>
              </InfoCard>
            </div>

            {selected.customer_note && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-900">
                <span className="font-bold">Note client : </span>{selected.customer_note}
              </div>
            )}

            {/* Articles — item cards instead of table */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1.5 flex items-center gap-1">
                <Package className="w-3 h-3" />
                Articles ({items.length})
              </div>
              <div className="rounded-xl bg-white border border-neutral-200 overflow-hidden">
                {detailLoading ? (
                  <div className="p-4 text-xs text-slate-500 text-center">Chargement…</div>
                ) : items.length === 0 ? (
                  <div className="p-4 text-xs text-slate-500 text-center">Aucun article.</div>
                ) : (
                  <div className="divide-y divide-neutral-100">
                    {items.map(it => (
                      <div key={it.id} className="p-2.5 flex items-start gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-neutral-100 flex items-center justify-center shrink-0 mt-0.5">
                          <Package className="w-3.5 h-3.5 text-neutral-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-semibold text-neutral-900 leading-snug break-words">{it.article_name}</div>
                          {it.internal_ref && <div className="text-[10px] font-mono text-neutral-400 mt-0.5">{it.internal_ref}</div>}
                          <div className="text-[10px] text-neutral-500 font-medium mt-0.5">
                            Qté <span className="font-bold text-neutral-700 num">{it.quantity}</span>
                            {' · '}
                            PU <span className="font-bold text-neutral-700 num">{formatFCFA(it.unit_price)}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[13px] font-extrabold text-neutral-900 num whitespace-nowrap">{formatFCFA(it.line_total)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Totals */}
                {!detailLoading && items.length > 0 && (
                  <div className="bg-neutral-50/80 border-t border-neutral-100 p-2.5 space-y-1">
                    {selected.subtotal > 0 && selected.subtotal !== selected.total && (
                      <div className="flex items-center justify-between text-[11px] text-neutral-600">
                        <span className="font-semibold">Sous-total</span>
                        <span className="num font-bold whitespace-nowrap">{formatFCFA(selected.subtotal)}</span>
                      </div>
                    )}
                    {selected.delivery_fee > 0 && (
                      <div className="flex items-center justify-between text-[11px] text-neutral-600">
                        <span className="font-semibold">Livraison</span>
                        <span className="num font-bold whitespace-nowrap">{formatFCFA(selected.delivery_fee)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-1 border-t border-neutral-200/60">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Total</span>
                      <span className="text-[16px] font-extrabold text-neutral-900 num whitespace-nowrap">{formatFCFA(selected.total)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Historique — premium timeline */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1.5 flex items-center gap-1">
                <Clock className="w-3 h-3" /> Historique
              </div>
              <div className="rounded-xl bg-white border border-neutral-200 p-2.5">
                {history.length === 0 ? (
                  <div className="text-xs text-neutral-400 text-center py-1">—</div>
                ) : (
                  <div className="relative pl-4">
                    <div className="absolute left-[5px] top-1 bottom-1 w-px bg-neutral-200" />
                    {history.map((h) => (
                      <div key={h.id} className="relative pb-2 last:pb-0">
                        <div className={`absolute -left-4 top-0.5 w-[11px] h-[11px] rounded-full border-2 border-white ${STATUS_META[h.new_status as OrderStatus]?.dot || 'bg-slate-400'}`} />
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] text-neutral-800">
                              {h.old_status ? <span className="text-neutral-400">{STATUS_META[h.old_status as OrderStatus]?.label || h.old_status} → </span> : null}
                              <span className="font-bold">{STATUS_META[h.new_status as OrderStatus]?.label || h.new_status}</span>
                            </div>
                            {h.note && <div className="text-[10px] text-neutral-500 mt-0.5 break-words">{h.note}</div>}
                          </div>
                          <div className="text-[10px] text-neutral-400 font-semibold whitespace-nowrap shrink-0">{formatDateTime(h.created_at)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl bg-neutral-50/60 border border-neutral-200 p-2.5 text-[10px] text-neutral-600 flex items-start gap-1.5">
              <FileText className="w-3 h-3 shrink-0 mt-0.5 text-neutral-400" />
              <div>
                <span className="font-bold">Réservation stock non active.</span> Le stock est décrémenté uniquement lors de la transformation en vente.
              </div>
            </div>
          </div>
        )}
      </DocPanel>

      <ConfirmDialog open={confirmCancel} onClose={() => setConfirmCancel(false)} onConfirm={doCancel}
        title="Annuler la commande" message="Confirmer l'annulation de cette commande ?" confirmLabel="Annuler la commande" danger />
    </div>
  );
}

function nextStatus(s: OrderStatus): OrderStatus | null {
  const idx = STATUS_FLOW.indexOf(s);
  if (idx < 0 || idx >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[idx + 1];
}

function StatusChip({ label, value, active, onClick, dot, neutral }: {
  label: string; value: number; active: boolean; onClick: () => void; dot?: string; neutral?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1.5 px-1.5 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? 'text-brand-700'
          : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {dot && !active && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      <span>{label}</span>
      <span className={`num font-extrabold ${active ? 'text-brand-700' : 'text-slate-800'}`}>{value}</span>
    </button>
  );
}

function InfoCard({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-neutral-50/60 border border-neutral-200/70 p-2">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold text-neutral-500 mb-1">
        <Icon className="w-3 h-3" /> {title}
      </div>
      {children}
    </div>
  );
}

function escapeHtml(s: string): string {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export default OnlineOrders;
