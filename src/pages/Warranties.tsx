import { useEffect, useState, useMemo } from 'react';
import {
  Search, Filter, RefreshCw, Printer, Download, ChevronDown, ChevronUp,
  X, Eye, FileText, Copy, Clock, ShieldCheck, Smartphone, Store, User, Calendar,
  CheckCircle, AlertTriangle, XCircle, Minus, Ban,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { formatFCFA } from '../lib/format';
import { printWarrantyCertificate, buildPrintTenantForSite, computeWarrantyExpiry } from '../lib/print';

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
  site_name: string | null;
  user_name: string | null;
  warranty_cancelled?: boolean;
  warranty_cancelled_at?: string | null;
  warranty_cancelled_reason?: string | null;
  items?: { name: string; quantity: number; unit_price: number }[];
};

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
  active: { label: 'Active', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: CheckCircle },
  expiring: { label: 'Expire bientôt', cls: 'bg-amber-50 text-amber-800 border-amber-200', icon: AlertTriangle },
  expired: { label: 'Expirée', cls: 'bg-neutral-100 text-neutral-600 border-neutral-200', icon: XCircle },
  none: { label: 'Sans garantie', cls: 'bg-neutral-50 text-neutral-500 border-neutral-200', icon: Minus },
  cancelled: { label: 'Annulée', cls: 'bg-red-50 text-red-700 border-red-200', icon: Ban },
};

export function Warranties() {
  const { tenant, currentSite, sites, profile } = useApp();
  const { success, error } = useToast();
  const [entries, setEntries] = useState<WarrantyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalSearch, setGlobalSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterStatus, setFilterStatus] = useState<WarrantyStatus | ''>('');
  const [filterSite, setFilterSite] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [detailEntry, setDetailEntry] = useState<WarrantyEntry | null>(null);
  const [cancelModal, setCancelModal] = useState<WarrantyEntry | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [warrantyTerms, setWarrantyTerms] = useState('');

  const load = async () => {
    if (!tenant) return;
    setLoading(true);
    const [{ data, error: e }, { data: settingsData }] = await Promise.all([
      supabase
        .from('sales')
        .select('id, sale_number, created_at, total, status, customer_id, site_id, user_id, doc_header, customers(name, phone), sites(name), sale_items(name, quantity, unit_price)')
        .eq('tenant_id', tenant.id)
        .not('doc_header', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('document_settings')
        .select('warranty_terms')
        .eq('tenant_id', tenant.id)
        .eq('doc_type', 'invoice')
        .maybeSingle(),
    ]);

    if (e) {
      error('Erreur de chargement');
      setLoading(false);
      return;
    }

    if (settingsData?.warranty_terms) {
      setWarrantyTerms(settingsData.warranty_terms);
    }

    const userIds = [...new Set((data || []).map((s: any) => s.user_id).filter(Boolean))];
    let userMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);
      if (profiles) {
        userMap = Object.fromEntries(profiles.map((p: any) => [p.id, p.full_name || '']));
      }
    }

    const rows: WarrantyEntry[] = (data || [])
      .filter((s: any) => {
        const dh = s.doc_header;
        return dh && (dh.imei || dh.warranty);
      })
      .map((s: any) => ({
        id: s.id,
        sale_number: s.sale_number,
        created_at: s.created_at,
        customer_name: s.customers?.name || null,
        customer_phone: s.customers?.phone || null,
        imei: s.doc_header?.imei || null,
        warranty: s.doc_header?.warranty || null,
        delivery_date: s.doc_header?.delivery_date || null,
        representative: s.doc_header?.representative || null,
        total: Number(s.total),
        status: s.status,
        site_name: s.sites?.name || null,
        user_name: userMap[s.user_id] || null,
        warranty_cancelled: s.doc_header?.warranty_cancelled || false,
        warranty_cancelled_at: s.doc_header?.warranty_cancelled_at || null,
        warranty_cancelled_reason: s.doc_header?.warranty_cancelled_reason || null,
        items: (s.sale_items || []).map((i: any) => ({ name: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price) })),
      }));

    setEntries(rows);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenant?.id]);

  const filtered = useMemo(() => {
    let list = entries;

    if (globalSearch.trim()) {
      const q = globalSearch.toLowerCase();
      list = list.filter(e =>
        (e.imei && e.imei.toLowerCase().includes(q)) ||
        (e.sale_number && e.sale_number.toLowerCase().includes(q)) ||
        (e.customer_name && e.customer_name.toLowerCase().includes(q)) ||
        (e.customer_phone && e.customer_phone.includes(q)) ||
        (e.warranty && e.warranty.toLowerCase().includes(q)) ||
        (e.representative && e.representative.toLowerCase().includes(q))
      );
    }

    if (filterStatus) {
      list = list.filter(e => getWarrantyStatus(e.created_at, e.warranty, e.warranty_cancelled) === filterStatus);
    }

    if (filterSite) {
      list = list.filter(e => e.site_name === filterSite);
    }

    if (filterDateFrom) {
      list = list.filter(e => e.created_at >= filterDateFrom);
    }
    if (filterDateTo) {
      list = list.filter(e => e.created_at.slice(0, 10) <= filterDateTo);
    }

    return list;
  }, [entries, globalSearch, filterStatus, filterSite, filterDateFrom, filterDateTo]);

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

  const printCertificate = (entry: WarrantyEntry) => {
    if (!tenant) return;
    const ws = getWarrantyStatus(entry.created_at, entry.warranty, entry.warranty_cancelled);
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
      items: entry.items,
      total: entry.total,
      warrantyTerms: warrantyTerms || undefined,
      representative: entry.representative,
      siteName: entry.site_name,
      status: ws as any,
    });
  };

  const exportCsv = () => {
    const headers = ['Date vente', 'Facture', 'Client', 'Téléphone', 'IMEI', 'Garantie', 'Expiration', 'Statut garantie', 'Magasin', 'Vendeur'];
    const rows = filtered.map(e => [
      new Date(e.created_at).toLocaleDateString('fr-FR'),
      e.sale_number,
      e.customer_name || '',
      e.customer_phone || '',
      e.imei || '',
      e.warranty || '',
      getExpirationDate(e.created_at, e.warranty) || '',
      STATUS_CONFIG[getWarrantyStatus(e.created_at, e.warranty, e.warranty_cancelled)].label,
      e.site_name || '',
      e.user_name || '',
    ]);
    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `garanties_imei_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const siteNames = useMemo(() => [...new Set(entries.map(e => e.site_name).filter(Boolean))], [entries]);

  const stats = useMemo(() => {
    const active = entries.filter(e => getWarrantyStatus(e.created_at, e.warranty, e.warranty_cancelled) === 'active').length;
    const expiring = entries.filter(e => getWarrantyStatus(e.created_at, e.warranty, e.warranty_cancelled) === 'expiring').length;
    const expired = entries.filter(e => getWarrantyStatus(e.created_at, e.warranty, e.warranty_cancelled) === 'expired').length;
    const cancelled = entries.filter(e => getWarrantyStatus(e.created_at, e.warranty, e.warranty_cancelled) === 'cancelled').length;
    return { active, expiring, expired, cancelled };
  }, [entries]);

  return (
    <div className="w-full bg-white min-h-screen">
      <div className="px-4 sm:px-6 pt-5 pb-24 max-w-6xl mx-auto">
        {/* Search bar with title inside - like Articles page */}
        <div className="flex items-center gap-1.5 px-2.5 pr-1.5 py-1.5 rounded-2xl bg-white border border-neutral-200 shadow-sm focus-within:border-neutral-400 focus-within:ring-2 focus-within:ring-neutral-900/10 transition-all mb-4">
          <div className="flex items-center gap-2 pr-2.5 border-r border-neutral-200 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-neutral-900 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <div className="leading-tight hidden sm:block">
              <h1 className="text-sm font-bold tracking-tight text-neutral-900 leading-none">Garanties & IMEI</h1>
              <div className="text-[9px] font-semibold tracking-wider uppercase text-neutral-400 leading-none mt-0.5">Registre</div>
            </div>
          </div>
          <Search className="w-3.5 h-3.5 text-neutral-400 shrink-0 ml-1" />
          <input
            value={globalSearch}
            onChange={e => setGlobalSearch(e.target.value)}
            placeholder="Rechercher IMEI, facture, client, téléphone..."
            className="flex-1 min-w-0 w-0 bg-transparent text-xs focus:outline-none placeholder:text-neutral-400"
          />
          {globalSearch && (
            <button onClick={() => setGlobalSearch('')} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Action buttons row - fully responsive */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button onClick={() => setShowFilters(!showFilters)} className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border text-[12px] font-semibold transition-colors ${showFilters ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-300'}`}>
            <Filter className="w-3.5 h-3.5" />
            <span>Filtres</span>
            {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <button onClick={load} className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-neutral-200 bg-white text-neutral-700 text-[12px] font-semibold hover:border-neutral-300 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Actualiser</span>
          </button>
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-neutral-200 bg-white text-neutral-700 text-[12px] font-semibold hover:border-neutral-300 transition-colors">
            <Download className="w-3.5 h-3.5" />
            <span>Exporter</span>
          </button>
        </div>

        {/* Single stats card - IPM "Créances" style */}
        {!loading && entries.length > 0 && (
          <div className="bg-white rounded-xl border border-neutral-200 p-4 mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">Suivi garanties</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-[10px] text-neutral-500 mb-0.5">Garanties actives</p>
                <p className="text-base font-bold text-emerald-600 tabular-nums">{stats.active}</p>
              </div>
              <div>
                <p className="text-[10px] text-neutral-500 mb-0.5">Expirent bientôt</p>
                <p className="text-base font-bold text-amber-600 tabular-nums">{stats.expiring}</p>
              </div>
              <div>
                <p className="text-[10px] text-neutral-500 mb-0.5">Expirées</p>
                <p className="text-base font-bold text-neutral-900 tabular-nums">{stats.expired}</p>
              </div>
              <div>
                <p className="text-[10px] text-neutral-500 mb-0.5">Annulées</p>
                <p className="text-base font-bold text-red-600 tabular-nums">{stats.cancelled}</p>
              </div>
            </div>
          </div>
        )}

        {/* Filters panel */}
        {showFilters && (
          <div className="mb-4 p-3 rounded-xl border border-neutral-200 bg-neutral-50/50 space-y-2.5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="text-[10px] font-semibold text-neutral-500 mb-1 block">Statut garantie</label>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="w-full h-8 rounded-lg border border-neutral-200 bg-white text-[12px] text-neutral-800 px-2 outline-none">
                  <option value="">Tous</option>
                  <option value="active">Active</option>
                  <option value="expiring">Expire bientôt</option>
                  <option value="expired">Expirée</option>
                  <option value="cancelled">Annulée</option>
                  <option value="none">Sans garantie</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-neutral-500 mb-1 block">Magasin</label>
                <select value={filterSite} onChange={e => setFilterSite(e.target.value)} className="w-full h-8 rounded-lg border border-neutral-200 bg-white text-[12px] text-neutral-800 px-2 outline-none">
                  <option value="">Tous</option>
                  {siteNames.map(s => <option key={s} value={s!}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-neutral-500 mb-1 block">Date du</label>
                <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="w-full h-8 rounded-lg border border-neutral-200 bg-white text-[12px] text-neutral-800 px-2 outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-neutral-500 mb-1 block">Date au</label>
                <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="w-full h-8 rounded-lg border border-neutral-200 bg-white text-[12px] text-neutral-800 px-2 outline-none" />
              </div>
            </div>
            {(filterStatus || filterSite || filterDateFrom || filterDateTo) && (
              <button onClick={() => { setFilterStatus(''); setFilterSite(''); setFilterDateFrom(''); setFilterDateTo(''); }} className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-800 transition-colors">
                Effacer les filtres
              </button>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-5 h-5 animate-spin text-neutral-300" />
          </div>
        )}

        {/* Empty state */}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-16">
            <Smartphone className="w-8 h-8 text-neutral-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-neutral-600">Aucun enregistrement</p>
            <p className="text-[12px] text-neutral-400 mt-1">Les factures avec IMEI ou garantie apparaîtront ici.</p>
          </div>
        )}

        {/* Desktop table */}
        {!loading && filtered.length > 0 && (
          <>
            <div className="hidden md:block border border-neutral-200 rounded-xl overflow-hidden bg-white">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50/60">
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
                    const ws = getWarrantyStatus(entry.created_at, entry.warranty, entry.warranty_cancelled);
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
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${cfg.cls}`}>
                            <Icon className="w-2.5 h-2.5" />
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

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {filtered.map(entry => {
                const ws = getWarrantyStatus(entry.created_at, entry.warranty, entry.warranty_cancelled);
                const cfg = STATUS_CONFIG[ws];
                const Icon = cfg.icon;
                const expiry = getExpirationDate(entry.created_at, entry.warranty);
                return (
                  <div key={entry.id} className="border border-neutral-200 rounded-xl bg-white p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="text-[12px] font-bold text-neutral-900">{entry.sale_number}</div>
                        <div className="text-[11px] text-neutral-500">{new Date(entry.created_at).toLocaleDateString('fr-FR')}</div>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-semibold shrink-0 ${cfg.cls}`}>
                        <Icon className="w-2.5 h-2.5" />
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
                        <button onClick={() => setDetailEntry(entry)} className="text-[11px] font-semibold text-neutral-600 hover:text-neutral-900 transition-colors inline-flex items-center gap-0.5">
                          Détails <Eye className="w-3 h-3" />
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
                <div className="pt-2">
                  <div className="text-[10px] font-semibold text-neutral-500 mb-1">Statut garantie</div>
                  {(() => {
                    const ws = getWarrantyStatus(detailEntry.created_at, detailEntry.warranty, detailEntry.warranty_cancelled);
                    const cfg = STATUS_CONFIG[ws];
                    const Icon = cfg.icon;
                    return (
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-semibold ${cfg.cls}`}>
                        <Icon className="w-3.5 h-3.5" />
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
                  <button onClick={() => { setCancelModal(detailEntry); setDetailEntry(null); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-[11px] font-semibold text-red-700 hover:bg-red-100 transition-colors">
                    <Ban className="w-3 h-3" /> Annuler garantie
                  </button>
                )}
                <button onClick={() => setDetailEntry(null)} className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-neutral-900 text-white text-[11px] font-semibold hover:bg-neutral-800 transition-colors">
                  Fermer
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
                  <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                    <Ban className="w-4 h-4 text-red-600" />
                  </div>
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
                  <div className="flex items-center gap-2 px-3 py-2 bg-neutral-50 rounded-lg border border-neutral-200">
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
                    className="w-full rounded-xl border border-neutral-200 bg-white text-[12px] text-neutral-800 px-3 py-2 outline-none focus:border-neutral-400 transition-colors resize-none"
                  />
                </div>
              </div>
              <div className="px-5 py-3 border-t border-neutral-100 flex items-center gap-2">
                <button
                  onClick={() => { setCancelModal(null); setCancelReason(''); }}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-neutral-200 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors"
                >
                  Retour
                </button>
                <button
                  onClick={cancelWarranty}
                  disabled={cancelling}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white text-[12px] font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {cancelling ? 'Annulation...' : "Confirmer l'annulation"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value, mono }: { icon: typeof Calendar; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="w-7 h-7 rounded-lg bg-neutral-50 border border-neutral-200 flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-3.5 h-3.5 text-neutral-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">{label}</div>
        <div className={`text-[13px] font-medium text-neutral-900 ${mono ? 'font-mono' : ''}`}>{value}</div>
      </div>
    </div>
  );
}
