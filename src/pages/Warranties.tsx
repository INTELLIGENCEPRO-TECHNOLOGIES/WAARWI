import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  Filter, RefreshCw, Printer, Download, Search,
  X, Eye, FileText, Copy, Clock, ShieldCheck, Smartphone, Store, User, Calendar,
  CheckCircle, AlertTriangle, XCircle, Minus, Ban, Loader2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { formatFCFA } from '../lib/format';
import { printWarrantyCertificate, buildPrintTenantForSite, computeWarrantyExpiry } from '../lib/print';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import { SearchableSelect } from '../components/SearchableSelect';

type WarrantyEntry = {
  id: string;
  sale_number: string;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  imei: string | null;
  warranty: string | null;
  delivery_date: string | null;
  representative: string | null;
  total: number;
  status: string;
  site_id: string | null;
  site_name: string | null;
  user_name: string | null;
  warranty_cancelled?: boolean;
  warranty_cancelled_at?: string | null;
  warranty_cancelled_reason?: string | null;
  warranty_status?: WarrantyStatus;
  expiration_date?: string | null;
  items?: { name: string; quantity: number; unit_price: number }[];
};

const PAGE_SIZE = 50;

type WarrantyStatus = 'active' | 'expiring' | 'expired' | 'none' | 'cancelled';

function parseWarrantyDuration(warranty: string | null): number | null {
  if (!warranty) return null;
  const lower = warranty.toLowerCase().trim();
  const numMatch = lower.match(/^(\d+)/);
  if (!numMatch) return null;
  const num = parseInt(numMatch[1], 10);
  if (lower.includes('an') || lower.includes('year')) return num * 365;
  if (lower.includes('mois') || lower.includes('month')) return num * 30;
  if (lower.includes('jour') || lower.includes('day')) return num;
  if (lower.includes('semaine') || lower.includes('week')) return num * 7;
  return num * 30;
}

function getWarrantyStatus(saleDate: string, warranty: string | null, cancelled?: boolean): WarrantyStatus {
  if (cancelled) return 'cancelled';
  if (!warranty || warranty.trim() === '') return 'none';
  const days = parseWarrantyDuration(warranty);
  if (days === null) return 'active';
  const end = new Date(saleDate);
  end.setDate(end.getDate() + days);
  const now = new Date();
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 30) return 'expiring';
  return 'active';
}

function getExpirationDate(saleDate: string, warranty: string | null): string | null {
  if (!warranty) return null;
  const days = parseWarrantyDuration(warranty);
  if (days === null) return null;
  const end = new Date(saleDate);
  end.setDate(end.getDate() + days);
  return end.toLocaleDateString('fr-FR');
}

function getDaysLeft(saleDate: string, warranty: string | null): number | null {
  if (!warranty) return null;
  const days = parseWarrantyDuration(warranty);
  if (days === null) return null;
  const end = new Date(saleDate);
  end.setDate(end.getDate() + days);
  return Math.ceil((end.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
}

const STATUS_CONFIG: Record<WarrantyStatus, { label: string; cls: string; icon: typeof CheckCircle }> = {
  active: { label: 'Active', cls: 'text-emerald-600', icon: CheckCircle },
  expiring: { label: 'Expire bientôt', cls: 'text-amber-600', icon: AlertTriangle },
  expired: { label: 'Expirée', cls: 'text-neutral-500', icon: XCircle },
  none: { label: 'Sans garantie', cls: 'text-neutral-400', icon: Minus },
  cancelled: { label: 'Annulée', cls: 'text-red-600', icon: Ban },
};

export function Warranties() {
  const { tenant, currentSite } = useApp();
  const { success, error } = useToast();
  const [entries, setEntries] = useState<WarrantyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [serverStats, setServerStats] = useState<Record<string, number>>({});
  const [siteOptions, setSiteOptions] = useState<{ id: string; name: string }[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<WarrantyStatus | ''>('');
  const [filterSite, setFilterSite] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [detailEntry, setDetailEntry] = useState<WarrantyEntry | null>(null);
  const [cancelModal, setCancelModal] = useState<WarrantyEntry | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [warrantyTerms, setWarrantyTerms] = useState('');

  // Debounce search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(globalSearch.trim()), 250);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [globalSearch]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [debouncedSearch, filterStatus, filterSite, filterDateFrom, filterDateTo, tenant?.id]);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setLoadError(null);
    const myReqId = ++reqIdRef.current;

    // Load warranty terms in parallel
    const termsPromise = supabase
      .from('document_settings')
      .select('warranty_terms')
      .eq('tenant_id', tenant.id)
      .eq('doc_type', 'invoice')
      .maybeSingle();

    const params: Record<string, unknown> = {
      p_tenant_id: tenant.id,
      p_page: page,
      p_page_size: PAGE_SIZE,
    };
    if (filterSite) params.p_site_id = filterSite;
    if (debouncedSearch) params.p_search = debouncedSearch;
    if (filterStatus) params.p_status_filter = filterStatus;
    if (filterDateFrom) {
      const f = new Date(filterDateFrom); f.setHours(0, 0, 0, 0);
      params.p_date_from = f.toISOString();
    }
    if (filterDateTo) {
      const t = new Date(filterDateTo); t.setHours(0, 0, 0, 0);
      t.setDate(t.getDate() + 1);
      params.p_date_to = t.toISOString();
    }

    const [{ data, error: rpcErr }, { data: settingsData }] = await Promise.all([
      supabase.rpc('rpc_paginated_warranties', params),
      termsPromise,
    ]);
    if (myReqId !== reqIdRef.current) return;

    if (settingsData?.warranty_terms) setWarrantyTerms(settingsData.warranty_terms);

    if (rpcErr || !data) {
      setLoadError(rpcErr?.message || 'Impossible de charger les garanties');
      setEntries([]); setTotalCount(0); setServerStats({}); setSiteOptions([]);
      setLoading(false);
      return;
    }

    const rows: WarrantyEntry[] = ((data.rows || []) as any[]).map((r: any) => ({
      ...r,
      total: Number(r.total),
    }));
    setEntries(rows);
    setTotalCount(data.total_count || 0);
    setServerStats(data.stats || {});
    setSiteOptions(data.site_options || []);
    setLoadError(null);
    setLoading(false);
  }, [tenant?.id, page, debouncedSearch, filterStatus, filterSite, filterDateFrom, filterDateTo]);

  useEffect(() => { load(); }, [load]);

  const filtered = entries;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const copyImei = (imei: string) => {
    navigator.clipboard.writeText(imei);
    success('IMEI copié');
  };

  const cancelWarranty = async () => {
    if (!cancelModal || !tenant) return;
    setCancelling(true);
    const { data: saleData } = await supabase
      .from('sales')
      .select('doc_header')
      .eq('id', cancelModal.id)
      .single();

    const currentHeader = saleData?.doc_header || {};
    const updatedHeader = {
      ...currentHeader,
      warranty_cancelled: true,
      warranty_cancelled_at: new Date().toISOString(),
      warranty_cancelled_reason: cancelReason || 'Annulation manuelle',
    };

    const { error: e } = await supabase
      .from('sales')
      .update({ doc_header: updatedHeader })
      .eq('id', cancelModal.id);

    setCancelling(false);
    if (e) {
      error("Erreur lors de l'annulation");
      return;
    }
    success('Garantie annulée');
    setCancelModal(null);
    setCancelReason('');
    load();
  };

  const printCertificate = async (entry: WarrantyEntry) => {
    if (!tenant) return;
    let items = entry.items;
    if (!items || items.length === 0) {
      const { data } = await supabase.from('sale_items').select('name, quantity, unit_price').eq('sale_id', entry.id);
      items = (data || []).map((i: any) => ({ name: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price) }));
    }
    const ws = (entry.warranty_status as WarrantyStatus) || getWarrantyStatus(entry.created_at, entry.warranty, entry.warranty_cancelled);
    const expiry = entry.warranty ? computeWarrantyExpiry(entry.created_at, entry.warranty) : '';
    printWarrantyCertificate({
      tenant: buildPrintTenantForSite(tenant, currentSite),
      saleNumber: entry.sale_number,
      saleDate: entry.created_at,
      customerName: entry.customer_name || 'Client comptoir',
      customerPhone: entry.customer_phone || undefined,
      imei: entry.imei,
      warrantyDuration: entry.warranty || '',
      expirationDate: expiry,
      items,
      total: entry.total,
      warrantyTerms: warrantyTerms || undefined,
      representative: entry.representative,
      siteName: entry.site_name,
      status: ws as any,
    });
  };

  const exportCsv = async () => {
    if (!tenant) return;
    const headers = ['Date vente', 'Facture', 'Client', 'Téléphone', 'IMEI', 'Garantie', 'Expiration', 'Statut garantie', 'Magasin', 'Vendeur'];
    const allRows: string[][] = [];
    let pg = 1;
    const batchSize = 200;
    while (true) {
      const params: Record<string, unknown> = {
        p_tenant_id: tenant.id, p_page: pg, p_page_size: batchSize,
      };
      if (filterSite) params.p_site_id = filterSite;
      if (debouncedSearch) params.p_search = debouncedSearch;
      if (filterStatus) params.p_status_filter = filterStatus;
      if (filterDateFrom) { const f = new Date(filterDateFrom); f.setHours(0,0,0,0); params.p_date_from = f.toISOString(); }
      if (filterDateTo) { const t = new Date(filterDateTo); t.setHours(0,0,0,0); t.setDate(t.getDate()+1); params.p_date_to = t.toISOString(); }
      const { data: batch } = await supabase.rpc('rpc_paginated_warranties', params);
      if (!batch?.rows?.length) break;
      for (const e of batch.rows as any[]) {
        const ws = e.warranty_status || getWarrantyStatus(e.created_at, e.warranty, e.warranty_cancelled);
        allRows.push([
          new Date(e.created_at).toLocaleDateString('fr-FR'),
          e.sale_number, e.customer_name || '', e.customer_phone || '',
          e.imei || '', e.warranty || '',
          e.expiration_date ? new Date(e.expiration_date).toLocaleDateString('fr-FR') : (getExpirationDate(e.created_at, e.warranty) || ''),
          STATUS_CONFIG[ws as WarrantyStatus]?.label || ws,
          e.site_name || '', e.user_name || '',
        ]);
      }
      if ((batch.rows as any[]).length < batchSize) break;
      pg++;
    }
    const csv = [headers.join(';'), ...allRows.map(r => r.join(';'))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `garanties_imei_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = serverStats;

  return (
    <div className="space-y-3 pb-6">
      {/* ── Header premium unifié ────────── */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-4 sm:px-5 lg:px-8 pb-3 pt-4 -mt-3 sm:-mt-4 lg:-mt-6 bg-white space-y-3 border-b border-neutral-100">
        <h1 className="text-lg font-bold text-neutral-900 leading-tight">Garanties & IMEI</h1>
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-neutral-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <input
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              placeholder="Rechercher IMEI, facture, client, téléphone…"
              className="w-input-ul w-full text-sm py-1.5"
            />
          </div>
          {globalSearch && (
            <button onClick={() => setGlobalSearch('')} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600">
              <X className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => setPickerOpen(true)} className={`shrink-0 inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors ${filterStatus || filterSite || filterDateFrom || filterDateTo ? 'text-brand-700' : 'text-neutral-500 hover:text-neutral-700'}`}>
            <Filter className="w-4 h-4" />
            <span className="hidden md:inline">Filtres</span>
          </button>
          <button onClick={load} className="shrink-0 p-1.5 text-neutral-400 hover:text-neutral-600 transition-colors" title="Actualiser">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={exportCsv} className="shrink-0 p-1.5 text-neutral-400 hover:text-neutral-600 transition-colors" title="Exporter">
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

        {/* Stats - minimalist dividers, no card */}
        {!loading && !loadError && totalCount > 0 && (
          <div className="flex items-stretch border-b border-neutral-200 pb-3">
            <div className="flex-1 px-2 first:pl-0">
              <p className="text-[10px] text-neutral-500 mb-0.5">Garanties actives</p>
              <p className="text-base font-bold text-emerald-600 tabular-nums">{stats.active || 0}</p>
            </div>
            <div className="w-px bg-neutral-200" />
            <div className="flex-1 px-2">
              <p className="text-[10px] text-neutral-500 mb-0.5">Expirent bientôt</p>
              <p className="text-base font-bold text-amber-600 tabular-nums">{stats.expiring || 0}</p>
            </div>
            <div className="w-px bg-neutral-200" />
            <div className="flex-1 px-2">
              <p className="text-[10px] text-neutral-500 mb-0.5">Expirées</p>
              <p className="text-base font-bold text-neutral-900 tabular-nums">{stats.expired || 0}</p>
            </div>
            <div className="w-px bg-neutral-200" />
            <div className="flex-1 px-2 last:pr-0">
              <p className="text-[10px] text-neutral-500 mb-0.5">Annulées</p>
              <p className="text-base font-bold text-red-600 tabular-nums">{stats.cancelled || 0}</p>
            </div>
          </div>
        )}

        {/* Premium date range picker + filters modal */}
        <PremiumDateRangePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          from={filterDateFrom}
          to={filterDateTo}
          onApply={(f, t) => { setFilterDateFrom(f); setFilterDateTo(t); setPickerOpen(false); }}
          onReset={() => { setFilterStatus(''); setFilterSite(''); }}
          extraFilters={
            <>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-black mb-1.5 block">Statut garantie</label>
                <SearchableSelect
                  noBorder
                  searchable={false}
                  placeholder="Tous"
                  value={filterStatus}
                  onChange={v => setFilterStatus(v as any)}
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'expiring', label: 'Expire bientôt' },
                    { value: 'expired', label: 'Expirée' },
                    { value: 'cancelled', label: 'Annulée' },
                    { value: 'none', label: 'Sans garantie' },
                  ]}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-black mb-1.5 block">Magasin</label>
                <SearchableSelect
                  noBorder
                  searchable={false}
                  placeholder="Tous"
                  value={filterSite}
                  onChange={setFilterSite}
                  options={siteOptions.map(s => ({ value: s.id, label: s.name }))}
                />
              </div>
            </>
          }
        />

        {/* Active filter chips */}
        {(filterStatus || filterSite || filterDateFrom || filterDateTo) && (
          <div className="flex items-center gap-2 flex-wrap text-[10px] font-bold uppercase tracking-wider">
            {filterDateFrom && <span className="shrink-0 text-slate-600 num">Du {new Date(filterDateFrom).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>}
            {filterDateTo && <span className="shrink-0 text-slate-600 num">Au {new Date(filterDateTo).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>}
            {filterStatus && <span className="shrink-0 text-brand-700">{STATUS_CONFIG[filterStatus as WarrantyStatus]?.label || filterStatus}</span>}
            {filterSite && <span className="shrink-0 text-brand-700">{siteOptions.find(s => s.id === filterSite)?.name || filterSite}</span>}
            <button onClick={() => { setFilterStatus(''); setFilterSite(''); setFilterDateFrom(''); setFilterDateTo(''); }} className="shrink-0 text-slate-400 hover:text-slate-600 inline-flex items-center gap-1 transition-all">
              <X className="w-3 h-3" />Réinitialiser
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-5 h-5 animate-spin text-neutral-300" />
          </div>
        )}

        {/* Error state */}
        {!loading && loadError && (
          <div className="py-12 flex flex-col items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            <p className="text-sm text-neutral-700 font-semibold">Chargement impossible</p>
            <p className="text-xs text-neutral-500 max-w-xs text-center">{loadError}</p>
            <button onClick={() => load()} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> Réessayer
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !loadError && filtered.length === 0 && (
          <div className="text-center py-16">
            <Smartphone className="w-8 h-8 text-neutral-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-neutral-600">Aucun enregistrement</p>
            <p className="text-[12px] text-neutral-400 mt-1">Les factures avec IMEI ou garantie apparaîtront ici.</p>
          </div>
        )}

        {/* Desktop table */}
        {!loading && filtered.length > 0 && (
          <>
            <div className="hidden md:block">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-neutral-200">
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Date</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Facture</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Client</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">IMEI</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Garantie</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Expiration</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Statut</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filtered.map(entry => {
                    const ws = (entry.warranty_status as WarrantyStatus) || getWarrantyStatus(entry.created_at, entry.warranty, entry.warranty_cancelled);
                    const cfg = STATUS_CONFIG[ws];
                    const Icon = cfg.icon;
                    const expiry = getExpirationDate(entry.created_at, entry.warranty);
                    const daysLeft = getDaysLeft(entry.created_at, entry.warranty);
                    return (
                      <tr key={entry.id} className="hover:bg-neutral-50/50 transition-colors">
                        <td className="px-3 py-2.5 text-[12px] text-neutral-700 tabular-nums">{new Date(entry.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                        <td className="px-3 py-2.5 text-[12px] font-semibold text-neutral-900">{entry.sale_number}</td>
                        <td className="px-3 py-2.5">
                          <div className="text-[12px] font-medium text-neutral-800 truncate max-w-[140px]">{entry.customer_name || '-'}</div>
                          {entry.customer_phone && <div className="text-[10px] text-neutral-400">{entry.customer_phone}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-[12px] font-mono text-neutral-800">{entry.imei || '-'}</td>
                        <td className="px-3 py-2.5 text-[12px] text-neutral-700">{entry.warranty || '-'}</td>
                        <td className="px-3 py-2.5">
                          {expiry ? (
                            <div>
                              <div className="text-[12px] text-neutral-800 tabular-nums">{expiry}</div>
                              {daysLeft !== null && daysLeft >= 0 && ws !== 'cancelled' && (
                                <div className="text-[10px] text-neutral-400">{daysLeft} jour{daysLeft !== 1 ? 's' : ''} restant{daysLeft !== 1 ? 's' : ''}</div>
                              )}
                            </div>
                          ) : <span className="text-[12px] text-neutral-400">-</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-semibold ${cfg.cls}`}>
                            <Icon className="w-2.5 h-2.5 shrink-0" />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setDetailEntry(entry)} title="Voir détails" className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 hover:text-neutral-800 transition-colors">
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            {entry.warranty && (
                              <button onClick={() => printCertificate(entry)} title="Imprimer fiche garantie" className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 hover:text-neutral-800 transition-colors">
                                <Printer className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {entry.imei && (
                              <button onClick={() => copyImei(entry.imei!)} title="Copier IMEI" className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 hover:text-neutral-800 transition-colors">
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 py-3">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-600 hover:text-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" /> Précédent
                </button>
                <span className="text-[11px] text-neutral-500 num">{page} / {totalPages}</span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-600 hover:text-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Suivant <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Mobile list - no cards, dividers only */}
            <div className="md:hidden divide-y divide-neutral-100">
              {filtered.map(entry => {
                const ws = (entry.warranty_status as WarrantyStatus) || getWarrantyStatus(entry.created_at, entry.warranty, entry.warranty_cancelled);
                const cfg = STATUS_CONFIG[ws];
                const Icon = cfg.icon;
                const expiry = getExpirationDate(entry.created_at, entry.warranty);
                return (
                  <div key={entry.id} className="py-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="text-[12px] font-bold text-neutral-900">{entry.sale_number}</div>
                        <div className="text-[11px] text-neutral-500">{new Date(entry.created_at).toLocaleDateString('fr-FR')}</div>
                      </div>
                      <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[9px] font-semibold shrink-0 ${cfg.cls}`}>
                        <Icon className="w-2.5 h-2.5 shrink-0" />
                        {cfg.label}
                      </span>
                    </div>
                    <div className="space-y-1 text-[11px]">
                      {entry.customer_name && (
                        <div className="flex items-center gap-1.5">
                          <User className="w-3 h-3 text-neutral-400 shrink-0" />
                          <span className="text-neutral-700 font-medium">{entry.customer_name}</span>
                        </div>
                      )}
                      {entry.imei && (
                        <div className="flex items-center gap-1.5">
                          <Smartphone className="w-3 h-3 text-neutral-400 shrink-0" />
                          <span className="text-neutral-800 font-mono">{entry.imei}</span>
                        </div>
                      )}
                      {entry.warranty && (
                        <div className="flex items-center gap-1.5">
                          <ShieldCheck className="w-3 h-3 text-neutral-400 shrink-0" />
                          <span className="text-neutral-700">{entry.warranty}</span>
                        </div>
                      )}
                      {expiry && (
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-neutral-400 shrink-0" />
                          <span className="text-neutral-600">Expire le {expiry}</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-2 pt-2 border-t border-neutral-100 flex items-center justify-between">
                      <span className="text-[10px] text-neutral-400">{entry.site_name}</span>
                      <div className="flex items-center gap-2">
                        {entry.warranty && (
                          <button onClick={() => printCertificate(entry)} className="text-[11px] font-semibold text-neutral-600 hover:text-neutral-900 transition-colors inline-flex items-center gap-0.5">
                            <Printer className="w-3 h-3" />
                          </button>
                        )}
                        <button onClick={() => setDetailEntry(entry)} className="btn-icon" title="Détails">
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Detail modal */}
        {detailEntry && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center animate-fade-in">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setDetailEntry(null)} />
            <div className="relative w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Détail Garantie / IMEI</div>
                  <div className="text-sm font-bold text-neutral-900 mt-0.5">{detailEntry.sale_number}</div>
                </div>
                <button onClick={() => setDetailEntry(null)} className="w-8 h-8 rounded-lg bg-neutral-100 hover:bg-neutral-200 flex items-center justify-center transition-colors">
                  <X className="w-4 h-4 text-neutral-600" />
                </button>
              </div>
              <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
                <DetailRow icon={Calendar} label="Date de vente" value={new Date(detailEntry.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} />
                {detailEntry.delivery_date && <DetailRow icon={Calendar} label="Date de livraison" value={new Date(detailEntry.delivery_date).toLocaleDateString('fr-FR')} />}
                <DetailRow icon={User} label="Client" value={detailEntry.customer_name || 'Non renseigné'} />
                {detailEntry.customer_phone && <DetailRow icon={User} label="Téléphone client" value={detailEntry.customer_phone} />}
                {detailEntry.imei && <DetailRow icon={Smartphone} label="IMEI / Téléphone" value={detailEntry.imei} mono />}
                {detailEntry.warranty && <DetailRow icon={ShieldCheck} label="Durée de garantie" value={detailEntry.warranty} />}
                {detailEntry.warranty && (
                  <DetailRow icon={Clock} label="Date d'expiration" value={getExpirationDate(detailEntry.created_at, detailEntry.warranty) || 'Non calculable'} />
                )}
                {detailEntry.warranty && (() => {
                  const dl = getDaysLeft(detailEntry.created_at, detailEntry.warranty);
                  if (dl === null) return null;
                  return <DetailRow icon={Clock} label="Jours restants" value={dl > 0 ? `${dl} jour${dl > 1 ? 's' : ''}` : dl === 0 ? "Expire aujourd'hui" : `Expirée depuis ${Math.abs(dl)} jour${Math.abs(dl) > 1 ? 's' : ''}`} />;
                })()}
                {detailEntry.representative && <DetailRow icon={User} label="Représentant" value={detailEntry.representative} />}
                {detailEntry.site_name && <DetailRow icon={Store} label="Magasin" value={detailEntry.site_name} />}
                {detailEntry.user_name && <DetailRow icon={User} label="Vendeur" value={detailEntry.user_name} />}
                <DetailRow icon={FileText} label="Montant facture" value={formatFCFA(detailEntry.total)} />
                {detailEntry.warranty_cancelled && detailEntry.warranty_cancelled_at && (
                  <DetailRow icon={Ban} label="Annulée le" value={new Date(detailEntry.warranty_cancelled_at).toLocaleDateString('fr-FR')} />
                )}
                {detailEntry.warranty_cancelled && detailEntry.warranty_cancelled_reason && (
                  <DetailRow icon={Ban} label="Motif d'annulation" value={detailEntry.warranty_cancelled_reason} />
                )}
                <div className="pt-2 border-t border-neutral-100">
                  <div className="text-[10px] font-semibold text-neutral-500 mb-1">Statut garantie</div>
                  {(() => {
                    const ws = getWarrantyStatus(detailEntry.created_at, detailEntry.warranty, detailEntry.warranty_cancelled);
                    const cfg = STATUS_CONFIG[ws];
                    const Icon = cfg.icon;
                    return (
                      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold ${cfg.cls}`}>
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        {cfg.label}
                      </span>
                    );
                  })()}
                </div>
              </div>
              <div className="px-5 py-3 border-t border-neutral-100 flex flex-wrap items-center gap-2">
                {detailEntry.warranty && !detailEntry.warranty_cancelled && (
                  <button onClick={() => printCertificate(detailEntry)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 bg-white text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors">
                    <Printer className="w-3 h-3" /> Fiche garantie
                  </button>
                )}
                {detailEntry.imei && (
                  <button onClick={() => copyImei(detailEntry.imei!)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 bg-white text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors">
                    <Copy className="w-3 h-3" /> Copier IMEI
                  </button>
                )}
                {detailEntry.warranty && !detailEntry.warranty_cancelled && getWarrantyStatus(detailEntry.created_at, detailEntry.warranty) !== 'expired' && (
                  <button onClick={() => { setCancelModal(detailEntry); setDetailEntry(null); }} className="btn-icon-danger-solid" title="Annuler garantie">
                    <Ban className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => setDetailEntry(null)} className="ml-auto btn-icon" title="Fermer">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Cancel warranty modal */}
        {cancelModal && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center animate-fade-in">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => { setCancelModal(null); setCancelReason(''); }} />
            <div className="relative w-full max-w-sm mx-4 bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-100">
                <div className="flex items-center gap-2">
                  <Ban className="w-4 h-4 text-red-600 shrink-0" />
                  <div>
                    <div className="text-sm font-bold text-neutral-900">Annuler la garantie</div>
                    <div className="text-[11px] text-neutral-500">{cancelModal.sale_number}</div>
                  </div>
                </div>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="text-[12px] text-neutral-600">
                  Cette action annulera la garantie pour cet appareil. L'annulation sera définitive.
                </div>
                {cancelModal.imei && (
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-3.5 h-3.5 text-neutral-400" />
                    <span className="text-[12px] font-mono text-neutral-800">{cancelModal.imei}</span>
                  </div>
                )}
                <div>
                  <label className="text-[10px] font-semibold text-neutral-500 mb-1 block">Motif d'annulation</label>
                  <textarea
                    value={cancelReason}
                    onChange={e => setCancelReason(e.target.value)}
                    placeholder="Ex: Appareil endommagé par le client, garantie non applicable..."
                    rows={3}
                    className="bare-input w-full text-[12px] text-neutral-800 resize-none"
                  />
                </div>
              </div>
              <div className="px-5 py-3 border-t border-neutral-100 flex items-center gap-2">
                <button
                  onClick={() => { setCancelModal(null); setCancelReason(''); }}
                  className="btn-icon" title="Retour"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  onClick={cancelWarranty}
                  disabled={cancelling}
                  className="btn-icon-danger-solid" title="Confirmer l'annulation"
                >
                  {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

function DetailRow({ icon: Icon, label, value, mono }: { icon: typeof Calendar; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 py-2 border-b border-neutral-100 last:border-b-0">
      <Icon className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">{label}</div>
        <div className={`text-[13px] font-medium text-neutral-900 ${mono ? 'font-mono' : ''}`}>{value}</div>
      </div>
    </div>
  );
}
