import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Users, Truck, Loader2, CreditCard as Edit2, PowerOff,
  X, Calendar, FileText, Wallet, Info, ChevronRight, Phone,
  ShoppingBag, Check, Filter, Printer, Tag, Trash2,
  Download, Upload, Scale, RotateCcw
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { SearchableSelect } from '../components/SearchableSelect';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import { formatFCFA, formatDateTime, formatDate } from '../lib/format';
import { desktopAutoFocus } from '../lib/device';
import { consumeNavContext } from '../lib/navHighlight';
import { printDocumentA4, buildPrintTenantForSite, type PrintTenant } from '../lib/print';
import { DocItems, DocTotals, DocPayments, DocSlimHeader } from '../components/DocLayout';
import type { DocItem, DocPayment } from '../components/DocLayout';
import type { Customer } from '../lib/types';
import { CollapsibleSection, FormField, ValidatedInput } from '../components/FormPrimitives';
import { useTranslation } from 'react-i18next';

type Supplier = {
  id: string; tenant_id: string; name: string; contact: string;
  phone: string; whatsapp: string; email: string; address: string; country: string;
  delivery_days: number; payment_terms: string; credit_limit: number; credit_blocked: boolean; is_active: boolean;
  balance: number;
};

type TabKey = 'customers' | 'suppliers';
type CustomerOptionKey = 'info' | 'payment' | 'docs' | 'pricing' | null;
type SupplierOptionKey = 'info' | 'payment' | 'docs' | 'articles' | null;

export function Tiers() {
  const { tenant, currentSite, sites, profile, dataTick } = useApp();
  const { can } = usePermissions();
  const { t } = useTranslation();
  const { success, error } = useToast();
  const sharedCustomers = (tenant as any)?.settings?.shared_customers !== false;
  const sharedSuppliers = (tenant as any)?.settings?.shared_suppliers !== false;
  const [tab, setTab] = useState<TabKey>('customers');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [dueMap, setDueMap] = useState<Record<string, number>>({});
  const [paidMap, setPaidMap] = useState<Record<string, number>>({});
  const [totalMap, setTotalMap] = useState<Record<string, number>>({});
  const [supDueMap, setSupDueMap] = useState<Record<string, { total: number; paid: number; due: number }>>({});
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('');

  // Create / edit
  const [custOpen, setCustOpen] = useState(false);
  const [custEdit, setCustEdit] = useState<Customer | null>(null);
  const [custForm, setCustForm] = useState<any>({});
  const [custErrors, setCustErrors] = useState<Record<string, string>>({});
  const [custTouched, setCustTouched] = useState<Record<string, boolean>>({});
  const [supOpen, setSupOpen] = useState(false);
  const [supEdit, setSupEdit] = useState<Supplier | null>(null);
  const [supForm, setSupForm] = useState<Partial<Supplier>>({});
  const [supErrors, setSupErrors] = useState<Record<string, string>>({});
  const [supTouched, setSupTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [toDeactivateCust, setToDeactivateCust] = useState<Customer | null>(null);
  const [toDeactivateSup, setToDeactivateSup] = useState<Supplier | null>(null);

  // FAB
  const [fabOpen, setFabOpen] = useState(false);

  // Options sheet (click on a tier row/card)
  const [optCust, setOptCust] = useState<Customer | null>(null);
  const [optSup, setOptSup] = useState<Supplier | null>(null);

  // Sub-modal selection
  const [custView, setCustView] = useState<{ c: Customer; key: CustomerOptionKey } | null>(null);
  const [supView, setSupView] = useState<{ s: Supplier; key: SupplierOptionKey } | null>(null);

  const load = async (silent = false) => {
    if (!tenant) return;
    if (!silent) setLoading(true);
    let custQuery = supabase.from('customers').select('id, name, phone, email, address, customer_type, whatsapp, is_active, tenant_id, site_id, credit_limit, balance').eq('tenant_id', tenant.id).order('name');
    if (!sharedCustomers && currentSite) {
      custQuery = custQuery.eq('site_id', currentSite.id);
    }
    let supQuery = supabase.from('suppliers').select('id, name, phone, email, address, whatsapp, is_active, tenant_id, site_id, balance, credit_limit').eq('tenant_id', tenant.id).order('name');
    if (!sharedSuppliers && currentSite) {
      supQuery = supQuery.eq('site_id', currentSite.id);
    }
    const [cRes, sRes, salesRes, soRes, supPayRes] = await Promise.all([
      custQuery,
      supQuery,
      supabase.from('sales').select('customer_id, total, paid, status').eq('tenant_id', tenant.id).not('customer_id', 'is', null).neq('status', 'cancelled').limit(5000),
      supabase.from('supplier_orders').select('supplier_id, total, paid, status').eq('tenant_id', tenant.id).neq('status', 'cancelled').limit(5000),
      supabase.from('supplier_payments').select('supplier_id, amount').eq('tenant_id', tenant.id).limit(5000),
    ]);
    setCustomers((cRes.data || []) as any);
    setSuppliers((sRes.data || []) as any);

    const dm: Record<string, number> = {};
    const pm: Record<string, number> = {};
    const tm: Record<string, number> = {};
    (salesRes.data || []).forEach((s: any) => {
      const due = Math.max(0, Number(s.total) - Number(s.paid));
      if (s.customer_id) {
        tm[s.customer_id] = (tm[s.customer_id] || 0) + Number(s.total);
        pm[s.customer_id] = (pm[s.customer_id] || 0) + Number(s.paid);
        if (due > 0) dm[s.customer_id] = (dm[s.customer_id] || 0) + due;
      }
    });
    setDueMap(dm); setPaidMap(pm); setTotalMap(tm);

    const sm: Record<string, { total: number; paid: number; due: number }> = {};
    (soRes.data || []).forEach((o: any) => {
      if (!o.supplier_id) return;
      if (!sm[o.supplier_id]) sm[o.supplier_id] = { total: 0, paid: 0, due: 0 };
      sm[o.supplier_id].total += Number(o.total) || 0;
      sm[o.supplier_id].paid += Number(o.paid) || 0;
    });
    // Add free payments (not linked to orders) to paid bucket
    (supPayRes.data || []).forEach((p: any) => {
      if (!sm[p.supplier_id]) sm[p.supplier_id] = { total: 0, paid: 0, due: 0 };
    });
    Object.keys(sm).forEach(k => { sm[k].due = Math.max(0, sm[k].total - sm[k].paid); });
    setSupDueMap(sm);

    if (!silent) setLoading(false);
  };
  useEffect(() => { load(); }, [tenant?.id, currentSite?.id, sharedCustomers, sharedSuppliers]);
  useEffect(() => { if (dataTick > 0) { const t = setTimeout(() => load(true), 400); return () => clearTimeout(t); } }, [dataTick]);

  const [flashTarget, setFlashTarget] = useState<'customers' | 'suppliers' | null>(null);
  useEffect(() => {
    const ctx = consumeNavContext();
    if (!ctx?.target) return;
    if (ctx.target === 'receivables' || ctx.target === 'customers') {
      setTab('customers');
      setFlashTarget('customers');
    } else if (ctx.target === 'payables' || ctx.target === 'suppliers') {
      setTab('suppliers');
      setFlashTarget('suppliers');
    }
    const t = setTimeout(() => setFlashTarget(null), 6800);
    return () => clearTimeout(t);
  }, []);

  // ── Filters ──────────────────────────────────────────────────
  const filteredCustomers = useMemo(() => {
    let r = customers;
    if (typeFilter) r = r.filter(c => c.customer_type === typeFilter);
    if (statusFilter === 'active') r = r.filter(c => (c as any).is_active !== false);
    if (statusFilter === 'inactive') r = r.filter(c => (c as any).is_active === false);
    const q = search.toLowerCase().trim();
    if (!q) return r;
    return r.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      ((c as any).whatsapp || '').includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.customer_type || '').toLowerCase().includes(q)
    );
  }, [customers, search, typeFilter, statusFilter]);

  const filteredSuppliers = useMemo(() => {
    let r = suppliers;
    if (statusFilter === 'active') r = r.filter(s => s.is_active);
    if (statusFilter === 'inactive') r = r.filter(s => !s.is_active);
    const q = search.toLowerCase().trim();
    if (!q) return r;
    return r.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.contact || '').toLowerCase().includes(q) ||
      (s.phone || '').includes(q) ||
      (s.email || '').toLowerCase().includes(q) ||
      (s.country || '').toLowerCase().includes(q)
    );
  }, [suppliers, search, statusFilter]);

  // ── CRUD: Customer ───────────────────────────────────────────
  const validateCustField = (field: string, val: any, _all: any): string | undefined => {
    switch (field) {
      case 'name':
        if (!val?.trim()) return t('tiers.nameRequired');
        break;
      case 'phone':
        if (val && !/^[+]?[\d\s()-]{6,}$/.test(String(val).trim())) return t('tiers.phoneInvalid', { defaultValue: 'Numéro invalide' });
        break;
      case 'email':
        if (val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val).trim())) return t('tiers.emailInvalid');
        break;
    }
    return undefined;
  };
  const validateCustAll = (): boolean => {
    const fields = ['name', 'phone', 'email'];
    const errs: Record<string, string> = {};
    let ok = true;
    for (const f of fields) {
      const e = validateCustField(f, custForm[f], custForm);
      if (e) { errs[f] = e; ok = false; }
    }
    setCustErrors(errs);
    setCustTouched(Object.fromEntries(fields.map(f => [f, true])));
    return ok;
  };
  const setCustField = (field: string, value: any) => {
    setCustForm((prev: any) => {
      const next = { ...prev, [field]: value };
      if (field === 'phone' && !prev.whatsapp) next.whatsapp = value;
      const blurOnlyFields = ['email', 'phone'];
      if (!blurOnlyFields.includes(field)) {
        const err = validateCustField(field, value, next);
        setCustErrors(pe => ({ ...pe, [field]: err || '' }));
      } else if (custTouched[field]) {
        const err = validateCustField(field, value, next);
        setCustErrors(pe => ({ ...pe, [field]: err || '' }));
      }
      return next;
    });
  };
  const openCustCreate = () => { setCustEdit(null); setCustForm({ customer_type: 'particulier', is_active: true }); setCustErrors({}); setCustTouched({}); setCustOpen(true); setFabOpen(false); };
  const openCustEdit = (c: Customer) => { setCustEdit(c); setCustForm(c); setCustErrors({}); setCustTouched({}); setCustOpen(true); };
  const saveCust = async () => {
    if (!validateCustAll()) { error(t('tiers.fixErrors')); return; }
    if (!can('manage_customers')) { error(t('tiers.noPermissionCustomers')); return; }
    if (!tenant) return;
    setSaving(true);
    const payload: any = {
      tenant_id: tenant.id, name: custForm.name.trim(), phone: custForm.phone || '',
      email: custForm.email || '', address: custForm.address || '',
      whatsapp: custForm.whatsapp || '',
      customer_type: custForm.customer_type || 'particulier',
      credit_limit: Number(custForm.credit_limit || 0),
      credit_blocked: custForm.credit_blocked === true,
      is_active: custEdit ? custForm.is_active !== false : true,
    };
    if (!sharedCustomers && currentSite && !custEdit) {
      payload.site_id = currentSite.id;
    }
    const { error: e } = custEdit
      ? await supabase.from('customers').update(payload).eq('id', custEdit.id)
      : await supabase.from('customers').insert(payload);
    setSaving(false);
    if (e) {
      const msg = e.message || '';
      error(msg.includes('Limite du plan') ? t('tiers.planLimitCustomers') : msg);
    } else { success(custEdit ? t('tiers.customerModified') : t('tiers.customerCreated')); setCustOpen(false); load(); }
  };
  const deactivateCust = async () => {
    if (!toDeactivateCust) return;
    if (!can('manage_customers')) { error('Vous n\'avez pas la permission de supprimer les clients'); return; }
    const { error: hardErr } = await supabase.rpc('tenant_delete_customer_safe', { p_id: toDeactivateCust.id });
    if (!hardErr) { success('Client supprimé définitivement'); setToDeactivateCust(null); load(); return; }
    const { error: e } = await supabase.from('customers').update({ is_active: false }).eq('id', toDeactivateCust.id);
    if (e) error(e.message);
    else { success('Client désactivé (opérations associées conservées)'); setToDeactivateCust(null); load(); }
  };

  const reactivateCust = async (c: Customer) => {
    if (!can('manage_customers')) { error('Vous n\'avez pas la permission'); return; }
    const { error: e } = await supabase.from('customers').update({ is_active: true }).eq('id', c.id);
    if (e) error(e.message);
    else { success('Client réactivé'); load(); }
  };

  // ── CRUD: Supplier ───────────────────────────────────────────
  const validateSupField = (field: string, val: any): string | undefined => {
    switch (field) {
      case 'name':
        if (!val?.trim()) return t('tiers.nameRequired');
        break;
      case 'phone':
        if (val && !/^[+]?[\d\s()-]{6,}$/.test(String(val).trim())) return t('tiers.phoneInvalid', { defaultValue: 'Numéro invalide' });
        break;
      case 'email':
        if (val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val).trim())) return t('tiers.emailInvalid');
        break;
    }
    return undefined;
  };
  const validateSupAll = (): boolean => {
    const fields = ['name', 'phone', 'email'];
    const errs: Record<string, string> = {};
    let ok = true;
    for (const f of fields) {
      const e = validateSupField(f, (supForm as any)[f]);
      if (e) { errs[f] = e; ok = false; }
    }
    setSupErrors(errs);
    setSupTouched(Object.fromEntries(fields.map(f => [f, true])));
    return ok;
  };
  const setSupField = (field: string, value: any) => {
    setSupForm((prev: any) => {
      const next = { ...prev, [field]: value };
      if (field === 'phone' && !prev.whatsapp) next.whatsapp = value;
      const blurOnlyFields = ['email', 'phone'];
      if (!blurOnlyFields.includes(field)) {
        const err = validateSupField(field, value);
        setSupErrors(pe => ({ ...pe, [field]: err || '' }));
      } else if (supTouched[field]) {
        const err = validateSupField(field, value);
        setSupErrors(pe => ({ ...pe, [field]: err || '' }));
      }
      return next;
    });
  };
  const openSupCreate = () => { setSupEdit(null); setSupForm({ country: 'Sénégal', is_active: true }); setSupErrors({}); setSupTouched({}); setSupOpen(true); setFabOpen(false); };
  const openSupEdit = (s: Supplier) => { setSupEdit(s); setSupForm(s); setSupErrors({}); setSupTouched({}); setSupOpen(true); };
  const saveSup = async () => {
    if (!validateSupAll()) { error(t('tiers.fixErrors')); return; }
    if (!can('manage_customers')) { error(t('tiers.noPermissionSuppliers')); return; }
    if (!tenant || !supForm.name?.trim()) { error(t('tiers.nameRequired')); return; }
    setSaving(true);
    const payload: any = {
      tenant_id: tenant.id, name: supForm.name.trim(), contact: supForm.contact || '',
      phone: supForm.phone || '', whatsapp: supForm.whatsapp || '', email: supForm.email || '',
      address: supForm.address || '', country: supForm.country || 'Sénégal',
      delivery_days: Number(supForm.delivery_days || 0),
      payment_terms: supForm.payment_terms || '',
      credit_limit: Number((supForm as any).credit_limit || 0),
      credit_blocked: (supForm as any).credit_blocked === true,
      is_active: supEdit ? supForm.is_active : true,
    };
    if (!sharedSuppliers && currentSite && !supEdit) {
      payload.site_id = currentSite.id;
    }
    const { error: e } = supEdit
      ? await supabase.from('suppliers').update(payload).eq('id', supEdit.id)
      : await supabase.from('suppliers').insert(payload);
    setSaving(false);
    if (e) {
      const msg = e.message || '';
      error(msg.includes('Limite du plan') ? 'Limite de fournisseurs atteinte pour votre plan. Mettez à niveau votre abonnement.' : msg);
    } else { success(supEdit ? t('tiers.supplierModified') : t('tiers.supplierCreated')); setSupOpen(false); load(); }
  };
  const deactivateSup = async () => {
    if (!toDeactivateSup) return;
    if (!can('manage_customers')) { error('Vous n\'avez pas la permission de supprimer les fournisseurs'); return; }
    const { error: hardErr } = await supabase.rpc('tenant_delete_supplier_safe', { p_id: toDeactivateSup.id });
    if (!hardErr) { success('Fournisseur supprimé définitivement'); setToDeactivateSup(null); load(); return; }
    const { error: e } = await supabase.from('suppliers').update({ is_active: false }).eq('id', toDeactivateSup.id);
    if (e) error(e.message);
    else { success('Fournisseur désactivé (opérations associées conservées)'); setToDeactivateSup(null); load(); }
  };

  const reactivateSup = async (s: Supplier) => {
    if (!can('manage_customers')) { error('Vous n\'avez pas la permission'); return; }
    const { error: e } = await supabase.from('suppliers').update({ is_active: true }).eq('id', s.id);
    if (e) error(e.message);
    else { success('Fournisseur réactivé'); load(); }
  };

  const activeCustCount = customers.filter(c => (c as any).is_active !== false).length;
  const activeSupCount = suppliers.filter(s => s.is_active).length;

  const [filtersOpen, setFiltersOpen] = useState(false);
  const hasFilters = !!(search || typeFilter || statusFilter);
  const clearFilters = () => { setSearch(''); setSearchInput(''); setTypeFilter(''); setStatusFilter(''); setFiltersOpen(false); };

  // Import / Export
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importFilename, setImportFilename] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);

  // Balance adjustment
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [balanceTarget, setBalanceTarget] = useState<{ id: string; name: string; type: 'customer' | 'supplier'; currentBalance: number } | null>(null);
  const [balanceAmount, setBalanceAmount] = useState('');
  const [balanceNote, setBalanceNote] = useState('');
  const [savingBalance, setSavingBalance] = useState(false);

  const CUST_HEADERS = [
    { key: 'nom', label: 'Nom *', required: true },
    { key: 'telephone', label: 'Téléphone', required: false },
    { key: 'whatsapp', label: 'WhatsApp', required: false },
    { key: 'email', label: 'Email', required: false },
    { key: 'adresse', label: 'Adresse', required: false },
    { key: 'type', label: 'Type', required: false },
    { key: 'plafond_credit', label: 'Plafond crédit', required: false },
    { key: 'solde', label: 'Solde comptable', required: false },
  ];
  const SUP_HEADERS = [
    { key: 'nom', label: 'Nom *', required: true },
    { key: 'contact', label: 'Contact', required: false },
    { key: 'telephone', label: 'Téléphone', required: false },
    { key: 'whatsapp', label: 'WhatsApp', required: false },
    { key: 'email', label: 'Email', required: false },
    { key: 'adresse', label: 'Adresse', required: false },
    { key: 'pays', label: 'Pays', required: false },
    { key: 'delai_livraison', label: 'Délai livraison (jours)', required: false },
    { key: 'conditions_paiement', label: 'Conditions de paiement', required: false },
    { key: 'plafond_credit', label: 'Plafond crédit', required: false },
    { key: 'solde', label: 'Solde comptable', required: false },
  ];

  const exportTiers = async () => {
    const XLSX = await import('xlsx');
    const headers = tab === 'customers' ? CUST_HEADERS : SUP_HEADERS;
    const headerRow = headers.map(h => h.label);

    let dataRows: any[][];
    if (tab === 'customers') {
      dataRows = filteredCustomers.map(c => [
        c.name || '', c.phone || '', (c as any).whatsapp || '', c.email || '',
        c.address || '', c.customer_type || 'particulier',
        Number((c as any).credit_limit || 0),
        Number((c as any).balance || 0),
      ]);
    } else {
      dataRows = filteredSuppliers.map(s => [
        s.name || '', s.contact || '', s.phone || '', s.whatsapp || '',
        s.email || '', s.address || '', s.country || 'Sénégal',
        Number(s.delivery_days || 0), s.payment_terms || '',
        Number(s.credit_limit || 0),
        Number((s as any).balance || 0),
      ]);
    }

    if (dataRows.length === 0) { error('Aucune donnée à exporter'); return; }

    const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    ws['!cols'] = headerRow.map(h => ({ wch: Math.max(16, h.length + 4) }));
    const wb = XLSX.utils.book_new();
    const sheetName = tab === 'customers' ? 'Clients' : 'Fournisseurs';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `export-${tab}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    success(`${dataRows.length} ${tab === 'customers' ? 'clients' : 'fournisseurs'} exportés`);
  };

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const headers = tab === 'customers' ? CUST_HEADERS : SUP_HEADERS;
    const headerRow = headers.map(h => h.label);
    const ws = XLSX.utils.aoa_to_sheet([headerRow]);
    ws['!cols'] = headerRow.map(h => ({ wch: Math.max(16, h.length + 4) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tab === 'customers' ? 'Clients' : 'Fournisseurs');
    XLSX.writeFile(wb, `modele-${tab}.xlsx`);
  };

  const handleImportFile = async (f: File) => {
    setImportFilename(f.name);
    const XLSX = await import('xlsx');
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) { error('Fichier vide'); return; }
    const sheet = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '', raw: false });

    const headers = tab === 'customers' ? CUST_HEADERS : SUP_HEADERS;
    const labelToKey = new Map<string, string>();
    headers.forEach(h => {
      const norm = h.label.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_').replace(/_+$/, '').replace(/^_+/, '');
      labelToKey.set(norm, h.key);
      labelToKey.set(h.key, h.key);
    });

    const parsed = raw.map(r => {
      const row: any = {};
      for (const k of Object.keys(r)) {
        const norm = k.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_').replace(/_+$/, '').replace(/^_+/, '');
        const key = labelToKey.get(norm) || norm;
        row[key] = String(r[k] ?? '').trim();
      }
      return row;
    }).filter(r => r.nom);

    if (parsed.length === 0) { error('Aucune ligne valide trouvée (colonne "Nom" obligatoire)'); return; }
    setImportRows(parsed);
    setImportResult(null);
  };

  const runImport = async () => {
    if (!tenant || importRows.length === 0) return;
    setImporting(true);
    const errors: string[] = [];
    let created = 0, updated = 0;

    if (tab === 'customers') {
      for (const row of importRows) {
        const payload: any = {
          tenant_id: tenant.id,
          name: row.nom,
          phone: row.telephone || '',
          whatsapp: row.whatsapp || '',
          email: row.email || '',
          address: row.adresse || '',
          customer_type: row.type || 'particulier',
          credit_limit: Number(row.plafond_credit || 0),
        };
        if (!sharedCustomers && currentSite) payload.site_id = currentSite.id;
        const balanceVal = Number(row.solde || 0);

        const { data: existing } = await supabase.from('customers')
          .select('id').eq('tenant_id', tenant.id).eq('name', row.nom).maybeSingle();

        if (existing) {
          const updatePayload: any = { ...payload };
          delete updatePayload.tenant_id;
          if (balanceVal) updatePayload.balance = balanceVal;
          const { error: e } = await supabase.from('customers').update(updatePayload).eq('id', existing.id);
          if (e) errors.push(`${row.nom}: ${e.message}`);
          else updated++;
        } else {
          if (balanceVal) payload.balance = balanceVal;
          const { error: e } = await supabase.from('customers').insert(payload);
          if (e) errors.push(`${row.nom}: ${e.message}`);
          else created++;
        }
      }
    } else {
      for (const row of importRows) {
        const payload: any = {
          tenant_id: tenant.id,
          name: row.nom,
          contact: row.contact || '',
          phone: row.telephone || '',
          whatsapp: row.whatsapp || '',
          email: row.email || '',
          address: row.adresse || '',
          country: row.pays || 'Sénégal',
          delivery_days: Number(row.delai_livraison || 0),
          payment_terms: row.conditions_paiement || '',
          credit_limit: Number(row.plafond_credit || 0),
        };
        if (!sharedSuppliers && currentSite) payload.site_id = currentSite.id;
        const balanceVal = Number(row.solde || 0);

        const { data: existing } = await supabase.from('suppliers')
          .select('id').eq('tenant_id', tenant.id).eq('name', row.nom).maybeSingle();

        if (existing) {
          const updatePayload: any = { ...payload };
          delete updatePayload.tenant_id;
          if (balanceVal) updatePayload.balance = balanceVal;
          const { error: e } = await supabase.from('suppliers').update(updatePayload).eq('id', existing.id);
          if (e) errors.push(`${row.nom}: ${e.message}`);
          else updated++;
        } else {
          if (balanceVal) payload.balance = balanceVal;
          const { error: e } = await supabase.from('suppliers').insert(payload);
          if (e) errors.push(`${row.nom}: ${e.message}`);
          else created++;
        }
      }
    }

    setImportResult({ created, updated, errors });
    setImporting(false);
    if (errors.length === 0) success(`Import terminé: ${created} créés, ${updated} mis à jour`);
    else error(`Import partiel: ${errors.length} erreur(s)`);
    load();
  };

  const openBalanceAdjust = (id: string, name: string, type: 'customer' | 'supplier', currentBalance: number) => {
    setBalanceTarget({ id, name, type, currentBalance });
    setBalanceAmount(String(currentBalance));
    setBalanceNote('');
    setBalanceOpen(true);
  };

  const saveBalance = async () => {
    if (!balanceTarget || !tenant) return;
    setSavingBalance(true);
    const table = balanceTarget.type === 'customer' ? 'customers' : 'suppliers';
    const newBalance = Number(balanceAmount || 0);
    const adjustment = newBalance - balanceTarget.currentBalance;
    const { error: e } = await supabase.from(table).update({ balance: newBalance }).eq('id', balanceTarget.id);
    if (!e) {
      await supabase.from('balance_adjustments').insert({
        tenant_id: tenant.id,
        entity_type: balanceTarget.type,
        entity_id: balanceTarget.id,
        previous_balance: balanceTarget.currentBalance,
        new_balance: newBalance,
        amount: adjustment,
        note: balanceNote || 'Report de solde',
        user_id: profile?.id || null,
      });
    }
    setSavingBalance(false);
    if (e) error(e.message);
    else {
      success(`Solde de "${balanceTarget.name}" positionné à ${formatFCFA(newBalance)}`);
      setBalanceOpen(false);
      setBalanceTarget(null);
      load();
    }
  };

  return (
    <div className="space-y-3 pb-6">
      {/* ── Embedded header: title + search + filter trigger (like Billing) ── */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 pb-3 pt-3 sm:pt-4 lg:pt-6 -mt-3 sm:-mt-4 lg:-mt-6 bg-slate-50/95 backdrop-blur-sm space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
            <div className="flex items-center gap-2 pr-2 border-r border-slate-200 shrink-0">
              <div className="leading-tight">
                <h1 className="text-sm font-bold tracking-tight text-slate-900 leading-none">Gestion des tiers</h1>
                <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400 leading-none mt-0.5 hidden sm:block">Clients &amp; fournisseurs</div>
                <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400 leading-none mt-0.5 sm:hidden">Tiers</div>
              </div>
            </div>
            <input
              value={searchInput}
              onChange={e => { setSearchInput(e.target.value); if (searchTimerRef.current) clearTimeout(searchTimerRef.current); searchTimerRef.current = setTimeout(() => setSearch(e.target.value), 250); }}
              placeholder="Nom, téléphone, email, pays…"
              className="flex-1 min-w-0 w-0 bg-transparent text-xs focus:outline-none placeholder:text-slate-400"
            />
            {searchInput && (
              <button onClick={() => { setSearchInput(''); setSearch(''); }} className="shrink-0 p-1 text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => setFiltersOpen(v => !v)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${
                (typeFilter || statusFilter)
                  ? 'bg-brand-50 text-brand-700 border border-brand-200'
                  : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Filtres</span>
            </button>
            <button
              onClick={() => setFabOpen(v => !v)}
              className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center shadow-glow hover:shadow-premium active:scale-95 transition-all"
              style={{ background: 'linear-gradient(135deg, #0f766e 0%, #064e3b 100%)' }}
              aria-label="Nouveau tiers"
            >
              <Plus className="w-3.5 h-3.5 text-white" />
            </button>
        </div>
      </div>

      {/* ── Tabs + action buttons ── */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {[
            { k: 'customers' as TabKey, l: 'Clients', c: activeCustCount, Icon: Users },
            { k: 'suppliers' as TabKey, l: 'Fournisseurs', c: activeSupCount, Icon: Truck },
          ].map(t => {
            const active = tab === t.k;
            const Icon = t.Icon;
            return (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold transition-all active:scale-95 ${
                  active
                    ? 'bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-glow border border-transparent'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-brand-300 hover:text-brand-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.l}
                <span className={`num px-1.5 py-0.5 rounded-md text-[10px] font-bold ${active ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>{t.c}</span>
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <button
              onClick={exportTiers}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-semibold bg-white text-slate-600 border border-slate-200 hover:border-emerald-300 hover:text-emerald-700 transition-all"
              title="Exporter en Excel"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Exporter</span>
            </button>
            <button
              onClick={() => { setImportRows([]); setImportFilename(''); setImportResult(null); setImportExportOpen(true); }}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-semibold bg-white text-slate-600 border border-slate-200 hover:border-blue-300 hover:text-blue-700 transition-all"
              title="Importer depuis Excel"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Importer</span>
            </button>
            <button
              onClick={() => { setBalanceTarget(null); setBalanceOpen(true); }}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-semibold bg-white text-slate-600 border border-slate-200 hover:border-amber-300 hover:text-amber-700 transition-all"
              title="Positionner un solde"
            >
              <Scale className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Solde</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Filter chips panel (expandable) ── */}
      {filtersOpen && (
        <div className="card p-2.5 flex flex-col sm:flex-row gap-2 animate-slide-down">
          {tab === 'customers' && (
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input sm:w-44">
              <option value="">Tous types</option>
              <option value="particulier">Particulier</option>
              <option value="professionnel">Professionnel</option>
              <option value="garage">Garage</option>
              <option value="revendeur">Revendeur</option>
              <option value="societe">Société</option>
              <option value="administration">Administration</option>
            </select>
          )}
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="input sm:w-40">
            <option value="">Tous statuts</option>
            <option value="active">Actif</option>
            <option value="inactive">Inactif</option>
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 hover:bg-slate-100">
              <X className="w-3.5 h-3.5" />Réinitialiser
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="card py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : (
        <div className="space-y-3">
          {tab === 'customers' && (
            <section className={flashTarget === 'customers' ? 'waarwi-flash waarwi-flash-scroll' : ''}>
              <CustomerList
                list={filteredCustomers} total={customers.length}
                dueMap={dueMap} paidMap={paidMap} totalMap={totalMap}
                onCreate={openCustCreate}
                onClickRow={c => setOptCust(c)}
              />
            </section>
          )}

          {tab === 'suppliers' && (
            <section className={flashTarget === 'suppliers' ? 'waarwi-flash waarwi-flash-scroll' : ''}>
              <SupplierList
                list={filteredSuppliers} total={suppliers.length}
                dueMap={supDueMap}
                onCreate={openSupCreate}
                onClickRow={s => setOptSup(s)}
              />
            </section>
          )}
        </div>
      )}

      {/* FAB */}
      <div className="fixed bottom-20 right-4 z-30">
        {fabOpen && (
          <div className="absolute bottom-16 right-0 flex flex-col gap-2 animate-slide-down">
            <button onClick={openCustCreate} className="flex items-center gap-2 pr-4 pl-2 py-2 rounded-full bg-white border border-slate-200 shadow-premium text-sm font-semibold text-slate-800 whitespace-nowrap">
              <span className="w-8 h-8 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><Users className="w-4 h-4" /></span>
              Nouveau client
            </button>
            <button onClick={openSupCreate} className="flex items-center gap-2 pr-4 pl-2 py-2 rounded-full bg-white border border-slate-200 shadow-premium text-sm font-semibold text-slate-800 whitespace-nowrap">
              <span className="w-8 h-8 rounded-full bg-neutral-50 text-neutral-700 flex items-center justify-center shrink-0"><Truck className="w-4 h-4" /></span>
              Nouveau fournisseur
            </button>
          </div>
        )}
        <button onClick={() => setFabOpen(v => !v)} className={`w-14 h-14 rounded-full bg-brand-700 text-white shadow-glow flex items-center justify-center transition-transform ${fabOpen ? 'rotate-45' : ''}`}>
          <Plus className="w-6 h-6" />
        </button>
      </div>

      {/* Customer form */}
      <Modal open={custOpen} onClose={() => setCustOpen(false)} title={custEdit ? t('tiers.editCustomer') : t('tiers.addCustomer')}
        size="md"
        footer={<>
          <button onClick={() => setCustOpen(false)} className="btn-secondary">{t('common.cancel')}</button>
          <button onClick={saveCust} disabled={saving} className="btn-primary">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}
          </button>
        </>}>
        <div className="space-y-4">
          <CollapsibleSection title={t('tiers.identity')} subtitle={t('tiers.identitySubtitle')}>
            <ValidatedInput
              label={t('tiers.name')}
              required
              full
              value={custForm.name || ''}
              onChange={v => setCustField('name', v)}
              onBlur={() => setCustTouched(prev => ({ ...prev, name: true }))}
              error={custErrors.name}
              touched={custTouched.name}
              placeholder={t('tiers.name')}
              autoFocus={desktopAutoFocus}
            />
            <FormField label={t('tiers.type')}>
              <select value={custForm.customer_type || 'particulier'} onChange={e => setCustField('customer_type', e.target.value)} className="input">
                <option value="particulier">{t('tiers.customerType.particulier')}</option>
                <option value="professionnel">{t('tiers.customerType.professionnel')}</option>
                <option value="garage">{t('tiers.customerType.garage')}</option>
                <option value="revendeur">{t('tiers.customerType.revendeur')}</option>
                <option value="societe">{t('tiers.customerType.societe')}</option>
                <option value="administration">{t('tiers.customerType.administration')}</option>
              </select>
            </FormField>
            {custEdit && (
              <FormField label={t('tiers.status')}>
                <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-200 cursor-pointer">
                  <input type="checkbox" checked={custForm.is_active !== false} onChange={e => setCustForm((f: any) => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4" />
                  <span className="text-sm">{t('common.active')}</span>
                </label>
              </FormField>
            )}
          </CollapsibleSection>
          <CollapsibleSection title={t('tiers.contact')} subtitle={t('tiers.contactSubtitle')}>
            <ValidatedInput
              label={t('tiers.phone')}
              value={custForm.phone || ''}
              onChange={v => setCustField('phone', v)}
              onBlur={() => { setCustTouched(prev => ({ ...prev, phone: true })); const err = validateCustField('phone', custForm.phone, custForm); setCustErrors(pe => ({ ...pe, phone: err || '' })); }}
              error={custErrors.phone}
              touched={custTouched.phone}
              placeholder={t('tiers.phonePlaceholder')}
              hint={t('tiers.phoneHint')}
            />
            <ValidatedInput
              label={t('tiers.whatsapp')}
              value={custForm.whatsapp || ''}
              onChange={v => setCustField('whatsapp', v)}
              placeholder={t('tiers.phonePlaceholder')}
            />
            <ValidatedInput
              label={t('tiers.email')}
              full
              type="email"
              value={custForm.email || ''}
              onChange={v => setCustField('email', v)}
              onBlur={() => { setCustTouched(prev => ({ ...prev, email: true })); const err = validateCustField('email', custForm.email, custForm); setCustErrors(pe => ({ ...pe, email: err || '' })); }}
              error={custErrors.email}
              touched={custTouched.email}
            />
            <ValidatedInput
              label={t('tiers.address')}
              full
              value={custForm.address || ''}
              onChange={v => setCustField('address', v)}
            />
          </CollapsibleSection>
          <CollapsibleSection title={t('tiers.credit')} subtitle={t('tiers.creditSubtitle')} defaultOpen={!!custEdit}>
            <FormField label={t('tiers.creditLimit')} hint={t('tiers.creditLimitHint')}>
              <input type="number" min={0} value={custForm.credit_limit || ''} onChange={e => setCustField('credit_limit', Number(e.target.value))} className="input" placeholder={t('tiers.creditLimitHint')} />
            </FormField>
            <FormField label={t('tiers.blockCredit')}>
              <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-200 cursor-pointer">
                <input type="checkbox" checked={custForm.credit_blocked === true} onChange={e => setCustField('credit_blocked', e.target.checked)} className="w-4 h-4" />
                <span className="text-sm text-slate-700">{t('tiers.blockCreditCustomer')}</span>
              </label>
            </FormField>
          </CollapsibleSection>
        </div>
      </Modal>

      {/* Supplier form */}
      <Modal open={supOpen} onClose={() => setSupOpen(false)} title={supEdit ? t('tiers.editSupplier') : t('tiers.addSupplier')}
        size="md"
        footer={<>
          <button onClick={() => setSupOpen(false)} className="btn-secondary">{t('common.cancel')}</button>
          <button onClick={saveSup} disabled={saving} className="btn-primary">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}
          </button>
        </>}>
        <div className="space-y-4">
          <CollapsibleSection title={t('tiers.identity')} subtitle={t('tiers.identitySubtitle')}>
            <ValidatedInput
              label={t('tiers.name')}
              required
              full
              value={supForm.name || ''}
              onChange={v => setSupField('name', v)}
              onBlur={() => setSupTouched(prev => ({ ...prev, name: true }))}
              error={supErrors.name}
              touched={supTouched.name}
              placeholder={t('tiers.name')}
              autoFocus={desktopAutoFocus}
            />
            <ValidatedInput
              label={t('tiers.contactPerson')}
              value={supForm.contact || ''}
              onChange={v => setSupField('contact', v)}
            />
            <ValidatedInput
              label={t('tiers.country')}
              value={supForm.country || 'Sénégal'}
              onChange={v => setSupField('country', v)}
            />
          </CollapsibleSection>
          <CollapsibleSection title={t('tiers.contact')} subtitle={t('tiers.contactSubtitle')}>
            <ValidatedInput
              label={t('tiers.phone')}
              value={supForm.phone || ''}
              onChange={v => setSupField('phone', v)}
              onBlur={() => { setSupTouched(prev => ({ ...prev, phone: true })); const err = validateSupField('phone', supForm.phone); setSupErrors(pe => ({ ...pe, phone: err || '' })); }}
              error={supErrors.phone}
              touched={supTouched.phone}
              placeholder="+221 33 000 00 00"
              hint={t('tiers.phoneHint')}
            />
            <ValidatedInput
              label={t('tiers.whatsapp')}
              value={supForm.whatsapp || ''}
              onChange={v => setSupField('whatsapp', v)}
              placeholder={t('tiers.phonePlaceholder')}
            />
            <ValidatedInput
              label={t('tiers.email')}
              full
              type="email"
              value={supForm.email || ''}
              onChange={v => setSupField('email', v)}
              onBlur={() => { setSupTouched(prev => ({ ...prev, email: true })); const err = validateSupField('email', supForm.email); setSupErrors(pe => ({ ...pe, email: err || '' })); }}
              error={supErrors.email}
              touched={supTouched.email}
            />
            <ValidatedInput
              label={t('tiers.address')}
              full
              value={supForm.address || ''}
              onChange={v => setSupField('address', v)}
            />
          </CollapsibleSection>
          <CollapsibleSection title={t('tiers.commercialTerms')} subtitle={t('tiers.commercialTermsSubtitle')} defaultOpen={!!supEdit}>
            <FormField label={t('tiers.deliveryDays')}>
              <input type="number" value={supForm.delivery_days ?? ''} onChange={e => setSupField('delivery_days', Number(e.target.value))} className="input" min={0} />
            </FormField>
            <FormField label={t('tiers.paymentTerms')}>
              <input value={supForm.payment_terms || ''} onChange={e => setSupField('payment_terms', e.target.value)} className="input" placeholder={t('tiers.paymentTermsPlaceholder')} />
            </FormField>
            <FormField label={t('tiers.creditLimit')} hint={t('tiers.creditLimitHint')}>
              <input type="number" min={0} value={(supForm as any).credit_limit || ''} onChange={e => setSupField('credit_limit', Number(e.target.value))} className="input" placeholder={t('tiers.creditLimitHint')} />
            </FormField>
            <FormField label={t('tiers.blockCredit')}>
              <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-200 cursor-pointer">
                <input type="checkbox" checked={(supForm as any).credit_blocked === true} onChange={e => setSupField('credit_blocked', e.target.checked)} className="w-4 h-4" />
                <span className="text-sm text-slate-700">{t('tiers.blockCreditSupplier')}</span>
              </label>
            </FormField>
          </CollapsibleSection>
        </div>
      </Modal>

      {/* Options sheet — customer */}
      {optCust && (
        <OptionsSheet
          title={optCust.name}
          subtitle={<span className="capitalize">{optCust.customer_type || 'particulier'}{(optCust as any).is_active === false ? ' · Inactif' : ''}</span>}
          onClose={() => setOptCust(null)}
          onEdit={() => { const c = optCust; setOptCust(null); openCustEdit(c); }}
          onDeactivate={(optCust as any).is_active !== false ? () => { const c = optCust; setOptCust(null); setToDeactivateCust(c); } : undefined}
          onReactivate={(optCust as any).is_active === false ? () => { const c = optCust; setOptCust(null); reactivateCust(c); } : undefined}
          actions={[
            { icon: Info, label: 'Interroger le compte', desc: 'Solde, totaux et historique rapide', onClick: () => { setCustView({ c: optCust, key: 'info' }); setOptCust(null); } },
            { icon: Scale, label: 'Positionner le solde', desc: 'Ajuster manuellement le solde comptable', onClick: () => { const c = optCust; setOptCust(null); openBalanceAdjust(c.id, c.name, 'customer', Number((c as any).balance || 0)); } },
            { icon: Tag, label: 'Tarifs d\'exception', desc: 'Prix spéciaux par article', onClick: () => { setCustView({ c: optCust, key: 'pricing' }); setOptCust(null); } },
            { icon: Wallet, label: 'Saisir un règlement', desc: 'Encaissement + imputation facture', onClick: () => { setCustView({ c: optCust, key: 'payment' }); setOptCust(null); } },
            { icon: FileText, label: 'Documents de ventes', desc: 'Factures filtrées par période', onClick: () => { setCustView({ c: optCust, key: 'docs' }); setOptCust(null); } },
          ]}
        />
      )}

      {/* Options sheet — supplier */}
      {optSup && (
        <OptionsSheet
          title={optSup.name}
          subtitle={<span>{optSup.country || 'Fournisseur'}{!optSup.is_active ? ' · Inactif' : ''}</span>}
          onClose={() => setOptSup(null)}
          onEdit={() => { const s = optSup; setOptSup(null); openSupEdit(s); }}
          onDeactivate={optSup.is_active ? () => { const s = optSup; setOptSup(null); setToDeactivateSup(s); } : undefined}
          onReactivate={!optSup.is_active ? () => { const s = optSup; setOptSup(null); reactivateSup(s); } : undefined}
          actions={[
            { icon: Info, label: 'Interroger le compte', desc: 'Dette, totaux et derniers mouvements', onClick: () => { setSupView({ s: optSup, key: 'info' }); setOptSup(null); } },
            { icon: Scale, label: 'Positionner le solde', desc: 'Ajuster manuellement le solde comptable', onClick: () => { const s = optSup; setOptSup(null); openBalanceAdjust(s.id, s.name, 'supplier', Number((s as any).balance || 0)); } },
            { icon: Wallet, label: 'Saisir un règlement', desc: 'Paiement + imputation commande', onClick: () => { setSupView({ s: optSup, key: 'payment' }); setOptSup(null); } },
            { icon: FileText, label: 'Documents d\'achats', desc: 'Commandes filtrées par période', onClick: () => { setSupView({ s: optSup, key: 'docs' }); setOptSup(null); } },
            { icon: ShoppingBag, label: 'Articles liés', desc: 'Catalogue rattaché', onClick: () => { setSupView({ s: optSup, key: 'articles' }); setOptSup(null); } },
          ]}
        />
      )}

      {custView && (
        <CustomerDetailModal
          view={custView}
          onClose={() => { setCustView(null); load(); }}
        />
      )}
      {supView && (
        <SupplierDetailModal
          view={supView}
          siteId={currentSite?.id || null}
          onClose={() => { setSupView(null); load(); }}
        />
      )}

      <ConfirmDialog
        open={!!toDeactivateCust}
        onClose={() => setToDeactivateCust(null)}
        onConfirm={deactivateCust}
        title="Supprimer le client ?"
        message={`"${toDeactivateCust?.name}" sera supprimé définitivement si aucune opération n'est liée, sinon il sera désactivé.`}
        danger
      />
      <ConfirmDialog
        open={!!toDeactivateSup}
        onClose={() => setToDeactivateSup(null)}
        onConfirm={deactivateSup}
        title="Supprimer le fournisseur ?"
        message={`"${toDeactivateSup?.name}" sera supprimé définitivement si aucune opération n'est liée, sinon il sera désactivé.`}
        danger
      />

      {/* Import modal */}
      <Modal open={importExportOpen} onClose={() => setImportExportOpen(false)} title={`Importer des ${tab === 'customers' ? 'clients' : 'fournisseurs'}`} size="md"
        footer={importRows.length > 0 && !importResult ? <>
          <button onClick={() => setImportExportOpen(false)} className="btn-secondary">Annuler</button>
          <button onClick={runImport} disabled={importing} className="btn-primary">
            {importing && <Loader2 className="w-4 h-4 animate-spin" />}
            Importer {importRows.length} ligne{importRows.length > 1 ? 's' : ''}
          </button>
        </> : undefined}
      >
        <div className="space-y-4">
          {!importResult && (
            <>
              <div className="flex items-center gap-2">
                <button onClick={downloadTemplate} className="btn-secondary text-xs gap-1.5">
                  <Download className="w-3.5 h-3.5" />Télécharger le modèle
                </button>
              </div>
              <div
                className="border-2 border-dashed border-slate-300 rounded-2xl p-6 text-center hover:border-brand-400 transition-colors cursor-pointer"
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImportFile(f); }}
                onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv'; inp.onchange = () => { if (inp.files?.[0]) handleImportFile(inp.files[0]); }; inp.click(); }}
              >
                <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">Glissez un fichier Excel ici</p>
                <p className="text-xs text-slate-400 mt-1">ou cliquez pour parcourir (.xlsx, .xls, .csv)</p>
              </div>
              {importFilename && (
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                  <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="text-xs font-medium text-slate-700 truncate flex-1">{importFilename}</span>
                  <span className="text-xs text-slate-500">{importRows.length} ligne{importRows.length > 1 ? 's' : ''}</span>
                </div>
              )}
              {importRows.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Nom</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Tél</th>
                        <th className="px-2 py-1.5 text-right font-semibold text-slate-600">Solde</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 20).map((r, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-2 py-1 text-slate-800 font-medium">{r.nom}</td>
                          <td className="px-2 py-1 text-slate-500">{r.telephone || '-'}</td>
                          <td className="px-2 py-1 text-right text-slate-700 num">{Number(r.solde || 0) ? formatFCFA(Number(r.solde)) : '-'}</td>
                        </tr>
                      ))}
                      {importRows.length > 20 && (
                        <tr><td colSpan={3} className="px-2 py-1.5 text-center text-slate-400 italic">+{importRows.length - 20} autres lignes...</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {importResult && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                  <div className="text-2xl font-black text-emerald-700 num">{importResult.created}</div>
                  <div className="text-[10px] font-semibold text-emerald-600 uppercase">Créés</div>
                </div>
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-center">
                  <div className="text-2xl font-black text-blue-700 num">{importResult.updated}</div>
                  <div className="text-[10px] font-semibold text-blue-600 uppercase">Mis à jour</div>
                </div>
              </div>
              {importResult.errors.length > 0 && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 space-y-1.5">
                  <div className="text-xs font-bold text-red-700">{importResult.errors.length} erreur{importResult.errors.length > 1 ? 's' : ''}</div>
                  <div className="max-h-32 overflow-y-auto text-[11px] text-red-600 space-y-0.5">
                    {importResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                </div>
              )}
              <button onClick={() => setImportExportOpen(false)} className="btn-primary w-full">Fermer</button>
            </div>
          )}
        </div>
      </Modal>

      {/* Balance adjustment modal */}
      <Modal open={balanceOpen && !!balanceTarget} onClose={() => { setBalanceOpen(false); setBalanceTarget(null); }} title="Positionner le solde" size="sm"
        footer={<>
          <button onClick={() => setBalanceOpen(false)} className="btn-secondary">Annuler</button>
          <button onClick={saveBalance} disabled={savingBalance} className="btn-primary">
            {savingBalance && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer
          </button>
        </>}
      >
        {balanceTarget && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-xs text-slate-500 mb-0.5">{balanceTarget.type === 'customer' ? 'Client' : 'Fournisseur'}</div>
              <div className="text-sm font-bold text-slate-900">{balanceTarget.name}</div>
              <div className="text-xs text-slate-500 mt-1">Solde actuel: <span className="font-bold num">{formatFCFA(balanceTarget.currentBalance)}</span></div>
            </div>
            <div>
              <label className="label">Nouveau solde (FCFA)</label>
              <input
                type="number"
                value={balanceAmount}
                onChange={e => setBalanceAmount(e.target.value)}
                className="input"
                placeholder="0"
                autoFocus
              />
              <p className="text-[10px] text-slate-400 mt-1">Un solde positif indique une créance (le tiers doit de l'argent). Négatif = avoir.</p>
            </div>
            <div>
              <label className="label">Note (optionnel)</label>
              <input value={balanceNote} onChange={e => setBalanceNote(e.target.value)} className="input" placeholder="Reprise de solde comptable..." />
            </div>
          </div>
        )}
      </Modal>

      {/* Balance quick-select: shown when clicking Solde button without preselection */}
      <BalanceQuickSelect
        open={balanceOpen && !balanceTarget}
        onClose={() => setBalanceOpen(false)}
        customers={tab === 'customers' ? filteredCustomers : []}
        suppliers={tab === 'suppliers' ? filteredSuppliers : []}
        onSelect={(id, name, type, bal) => openBalanceAdjust(id, name, type, bal)}
        tab={tab}
      />
    </div>
  );
}

/* ───────────────────────── UI primitives ───────────────────────── */
function Badge({ tone, children }: { tone: 'neutral' | 'emerald' | 'amber' | 'red' | 'slate' | 'sky'; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    neutral: 'bg-slate-100 text-slate-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    slate: 'bg-slate-100 text-slate-500',
    sky: 'bg-neutral-50 text-neutral-700',
  };
  return <span className={`badge ${tones[tone]} capitalize`}>{children}</span>;
}

/* ───────────────────────── Customer list ───────────────────────── */
function CustomerList({ list, total, dueMap, paidMap, totalMap, onCreate, onClickRow }: {
  list: Customer[]; total: number;
  dueMap: Record<string, number>; paidMap: Record<string, number>; totalMap: Record<string, number>;
  onCreate: () => void; onClickRow: (c: Customer) => void;
}) {
  if (list.length === 0) {
    return total === 0
      ? <div className="card"><EmptyState icon={Users} title="Aucun client" description="Créez votre premier client pour démarrer." action={<button onClick={onCreate} className="btn-primary"><Plus className="w-4 h-4" />Nouveau client</button>} /></div>
      : <div className="card"><EmptyState icon={Users} title="Aucun résultat" description="Aucun client ne correspond à votre recherche." /></div>;
  }
  return (
    <div className="space-y-1.5">
      {list.map(c => {
        const due = dueMap[c.id] || 0;
        const inactive = (c as any).is_active === false;
        const limit = Number((c as any).credit_limit || 0);
        const blocked = (c as any).credit_blocked === true;
        const balance = Number((c as any).balance || 0);
        const nearLimit = limit > 0 && balance >= limit * 0.8;
        const overLimit = limit > 0 && balance >= limit;
        return (
          <button
            key={c.id}
            onClick={() => onClickRow(c)}
            className={`w-full text-left bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-brand-300 active:scale-[0.99] transition-all px-3.5 py-2.5 ${inactive ? 'opacity-50' : ''}`}
          >
            {/* Row 1: name + badges */}
            <div className="flex items-start gap-2 mb-1.5">
              <div className="w-6 h-6 shrink-0 rounded-lg bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700 flex items-center justify-center text-[10px] font-bold mt-0.5">
                {c.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-bold text-slate-900 leading-snug">{c.name}</p>
                {c.phone && (
                  <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5">
                    <Phone className="w-2.5 h-2.5 shrink-0" />{c.phone}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {blocked && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-red-50 text-red-600 border border-red-100">Bloqué</span>}
                {!blocked && overLimit && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-red-50 text-red-600 border border-red-100">Plafond</span>}
                {!blocked && nearLimit && !overLimit && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-50 text-amber-600 border border-amber-100">Limite</span>}
                {inactive && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-slate-100 text-slate-400 border border-slate-200">Inactif</span>}
              </div>
            </div>
            {/* Row 2: solde label + amount */}
            <div className="flex items-center justify-between pl-8 border-t border-slate-100 pt-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Solde comptable</span>
              <span className={`text-[12px] font-black tabular-nums ${balance > 0 ? 'text-amber-600' : balance < 0 ? 'text-emerald-600' : 'text-slate-300'}`}>{formatFCFA(balance)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Supplier list ───────────────────────── */
function SupplierList({ list, total, dueMap, onCreate, onClickRow }: {
  list: Supplier[]; total: number;
  dueMap: Record<string, { total: number; paid: number; due: number }>;
  onCreate: () => void; onClickRow: (s: Supplier) => void;
}) {
  if (list.length === 0) {
    return total === 0
      ? <div className="card"><EmptyState icon={Truck} title="Aucun fournisseur" description="Créez votre premier fournisseur." action={<button onClick={onCreate} className="btn-primary"><Plus className="w-4 h-4" />Nouveau fournisseur</button>} /></div>
      : <div className="card"><EmptyState icon={Truck} title="Aucun résultat" description="Aucun fournisseur ne correspond à votre recherche." /></div>;
  }
  return (
    <div className="space-y-1.5">
      {list.map(s => {
        const d = dueMap[s.id] || { total: 0, paid: 0, due: 0 };
        const balance = Number((s as any).balance || 0);
        return (
          <button
            key={s.id}
            onClick={() => onClickRow(s)}
            className={`w-full text-left bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-neutral-300 active:scale-[0.99] transition-all px-3.5 py-2.5 ${!s.is_active ? 'opacity-50' : ''}`}
          >
            {/* Row 1: name + inactive badge */}
            <div className="flex items-start gap-2 mb-1.5">
              <div className="w-6 h-6 shrink-0 rounded-lg bg-gradient-to-br from-neutral-50 to-neutral-100 text-neutral-700 flex items-center justify-center text-[10px] font-bold mt-0.5">
                {s.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-bold text-slate-900 leading-snug">{s.name}</p>
                {s.phone && (
                  <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5">
                    <Phone className="w-2.5 h-2.5 shrink-0" />{s.phone}
                  </div>
                )}
              </div>
              {!s.is_active && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-slate-100 text-slate-400 border border-slate-200 shrink-0">Inactif</span>}
            </div>
            {/* Row 2: solde label + amount */}
            <div className="flex items-center justify-between pl-8 border-t border-slate-100 pt-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Solde comptable</span>
              <span className={`text-[12px] font-black tabular-nums ${balance > 0 ? 'text-red-600' : balance < 0 ? 'text-emerald-600' : 'text-slate-300'}`}>{formatFCFA(balance)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Options bottom sheet ───────────────────────── */
function OptionsSheet({ title, subtitle, onClose, actions, onEdit, onDeactivate, onReactivate }: {
  title: string; subtitle?: React.ReactNode; onClose: () => void;
  actions: { icon: any; label: string; desc?: string; onClick: () => void }[];
  onEdit?: () => void; onDeactivate?: () => void; onReactivate?: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="scrim" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-premium animate-sheet-up sm:animate-scale-in">
        <div className="sm:hidden sheet-handle" />
        <div className="px-5 pt-3 sm:pt-4 pb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-base font-bold text-slate-900 truncate">{title}</div>
            {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-500"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-3 pb-2 space-y-1">
          {actions.map((a, i) => {
            const Icon = a.icon;
            return (
              <button key={i} onClick={a.onClick} className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-slate-50 active:bg-slate-100 transition-colors text-left">
                <span className="w-10 h-10 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">{a.label}</span>
                  {a.desc && <span className="block text-xs text-slate-500 mt-0.5">{a.desc}</span>}
                </span>
                <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
              </button>
            );
          })}
        </div>
        <div className="px-3 pb-4 pt-1 border-t border-slate-100 flex gap-2" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {onEdit && <button onClick={onEdit} className="flex-1 btn-secondary justify-center"><Edit2 className="w-4 h-4" />Modifier</button>}
          {onReactivate && <button onClick={onReactivate} className="flex-1 inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-colors"><RotateCcw className="w-4 h-4" />Réactiver</button>}
          {onDeactivate && <button onClick={onDeactivate} className="flex-1 inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition-colors"><Trash2 className="w-4 h-4" />Supprimer</button>}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Customer detail modal ───────────────────────── */
function CustomerDetailModal({ view, onClose }: { view: { c: Customer; key: CustomerOptionKey }; onClose: () => void }) {
  const { c: initialC, key } = view;
  const { tenant, currentSite } = useApp();
  const { success, error } = useToast();
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<any[]>([]);
  const [saleItems, setSaleItems] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [methods, setMethods] = useState<any[]>([]);
  const [customerBalance, setCustomerBalance] = useState<number>(Number((initialC as any).balance || 0));

  const [paySale, setPaySale] = useState<string>('');
  const [payAmount, setPayAmount] = useState<string>('');
  const [payMethod, setPayMethod] = useState<string>('');
  const [payRef, setPayRef] = useState('');
  const [paying, setPaying] = useState(false);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [invoiceView, setInvoiceView] = useState<any | null>(null);

  const [creditMethodIds, setCreditMethodIds] = useState<Set<string>>(new Set());
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!tenant) return;
    supabase.from('profiles').select('id, full_name, email').eq('tenant_id', tenant.id).then(({ data }) => {
      const m: Record<string, string> = {};
      (data || []).forEach((p: any) => { m[p.id] = p.full_name || p.email || ''; });
      setProfileNames(m);
    });
  }, [tenant?.id]);
  const creatorName = (userId?: string | null) => (userId && profileNames[userId]) || 'Utilisateur non renseigné';
  const [prepayments, setPrepayments] = useState<{ id: string; amount: number; amount_used: number; method_name: string; reference: string; created_at: string }[]>([]);
  const [avoirs, setAvoirs] = useState<{ id: string; return_number: string; total: number; credit_used: number; created_at: string; refunded_at?: string | null }[]>([]);
  const [balanceAdjs, setBalanceAdjs] = useState<{ id: string; amount: number; note: string; created_at: string }[]>([]);

  const c = useMemo(() => ({ ...initialC, balance: customerBalance } as any), [initialC, customerBalance]);

  const reload = async () => {
    if (!tenant) return;
    setLoading(true);
    const [sRes, pmAllRes, custRes] = await Promise.all([
      supabase.from('sales').select('id, sale_number, total, paid, status, created_at, source, user_id').eq('tenant_id', tenant.id).eq('customer_id', c.id).order('created_at', { ascending: false }).limit(400),
      supabase.from('payment_methods').select('id, name, code, payment_type').eq('tenant_id', tenant.id).eq('is_active', true).order('sort_order'),
      supabase.from('customers').select('balance').eq('id', initialC.id).maybeSingle(),
    ]);
    const ss = sRes.data || [];
    setSales(ss);
    if (custRes.data) setCustomerBalance(Number(custRes.data.balance || 0));
    const allPm = pmAllRes.data || [];
    const realMethods = allPm.filter((m: any) => m.payment_type !== 'credit');
    setMethods(realMethods);
    const creditIds = new Set<string>(allPm.filter((m: any) => m.payment_type === 'credit').map((m: any) => m.id));
    setCreditMethodIds(creditIds);
    if (!payMethod && realMethods.length) setPayMethod(realMethods[0].id);

    const salesIds = ss.map(s => s.id);
    const [{ data: prepays }, { data: avoirRows }, { data: adjRows }] = await Promise.all([
      supabase.from('customer_prepayments').select('id, amount, amount_used, method_name, reference, created_at').eq('tenant_id', tenant.id).eq('customer_id', c.id).order('created_at', { ascending: false }),
      supabase.from('sale_returns').select('id, return_number, total, credit_used, created_at, refunded_at').eq('tenant_id', tenant.id).eq('customer_id', c.id).eq('status', 'approved').eq('refund_method', 'avoir').order('created_at', { ascending: false }),
      supabase.from('balance_adjustments').select('id, amount, note, created_at').eq('tenant_id', tenant.id).eq('entity_type', 'customer').eq('entity_id', c.id).order('created_at', { ascending: false }),
    ]);
    setPrepayments(prepays || []);
    setAvoirs(avoirRows || []);
    setBalanceAdjs(adjRows || []);

    if (salesIds.length) {
      const [{ data: pays }, { data: items }] = await Promise.all([
        supabase.from('sale_payments').select('id, sale_id, payment_method_id, method_name, amount, reference, created_at').in('sale_id', salesIds).order('created_at', { ascending: false }),
        supabase.from('sale_items').select('sale_id, name, quantity, unit_price, discount, total, purchase_cost').in('sale_id', salesIds),
      ]);
      setPayments(pays || []);
      setSaleItems(items || []);
    } else { setPayments([]); setSaleItems([]); }
    setLoading(false);
  };
  useEffect(() => { reload(); }, [initialC.id]);

  // Filter out credit-type "payments" — they are not real règlements, just markers for credit sales
  const realPayments = useMemo(
    () => payments.filter(p => !creditMethodIds.has(p.payment_method_id)),
    [payments, creditMethodIds]
  );

  const totals = useMemo(() => {
    const valid = sales.filter(s => s.status !== 'cancelled');
    const total = valid.reduce((a, s) => a + Number(s.total), 0);
    const validIds = new Set(valid.map(s => s.id));
    const paid = realPayments
      .filter(p => validIds.has(p.sale_id))
      .reduce((a, p) => a + Number(p.amount), 0);
    const unusedPrepay = prepayments.reduce((a, p) => a + Math.max(0, Number(p.amount) - Number(p.amount_used)), 0);
    const unusedAvoir = avoirs.reduce((a, av) => a + Math.max(0, Number(av.total) - Number(av.credit_used)), 0);
    return { total, paid, due: total - paid - unusedPrepay, unusedPrepay, unusedAvoir };
  }, [sales, realPayments, prepayments, avoirs]);

  const unpaidSales = useMemo(() => {
    const paidBySale: Record<string, number> = {};
    realPayments.forEach(p => { paidBySale[p.sale_id] = (paidBySale[p.sale_id] || 0) + Number(p.amount); });
    const result = sales.filter(s => {
      if (s.status === 'cancelled') return false;
      const realPaid = paidBySale[s.id] || 0;
      return realPaid < Number(s.total);
    }).map(s => {
      const realPaid = paidBySale[s.id] || 0;
      return { ...s, paid: realPaid };
    });

    const customerBalance = Number((c as any).balance || 0);
    const invoiceDue = result.reduce((a, s) => a + (Number(s.total) - Number(s.paid)), 0);
    const positionedDue = Math.max(0, customerBalance - invoiceDue);
    if (positionedDue > 0) {
      result.unshift({ id: '__balance__', sale_number: 'Report de solde', total: positionedDue, paid: 0, status: 'validated', created_at: new Date(0).toISOString() } as any);
    }

    return result;
  }, [sales, realPayments, c]);

  const ledger = useMemo(() => {
    type Row = { id: string; ts: string; label: string; ref: string; debit: number; credit: number; kind: 'sale' | 'payment' | 'cancel' | 'adjustment' };
    const rows: Row[] = [];
    balanceAdjs.forEach(adj => {
      const amt = Number(adj.amount);
      if (amt > 0) {
        rows.push({ id: 'adj-' + adj.id, ts: adj.created_at, label: adj.note || 'Report de solde', ref: '', debit: amt, credit: 0, kind: 'adjustment' });
      } else if (amt < 0) {
        rows.push({ id: 'adj-' + adj.id, ts: adj.created_at, label: adj.note || 'Ajustement de solde', ref: '', debit: 0, credit: Math.abs(amt), kind: 'adjustment' });
      }
    });
    sales.forEach(s => {
      if (s.status === 'cancelled') {
        rows.push({ id: 'c-' + s.id, ts: s.created_at, label: 'Facture annulée', ref: s.sale_number, debit: 0, credit: 0, kind: 'cancel' });
        return;
      }
      rows.push({ id: 's-' + s.id, ts: s.created_at, label: 'Vente', ref: s.sale_number, debit: Number(s.total), credit: 0, kind: 'sale' });
    });
    realPayments.forEach(p => {
      const s = sales.find(x => x.id === p.sale_id);
      rows.push({ id: 'p-' + p.id, ts: p.created_at, label: `Règlement${p.method_name ? ' · ' + p.method_name : ''}`, ref: s?.sale_number || '', debit: 0, credit: Number(p.amount), kind: 'payment' });
    });
    prepayments.forEach(pp => {
      const unused = Math.max(0, Number(pp.amount) - Number(pp.amount_used));
      if (unused > 0) {
        rows.push({ id: 'pp-' + pp.id, ts: pp.created_at, label: `Acompte · avoir${pp.method_name ? ' · ' + pp.method_name : ''}`, ref: pp.reference || '', debit: 0, credit: unused, kind: 'payment' });
      }
    });
    rows.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    let running = 0;
    return rows.map(r => { running += r.debit - r.credit; return { ...r, running }; });
  }, [sales, realPayments, prepayments, avoirs, balanceAdjs]);

  const filteredDocs = useMemo(() => sales.filter(s => {
    if (dateFrom && new Date(s.created_at) < new Date(dateFrom)) return false;
    if (dateTo) { const t = new Date(dateTo); t.setDate(t.getDate() + 1); if (new Date(s.created_at) >= t) return false; }
    return true;
  }), [sales, dateFrom, dateTo]);

  const docsKpis = useMemo(() => {
    const valid = filteredDocs.filter(s => s.status !== 'cancelled');
    const count = valid.length;
    const ca = valid.reduce((a, s) => a + Number(s.total), 0);
    const items = saleItems.filter(it => valid.some(s => s.id === it.sale_id));
    const cost = items.reduce((a, it) => a + Number(it.purchase_cost || 0) * Number(it.quantity), 0);
    const marge = ca - cost;
    const margePct = ca > 0 ? (marge / ca) * 100 : 0;
    return { count, ca, marge, margePct };
  }, [filteredDocs, saleItems]);

  const yearStats = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const months = Array.from({ length: 12 }, (_, m) => ({ m, count: 0, total: 0, cost: 0 }));
    sales.filter(s => s.status !== 'cancelled').forEach(s => {
      const d = new Date(s.created_at);
      if (d.getFullYear() !== year) return;
      const r = months[d.getMonth()];
      r.count += 1; r.total += Number(s.total);
    });
    saleItems.forEach(it => {
      const s = sales.find(x => x.id === it.sale_id);
      if (!s || s.status === 'cancelled') return;
      const d = new Date(s.created_at);
      if (d.getFullYear() !== year) return;
      months[d.getMonth()].cost += Number(it.purchase_cost || 0) * Number(it.quantity);
    });
    return { year, months };
  }, [sales, saleItems]);

  const submitPayment = async () => {
    if (!paySale) { error('Sélectionnez une facture à imputer'); return; }
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { error('Montant invalide'); return; }
    const pm = methods.find(m => m.id === payMethod);
    if (!pm) { error('Mode de règlement requis'); return; }
    setPaying(true);
    let sessionId: string | null = null;
    if (currentSite && tenant) {
      const { data: sess } = await supabase.from('cash_sessions')
        .select('id').eq('tenant_id', tenant.id).eq('site_id', currentSite.id)
        .eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle();
      sessionId = sess?.id || null;
    }

    let e: any = null;
    if (paySale === '__balance__') {
      const { error: rpcErr } = await supabase.rpc('register_customer_payment', {
        p_customer_id: c.id, p_payment_method_id: pm.id, p_method_name: pm.name,
        p_amount: amt, p_reference: payRef || `Règlement solde · ${c.name}`,
        p_cash_session_id: sessionId, p_sale_id: null,
      });
      e = rpcErr;
    } else {
      const sale = sales.find(s => s.id === paySale);
      const ref = payRef || (sale ? `Règlement facture ${sale.sale_number} · ${c.name}` : '');
      const { error: rpcErr } = await supabase.rpc('register_sale_payment', {
        p_sale_id: paySale, p_payment_method_id: pm.id, p_method_name: pm.name,
        p_amount: amt, p_reference: ref, p_cash_session_id: sessionId,
      });
      e = rpcErr;
    }

    setPaying(false);
    if (e) { error(e.message); return; }
    success(sessionId ? 'Règlement enregistré · imputé sur la caisse du jour' : 'Règlement enregistré');
    setPaySale(''); setPayAmount(''); setPayRef('');
    reload();
  };

  const openInvoice = (saleId: string) => {
    const sale = sales.find(s => s.id === saleId);
    if (!sale) return;
    const items = saleItems.filter(it => it.sale_id === saleId);
    const pays = payments.filter(p => p.sale_id === saleId);
    setInvoiceView({ sale, items, pays });
  };

  const printInvoice = (data: { sale: any; items: any[]; pays: any[] }) => {
    if (!tenant) return;
    const tenantPrint: PrintTenant = buildPrintTenantForSite(tenant, currentSite);
    const items = data.items.map(i => ({
      name: i.name, supplier_ref: null,
      oem_ref: i.articles?.oem_ref || null, quantity: Number(i.quantity),
      unit_price: Number(i.unit_price), discount: Number(i.discount || 0),
    }));
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
    printDocumentA4({
      tenant: tenantPrint,
      docLabel: 'FACTURE',
      docNumber: data.sale.sale_number,
      docDate: new Date(data.sale.created_at).toLocaleDateString('fr-FR'),
      customer: { name: c.name, phone: c.phone || undefined, address: c.address || undefined },
      items, subtotal, total: Number(data.sale.total),
      payments: data.pays.map(p => ({ method_name: p.method_name, amount: Number(p.amount) })),
      paid: Number(data.sale.paid),
      issuedBy: creatorName(data.sale.user_id),
    });
  };

  const modalTitle = key === 'info' ? 'Compte client' : key === 'payment' ? 'Saisir un règlement' : key === 'pricing' ? 'Tarifs d\'exception' : 'Documents de ventes';

  return (
    <Modal open onClose={onClose} title={modalTitle} size="lg" layer="top"
      footer={<button onClick={onClose} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>}>

      {/* Premium embedded title bar */}
      <div className="mb-3 rounded-2xl bg-white border border-slate-200 shadow-sm p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 shrink-0 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-glow">
            <Users className="w-4 h-4 text-white" />
          </div>
          <div className="text-sm font-bold tracking-tight text-slate-900">{c.name}</div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400">
            {key === 'info' && 'Compte client · débit / crédit'}
            {key === 'payment' && 'Encaissement avec imputation'}
            {key === 'docs' && 'Documents de ventes · statistiques'}
            {key === 'pricing' && 'Prix spéciaux par article'}
          </div>
          {key !== 'pricing' && !loading && (
          <div className="text-right">
            <div className={`${customerBalance > 0 ? 'text-amber-700' : customerBalance < 0 ? 'text-emerald-700' : 'text-slate-500'}`}>
              <div className="text-[9px] font-bold uppercase tracking-wider opacity-70 leading-none">Solde comptable</div>
              <div className="text-sm font-bold tabular-nums leading-none mt-0.5">{formatFCFA(customerBalance)}</div>
            </div>
            {totals.unusedAvoir > 0 && (
              <div className="text-teal-700 mt-1">
                <div className="text-[9px] font-bold uppercase tracking-wider opacity-70 leading-none">Avoir disponible</div>
                <div className="text-xs font-bold tabular-nums leading-none mt-0.5">-{formatFCFA(totals.unusedAvoir)}</div>
              </div>
            )}
          </div>
          )}
        </div>
      </div>

      {loading && key !== 'pricing' ? <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div> : (
        <>
          {key === 'info' && (
            <LedgerView customerName={c.name} ledger={ledger} totalDebit={totals.total} totalCredit={totals.paid} balance={totals.due} unusedAvoir={totals.unusedAvoir}
              dateFrom={dateFrom} dateTo={dateTo} onOpenPicker={() => setPickerOpen(true)} onClearDates={() => { setDateFrom(''); setDateTo(''); }} />
          )}

          {key === 'payment' && (
            <PaymentForm
              unpaid={unpaidSales} methods={methods}
              paySale={paySale} setPaySale={setPaySale}
              payAmount={payAmount} setPayAmount={setPayAmount}
              payMethod={payMethod} setPayMethod={setPayMethod}
              payRef={payRef} setPayRef={setPayRef}
              paying={paying} onSubmit={submitPayment}
              onSelectSale={(id: string) => { const s = unpaidSales.find((x: any) => x.id === id); if (s) setPayAmount(String(Math.max(0, Number(s.total) - Number(s.paid)))); }}
              recentPayments={payments.slice(0, 8).map(p => ({ ...p, sale_number: sales.find(x => x.id === p.sale_id)?.sale_number }))}
            />
          )}

          {key === 'docs' && (
            <DocsView
              kpis={docsKpis} yearStats={yearStats} docs={filteredDocs} saleItems={saleItems}
              dateFrom={dateFrom} dateTo={dateTo}
              onOpenPicker={() => setPickerOpen(true)}
              onClearDates={() => { setDateFrom(''); setDateTo(''); }}
              onOpenInvoice={openInvoice}
            />
          )}

          {key === 'pricing' && (
            <ExceptionPricingView customerId={c.id} />
          )}
        </>
      )}

      <PremiumDateRangePicker open={pickerOpen} onClose={() => setPickerOpen(false)} from={dateFrom} to={dateTo} onApply={(f, t) => { setDateFrom(f); setDateTo(t); setPickerOpen(false); }} />

      {invoiceView && (
        <InvoiceViewModal data={invoiceView} customerName={c.name} onClose={() => setInvoiceView(null)} onPrint={() => printInvoice(invoiceView)} />
      )}
    </Modal>
  );
}

/* ───────────────────────── Ledger view (bank-style) ───────────────────────── */
function LedgerView({ customerName, ledger, totalDebit, totalCredit, balance, unusedAvoir, dateFrom, dateTo, onOpenPicker, onClearDates }: {
  customerName: string;
  ledger: { id: string; ts: string; label: string; ref: string; debit: number; credit: number; running: number; kind: string }[];
  totalDebit: number; totalCredit: number; balance: number; unusedAvoir: number;
  dateFrom: string; dateTo: string; onOpenPicker: () => void; onClearDates: () => void;
}) {
  const [kindFilter, setKindFilter] = useState<'' | 'sale' | 'payment'>('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filteredLedger = useMemo(() => {
    let r = ledger;
    if (dateFrom) {
      const f = new Date(dateFrom); f.setHours(0, 0, 0, 0);
      r = r.filter(row => new Date(row.ts) >= f);
    }
    if (dateTo) {
      const t = new Date(dateTo); t.setHours(23, 59, 59, 999);
      r = r.filter(row => new Date(row.ts) <= t);
    }
    if (kindFilter) r = r.filter(row => row.kind === kindFilter);
    return r;
  }, [ledger, dateFrom, dateTo, kindFilter]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof ledger>();
    filteredLedger.slice().reverse().forEach(r => {
      const d = new Date(r.ts); const k = d.toISOString().slice(0, 10);
      if (!map.has(k)) map.set(k, [] as any);
      map.get(k)!.push(r);
    });
    return Array.from(map.entries());
  }, [filteredLedger]);

  const filteredDebit = useMemo(() => filteredLedger.reduce((s, r) => s + r.debit, 0), [filteredLedger]);
  const filteredCredit = useMemo(() => filteredLedger.reduce((s, r) => s + r.credit, 0), [filteredLedger]);
  const filteredBalance = filteredDebit - filteredCredit;

  const toggleDay = (day: string) => setExpanded(prev => ({ ...prev, [day]: !prev[day] }));
  const expandAll = () => { const m: Record<string, boolean> = {}; groups.forEach(([d]) => { m[d] = true; }); setExpanded(m); };
  const collapseAll = () => setExpanded({});

  if (ledger.length === 0) {
    return (
      <div className="py-10 text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 mb-3"><FileText className="w-6 h-6" /></div>
        <div className="text-sm font-semibold text-slate-700">Compte vide</div>
        <div className="text-xs text-slate-500 mt-1">Aucun mouvement pour {customerName}.</div>
      </div>
    );
  }

  return (
    <div>
      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={onOpenPicker} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm">
          <Calendar className="w-3.5 h-3.5 text-slate-400" />
          {dateFrom || dateTo ? (
            <span>{dateFrom && new Date(dateFrom).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} — {dateTo && new Date(dateTo).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>
          ) : (
            <span>Période</span>
          )}
        </button>
        {(dateFrom || dateTo) && (
          <button onClick={onClearDates} className="inline-flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="w-3 h-3" /> Effacer
          </button>
        )}
        <div className="flex items-center gap-1 ml-auto">
          {[{ v: '' as const, l: 'Tout' }, { v: 'sale' as const, l: 'Ventes' }, { v: 'payment' as const, l: 'Règlements' }].map(o => (
            <button key={o.v} onClick={() => setKindFilter(o.v)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${kindFilter === o.v ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'text-slate-500 hover:bg-slate-100'}`}>
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {/* Expand/collapse controls */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-slate-400 font-semibold">{groups.length} jour{groups.length > 1 ? 's' : ''} · {filteredLedger.length} opération{filteredLedger.length > 1 ? 's' : ''}</span>
        <div className="flex-1" />
        <button onClick={expandAll} className="text-[10px] font-semibold text-brand-600 hover:underline">Tout déplier</button>
        <button onClick={collapseAll} className="text-[10px] font-semibold text-slate-500 hover:underline">Tout replier</button>
      </div>

      <div className="space-y-2 max-h-[50vh] overflow-auto">
        {groups.map(([day, rows]) => {
          const isOpen = expanded[day] ?? false;
          const dayDebit = rows.reduce((s, r) => s + r.debit, 0);
          const dayCredit = rows.reduce((s, r) => s + r.credit, 0);
          return (
            <div key={day} className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
              <button onClick={() => toggleDay(day)} className="w-full px-3 py-2.5 hover:bg-slate-50/70 transition-colors">
                <div className="flex items-center gap-2">
                  <ChevronRight className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  <span className="text-[11px] font-bold text-slate-700 text-left">
                    {new Date(day).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1.5 pl-5.5">
                  <span className="text-[10px] font-medium text-slate-400">{rows.length} opération{rows.length > 1 ? 's' : ''}</span>
                  {dayDebit > 0 && <span className="text-[11px] font-bold text-amber-700 tabular-nums">-{formatFCFA(dayDebit)}</span>}
                  {dayCredit > 0 && <span className="text-[11px] font-bold text-emerald-700 tabular-nums">+{formatFCFA(dayCredit)}</span>}
                </div>
              </button>
              {isOpen && (
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {rows.map(r => (
                    <div key={r.id} className="flex items-center gap-2 px-2.5 py-2">
                      <div className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center ${r.kind === 'sale' ? 'bg-neutral-50 text-neutral-700' : r.kind === 'payment' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                        {r.kind === 'sale' ? <FileText className="w-3.5 h-3.5" /> : r.kind === 'payment' ? <Wallet className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-slate-900">{r.label}</div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-1 flex-wrap">
                          {r.ref && <span className="font-mono">{r.ref}</span>}
                          {r.ref && <span className="text-slate-300">·</span>}
                          <span>{new Date(r.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {r.debit > 0 && <div className="text-[13px] font-bold text-amber-700 tabular-nums whitespace-nowrap">-{formatFCFA(r.debit)}</div>}
                        {r.credit > 0 && <div className="text-[13px] font-bold text-emerald-700 tabular-nums whitespace-nowrap">+{formatFCFA(r.credit)}</div>}
                        {r.debit === 0 && r.credit === 0 && <div className="text-xs text-slate-400">—</div>}
                        <div className="text-[10px] text-slate-400 tabular-nums whitespace-nowrap">Solde {r.running < 0 ? '-' : ''}{formatFCFA(Math.abs(r.running))}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Totals footer */}
      <div className="mt-4 rounded-2xl bg-slate-900 text-white p-3 shadow-premium">
        <div className="grid grid-cols-2 gap-3">
          <div className="text-left">
            <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Ventes</div>
            <div className="mt-0.5 text-[13px] sm:text-sm font-bold tabular-nums text-amber-300">-{formatFCFA(filteredDebit)}</div>
            {filteredBalance > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-700">
                <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Solde dû</div>
                <div className="mt-0.5 text-sm font-bold tabular-nums text-amber-300">{formatFCFA(filteredBalance)}</div>
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Règlements</div>
            <div className="mt-0.5 text-[13px] sm:text-sm font-bold tabular-nums text-emerald-300">+{formatFCFA(filteredCredit)}</div>
            {filteredBalance < 0 && (
              <div className="mt-2 pt-2 border-t border-slate-700">
                <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Solde créditeur</div>
                <div className="mt-0.5 text-sm font-bold tabular-nums text-emerald-300">{formatFCFA(Math.abs(filteredBalance))}</div>
              </div>
            )}
          </div>
          {filteredBalance === 0 && (
            <div className="col-span-2 text-center pt-2 border-t border-slate-700">
              <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Solde</div>
              <div className="mt-0.5 text-sm font-bold tabular-nums text-white">0 FCFA</div>
            </div>
          )}
        </div>
        {unusedAvoir > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-teal-400" />
              <div className="text-[9px] uppercase tracking-wider text-teal-400 font-bold">Avoirs disponibles</div>
            </div>
            <div className="text-sm font-bold tabular-nums text-teal-300">+{formatFCFA(unusedAvoir)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Premium payment form ───────────────────────── */
function PaymentForm({
  unpaid, methods, paySale, setPaySale, payAmount, setPayAmount, payMethod, setPayMethod,
  payRef, setPayRef, paying, onSubmit, onSelectSale, recentPayments,
}: any) {
  const selected = unpaid.find((s: any) => s.id === paySale);
  const due = selected ? Math.max(0, Number(selected.total) - Number(selected.paid)) : 0;
  const amt = Number(payAmount) || 0;
  const remaining = Math.max(0, due - amt);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 text-white p-5 shadow-premium">
        <div className="text-[10px] uppercase tracking-wider font-bold text-white/70">Montant à encaisser</div>
        <div className="mt-1 flex items-baseline gap-2">
          <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
            className="bg-transparent text-3xl font-bold tracking-tight focus:outline-none flex-1 min-w-0 placeholder:text-white/30" placeholder="0" min={0} />
          <span className="text-sm font-semibold text-white/70">FCFA</span>
        </div>
        {selected && (
          <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px]">
            <span className="text-white/60">{selected.id === '__balance__' ? 'Solde positionné' : 'Dû sur cette facture'}</span>
            <span className="font-bold tabular-nums">{formatFCFA(due)}</span>
          </div>
        )}
        {selected && amt > 0 && (
          <div className="flex items-center justify-between text-[11px] mt-1">
            <span className="text-white/60">Reste après règlement</span>
            <span className={`font-bold tabular-nums ${remaining === 0 ? 'text-emerald-300' : 'text-amber-300'}`}>{formatFCFA(remaining)}</span>
          </div>
        )}
      </div>

      <div>
        <label className="label">Imputer sur</label>
        <SearchableSelect
          options={[
            { value: '', label: '— Sélectionner une créance —' },
            ...unpaid.map((s: any) => {
              const d = Math.max(0, Number(s.total) - Number(s.paid));
              return { value: s.id, label: `${s.sale_number} · dû ${formatFCFA(d)}` };
            })
          ]}
          value={paySale}
          onChange={v => { setPaySale(v); onSelectSale(v); }}
          placeholder="— Sélectionner une créance —"
        />
        {unpaid.length === 0 && <div className="text-xs text-emerald-700 mt-1.5 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" />Aucune créance en attente.</div>}
      </div>

      <div>
        <label className="label">Mode de règlement</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {methods.map((m: any) => (
            <button key={m.id} type="button" onClick={() => setPayMethod(m.id)}
              className={`px-3 py-2.5 rounded-xl text-xs font-semibold border-2 transition-all ${payMethod === m.id ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
              {m.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Référence (optionnel)</label>
        <input value={payRef} onChange={e => setPayRef(e.target.value)} className="input" placeholder="N° bordereau, transaction…" />
      </div>

      <button onClick={onSubmit} disabled={paying || !paySale || amt <= 0} className="btn-primary w-full justify-center py-3 text-sm">
        {paying && <Loader2 className="w-4 h-4 animate-spin" />}
        Valider le règlement
      </button>

      {recentPayments.length > 0 && (
        <div>
          <div className="text-[11px] font-bold tracking-wider uppercase text-slate-400 mb-2 px-1">Derniers encaissements</div>
          <div className="space-y-1">
            {recentPayments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800 truncate">{p.method_name}{p.reference ? ` · ${p.reference}` : ''}</div>
                  <div className="text-[11px] text-slate-500">{p.sale_number || '—'} · {formatDateTime(p.created_at)}</div>
                </div>
                <div className="font-bold text-emerald-700">{formatFCFA(p.amount)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Documents view ───────────────────────── */
function DocsView({ kpis, yearStats, docs, saleItems, dateFrom, dateTo, onOpenPicker, onClearDates, onOpenInvoice }: any) {
  const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  const maxMonth = Math.max(1, ...yearStats.months.map((m: any) => m.total));
  const [statsOpen, setStatsOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-slate-200 p-2.5 min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Factures</div>
          <div className="mt-0.5 text-[15px] font-bold text-slate-900 tabular-nums">{kpis.count}</div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/40 p-2.5 min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-neutral-700 font-bold">CA total</div>
          <div className="mt-0.5 text-[13px] font-bold text-neutral-900 tabular-nums break-words">{formatFCFA(kpis.ca)}</div>
        </div>
        <div className={`rounded-2xl border p-2.5 min-w-0 ${kpis.marge >= 0 ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40'}`}>
          <div className={`text-[9px] uppercase tracking-wider font-bold ${kpis.marge >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>Marge</div>
          <div className={`mt-0.5 text-[13px] font-bold tabular-nums break-words ${kpis.marge >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>{formatFCFA(kpis.marge)}</div>
          <div className={`text-[9px] font-semibold ${kpis.marge >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{kpis.margePct.toFixed(1)}%</div>
        </div>
      </div>

      <div>
        <button onClick={() => setStatsOpen(v => !v)} className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-2xl border border-slate-200 bg-white hover:border-brand-300 transition-all">
          <span className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center"><Calendar className="w-3.5 h-3.5" /></span>
            <span className="text-[12px] font-bold text-slate-900">Statistiques {yearStats.year}</span>
            <span className="text-[10px] text-slate-400 font-semibold">jan → déc</span>
          </span>
          <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${statsOpen ? 'rotate-90' : ''}`} />
        </button>
        {statsOpen && (
          <div className="mt-2 rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
            {yearStats.months.map((m: any) => {
              const marge = m.total - m.cost;
              const pct = m.total > 0 ? (m.total / maxMonth) * 100 : 0;
              return (
                <div key={m.m} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]">
                  <div className="w-8 text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">{monthNames[m.m]}</div>
                  <div className="w-6 text-center text-[10px] font-semibold text-slate-600 tabular-nums shrink-0">{m.count}</div>
                  <div className="flex-1 min-w-0">
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-brand-500 to-brand-700 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="text-right font-semibold text-slate-800 tabular-nums whitespace-nowrap shrink-0">{formatFCFA(m.total)}</div>
                  <div className={`text-right text-[10px] font-semibold tabular-nums whitespace-nowrap shrink-0 hidden sm:block ${marge >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatFCFA(marge)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <button onClick={onOpenPicker} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${dateFrom || dateTo ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'}`}>
            <Calendar className="w-3.5 h-3.5" />
            {dateFrom && dateTo ? `${formatDate(dateFrom)} → ${formatDate(dateTo)}` : dateFrom ? `Depuis ${formatDate(dateFrom)}` : dateTo ? `Jusqu'au ${formatDate(dateTo)}` : 'Période'}
          </button>
          {(dateFrom || dateTo) && <button onClick={onClearDates} className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1">Effacer <X className="w-3 h-3" /></button>}
          <span className="ml-auto text-[11px] text-slate-500">{docs.length} document{docs.length > 1 ? 's' : ''}</span>
        </div>
        {docs.length === 0 ? <div className="text-sm text-slate-500 py-8 text-center">Aucun document sur cette période.</div> : (
          <div className="space-y-1.5">
            {docs.map((s: any) => {
              const items = (saleItems || []).filter((it: any) => it.sale_id === s.id);
              const qty = items.reduce((a: number, it: any) => a + Number(it.quantity || 0), 0);
              const avgPU = qty > 0 ? items.reduce((a: number, it: any) => a + Number(it.unit_price || 0) * Number(it.quantity || 0), 0) / qty : 0;
              const designation = items.length === 0
                ? s.sale_number
                : items.length === 1
                  ? items[0].name
                  : `${items[0].name} + ${items.length - 1} article${items.length - 1 > 1 ? 's' : ''}`;
              return (
                <button key={s.id} onClick={() => onOpenInvoice(s.id)} className="w-full rounded-2xl border border-slate-200 bg-white hover:border-brand-300 hover:shadow-md transition-all px-3 py-2.5 text-left active:scale-[0.995]">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-slate-900 line-clamp-2 leading-snug article-text">{designation}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-brand-700 font-semibold">{s.sale_number}</span>
                        <span className="text-slate-300">·</span>
                        <span>{formatDateTime(s.created_at)}</span>
                      </div>
                    </div>
                    <StatusBadgeSale sale={s} />
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-100 grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Quantité</div>
                      <div className="font-semibold text-slate-800 tabular-nums">{qty.toLocaleString('fr-FR')}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">PU moyen</div>
                      <div className="font-semibold text-slate-800 tabular-nums">{formatFCFA(avgPU)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Total</div>
                      <div className="font-bold text-brand-700 tabular-nums whitespace-nowrap">{formatFCFA(s.total)}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Invoice viewer modal ───────────────────────── */
function InvoiceViewModal({ data, customerName, onClose, onPrint }: { data: { sale: any; items: any[]; pays: any[] }; customerName: string; onClose: () => void; onPrint: () => void }) {
  const { sale, items, pays } = data;
  const paidTotal = pays.reduce((s: number, p: any) => s + Number(p.amount), 0);
  const due = Math.max(0, Number(sale.total) - paidTotal);
  const subtotal = items.reduce((s: number, it: any) => s + Number(it.total), 0);

  const docItems: DocItem[] = items.map((it: any) => ({
    name: it.name,
    quantity: Number(it.quantity),
    unit_price: Number(it.unit_price),
    discount: Number(it.discount ?? 0),
    total: Number(it.total),
  }));

  const docPayments: DocPayment[] = pays.map((p: any) => ({
    method_name: p.method_name,
    amount: Number(p.amount),
    paid_at: p.created_at,
  }));

  const statusColor = sale.status === 'paid' ? 'emerald' : sale.status === 'cancelled' ? 'rose' : sale.status === 'validated' ? 'blue' : 'amber';
  const statusLabel = sale.status === 'paid' ? 'Payée' : sale.status === 'cancelled' ? 'Annulée' : sale.status === 'validated' ? 'Crédit' : 'Partielle';

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="scrim" onClick={onClose} />
      <div className="relative w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-premium animate-sheet-up sm:animate-scale-in max-h-[92vh] flex flex-col">
        <div className="sm:hidden sheet-handle" />
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Facture</div>
            <div className="text-base font-bold text-slate-900 font-mono">{sale.sale_number}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={onPrint} className="btn-icon-primary" title="Imprimer"><Printer className="w-4 h-4" /></button>
            <button onClick={onClose} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <DocSlimHeader
            status={{ label: statusLabel, color: statusColor as any }}
            customerName={customerName}
            date={formatDateTime(sale.created_at)}
          />

          {/* Articles via DocItems */}
          <DocItems items={docItems} />

          {/* Totaux */}
          <DocTotals
            subtotal={subtotal}
            total={Number(sale.total)}
            paid={paidTotal > 0 ? paidTotal : undefined}
            remaining={due > 0 ? due : undefined}
          />

          {/* Paiements */}
          {docPayments.length > 0 && (
            <DocPayments payments={docPayments} formatDate={formatDateTime} />
          )}
        </div>
      </div>
    </div>
  );
}

function Line({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'emerald' | 'amber' }) {
  const cls = tone === 'emerald' ? 'text-emerald-300' : tone === 'amber' ? 'text-amber-300' : 'text-white';
  return (
    <div className={`flex items-center justify-between ${strong ? 'text-base font-bold' : 'text-sm'}`}>
      <span className="text-white/70">{label}</span>
      <span className={`tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}

/* ───────────────────────── Supplier detail modal ───────────────────────── */
function SupplierDetailModal({ view, onClose }: { view: { s: Supplier; key: SupplierOptionKey }; siteId: string | null; onClose: () => void }) {
  const { s, key } = view;
  const { tenant, currentSite } = useApp();
  const { success, error } = useToast();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [methods, setMethods] = useState<any[]>([]);
  const [articles, setArticles] = useState<any[]>([]);

  const [payOrder, setPayOrder] = useState<string>('');
  const [payAmount, setPayAmount] = useState<string>('');
  const [payMethod, setPayMethod] = useState<string>('');
  const [payRef, setPayRef] = useState('');
  const [paying, setPaying] = useState(false);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [orderView, setOrderView] = useState<any | null>(null);
  const [balanceAdjs, setBalanceAdjs] = useState<{ id: string; amount: number; note: string; created_at: string }[]>([]);
  const [supplierBalance, setSupplierBalance] = useState<number>(Number((s as any).balance || 0));
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!tenant) return;
    supabase.from('profiles').select('id, full_name, email').eq('tenant_id', tenant.id).then(({ data }) => {
      const m: Record<string, string> = {};
      (data || []).forEach((p: any) => { m[p.id] = p.full_name || p.email || ''; });
      setProfileNames(m);
    });
  }, [tenant?.id]);
  const creatorName = (userId?: string | null) => (userId && profileNames[userId]) || 'Utilisateur non renseigné';

  const reload = async () => {
    if (!tenant) return;
    setLoading(true);
    const [oRes, pRes, mRes, aRes, adjRes, balRes] = await Promise.all([
      supabase.from('supplier_orders').select('id, order_number, total, paid, status, created_at, expected_date, user_id').eq('tenant_id', tenant.id).eq('supplier_id', s.id).order('created_at', { ascending: false }).limit(400),
      supabase.from('supplier_payments').select('*').eq('tenant_id', tenant.id).eq('supplier_id', s.id).order('paid_at', { ascending: false }).limit(200),
      supabase.from('payment_methods').select('id, name, code, payment_type').eq('tenant_id', tenant.id).eq('is_active', true).neq('payment_type', 'credit').order('sort_order'),
      supabase.from('articles').select('id, name, internal_ref, supplier_ref, sale_price, is_active').eq('tenant_id', tenant.id).eq('supplier_id', s.id).order('name').limit(300),
      supabase.from('balance_adjustments').select('id, amount, note, created_at').eq('tenant_id', tenant.id).eq('entity_type', 'supplier').eq('entity_id', s.id).order('created_at', { ascending: false }),
      supabase.from('suppliers').select('balance').eq('id', s.id).maybeSingle(),
    ]);
    const oo = oRes.data || [];
    setOrders(oo);
    setPayments(pRes.data || []);
    setMethods(mRes.data || []);
    setArticles(aRes.data || []);
    setBalanceAdjs(adjRes.data || []);
    if (balRes.data) setSupplierBalance(Number(balRes.data.balance || 0));
    if (!payMethod && (mRes.data || []).length) setPayMethod(mRes.data![0].id);
    const ids = oo.map(o => o.id);
    if (ids.length) {
      const { data: items } = await supabase.from('supplier_order_items').select('*').in('order_id', ids);
      setOrderItems(items || []);
    } else setOrderItems([]);
    setLoading(false);
  };
  useEffect(() => { reload(); }, [s.id]);

  const totals = useMemo(() => {
    const valid = orders.filter(o => o.status !== 'cancelled');
    const total = valid.reduce((a, o) => a + Number(o.total), 0);
    const paid = valid.reduce((a, o) => a + Number(o.paid || 0), 0);
    return { total, paid, due: Math.max(0, total - paid) };
  }, [orders]);

  const unpaidOrders = useMemo(() => orders.filter(o => o.status !== 'cancelled' && Number(o.paid || 0) < Number(o.total)), [orders]);

  const ledger = useMemo(() => {
    type Row = { id: string; ts: string; label: string; ref: string; debit: number; credit: number; kind: 'order' | 'payment' | 'cancel' | 'adjustment' };
    const rows: Row[] = [];
    balanceAdjs.forEach(adj => {
      const amt = Number(adj.amount);
      if (amt > 0) {
        rows.push({ id: 'adj-' + adj.id, ts: adj.created_at, label: adj.note || 'Report de solde', ref: '', debit: 0, credit: amt, kind: 'adjustment' });
      } else if (amt < 0) {
        rows.push({ id: 'adj-' + adj.id, ts: adj.created_at, label: adj.note || 'Ajustement de solde', ref: '', debit: Math.abs(amt), credit: 0, kind: 'adjustment' });
      }
    });
    orders.forEach(o => {
      if (o.status === 'cancelled') {
        rows.push({ id: 'c-' + o.id, ts: o.created_at, label: 'Commande annulée', ref: o.order_number, debit: 0, credit: 0, kind: 'cancel' });
        return;
      }
      rows.push({ id: 'o-' + o.id, ts: o.created_at, label: 'Achats', ref: o.order_number, debit: 0, credit: Number(o.total), kind: 'order' });
    });
    payments.forEach(p => {
      const o = orders.find(x => x.id === p.order_id);
      rows.push({ id: 'p-' + p.id, ts: p.paid_at || p.created_at, label: 'Règlement', ref: o?.order_number || '', debit: Number(p.amount), credit: 0, kind: 'payment' });
    });
    rows.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    let running = 0;
    return rows.map(r => { running += r.credit - r.debit; return { ...r, running }; });
  }, [orders, payments, balanceAdjs]);

  const filteredDocs = useMemo(() => orders.filter(o => {
    if (dateFrom && new Date(o.created_at) < new Date(dateFrom)) return false;
    if (dateTo) { const t = new Date(dateTo); t.setDate(t.getDate() + 1); if (new Date(o.created_at) >= t) return false; }
    return true;
  }), [orders, dateFrom, dateTo]);

  const docsKpis = useMemo(() => {
    const valid = filteredDocs.filter(o => o.status !== 'cancelled');
    const count = valid.length;
    const achats = valid.reduce((a, o) => a + Number(o.total), 0);
    const paid = valid.reduce((a, o) => a + Number(o.paid || 0), 0);
    return { count, achats, due: Math.max(0, achats - paid) };
  }, [filteredDocs]);

  const yearStats = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const months = Array.from({ length: 12 }, (_, m) => ({ m, count: 0, total: 0, paid: 0 }));
    orders.filter(o => o.status !== 'cancelled').forEach(o => {
      const d = new Date(o.created_at);
      if (d.getFullYear() !== year) return;
      const r = months[d.getMonth()];
      r.count += 1; r.total += Number(o.total); r.paid += Number(o.paid || 0);
    });
    return { year, months };
  }, [orders]);

  const submitPayment = async () => {
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { error('Montant invalide'); return; }
    const pm = methods.find(m => m.id === payMethod);
    if (!pm) { error('Mode de règlement requis'); return; }
    if (!tenant) return;
    setPaying(true);
    const { error: e } = await supabase.from('supplier_payments').insert({
      tenant_id: tenant.id, supplier_id: s.id, order_id: payOrder || null,
      payment_method_id: pm.id, method_name: pm.name, amount: amt, reference: payRef,
    });
    if (!e && payOrder) {
      const order = orders.find(o => o.id === payOrder);
      if (order) {
        const newPaid = Number(order.paid || 0) + amt;
        await supabase.from('supplier_orders').update({ paid: newPaid }).eq('id', payOrder);
      }
    }
    if (!e) {
      await supabase.rpc('recompute_supplier_balance', { p_supplier_id: s.id });
    }
    setPaying(false);
    if (e) { error(e.message); return; }
    success('Règlement fournisseur enregistré');
    setPayOrder(''); setPayAmount(''); setPayRef('');
    reload();
  };

  const openOrder = (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const items = orderItems.filter(it => it.order_id === orderId);
    const pays = payments.filter(p => p.order_id === orderId);
    setOrderView({ order, items, pays });
  };

  const printOrder = (data: { order: any; items: any[]; pays: any[] }) => {
    if (!tenant) return;
    const tenantPrint: PrintTenant = buildPrintTenantForSite(tenant, currentSite);
    const items = data.items.map(i => ({
      name: i.name, supplier_ref: i.supplier_ref || null,
      oem_ref: i.articles?.oem_ref || null, quantity: Number(i.quantity_ordered),
      unit_price: Number(i.unit_price), discount: 0,
    }));
    const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
    const paidTotal = data.pays.reduce((sum, p) => sum + Number(p.amount), 0);
    printDocumentA4({
      tenant: tenantPrint,
      docLabel: 'BON DE COMMANDE',
      docNumber: data.order.order_number,
      docDate: new Date(data.order.created_at).toLocaleDateString('fr-FR'),
      customer: { name: s.name, phone: s.phone || undefined, address: s.address || undefined },
      items, subtotal, total: Number(data.order.total),
      payments: data.pays.map(p => ({ method_name: p.method_name, amount: Number(p.amount) })),
      paid: paidTotal,
      issuedBy: creatorName(data.order.user_id),
    });
  };

  const modalTitle = key === 'info' ? 'Compte fournisseur' : key === 'payment' ? 'Saisir un règlement' : key === 'articles' ? 'Articles liés' : 'Documents d\'achats';

  return (
    <Modal open onClose={onClose} title={modalTitle} size="lg" layer="top"
      footer={<button onClick={onClose} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>}>

      <div className="mb-3 rounded-2xl bg-white border border-slate-200 shadow-sm p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 shrink-0 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-glow">
            <Truck className="w-4 h-4 text-white" />
          </div>
          <div className="text-sm font-bold tracking-tight text-slate-900">{s.name}</div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400">
            {key === 'info' && 'Compte fournisseur · débit / crédit'}
            {key === 'payment' && 'Règlement avec imputation'}
            {key === 'docs' && 'Documents d\'achats · statistiques'}
            {key === 'articles' && `${articles.length} article${articles.length > 1 ? 's' : ''} lié${articles.length > 1 ? 's' : ''}`}
          </div>
          <div className={`text-right ${supplierBalance > 0 ? 'text-amber-700' : supplierBalance < 0 ? 'text-emerald-700' : 'text-slate-500'}`}>
            <div className="text-[9px] font-bold uppercase tracking-wider opacity-70 leading-none">Solde comptable</div>
            <div className="text-sm font-bold tabular-nums leading-none mt-0.5">{loading ? '…' : formatFCFA(supplierBalance)}</div>
          </div>
        </div>
      </div>

      {loading ? <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div> : (
        <>
          {key === 'info' && (
            <SupplierLedgerView supplierName={s.name} ledger={ledger} totalCredit={totals.total} totalDebit={totals.paid} due={totals.due}
              dateFrom={dateFrom} dateTo={dateTo} onOpenPicker={() => setPickerOpen(true)} onClearDates={() => { setDateFrom(''); setDateTo(''); }} />
          )}

          {key === 'payment' && (
            <SupplierPaymentForm
              unpaid={unpaidOrders} methods={methods}
              payOrder={payOrder} setPayOrder={setPayOrder}
              payAmount={payAmount} setPayAmount={setPayAmount}
              payMethod={payMethod} setPayMethod={setPayMethod}
              payRef={payRef} setPayRef={setPayRef}
              paying={paying} onSubmit={submitPayment}
              onSelectOrder={(id: string) => { const o = orders.find(x => x.id === id); if (o) setPayAmount(String(Math.max(0, Number(o.total) - Number(o.paid || 0)))); }}
              recentPayments={payments.slice(0, 8).map(p => ({ ...p, order_number: orders.find(x => x.id === p.order_id)?.order_number }))}
            />
          )}

          {key === 'docs' && (
            <SupplierDocsView
              kpis={docsKpis} yearStats={yearStats} docs={filteredDocs} orderItems={orderItems}
              dateFrom={dateFrom} dateTo={dateTo}
              onOpenPicker={() => setPickerOpen(true)}
              onClearDates={() => { setDateFrom(''); setDateTo(''); }}
              onOpenOrder={openOrder}
            />
          )}

          {key === 'articles' && (
            articles.length === 0 ? (
              <EmptyState icon={ShoppingBag} title="Aucun article lié" description="Aucun article du catalogue n'est rattaché à ce fournisseur pour l'instant." />
            ) : (
              <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr><th className="px-3 py-2 text-left">Réf.</th><th className="px-3 py-2 text-left">Désignation</th><th className="px-3 py-2 text-left">Réf. fourn.</th><th className="px-3 py-2 text-right">Prix vente</th><th className="px-3 py-2 text-center">Statut</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {articles.map(a => (
                      <tr key={a.id}>
                        <td className="px-3 py-2 font-mono text-xs text-brand-700">{a.internal_ref}</td>
                        <td className="px-3 py-2">{a.name}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{a.supplier_ref || '—'}</td>
                        <td className="px-3 py-2 text-right">{formatFCFA(a.sale_price)}</td>
                        <td className="px-3 py-2 text-center">{a.is_active ? <Badge tone="emerald">Actif</Badge> : <Badge tone="slate">Inactif</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}

      <PremiumDateRangePicker open={pickerOpen} onClose={() => setPickerOpen(false)} from={dateFrom} to={dateTo} onApply={(f, t) => { setDateFrom(f); setDateTo(t); setPickerOpen(false); }} />

      {orderView && (
        <OrderViewModal data={orderView} supplierName={s.name} onClose={() => setOrderView(null)} onPrint={() => printOrder(orderView)} />
      )}
    </Modal>
  );
}

/* ───────────────────────── Supplier ledger view ───────────────────────── */
function SupplierLedgerView({ supplierName, ledger, totalCredit, totalDebit, due, dateFrom, dateTo, onOpenPicker, onClearDates }: {
  supplierName: string;
  ledger: { id: string; ts: string; label: string; ref: string; debit: number; credit: number; running: number; kind: string }[];
  totalCredit: number; totalDebit: number; due: number;
  dateFrom: string; dateTo: string; onOpenPicker: () => void; onClearDates: () => void;
}) {
  const [kindFilter, setKindFilter] = useState<'' | 'order' | 'payment'>('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filteredLedger = useMemo(() => {
    let r = ledger;
    if (dateFrom) { const f = new Date(dateFrom); f.setHours(0, 0, 0, 0); r = r.filter(row => new Date(row.ts) >= f); }
    if (dateTo) { const t = new Date(dateTo); t.setHours(23, 59, 59, 999); r = r.filter(row => new Date(row.ts) <= t); }
    if (kindFilter) r = r.filter(row => row.kind === kindFilter);
    return r;
  }, [ledger, dateFrom, dateTo, kindFilter]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof ledger>();
    filteredLedger.slice().reverse().forEach(r => {
      const d = new Date(r.ts); const k = d.toISOString().slice(0, 10);
      if (!map.has(k)) map.set(k, [] as any);
      map.get(k)!.push(r);
    });
    return Array.from(map.entries());
  }, [filteredLedger]);

  const filteredAchats = useMemo(() => filteredLedger.reduce((s, r) => s + r.credit, 0), [filteredLedger]);
  const filteredRegle = useMemo(() => filteredLedger.reduce((s, r) => s + r.debit, 0), [filteredLedger]);
  const filteredDette = filteredAchats - filteredRegle;

  const toggleDay = (day: string) => setExpanded(prev => ({ ...prev, [day]: !prev[day] }));
  const expandAll = () => { const m: Record<string, boolean> = {}; groups.forEach(([d]) => { m[d] = true; }); setExpanded(m); };
  const collapseAll = () => setExpanded({});

  if (ledger.length === 0) {
    return (
      <div className="py-10 text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 mb-3"><FileText className="w-6 h-6" /></div>
        <div className="text-sm font-semibold text-slate-700">Compte vide</div>
        <div className="text-xs text-slate-500 mt-1">Aucun mouvement pour {supplierName}.</div>
      </div>
    );
  }

  return (
    <div>
      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={onOpenPicker} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm">
          <Calendar className="w-3.5 h-3.5 text-slate-400" />
          {dateFrom || dateTo ? (
            <span>{dateFrom && new Date(dateFrom).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} — {dateTo && new Date(dateTo).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>
          ) : (
            <span>Période</span>
          )}
        </button>
        {(dateFrom || dateTo) && (
          <button onClick={onClearDates} className="inline-flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="w-3 h-3" /> Effacer
          </button>
        )}
        <div className="flex items-center gap-1 ml-auto">
          {[{ v: '' as const, l: 'Tout' }, { v: 'order' as const, l: 'Achats' }, { v: 'payment' as const, l: 'Règlements' }].map(o => (
            <button key={o.v} onClick={() => setKindFilter(o.v)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${kindFilter === o.v ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'text-slate-500 hover:bg-slate-100'}`}>
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {/* Expand/collapse controls */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-slate-400 font-semibold">{groups.length} jour{groups.length > 1 ? 's' : ''} · {filteredLedger.length} opération{filteredLedger.length > 1 ? 's' : ''}</span>
        <div className="flex-1" />
        <button onClick={expandAll} className="text-[10px] font-semibold text-brand-600 hover:underline">Tout déplier</button>
        <button onClick={collapseAll} className="text-[10px] font-semibold text-slate-500 hover:underline">Tout replier</button>
      </div>

      <div className="space-y-2 max-h-[50vh] overflow-auto">
        {groups.map(([day, rows]) => {
          const isOpen = expanded[day] ?? false;
          const dayCredit = rows.reduce((s, r) => s + r.credit, 0);
          const dayDebit = rows.reduce((s, r) => s + r.debit, 0);
          return (
            <div key={day} className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
              <button onClick={() => toggleDay(day)} className="w-full px-3 py-2.5 hover:bg-slate-50/70 transition-colors">
                <div className="flex items-center gap-2">
                  <ChevronRight className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  <span className="text-[11px] font-bold text-slate-700 text-left">
                    {new Date(day).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1.5 pl-5.5">
                  <span className="text-[10px] font-medium text-slate-400">{rows.length} opération{rows.length > 1 ? 's' : ''}</span>
                  {dayCredit > 0 && <span className="text-[11px] font-bold text-amber-700 tabular-nums">+{formatFCFA(dayCredit)}</span>}
                  {dayDebit > 0 && <span className="text-[11px] font-bold text-emerald-700 tabular-nums">-{formatFCFA(dayDebit)}</span>}
                </div>
              </button>
              {isOpen && (
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {rows.map(r => (
                    <div key={r.id} className="flex items-center gap-2 px-2.5 py-2">
                      <div className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center ${r.kind === 'order' ? 'bg-amber-50 text-amber-700' : r.kind === 'payment' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                        {r.kind === 'order' ? <ShoppingBag className="w-3.5 h-3.5" /> : r.kind === 'payment' ? <Wallet className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-slate-900">{r.label}</div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-1 flex-wrap">
                          {r.ref && <span className="font-mono">{r.ref}</span>}
                          {r.ref && <span className="text-slate-300">·</span>}
                          <span>{new Date(r.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {r.credit > 0 && <div className="text-[13px] font-bold text-amber-700 tabular-nums whitespace-nowrap">+{formatFCFA(r.credit)}</div>}
                        {r.debit > 0 && <div className="text-[13px] font-bold text-emerald-700 tabular-nums whitespace-nowrap">-{formatFCFA(r.debit)}</div>}
                        {r.debit === 0 && r.credit === 0 && <div className="text-xs text-slate-400">—</div>}
                        <div className="text-[10px] text-slate-400 tabular-nums whitespace-nowrap">Dette {formatFCFA(r.running)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Totals footer */}
      <div className="mt-4 rounded-2xl bg-slate-900 text-white p-3 shadow-premium">
        <div className="grid grid-cols-2 gap-3">
          <div className="text-left">
            <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Achats</div>
            <div className="mt-0.5 text-[13px] sm:text-sm font-bold tabular-nums text-amber-300">{formatFCFA(filteredAchats)}</div>
            {filteredDette > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-700">
                <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Dette</div>
                <div className="mt-0.5 text-sm font-bold tabular-nums text-amber-300">{formatFCFA(filteredDette)}</div>
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Réglements</div>
            <div className="mt-0.5 text-[13px] sm:text-sm font-bold tabular-nums text-emerald-300">{formatFCFA(filteredRegle)}</div>
            {filteredDette < 0 && (
              <div className="mt-2 pt-2 border-t border-slate-700">
                <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Avoir</div>
                <div className="mt-0.5 text-sm font-bold tabular-nums text-emerald-300">{formatFCFA(Math.abs(filteredDette))}</div>
              </div>
            )}
          </div>
          {filteredDette === 0 && (
            <div className="col-span-2 text-center pt-2 border-t border-slate-700">
              <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Solde</div>
              <div className="mt-0.5 text-sm font-bold tabular-nums text-white">0 FCFA</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Supplier payment form ───────────────────────── */
function SupplierPaymentForm({
  unpaid, methods, payOrder, setPayOrder, payAmount, setPayAmount, payMethod, setPayMethod,
  payRef, setPayRef, paying, onSubmit, onSelectOrder, recentPayments,
}: any) {
  const selected = unpaid.find((o: any) => o.id === payOrder);
  const due = selected ? Math.max(0, Number(selected.total) - Number(selected.paid || 0)) : 0;
  const amt = Number(payAmount) || 0;
  const remaining = Math.max(0, due - amt);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 text-white p-5 shadow-premium">
        <div className="text-[10px] uppercase tracking-wider font-bold text-white/70">Montant à régler</div>
        <div className="mt-1 flex items-baseline gap-2">
          <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
            className="bg-transparent text-3xl font-bold tracking-tight focus:outline-none flex-1 min-w-0 placeholder:text-white/30" placeholder="0" min={0} />
          <span className="text-sm font-semibold text-white/70">FCFA</span>
        </div>
        {selected && (
          <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px]">
            <span className="text-white/60">Dû sur cette commande</span>
            <span className="font-bold tabular-nums">{formatFCFA(due)}</span>
          </div>
        )}
        {selected && amt > 0 && (
          <div className="flex items-center justify-between text-[11px] mt-1">
            <span className="text-white/60">Reste après règlement</span>
            <span className={`font-bold tabular-nums ${remaining === 0 ? 'text-emerald-300' : 'text-amber-300'}`}>{formatFCFA(remaining)}</span>
          </div>
        )}
      </div>

      <div>
        <label className="label">Imputer sur la commande</label>
        <SearchableSelect
          options={[
            { value: '', label: 'Acompte libre (sans commande)' },
            ...unpaid.map((o: any) => {
              const d = Math.max(0, Number(o.total) - Number(o.paid || 0));
              return { value: o.id, label: `${o.order_number} · du ${formatFCFA(d)}` };
            })
          ]}
          value={payOrder}
          onChange={v => { setPayOrder(v); onSelectOrder(v); }}
          placeholder="Acompte libre (sans commande)"
        />
        {unpaid.length === 0 && <div className="text-xs text-emerald-700 mt-1.5 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" />Toutes les commandes sont soldées.</div>}
      </div>

      <div>
        <label className="label">Mode de règlement</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {methods.map((m: any) => (
            <button key={m.id} type="button" onClick={() => setPayMethod(m.id)}
              className={`px-3 py-2.5 rounded-xl text-xs font-semibold border-2 transition-all ${payMethod === m.id ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
              {m.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Référence (optionnel)</label>
        <input value={payRef} onChange={e => setPayRef(e.target.value)} className="input" placeholder="N° chèque, virement…" />
      </div>

      <button onClick={onSubmit} disabled={paying || amt <= 0} className="btn-primary w-full justify-center py-3 text-sm">
        {paying && <Loader2 className="w-4 h-4 animate-spin" />}
        Valider le règlement
      </button>

      {recentPayments.length > 0 && (
        <div>
          <div className="text-[11px] font-bold tracking-wider uppercase text-slate-400 mb-2 px-1">Derniers règlements</div>
          <div className="space-y-1">
            {recentPayments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800 truncate">{p.method_name}{p.reference ? ` · ${p.reference}` : ''}</div>
                  <div className="text-[11px] text-slate-500">{p.order_number || 'Acompte libre'} · {formatDateTime(p.paid_at || p.created_at)}</div>
                </div>
                <div className="font-bold text-emerald-700">{formatFCFA(p.amount)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Supplier docs view ───────────────────────── */
function SupplierDocsView({ kpis, yearStats, docs, orderItems, dateFrom, dateTo, onOpenPicker, onClearDates, onOpenOrder }: any) {
  const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  const maxMonth = Math.max(1, ...yearStats.months.map((m: any) => m.total));
  const [statsOpen, setStatsOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-slate-200 p-2.5 min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Commandes</div>
          <div className="mt-0.5 text-[15px] font-bold text-slate-900 tabular-nums">{kpis.count}</div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/40 p-2.5 min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-neutral-700 font-bold">Achats</div>
          <div className="mt-0.5 text-[13px] font-bold text-neutral-900 tabular-nums break-words">{formatFCFA(kpis.achats)}</div>
        </div>
        <div className={`rounded-2xl border p-2.5 min-w-0 ${kpis.due > 0 ? 'border-amber-200 bg-amber-50/40' : 'border-emerald-200 bg-emerald-50/40'}`}>
          <div className={`text-[9px] uppercase tracking-wider font-bold ${kpis.due > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>Dette</div>
          <div className={`mt-0.5 text-[13px] font-bold tabular-nums break-words ${kpis.due > 0 ? 'text-amber-800' : 'text-emerald-800'}`}>{formatFCFA(kpis.due)}</div>
        </div>
      </div>

      <div>
        <button onClick={() => setStatsOpen(v => !v)} className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-2xl border border-slate-200 bg-white hover:border-brand-300 transition-all">
          <span className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center"><Calendar className="w-3.5 h-3.5" /></span>
            <span className="text-[12px] font-bold text-slate-900">Statistiques {yearStats.year}</span>
            <span className="text-[10px] text-slate-400 font-semibold">jan → déc</span>
          </span>
          <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${statsOpen ? 'rotate-90' : ''}`} />
        </button>
        {statsOpen && (
          <div className="mt-2 rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
            {yearStats.months.map((m: any) => {
              const pct = m.total > 0 ? (m.total / maxMonth) * 100 : 0;
              const due = Math.max(0, m.total - m.paid);
              return (
                <div key={m.m} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]">
                  <div className="w-8 text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">{monthNames[m.m]}</div>
                  <div className="w-6 text-center text-[10px] font-semibold text-slate-600 tabular-nums shrink-0">{m.count}</div>
                  <div className="flex-1 min-w-0">
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-brand-500 to-brand-700 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="text-right font-semibold text-slate-800 tabular-nums whitespace-nowrap shrink-0">{formatFCFA(m.total)}</div>
                  <div className={`text-right text-[10px] font-semibold tabular-nums whitespace-nowrap shrink-0 hidden sm:block ${due > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{due > 0 ? formatFCFA(due) : 'Soldée'}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <button onClick={onOpenPicker} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${dateFrom || dateTo ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'}`}>
            <Calendar className="w-3.5 h-3.5" />
            {dateFrom && dateTo ? `${formatDate(dateFrom)} → ${formatDate(dateTo)}` : dateFrom ? `Depuis ${formatDate(dateFrom)}` : dateTo ? `Jusqu'au ${formatDate(dateTo)}` : 'Période'}
          </button>
          {(dateFrom || dateTo) && <button onClick={onClearDates} className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1">Effacer <X className="w-3 h-3" /></button>}
          <span className="ml-auto text-[11px] text-slate-500">{docs.length} document{docs.length > 1 ? 's' : ''}</span>
        </div>
        {docs.length === 0 ? <div className="text-sm text-slate-500 py-8 text-center">Aucune commande sur cette période.</div> : (
          <div className="space-y-1.5">
            {docs.map((o: any) => {
              const items = (orderItems || []).filter((it: any) => it.order_id === o.id);
              const qty = items.reduce((a: number, it: any) => a + Number(it.quantity_ordered || 0), 0);
              const avgPU = qty > 0 ? items.reduce((a: number, it: any) => a + Number(it.unit_price || 0) * Number(it.quantity_ordered || 0), 0) / qty : 0;
              const designation = items.length === 0
                ? o.order_number
                : items.length === 1
                  ? items[0].name
                  : `${items[0].name} + ${items.length - 1} article${items.length - 1 > 1 ? 's' : ''}`;
              return (
                <button key={o.id} onClick={() => onOpenOrder(o.id)} className="w-full rounded-2xl border border-slate-200 bg-white hover:border-brand-300 hover:shadow-md transition-all px-3 py-2.5 text-left active:scale-[0.995]">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-slate-900 line-clamp-2 leading-snug article-text">{designation}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-brand-700 font-semibold">{o.order_number}</span>
                        <span className="text-slate-300">·</span>
                        <span>{formatDateTime(o.created_at)}</span>
                      </div>
                    </div>
                    <StatusBadgeOrder order={o} />
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-100 grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Quantité</div>
                      <div className="font-semibold text-slate-800 tabular-nums">{qty.toLocaleString('fr-FR')}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">PU moyen</div>
                      <div className="font-semibold text-slate-800 tabular-nums">{formatFCFA(avgPU)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Total</div>
                      <div className="font-bold text-brand-700 tabular-nums whitespace-nowrap">{formatFCFA(o.total)}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Supplier order viewer modal ───────────────────────── */
function OrderViewModal({ data, supplierName, onClose, onPrint }: { data: { order: any; items: any[]; pays: any[] }; supplierName: string; onClose: () => void; onPrint: () => void }) {
  const { order, items, pays } = data;
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="scrim" onClick={onClose} />
      <div className="relative w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-premium animate-sheet-up sm:animate-scale-in max-h-[92vh] flex flex-col">
        <div className="sm:hidden sheet-handle" />
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Commande</div>
            <div className="text-base font-bold text-slate-900 font-mono">{order.order_number}</div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onPrint} className="btn-secondary text-xs py-1.5 px-3"><FileText className="w-3.5 h-3.5" />Imprimer</button>
            <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-500"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="flex flex-wrap gap-3 text-sm">
            <div><div className="text-[10px] uppercase text-slate-400 font-bold">Fournisseur</div><div className="font-semibold">{supplierName}</div></div>
            <div><div className="text-[10px] uppercase text-slate-400 font-bold">Date</div><div className="font-semibold">{formatDateTime(order.created_at)}</div></div>
            <div className="ml-auto"><div className="text-[10px] uppercase text-slate-400 font-bold">Statut</div><StatusBadgeOrder order={order} /></div>
          </div>
          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2 text-left">Article</th><th className="px-3 py-2 text-right">Qté</th><th className="px-3 py-2 text-right">PU</th><th className="px-3 py-2 text-right">Total</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it: any, i: number) => (
                  <tr key={i}><td className="px-3 py-2">{it.name}</td><td className="px-3 py-2 text-right tabular-nums">{Number(it.quantity_ordered).toLocaleString('fr-FR')}</td><td className="px-3 py-2 text-right tabular-nums">{formatFCFA(it.unit_price)}</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{formatFCFA(it.total)}</td></tr>
                ))}
                {items.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400 text-xs">Aucune ligne.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <div className="w-full sm:w-80 rounded-2xl bg-slate-900 text-white p-4 space-y-1.5">
              <Line label="Sous-total" value={formatFCFA(items.reduce((a: number, it: any) => a + Number(it.total), 0))} />
              <Line label="Total" value={formatFCFA(order.total)} strong />
              <div className="pt-2 mt-2 border-t border-white/10 space-y-1">
                {pays.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between text-[12px] text-white/80"><span>{p.method_name}</span><span className="tabular-nums">{formatFCFA(p.amount)}</span></div>
                ))}
                {pays.length === 0 && <div className="text-[12px] text-white/60 text-center py-1">Aucun règlement</div>}
              </div>
              <Line label="Payé" value={formatFCFA(order.paid || 0)} tone="emerald" />
              <Line label="Dette" value={formatFCFA(Math.max(0, Number(order.total) - Number(order.paid || 0)))} tone="amber" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function StatusBadgeSale({ sale }: { sale: any }) {
  if (sale.status === 'cancelled') return <Badge tone="slate">Annulée</Badge>;
  if (Number(sale.paid) >= Number(sale.total)) return <Badge tone="emerald">Payée</Badge>;
  if (Number(sale.paid) > 0) return <Badge tone="amber">Partielle</Badge>;
  return <Badge tone="red">Impayée</Badge>;
}
function StatusBadgeOrder({ order }: { order: any }) {
  const total = Number(order.total); const paid = Number(order.paid || 0);
  if (order.status === 'cancelled') return <Badge tone="slate">Annulée</Badge>;
  if (paid >= total && total > 0) return <Badge tone="emerald">Réglée</Badge>;
  if (paid > 0) return <Badge tone="amber">Partielle</Badge>;
  return <Badge tone="sky">Ouverte</Badge>;
}

function ExceptionPricingView({ customerId }: { customerId: string }) {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const [prices, setPrices] = useState<any[]>([]);
  const [articles, setArticles] = useState<{ id: string; name: string; internal_ref: string; sale_price: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [newArticleId, setNewArticleId] = useState('');
  const [newPrice, setNewPrice] = useState<number | ''>('');
  const [newNote, setNewNote] = useState('');

  const load = async () => {
    if (!tenant) return;
    setLoading(true);
    const [{ data: ep }, { data: arts }] = await Promise.all([
      supabase.from('customer_exception_prices').select('*, articles(name, internal_ref, sale_price)').eq('tenant_id', tenant.id).eq('customer_id', customerId).order('created_at', { ascending: false }),
      supabase.from('articles').select('id, name, internal_ref, sale_price').eq('tenant_id', tenant.id).eq('is_active', true).order('name'),
    ]);
    setPrices(ep || []);
    setArticles(arts || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [customerId]);

  const addPrice = async () => {
    if (!tenant || !newArticleId || newPrice === '' || Number(newPrice) < 0) return;
    setSaving(true);
    const { error: e } = await supabase.from('customer_exception_prices').upsert({
      tenant_id: tenant.id,
      customer_id: customerId,
      article_id: newArticleId,
      exception_price: Number(newPrice),
      note: newNote,
    }, { onConflict: 'tenant_id,customer_id,article_id' });
    setSaving(false);
    if (e) error(e.message);
    else { success('Tarif ajouté'); setNewArticleId(''); setNewPrice(''); setNewNote(''); load(); }
  };

  const removePrice = async (id: string) => {
    await supabase.from('customer_exception_prices').delete().eq('id', id);
    success('Tarif supprimé');
    load();
  };

  const existingArticleIds = new Set(prices.map((p: any) => p.article_id));
  const availableArticles = articles.filter(a => !existingArticleIds.has(a.id));
  const filteredAvailable = search
    ? availableArticles.filter(a => a.name.toLowerCase().includes(search.toLowerCase()) || a.internal_ref.toLowerCase().includes(search.toLowerCase()))
    : availableArticles;

  if (loading) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>;

  return (
    <div className="space-y-4">
      {/* Add new exception price */}
      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Ajouter un tarif d'exception</div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_1fr_auto] gap-2 items-end">
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase mb-0.5 block">Article</label>
            <SearchableSelect
              options={filteredAvailable.map(a => ({ value: a.id, label: a.name, sublabel: `${a.internal_ref} — ${formatFCFA(a.sale_price)}` }))}
              value={newArticleId}
              onChange={v => {
                setNewArticleId(v);
                const art = articles.find(a => a.id === v);
                if (art && newPrice === '') setNewPrice(art.sale_price);
              }}
              placeholder="— Choisir un article —"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase mb-0.5 block">Prix spécial</label>
            <input type="number" min={0} value={newPrice} onChange={e => setNewPrice(Number(e.target.value))} className="input text-xs" placeholder="FCFA" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase mb-0.5 block">Note</label>
            <input value={newNote} onChange={e => setNewNote(e.target.value)} className="input text-xs" placeholder="Optionnelle" />
          </div>
          <button onClick={addPrice} disabled={saving || !newArticleId || newPrice === ''} className="btn-primary text-xs h-9 px-3 whitespace-nowrap">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Ajouter
          </button>
        </div>
      </div>

      {/* Existing exception prices */}
      {prices.length === 0 ? (
        <div className="text-center py-6 text-slate-400 text-sm">
          Aucun tarif d'exception configuré pour ce client.
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 px-1">
            {prices.length} tarif{prices.length > 1 ? 's' : ''} configuré{prices.length > 1 ? 's' : ''}
          </div>
          {prices.map((p: any) => {
            const art = p.articles;
            const normalPrice = art?.sale_price || 0;
            const diff = Number(p.exception_price) - normalPrice;
            const pct = normalPrice > 0 ? ((diff / normalPrice) * 100).toFixed(1) : '0';
            return (
              <div key={p.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">{art?.name || 'Article supprimé'}</div>
                  <div className="text-[10px] text-slate-400 font-mono">{art?.internal_ref || '-'}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-bold text-slate-900 num">{formatFCFA(p.exception_price)}</div>
                  <div className={`text-[10px] font-semibold ${diff < 0 ? 'text-emerald-600' : diff > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                    {diff < 0 ? '' : '+'}{pct}% vs {formatFCFA(normalPrice)}
                  </div>
                </div>
                {p.note && <div className="text-[10px] text-slate-400 max-w-[80px] truncate shrink-0" title={p.note}>{p.note}</div>}
                <button onClick={() => removePrice(p.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Balance Quick Select ───────────────────────── */
function BalanceQuickSelect({ open, onClose, customers, suppliers, onSelect, tab }: {
  open: boolean; onClose: () => void;
  customers: Customer[]; suppliers: Supplier[];
  onSelect: (id: string, name: string, type: 'customer' | 'supplier', balance: number) => void;
  tab: 'customers' | 'suppliers';
}) {
  const [search, setSearch] = useState('');
  const items = tab === 'customers'
    ? customers.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()))
    : suppliers.filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()));

  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title={`Positionner un solde - ${tab === 'customers' ? 'Client' : 'Fournisseur'}`} size="md">
      <div className="space-y-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input text-xs"
          placeholder="Rechercher un tiers..."
          autoFocus
        />
        <div className="max-h-72 overflow-y-auto space-y-1">
          {items.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Aucun résultat</p>}
          {items.map((item: any) => (
            <button
              key={item.id}
              onClick={() => { onClose(); onSelect(item.id, item.name, tab === 'customers' ? 'customer' : 'supplier', Number(item.balance || 0)); }}
              className="w-full flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 hover:border-brand-300 hover:bg-brand-50/30 transition-all text-left"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 truncate">{item.name}</div>
                <div className="text-[10px] text-slate-400">{item.phone || item.email || '-'}</div>
              </div>
              <div className="text-right shrink-0">
                <div className={`text-xs font-bold num ${Number(item.balance || 0) > 0 ? 'text-amber-600' : Number(item.balance || 0) < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {formatFCFA(Number(item.balance || 0))}
                </div>
                <div className="text-[9px] text-slate-400">solde actuel</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
