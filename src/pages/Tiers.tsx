import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Users, Truck, Loader2, CreditCard as Edit2, PowerOff,
  X, Calendar, FileText, Wallet, Info, ChevronRight, Phone,
  ShoppingBag, Check, Printer, Tag, Trash2,
  Download, Upload, Scale, RotateCcw, Save, Search, ChevronDown, TrendingUp
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

type TabKey = 'all' | 'customers' | 'suppliers';
type CustomerOptionKey = 'info' | 'payment' | 'docs' | 'pricing' | null;
type SupplierOptionKey = 'info' | 'payment' | 'docs' | 'articles' | null;
type SelectedRow = { id: string; type: 'customer' | 'supplier'; data: Customer | Supplier } | null;

export function Tiers() {
  const { tenant, currentSite, sites, profile, dataTick } = useApp();
  const { can } = usePermissions();
  const { t } = useTranslation();
  const { success, error } = useToast();
  const sharedCustomers = (tenant as any)?.settings?.shared_customers !== false;
  const sharedSuppliers = (tenant as any)?.settings?.shared_suppliers !== false;
  const [tab, setTab] = useState<TabKey>('all');
  const [selectedRow, setSelectedRow] = useState<SelectedRow>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [dueMap, setDueMap] = useState<Record<string, number>>({});
  const [paidMap, setPaidMap] = useState<Record<string, number>>({});
  const [totalMap, setTotalMap] = useState<Record<string, number>>({});
  const [supDueMap, setSupDueMap] = useState<Record<string, { total: number; paid: number; due: number }>>({});
  const [prepayMap, setPrepayMap] = useState<Record<string, number>>({});
  const [avoirMap, setAvoirMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);

  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Create menu (top + button dropdown)
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const [createMenuPos, setCreateMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const createDropdownRef = useRef<HTMLDivElement>(null);

  const updateCreateMenuPos = useCallback(() => {
    if (!createBtnRef.current) return;
    const rect = createBtnRef.current.getBoundingClientRect();
    setCreateMenuPos({ top: rect.bottom + 6, left: rect.right - 220 });
  }, []);

  useEffect(() => {
    if (!createMenuOpen) return;
    updateCreateMenuPos();
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (createBtnRef.current?.contains(target)) return;
      if (createDropdownRef.current?.contains(target)) return;
      setCreateMenuOpen(false);
    }
    window.addEventListener('scroll', updateCreateMenuPos, true);
    window.addEventListener('resize', updateCreateMenuPos);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('scroll', updateCreateMenuPos, true);
      window.removeEventListener('resize', updateCreateMenuPos);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [createMenuOpen, updateCreateMenuPos]);

  const createMenuDropdown = createMenuOpen ? createPortal(
    <div
      ref={createDropdownRef}
      style={{ position: 'fixed', top: createMenuPos.top, left: createMenuPos.left, width: 220, zIndex: 9999 }}
      className="bg-white border border-slate-200 rounded-xl shadow-lg shadow-slate-200/60 overflow-hidden"
    >
      <button
        onClick={() => { openCustCreate(); setCreateMenuOpen(false); }}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition-colors"
      >
        <Users className="w-4 h-4 text-slate-500 shrink-0" />
        <span className="font-semibold text-slate-900 whitespace-nowrap">Nouveau client</span>
      </button>
      <button
        onClick={() => { openSupCreate(); setCreateMenuOpen(false); }}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition-colors border-t border-slate-100"
      >
        <Truck className="w-4 h-4 text-slate-500 shrink-0" />
        <span className="font-semibold text-slate-900 whitespace-nowrap">Nouveau fournisseur</span>
      </button>
    </div>,
    document.body
  ) : null;

  // Options sheet (click on a tier row/card)
  const [optCust, setOptCust] = useState<Customer | null>(null);
  const [optSup, setOptSup] = useState<Supplier | null>(null);

  // Sub-modal selection
  const [custView, setCustView] = useState<{ c: Customer; key: CustomerOptionKey } | null>(null);
  const [supView, setSupView] = useState<{ s: Supplier; key: SupplierOptionKey } | null>(null);

  const load = async (silent = false) => {
    if (!tenant) return;
    if (!silent) setLoading(true);
    let custQuery = supabase.from('customers').select('id, name, phone, email, address, customer_type, whatsapp, is_active, tenant_id, site_id, credit_limit, balance, account_code').eq('tenant_id', tenant.id).order('name');
    if (!sharedCustomers && currentSite) {
      custQuery = custQuery.eq('site_id', currentSite.id);
    }
    let supQuery = supabase.from('suppliers').select('id, name, phone, email, address, whatsapp, is_active, tenant_id, site_id, balance, credit_limit, account_code').eq('tenant_id', tenant.id).order('name');
    if (!sharedSuppliers && currentSite) {
      supQuery = supQuery.eq('site_id', currentSite.id);
    }
    const [cRes, sRes, salesRes, soRes, supPayRes, prepaysRes, avoirsRes] = await Promise.all([
      custQuery,
      supQuery,
      supabase.from('sales').select('customer_id, total, paid, status').eq('tenant_id', tenant.id).not('customer_id', 'is', null).neq('status', 'cancelled').limit(5000),
      supabase.from('supplier_orders').select('supplier_id, total, paid, status').eq('tenant_id', tenant.id).neq('status', 'cancelled').limit(5000),
      supabase.from('supplier_payments').select('supplier_id, amount').eq('tenant_id', tenant.id).limit(5000),
      supabase.from('customer_prepayments').select('customer_id, amount, amount_used').eq('tenant_id', tenant.id).limit(5000),
      supabase.from('sale_returns').select('customer_id, total, credit_used').eq('tenant_id', tenant.id).eq('status', 'approved').eq('refund_method', 'avoir').limit(5000),
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

    const ppm: Record<string, number> = {};
    (prepaysRes.data || []).forEach((p: any) => {
      const unused = Math.max(0, Number(p.amount) - Number(p.amount_used));
      if (p.customer_id) ppm[p.customer_id] = (ppm[p.customer_id] || 0) + unused;
    });
    setPrepayMap(ppm);

    const avm: Record<string, number> = {};
    (avoirsRes.data || []).forEach((a: any) => {
      const unused = Math.max(0, Number(a.total) - Number(a.credit_used));
      if (a.customer_id) avm[a.customer_id] = (avm[a.customer_id] || 0) + unused;
    });
    setAvoirMap(avm);

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
    if (statusFilter === 'active') r = r.filter(c => (c as any).is_active !== false);
    if (statusFilter === 'inactive') r = r.filter(c => (c as any).is_active === false);
    const q = search.toLowerCase().trim();
    if (!q) return r;
    return r.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      ((c as any).whatsapp || '').includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.customer_type || '').toLowerCase().includes(q) ||
      ((c as any).account_code || '').toLowerCase().includes(q)
    );
  }, [customers, search, statusFilter]);

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
      (s.country || '').toLowerCase().includes(q) ||
      ((s as any).account_code || '').toLowerCase().includes(q)
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
  const openCustCreate = () => { setCustEdit(null); setCustForm({ customer_type: 'particulier', is_active: true }); setCustErrors({}); setCustTouched({}); setCustOpen(true); setCreateMenuOpen(false); };
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
    if (!can('delete_customers')) { error('Vous n\'avez pas la permission de supprimer les clients'); return; }
    const { error: hardErr } = await supabase.rpc('tenant_delete_customer_safe', { p_id: toDeactivateCust.id });
    if (!hardErr) { success('Client supprimé définitivement'); setToDeactivateCust(null); load(); return; }
    const { error: e } = await supabase.from('customers').update({ is_active: false }).eq('id', toDeactivateCust.id);
    if (e) error(e.message);
    else { success('Client désactivé (opérations associées conservées)'); setToDeactivateCust(null); load(); }
  };

  const reactivateCust = async (c: Customer) => {
    if (!can('delete_customers')) { error('Vous n\'avez pas la permission'); return; }
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
  const openSupCreate = () => { setSupEdit(null); setSupForm({ country: 'Sénégal', is_active: true }); setSupErrors({}); setSupTouched({}); setSupOpen(true); setCreateMenuOpen(false); };
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
    if (!can('delete_customers')) { error('Vous n\'avez pas la permission de supprimer les fournisseurs'); return; }
    const { error: hardErr } = await supabase.rpc('tenant_delete_supplier_safe', { p_id: toDeactivateSup.id });
    if (!hardErr) { success('Fournisseur supprimé définitivement'); setToDeactivateSup(null); load(); return; }
    const { error: e } = await supabase.from('suppliers').update({ is_active: false }).eq('id', toDeactivateSup.id);
    if (e) error(e.message);
    else { success('Fournisseur désactivé (opérations associées conservées)'); setToDeactivateSup(null); load(); }
  };

  const reactivateSup = async (s: Supplier) => {
    if (!can('delete_customers')) { error('Vous n\'avez pas la permission'); return; }
    const { error: e } = await supabase.from('suppliers').update({ is_active: true }).eq('id', s.id);
    if (e) error(e.message);
    else { success('Fournisseur réactivé'); load(); }
  };

  const activeCustCount = customers.filter(c => (c as any).is_active !== false).length;
  const activeSupCount = suppliers.filter(s => s.is_active).length;



  // Import / Export
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importFilename, setImportFilename] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);

  // Balance adjustment
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [balanceTarget, setBalanceTarget] = useState<{ id: string; name: string; type: 'customer' | 'supplier'; currentBalance: number; prepay: number; avoir: number } | null>(null);
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

  const reconcileBalances = async () => {
    if (!tenant || reconciling) return;
    setReconciling(true);
    try {
      const { data, error } = await supabase.rpc('reconcile_customer_balances', { p_tenant_id: tenant.id });
      if (error) throw error;
      const count = data?.corrected_count || 0;
      if (count > 0) {
        success(`Rapprochement terminé : ${count} client(s) corrigé(s), ${formatFCFA(data.total_reduced)} déduit(s)`);
        load();
      } else {
        success('Tous les soldes sont déjà corrects.');
      }
    } catch (e: any) {
      error('Erreur lors du rapprochement : ' + (e.message || ''));
    } finally {
      setReconciling(false);
    }
  };

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

  const openBalanceAdjust = async (id: string, name: string, type: 'customer' | 'supplier', currentBalance: number, prepay = 0, avoir = 0) => {
    let freshPrepay = prepay;
    let freshAvoir = avoir;
    let freshBalance = currentBalance;
    if (tenant) {
      const [ppRes, avRes, balRes] = await Promise.all([
        supabase.from('customer_prepayments').select('amount, amount_used').eq('tenant_id', tenant.id).eq('customer_id', id),
        supabase.from('sale_returns').select('total, credit_used').eq('tenant_id', tenant.id).eq('customer_id', id).eq('status', 'approved').eq('refund_method', 'avoir'),
        type === 'customer'
          ? supabase.from('customers').select('balance').eq('id', id).maybeSingle()
          : supabase.from('suppliers').select('balance').eq('id', id).maybeSingle(),
      ]);
      freshPrepay = (ppRes.data || []).reduce((a: number, p: any) => a + Math.max(0, Number(p.amount) - Number(p.amount_used)), 0);
      freshAvoir = (avRes.data || []).reduce((a: number, r: any) => a + Math.max(0, Number(r.total) - Number(r.credit_used)), 0);
      if (balRes.data) freshBalance = Number(balRes.data.balance || 0);
    }
    setBalanceTarget({ id, name, type, currentBalance: freshBalance, prepay: freshPrepay, avoir: freshAvoir });
    setBalanceAmount(String(freshBalance));
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

  const unifiedRows = useMemo(() => {
    type Row = { id: string; type: 'customer' | 'supplier'; accountCode: string; name: string; phone: string; balance: number; isActive: boolean; raw: any };
    const rows: Row[] = [];
    if (tab !== 'suppliers') {
      for (const c of filteredCustomers) {
        const rawBal = Number((c as any).balance || 0);
        const prepay = prepayMap[c.id] || 0;
        const avoir = avoirMap[c.id] || 0;
        const applied = Math.min(prepay, Math.max(0, rawBal));
        const avoirApp = Math.min(avoir, Math.max(0, rawBal - applied));
        const netBal = rawBal - applied - avoirApp;
        rows.push({ id: c.id, type: 'customer', accountCode: (c as any).account_code || '', name: c.name, phone: c.phone || '', balance: netBal, isActive: (c as any).is_active !== false, raw: c });
      }
    }
    if (tab !== 'customers') {
      for (const s of filteredSuppliers) {
        rows.push({ id: s.id, type: 'supplier', accountCode: (s as any).account_code || '', name: s.name, phone: s.phone || '', balance: Number(s.balance || 0), isActive: s.is_active, raw: s });
      }
    }
    return rows;
  }, [tab, filteredCustomers, filteredSuppliers, prepayMap, avoirMap]);

  const handleRowClick = (row: typeof unifiedRows[0]) => {
    if (selectedRow?.id === row.id) { setSelectedRow(null); return; }
    setSelectedRow({ id: row.id, type: row.type, data: row.raw });
  };

  const handleActionInterroger = () => {
    if (!selectedRow) return;
    if (selectedRow.type === 'customer') setCustView({ c: selectedRow.data as Customer, key: 'info' });
    else setSupView({ s: selectedRow.data as Supplier, key: 'info' });
  };
  const handleActionBalance = () => {
    if (!selectedRow) return;
    const d = selectedRow.data;
    if (selectedRow.type === 'customer') {
      const c = d as Customer;
      openBalanceAdjust(c.id, c.name, 'customer', Number((c as any).balance || 0), prepayMap[c.id] || 0, avoirMap[c.id] || 0);
    } else {
      const s = d as Supplier;
      openBalanceAdjust(s.id, s.name, 'supplier', Number(s.balance || 0));
    }
  };
  const handleActionPricing = () => {
    if (!selectedRow || selectedRow.type !== 'customer') return;
    setCustView({ c: selectedRow.data as Customer, key: 'pricing' });
  };
  const handleActionPayment = () => {
    if (!selectedRow) return;
    if (selectedRow.type === 'customer') setCustView({ c: selectedRow.data as Customer, key: 'payment' });
    else setSupView({ s: selectedRow.data as Supplier, key: 'payment' });
  };
  const handleActionDocs = () => {
    if (!selectedRow) return;
    if (selectedRow.type === 'customer') setCustView({ c: selectedRow.data as Customer, key: 'docs' });
    else setSupView({ s: selectedRow.data as Supplier, key: 'docs' });
  };
  const handleActionEdit = () => {
    if (!selectedRow) return;
    if (selectedRow.type === 'customer') openCustEdit(selectedRow.data as Customer);
    else openSupEdit(selectedRow.data as Supplier);
  };
  const handleActionDeactivate = () => {
    if (!selectedRow) return;
    if (selectedRow.type === 'customer') setToDeactivateCust(selectedRow.data as Customer);
    else setToDeactivateSup(selectedRow.data as Supplier);
  };

  const filterTabs: { k: TabKey; l: string; count: number; Icon: typeof Users }[] = [
    { k: 'all', l: 'Tous', count: activeCustCount + activeSupCount, Icon: Users },
    { k: 'customers', l: 'Clients', count: activeCustCount, Icon: Users },
    { k: 'suppliers', l: 'Fournisseurs', count: activeSupCount, Icon: Truck },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top bar ── */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-3 sm:px-4 py-2 sm:py-2.5">
        {/* Row 1: title + action buttons (desktop: all on one row) */}
        <div className="flex items-center gap-2 sm:gap-3">
          <h1 className="text-sm font-bold tracking-tight text-slate-900 whitespace-nowrap">Gestion des tiers</h1>
          {/* Search — hidden on mobile row 1, shown on desktop */}
          <div className="hidden sm:flex flex-1 min-w-0 items-center gap-1.5 px-1 py-1.5">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              value={searchInput}
              onChange={e => { setSearchInput(e.target.value); if (searchTimerRef.current) clearTimeout(searchTimerRef.current); searchTimerRef.current = setTimeout(() => setSearch(e.target.value), 250); }}
              placeholder="Rechercher"
              className="flex-1 min-w-0 bg-transparent text-xs focus:outline-none placeholder:text-slate-400"
            />
            {searchInput && (
              <button onClick={() => { setSearchInput(''); setSearch(''); }} className="p-0.5 text-slate-400 hover:text-slate-600"><X className="w-3 h-3" /></button>
            )}
          </div>
          <div className="flex-1 sm:hidden" />
          <button
            onClick={() => setStatusFilter(prev => prev === 'active' ? '' : 'active')}
            className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700 transition-colors"
            title="Afficher uniquement les tiers actifs"
          >
            <span className="relative inline-flex items-center">
              <span className={`w-7 h-4 rounded-full transition-colors ${statusFilter === 'active' ? 'bg-neutral-800' : 'bg-slate-300'}`} />
              <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${statusFilter === 'active' ? 'translate-x-3' : ''}`} />
            </span>
            <span className="hidden md:inline">Actifs</span>
          </button>
          <div className="flex items-center gap-1.5">
            <button onClick={reconcileBalances} disabled={reconciling} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black text-white text-[11px] font-semibold hover:bg-neutral-800 disabled:opacity-40 transition-colors" title="Rapprochement des soldes"><RotateCcw className={`w-3.5 h-3.5 ${reconciling ? 'animate-spin' : ''}`} /><span className="hidden lg:inline">Rapprochement</span></button>
            <button onClick={exportTiers} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black text-white text-[11px] font-semibold hover:bg-neutral-800 transition-colors" title="Exporter"><Download className="w-3.5 h-3.5" /><span className="hidden lg:inline">Exporter</span></button>
            <button onClick={() => { setImportRows([]); setImportFilename(''); setImportResult(null); setImportExportOpen(true); }} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black text-white text-[11px] font-semibold hover:bg-neutral-800 transition-colors" title="Importer"><Upload className="w-3.5 h-3.5" /><span className="hidden lg:inline">Importer</span></button>
            <div className="relative">
              <button ref={createBtnRef} onClick={() => setCreateMenuOpen(v => !v)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black text-white text-[11px] font-semibold hover:bg-neutral-800 transition-colors" aria-label="Nouveau tiers"><Plus className="w-4 h-4" /><span className="hidden lg:inline">Créer</span></button>
              {createMenuOpen && createMenuDropdown}
            </div>
          </div>
        </div>
        {/* Row 2: search bar (mobile only) */}
        <div className="sm:hidden mt-2 flex items-center gap-1.5 px-1 py-1.5">
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            value={searchInput}
            onChange={e => { setSearchInput(e.target.value); if (searchTimerRef.current) clearTimeout(searchTimerRef.current); searchTimerRef.current = setTimeout(() => setSearch(e.target.value), 250); }}
            placeholder="Rechercher"
            className="flex-1 min-w-0 bg-transparent text-xs focus:outline-none placeholder:text-slate-400"
          />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); setSearch(''); }} className="p-0.5 text-slate-400 hover:text-slate-600"><X className="w-3 h-3" /></button>
          )}
        </div>
        {/* Row 3: filter tabs (mobile only, wrapping) */}
        <div className="sm:hidden mt-2 flex items-center divide-x divide-slate-200">
          {filterTabs.map(ft => (
            <button
              key={ft.k}
              onClick={() => { setTab(ft.k); setSelectedRow(null); }}
              className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-semibold transition-colors ${tab === ft.k ? 'text-black' : 'text-slate-400'}`}
            >
              {ft.l} <span className="num">{ft.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Body: filter panel + table ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left filter panel — desktop */}
        <aside className="hidden md:flex flex-col w-48 shrink-0 bg-white border-r border-slate-200 py-3 divide-y divide-slate-100">
          {filterTabs.map(ft => {
            const active = tab === ft.k;
            return (
              <button
                key={ft.k}
                onClick={() => { setTab(ft.k); setSelectedRow(null); }}
                className={`flex items-center gap-2 px-3 py-2.5 text-left text-xs font-medium transition-colors ${active ? 'text-black font-bold' : 'text-slate-500 hover:text-slate-900'}`}
              >
                <ft.Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1">{ft.l}</span>
                <span className={`num text-[10px] font-bold ${active ? 'text-black' : 'text-slate-300'}`}>{ft.count}</span>
              </button>
            );
          })}
        </aside>

        {/* Table area */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {loading ? (
            <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
          ) : unifiedRows.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                icon={Users}
                title="Aucun tiers trouvé"
                description={search ? 'Aucun résultat pour cette recherche.' : 'Commencez par créer un client ou un fournisseur.'}
                action={!search ? { label: 'Nouveau client', onClick: openCustCreate } : undefined}
              />
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              {/* Desktop table */}
              <table className="w-full text-xs hidden sm:table">
                <thead className="sticky top-0 z-[5]">
                  <tr className="bg-white border-b border-slate-200">
                    <th className="px-3 py-2 text-left font-semibold text-slate-600 w-[110px]">N° tiers</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600 w-[60px]">Type</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Intitulé</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Téléphone</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600 w-[120px]">Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {unifiedRows.map(row => {
                    const isSelected = selectedRow?.id === row.id;
                    return (
                      <tr
                        key={`${row.type}-${row.id}`}
                        onClick={() => handleRowClick(row)}
                        onDoubleClick={() => {
                          setSelectedRow({ id: row.id, type: row.type, data: row.raw });
                          if (row.type === 'customer') setCustView({ c: row.raw as Customer, key: 'info' });
                          else setSupView({ s: row.raw as Supplier, key: 'info' });
                        }}
                        className={`border-b border-slate-100 cursor-pointer transition-colors ${isSelected ? 'bg-black text-white' : 'hover:bg-slate-50'} ${!row.isActive && !isSelected ? 'opacity-50' : ''}`}
                      >
                        <td className={`px-3 py-2 font-mono text-[11px] ${isSelected ? 'text-slate-200' : 'text-slate-500'}`}>{row.accountCode || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase ${isSelected ? 'text-slate-300' : row.type === 'customer' ? 'text-brand-700' : 'text-amber-600'}`}>
                            {row.type === 'customer' ? <Users className="w-3 h-3" /> : <Truck className="w-3 h-3" />}
                            <span className="hidden lg:inline">{row.type === 'customer' ? 'Client' : 'Fourn.'}</span>
                          </span>
                        </td>
                        <td className={`px-3 py-2 font-medium ${isSelected ? 'text-white' : 'text-slate-900'}`}>{row.name}</td>
                        <td className={`px-3 py-2 ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>{row.phone || '—'}</td>
                        <td className={`px-3 py-2 text-right font-semibold num ${isSelected ? 'text-white' : row.balance > 0 ? 'text-amber-600' : row.balance < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{formatFCFA(row.balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Mobile card list */}
              <div className="sm:hidden divide-y divide-slate-100">
                {unifiedRows.map(row => {
                  const isSelected = selectedRow?.id === row.id;
                  return (
                    <button
                      key={`m-${row.type}-${row.id}`}
                      onClick={() => handleRowClick(row)}
                      className={`w-full text-left px-3 py-2.5 transition-colors ${isSelected ? 'bg-black' : 'active:bg-slate-50'} ${!row.isActive && !isSelected ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0 ${isSelected ? 'bg-neutral-800' : row.type === 'customer' ? 'bg-brand-50' : 'bg-amber-50'}`}>
                          {row.type === 'customer'
                            ? <Users className={`w-3 h-3 ${isSelected ? 'text-slate-300' : 'text-brand-700'}`} />
                            : <Truck className={`w-3 h-3 ${isSelected ? 'text-slate-300' : 'text-amber-600'}`} />
                          }
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className={`text-[13px] font-semibold leading-tight ${isSelected ? 'text-white' : 'text-slate-900'}`} style={{ wordBreak: 'break-word' }}>
                            {row.name}
                          </div>
                          <div className={`text-[11px] mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 ${isSelected ? 'text-slate-400' : 'text-slate-500'}`}>
                            {row.accountCode && <span className="font-mono">{row.accountCode}</span>}
                            {row.phone && <span>{row.phone}</span>}
                            {!row.isActive && <span className="text-red-400 font-semibold">Inactif</span>}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={`text-[12px] font-bold num ${isSelected ? 'text-white' : row.balance > 0 ? 'text-amber-600' : row.balance < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {formatFCFA(row.balance)}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Bottom summary ── */}
          {!loading && unifiedRows.length > 0 && (
            <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-1.5 hidden sm:flex items-center gap-4 text-[11px] text-slate-500">
              <span className="num font-semibold">{unifiedRows.length}</span> tiers affichés
              {tab !== 'suppliers' && <span>| <span className="num font-semibold">{filteredCustomers.length}</span> clients</span>}
              {tab !== 'customers' && <span>| <span className="num font-semibold">{filteredSuppliers.length}</span> fournisseurs</span>}
            </div>
          )}
        </div>
      </div>

      {/* ── Desktop action bar (always visible) ── */}
      <div className="hidden sm:flex shrink-0 border-t border-slate-200 bg-white px-4 py-2 items-center gap-2">
        {selectedRow ? (
          <>
            <span className="text-xs font-bold text-slate-900 truncate max-w-[200px]">
              {selectedRow.type === 'customer' ? (selectedRow.data as Customer).name : (selectedRow.data as Supplier).name}
            </span>
            <span className="text-[10px] font-semibold uppercase text-slate-400 shrink-0">{selectedRow.type === 'customer' ? 'Client' : 'Fournisseur'}</span>
          </>
        ) : (
          <span className="text-[11px] text-slate-400">Sélectionnez un tiers pour agir</span>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button onClick={handleActionInterroger} disabled={!selectedRow} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Interroger le compte">
            <Info className="w-3.5 h-3.5" /> Interroger
          </button>
          <button onClick={handleActionBalance} disabled={!selectedRow} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Positionner le solde">
            <Scale className="w-3.5 h-3.5" /> Solde
          </button>
          {(!selectedRow || selectedRow.type === 'customer') && (
            <button onClick={handleActionPricing} disabled={!selectedRow} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Tarifs d'exception">
              <Tag className="w-3.5 h-3.5" /> Tarifs
            </button>
          )}
          <button onClick={handleActionPayment} disabled={!selectedRow} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Saisir un règlement">
            <Wallet className="w-3.5 h-3.5" /> Règlement
          </button>
          <button onClick={handleActionDocs} disabled={!selectedRow} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Documents">
            <FileText className="w-3.5 h-3.5" /> Documents
          </button>
          <div className="w-px h-5 bg-slate-200 mx-0.5" />
          <button onClick={handleActionEdit} disabled={!selectedRow} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Modifier">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          {can('delete_customers') && (
            <button onClick={handleActionDeactivate} disabled={!selectedRow} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Supprimer">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Mobile action modal (full screen) ── */}
      {selectedRow && (
        <div className="sm:hidden fixed inset-0 z-[60] flex flex-col bg-white animate-fade-in">
          <div className="shrink-0 border-b border-slate-200 px-4 py-3 flex items-center gap-3">
            <button onClick={() => setSelectedRow(null)} className="p-1 -ml-1 text-slate-500 hover:text-slate-800">
              <X className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-900" style={{ wordBreak: 'break-word' }}>
                {selectedRow.type === 'customer' ? (selectedRow.data as Customer).name : (selectedRow.data as Supplier).name}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {selectedRow.type === 'customer' ? 'Client' : 'Fournisseur'}
                {(selectedRow.data as any).account_code && <span className="ml-1.5 font-mono">{(selectedRow.data as any).account_code}</span>}
              </div>
            </div>
            <div className={`text-sm font-bold num ${(selectedRow.data as any).balance > 0 ? 'text-amber-600' : (selectedRow.data as any).balance < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
              {formatFCFA(Number((selectedRow.data as any).balance || 0))}
            </div>
          </div>
          <div className="flex-1 overflow-auto px-4 py-4">
            <div className="space-y-2">
              <button onClick={() => { handleActionInterroger(); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 active:bg-slate-100 transition-colors text-left">
                <div className="w-9 h-9 rounded-lg bg-slate-900 flex items-center justify-center shrink-0"><Info className="w-4 h-4 text-white" /></div>
                <div><div className="text-sm font-semibold text-slate-900">Interroger le compte</div><div className="text-[11px] text-slate-500 mt-0.5">Voir le détail comptable, commercial et statistiques</div></div>
              </button>
              <button onClick={() => { handleActionBalance(); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 active:bg-slate-100 transition-colors text-left">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"><Scale className="w-4 h-4 text-brand-700" /></div>
                <div><div className="text-sm font-semibold text-slate-900">Positionner le solde</div><div className="text-[11px] text-slate-500 mt-0.5">Ajuster manuellement le solde du tiers</div></div>
              </button>
              {selectedRow.type === 'customer' && (
                <button onClick={() => { handleActionPricing(); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 active:bg-slate-100 transition-colors text-left">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"><Tag className="w-4 h-4 text-brand-700" /></div>
                  <div><div className="text-sm font-semibold text-slate-900">Tarifs d'exception</div><div className="text-[11px] text-slate-500 mt-0.5">Gérer les prix spéciaux pour ce client</div></div>
                </button>
              )}
              <button onClick={() => { handleActionPayment(); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 active:bg-slate-100 transition-colors text-left">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"><Wallet className="w-4 h-4 text-brand-700" /></div>
                <div><div className="text-sm font-semibold text-slate-900">Saisir un règlement</div><div className="text-[11px] text-slate-500 mt-0.5">Enregistrer un paiement reçu ou versé</div></div>
              </button>
              <button onClick={() => { handleActionDocs(); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 active:bg-slate-100 transition-colors text-left">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"><FileText className="w-4 h-4 text-brand-700" /></div>
                <div><div className="text-sm font-semibold text-slate-900">Documents</div><div className="text-[11px] text-slate-500 mt-0.5">Consulter les factures et bons de commande</div></div>
              </button>
              <div className="border-t border-slate-100 my-3" />
              <button onClick={() => { handleActionEdit(); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 active:bg-slate-100 transition-colors text-left">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"><Edit2 className="w-4 h-4 text-slate-600" /></div>
                <div><div className="text-sm font-semibold text-slate-900">Modifier la fiche</div><div className="text-[11px] text-slate-500 mt-0.5">Éditer les informations du tiers</div></div>
              </button>
              {can('delete_customers') && (
                <button onClick={() => { handleActionDeactivate(); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg border border-red-100 hover:bg-red-50 active:bg-red-100 transition-colors text-left">
                  <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center shrink-0"><Trash2 className="w-4 h-4 text-red-500" /></div>
                  <div><div className="text-sm font-semibold text-red-600">Supprimer</div><div className="text-[11px] text-red-400 mt-0.5">Désactiver ou supprimer ce tiers</div></div>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modals (preserved) ── */}

      {/* Customer form */}
      <Modal open={custOpen} onClose={() => setCustOpen(false)} title={custEdit ? t('tiers.editCustomer') : t('tiers.addCustomer')}
        size="sm" layer="top" fullscreenMobile
        footer={<>
          <button onClick={() => setCustOpen(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
          <button onClick={saveCust} disabled={saving} className="btn-icon-primary" title="Enregistrer">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
        </>}>
        <div className="space-y-0">
          <div className="pb-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">{t('tiers.identity')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            {custEdit && (
              <FormField label={t('tiers.status')}>
                <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-200 cursor-pointer">
                  <input type="checkbox" checked={custForm.is_active !== false} onChange={e => setCustForm((f: any) => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4" />
                  <span className="text-sm">{t('common.active')}</span>
                </label>
              </FormField>
            )}
            </div>
          </div>
          <div className="border-t border-neutral-100 pt-3 pb-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">{t('tiers.contact')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            </div>
          </div>
          <div className="border-t border-neutral-100 pt-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">{t('tiers.credit')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label={t('tiers.creditLimit')} hint={t('tiers.creditLimitHint')}>
              <input type="number" min={0} value={custForm.credit_limit || ''} onChange={e => setCustField('credit_limit', Number(e.target.value))} className="input" placeholder={t('tiers.creditLimitHint')} />
            </FormField>
            <FormField label={t('tiers.blockCredit')}>
              <label className="flex items-center gap-2 h-10 px-3 border-b border-neutral-200 cursor-pointer">
                <input type="checkbox" checked={custForm.credit_blocked === true} onChange={e => setCustField('credit_blocked', e.target.checked)} className="w-4 h-4" />
                <span className="text-sm text-slate-700">{t('tiers.blockCreditCustomer')}</span>
              </label>
            </FormField>
            </div>
          </div>
        </div>
      </Modal>

      {/* Supplier form */}
      <Modal open={supOpen} onClose={() => setSupOpen(false)} title={supEdit ? t('tiers.editSupplier') : t('tiers.addSupplier')}
        size="sm" layer="top" fullscreenMobile
        footer={<>
          <button onClick={() => setSupOpen(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
          <button onClick={saveSup} disabled={saving} className="btn-icon-primary" title="Enregistrer">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
        </>}>
        <div className="space-y-0">
          <div className="pb-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">{t('tiers.identity')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            </div>
          </div>
          <div className="border-t border-neutral-100 pt-3 pb-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">{t('tiers.contact')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            </div>
          </div>
          <div className="border-t border-neutral-100 pt-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-2">{t('tiers.commercialTerms')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <label className="flex items-center gap-2 h-10 px-3 border-b border-neutral-200 cursor-pointer">
                <input type="checkbox" checked={(supForm as any).credit_blocked === true} onChange={e => setSupField('credit_blocked', e.target.checked)} className="w-4 h-4" />
                <span className="text-sm text-slate-700">{t('tiers.blockCreditSupplier')}</span>
              </label>
            </FormField>
            </div>
          </div>
        </div>
      </Modal>

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
      <Modal open={importExportOpen} onClose={() => setImportExportOpen(false)} title={`Importer des ${tab === 'suppliers' ? 'fournisseurs' : 'clients'}`} size="sm" fullscreenMobile
        footer={importRows.length > 0 && !importResult ? <>
          <button onClick={() => setImportExportOpen(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
          <button onClick={runImport} disabled={importing} className="btn-icon-primary" title="Importer">
            {importing && <Loader2 className="w-4 h-4 animate-spin" />}
            Importer {importRows.length} ligne{importRows.length > 1 ? 's' : ''}
          </button>
        </> : undefined}
      >
        <div className="space-y-0">
          {!importResult && (
            <>
              <div className="flex items-center gap-2 pb-3 border-b border-neutral-100">
                <button onClick={downloadTemplate} className="btn-icon" title="Télécharger le modèle">
                  <Download className="w-4 h-4" />
                </button>
                <span className="text-xs text-slate-500">Télécharger le modèle</span>
              </div>
              <div
                className="py-8 text-center cursor-pointer"
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImportFile(f); }}
                onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv'; inp.onchange = () => { if (inp.files?.[0]) handleImportFile(inp.files[0]); }; inp.click(); }}
              >
                <Upload className="w-7 h-7 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">Glissez un fichier Excel ici</p>
                <p className="text-xs text-slate-400 mt-1">ou cliquez pour parcourir (.xlsx, .xls, .csv)</p>
              </div>
              {importFilename && (
                <div className="flex items-center gap-2 py-2.5 border-y border-neutral-100">
                  <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="text-xs font-medium text-slate-700 truncate flex-1">{importFilename}</span>
                  <span className="text-xs text-slate-500">{importRows.length} ligne{importRows.length > 1 ? 's' : ''}</span>
                </div>
              )}
              {importRows.length > 0 && (
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="border-b border-neutral-200">
                      <tr>
                        <th className="px-1 py-1.5 text-left font-semibold text-slate-600">Nom</th>
                        <th className="px-1 py-1.5 text-left font-semibold text-slate-600">Tél</th>
                        <th className="px-1 py-1.5 text-right font-semibold text-slate-600">Solde</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 20).map((r, i) => (
                        <tr key={i} className="border-b border-neutral-100">
                          <td className="px-1 py-1 text-slate-800 font-medium">{r.nom}</td>
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
            <div className="space-y-3 pt-3 border-t border-neutral-100">
              <div className="flex items-center justify-around py-2">
                <div className="text-center">
                  <div className="text-2xl font-black text-emerald-700 num">{importResult.created}</div>
                  <div className="text-[10px] font-semibold text-emerald-600 uppercase">Créés</div>
                </div>
                <div className="w-px h-10 bg-neutral-200" />
                <div className="text-center">
                  <div className="text-2xl font-black text-brand-700 num">{importResult.updated}</div>
                  <div className="text-[10px] font-semibold text-brand-600 uppercase">Mis à jour</div>
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
              <button onClick={() => setImportExportOpen(false)} className="btn-icon w-full justify-center" title="Fermer"><X className="w-4 h-4" /></button>
            </div>
          )}
        </div>
      </Modal>

      {/* Balance adjustment modal */}
      <Modal open={balanceOpen && !!balanceTarget} onClose={() => { setBalanceOpen(false); setBalanceTarget(null); }} title="Positionner le solde" size="sm" layer="top" fullscreenMobile
        footer={<>
          <button onClick={() => setBalanceOpen(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
          <button onClick={saveBalance} disabled={savingBalance} className="btn-icon-primary" title="Valider">
            {savingBalance ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          </button>
        </>}
      >
        {balanceTarget && (
          <div className="space-y-4">
            <div className="pb-3 border-b border-neutral-100">
              <div className="text-xs text-slate-500 mb-0.5">{balanceTarget.type === 'customer' ? 'Client' : 'Fournisseur'}</div>
              <div className="text-sm font-bold text-black">{balanceTarget.name}</div>
              {(() => {
                const net = balanceTarget.currentBalance - balanceTarget.prepay - balanceTarget.avoir;
                if (balanceTarget.prepay > 0 || balanceTarget.avoir > 0) {
                  return (
                    <div className="mt-1.5 space-y-0.5">
                      <div className="text-xs text-slate-500">Dette comptable: <span className="font-bold num text-amber-600">{formatFCFA(balanceTarget.currentBalance)}</span></div>
                      {balanceTarget.prepay > 0 && <div className="text-xs text-slate-500">Acompte disponible: <span className="font-bold num text-emerald-600">{formatFCFA(balanceTarget.prepay)}</span></div>}
                      {balanceTarget.avoir > 0 && <div className="text-xs text-slate-500">Avoir disponible: <span className="font-bold num text-teal-600">{formatFCFA(balanceTarget.avoir)}</span></div>}
                      <div className="text-xs text-slate-700 pt-1 border-t border-slate-200 mt-1">Position nette: <span className={`font-bold num ${net > 0 ? 'text-amber-600' : net < 0 ? 'text-emerald-600' : 'text-slate-500'}`}>{formatFCFA(net)}</span></div>
                    </div>
                  );
                }
                return <div className="text-xs text-slate-500 mt-1">Solde actuel: <span className="font-bold num">{formatFCFA(balanceTarget.currentBalance)}</span></div>;
              })()}
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
              <p className="text-[10px] text-slate-400 mt-1">Positionnez la dette comptable. Les acomptes et avoirs réduisent automatiquement la position nette. Positif = le tiers doit; Négatif = vous devez au tiers.</p>
            </div>
            <div>
              <label className="label">Note (optionnel)</label>
              <input value={balanceNote} onChange={e => setBalanceNote(e.target.value)} className="input" placeholder="Reprise de solde comptable..." />
            </div>
          </div>
        )}
      </Modal>

      {/* Balance quick-select */}
      <BalanceQuickSelect
        open={balanceOpen && !balanceTarget}
        onClose={() => setBalanceOpen(false)}
        customers={tab !== 'suppliers' ? filteredCustomers : []}
        suppliers={tab !== 'customers' ? filteredSuppliers : []}
        onSelect={(id, name, type, bal, prepay, avoir) => openBalanceAdjust(id, name, type, bal, prepay, avoir)}
        tab={tab}
        prepayMap={prepayMap}
        avoirMap={avoirMap}
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
function CustomerList({ list, total, dueMap, paidMap, totalMap, prepayMap, avoirMap, onCreate, onClickRow }: {
  list: Customer[]; total: number;
  dueMap: Record<string, number>; paidMap: Record<string, number>; totalMap: Record<string, number>;
  prepayMap: Record<string, number>; avoirMap: Record<string, number>;
  onCreate: () => void; onClickRow: (c: Customer) => void;
}) {
  if (list.length === 0) {
    return total === 0
      ? <div className="card"><EmptyState icon={Users} title="Aucun client" description="Créez votre premier client pour démarrer." action={<button onClick={onCreate} className="btn-icon-primary" title="Nouveau client"><Plus className="w-4 h-4" /></button>} /></div>
      : <div className="card"><EmptyState icon={Users} title="Aucun résultat" description="Aucun client ne correspond à votre recherche." /></div>;
  }
  return (
    <div className="space-y-1 sm:space-y-0">
      {list.map(c => {
        const inactive = (c as any).is_active === false;
        const limit = Number((c as any).credit_limit || 0);
        const blocked = (c as any).credit_blocked === true;
        const balance = Number((c as any).balance || 0);
        const nearLimit = limit > 0 && balance >= limit * 0.8;
        const overLimit = limit > 0 && balance >= limit;
        const prepay = prepayMap[c.id] || 0;
        const avoir = avoirMap[c.id] || 0;
        const applied = Math.min(prepay, Math.max(0, balance));
        const avoirApp = Math.min(avoir, Math.max(0, balance - applied));
        const netDebt = Math.max(0, balance - applied - avoirApp);
        const excessPrepay = prepay - applied;
        const excessAvoir = avoir - avoirApp;
        const netLabel = netDebt > 0 ? 'Solde à payer' : excessPrepay > 0 ? 'Acompte disponible' : excessAvoir > 0 ? 'Avoir disponible' : 'Solde';
        const netAmount = netDebt > 0 ? netDebt : excessPrepay > 0 ? excessPrepay : excessAvoir > 0 ? excessAvoir : 0;
        const netColor = netDebt > 0 ? 'text-amber-600' : excessPrepay > 0 ? 'text-emerald-600' : excessAvoir > 0 ? 'text-teal-600' : 'text-slate-300';
        return (
          <button
            key={c.id}
            onClick={() => onClickRow(c)}
            className={`w-full text-left transition-colors ${inactive ? 'opacity-50' : ''} sm:hover:bg-slate-50 sm:rounded-none sm:px-2 sm:py-1.5 bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-brand-300 active:scale-[0.99] px-3.5 py-2.5`}
          >
            {/* Desktop: single flat line */}
            <div className="hidden sm:flex items-center gap-3">
              <div className="w-5 h-5 shrink-0 rounded-md bg-brand-50 text-brand-700 flex items-center justify-center text-[10px] font-bold">{c.name.charAt(0).toUpperCase()}</div>
              <p className="text-[12px] font-bold text-slate-900 truncate flex-1 min-w-0">{c.name}</p>
              {c.phone && <span className="text-[11px] text-slate-400 shrink-0 tabular-nums hidden md:inline">{c.phone}</span>}
              <div className="flex items-center gap-1 shrink-0">
                {blocked && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-red-50 text-red-600 border border-red-100">Bloqué</span>}
                {!blocked && overLimit && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-red-50 text-red-600 border border-red-100">Plafond</span>}
                {!blocked && nearLimit && !overLimit && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-50 text-amber-600 border border-amber-100">Limite</span>}
                {inactive && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-slate-100 text-slate-400 border border-slate-200">Inactif</span>}
              </div>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 shrink-0 hidden lg:inline">{netLabel}</span>
              <span className={`text-[12px] font-black tabular-nums shrink-0 w-28 text-right ${netColor}`}>{formatFCFA(netAmount)}</span>
            </div>
            {/* Mobile: card layout */}
            <div className="sm:hidden">
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
              <div className="flex items-center justify-between pl-8 border-t border-slate-100 pt-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">{netLabel}</span>
                <span className={`text-[12px] font-black tabular-nums ${netColor}`}>{formatFCFA(netAmount)}</span>
              </div>
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
      ? <div className="card"><EmptyState icon={Truck} title="Aucun fournisseur" description="Créez votre premier fournisseur." action={<button onClick={onCreate} className="btn-icon-primary" title="Nouveau fournisseur"><Plus className="w-4 h-4" /></button>} /></div>
      : <div className="card"><EmptyState icon={Truck} title="Aucun résultat" description="Aucun fournisseur ne correspond à votre recherche." /></div>;
  }
  return (
    <div className="space-y-1 sm:space-y-0">
      {list.map(s => {
        const balance = Number((s as any).balance || 0);
        const netColor = balance > 0 ? 'text-red-600' : balance < 0 ? 'text-emerald-600' : 'text-slate-300';
        return (
          <button
            key={s.id}
            onClick={() => onClickRow(s)}
            className={`w-full text-left transition-colors ${!s.is_active ? 'opacity-50' : ''} sm:hover:bg-slate-50 sm:rounded-none sm:px-2 sm:py-1.5 bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-neutral-300 active:scale-[0.99] px-3.5 py-2.5`}
          >
            {/* Desktop: single flat line */}
            <div className="hidden sm:flex items-center gap-3">
              <div className="w-5 h-5 shrink-0 rounded-md bg-neutral-100 text-neutral-700 flex items-center justify-center text-[10px] font-bold">{s.name.charAt(0).toUpperCase()}</div>
              <p className="text-[12px] font-bold text-slate-900 truncate flex-1 min-w-0">{s.name}</p>
              {s.phone && <span className="text-[11px] text-slate-400 shrink-0 tabular-nums hidden md:inline">{s.phone}</span>}
              {!s.is_active && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-slate-100 text-slate-400 border border-slate-200 shrink-0">Inactif</span>}
              <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 shrink-0 hidden lg:inline">Solde comptable</span>
              <span className={`text-[12px] font-black tabular-nums shrink-0 w-28 text-right ${netColor}`}>{formatFCFA(balance)}</span>
            </div>
            {/* Mobile: card layout */}
            <div className="sm:hidden">
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
              <div className="flex items-center justify-between pl-8 border-t border-slate-100 pt-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Solde comptable</span>
                <span className={`text-[12px] font-black tabular-nums ${netColor}`}>{formatFCFA(balance)}</span>
              </div>
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
          {onEdit && <button onClick={onEdit} className="flex-1 btn-icon justify-center" title="Modifier"><Edit2 className="w-4 h-4" /></button>}
          {onReactivate && <button onClick={onReactivate} className="flex-1 btn-icon-success" title="Réactiver"><RotateCcw className="w-4 h-4" /></button>}
          {onDeactivate && <button onClick={onDeactivate} className="flex-1 btn-icon-danger" title="Supprimer"><Trash2 className="w-4 h-4" /></button>}
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
  const [withdrawals, setWithdrawals] = useState<{ id: string; amount: number; reason: string; reference: string; created_at: string }[]>([]);
  const [loans, setLoans] = useState<{ id: string; amount: number; reason: string; reference: string; created_at: string }[]>([]);

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
    const [{ data: prepays }, { data: avoirRows }, { data: adjRows }, { data: withdrawalRows }, { data: loanRows }] = await Promise.all([
      supabase.from('customer_prepayments').select('id, amount, amount_used, method_name, reference, created_at').eq('tenant_id', tenant.id).eq('customer_id', c.id).order('created_at', { ascending: false }),
      supabase.from('sale_returns').select('id, return_number, total, credit_used, created_at, refunded_at').eq('tenant_id', tenant.id).eq('customer_id', c.id).eq('status', 'approved').eq('refund_method', 'avoir').order('created_at', { ascending: false }),
      supabase.from('balance_adjustments').select('id, amount, note, created_at').eq('tenant_id', tenant.id).eq('entity_type', 'customer').eq('entity_id', c.id).order('created_at', { ascending: false }),
      supabase.from('cash_movements').select('id, amount, reason, reference, created_at').eq('tenant_id', tenant.id).eq('customer_id', c.id).eq('kind', 'customer_withdrawal').order('created_at', { ascending: false }),
      supabase.from('cash_movements').select('id, amount, reason, reference, created_at').eq('tenant_id', tenant.id).eq('customer_id', c.id).eq('kind', 'customer_loan').order('created_at', { ascending: false }),
    ]);
    setPrepayments(prepays || []);
    setAvoirs(avoirRows || []);
    setBalanceAdjs(adjRows || []);
    setWithdrawals(withdrawalRows || []);
    setLoans(loanRows || []);

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
    type Row = { id: string; ts: string; label: string; ref: string; debit: number; credit: number; kind: 'sale' | 'payment' | 'cancel' | 'adjustment' | 'withdrawal' | 'loan' };
    const rows: Row[] = [];
    balanceAdjs.forEach(adj => {
      const amt = Number(adj.amount);
      if (amt > 0) {
        rows.push({ id: 'adj-' + adj.id, ts: adj.created_at, label: adj.note || 'Report de solde', ref: '', debit: amt, credit: 0, kind: 'adjustment' });
      } else if (amt < 0) {
        rows.push({ id: 'adj-' + adj.id, ts: adj.created_at, label: adj.note || 'Règlement solde', ref: '', debit: 0, credit: Math.abs(amt), kind: 'payment' });
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
      if (p.method_name && p.method_name.startsWith('Acompte ·')) return;
      const s = sales.find(x => x.id === p.sale_id);
      rows.push({ id: 'p-' + p.id, ts: p.created_at, label: `Règlement${p.method_name ? ' · ' + p.method_name : ''}`, ref: s?.sale_number || '', debit: 0, credit: Number(p.amount), kind: 'payment' });
    });
    prepayments.forEach(pp => {
      const credit = Number(pp.amount);
      if (credit > 0) {
        rows.push({ id: 'pp-' + pp.id, ts: pp.created_at, label: `Acompte${pp.method_name ? ' · ' + pp.method_name : ''}`, ref: pp.reference || '', debit: 0, credit, kind: 'payment' });
      }
    });
    withdrawals.forEach(w => {
      rows.push({ id: 'wd-' + w.id, ts: w.created_at, label: 'Retrait caisse' + (w.reason ? ' · ' + w.reason : ''), ref: w.reference || '', debit: Number(w.amount), credit: 0, kind: 'withdrawal' });
    });
    loans.forEach(l => {
      rows.push({ id: 'ln-' + l.id, ts: l.created_at, label: 'Prêt client' + (l.reason ? ' · ' + l.reason : ''), ref: l.reference || '', debit: Number(l.amount), credit: 0, kind: 'loan' });
    });
    rows.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    let running = 0;
    return rows.map(r => { running += r.debit - r.credit; return { ...r, running }; });
  }, [sales, realPayments, prepayments, avoirs, balanceAdjs, withdrawals, loans]);

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
    if (!tenant || !currentSite) return;
    const now = Date.now();
    const dup = payments.find(p => Number(p.amount) === amt && Math.abs(now - new Date(p.created_at).getTime()) < 60000);
    if (dup) { toast(`Règlement de ${formatFCFA(amt)} effectué il y a moins d'une minute — vérifiez qu'il ne s'agit pas d'un doublon.`, 'info'); }
    setPaying(true);
    const { data: sess } = await supabase.from('cash_sessions')
      .select('id')
      .eq('tenant_id', tenant.id).eq('site_id', currentSite.id)
      .eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle();
    if (!sess) { setPaying(false); error("La caisse doit être ouverte d'abord"); return; }

    let e: any = null;
    if (paySale === '__balance__') {
      const { error: rpcErr } = await supabase.rpc('register_customer_payment', {
        p_customer_id: c.id, p_payment_method_id: pm.id, p_method_name: pm.name,
        p_amount: amt, p_reference: payRef || `Règlement solde · ${c.name}`,
        p_cash_session_id: sess.id, p_sale_id: null,
      });
      e = rpcErr;
    } else {
      const sale = sales.find(s => s.id === paySale);
      const ref = payRef || (sale ? `Règlement facture ${sale.sale_number} · ${c.name}` : '');
      const { error: rpcErr } = await supabase.rpc('register_sale_payment', {
        p_sale_id: paySale, p_payment_method_id: pm.id, p_method_name: pm.name,
        p_amount: amt, p_reference: ref, p_cash_session_id: sess.id,
      });
      e = rpcErr;
    }

    setPaying(false);
    if (e) { error(e.message); return; }
    success('Règlement enregistré · imputé sur la caisse du jour');
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

  const ledgerNetBalance = ledger.length > 0 ? ledger[ledger.length - 1].running : 0;
  const effectiveBalance = customerBalance;
  const prepayApplied = Math.min(totals.unusedPrepay, Math.max(0, effectiveBalance));
  const avoirApplied = Math.min(totals.unusedAvoir, Math.max(0, effectiveBalance - prepayApplied));
  const netDebt = Math.max(0, effectiveBalance - prepayApplied - avoirApplied);
  const excessPrepay = totals.unusedPrepay - prepayApplied;
  const excessAvoir = totals.unusedAvoir - avoirApplied;

  const modalTitle = key === 'info' ? 'Interrogation client' : key === 'payment' ? 'Saisir un règlement' : key === 'pricing' ? 'Tarifs d\'exception' : 'Documents de ventes';
  const [infoTab, setInfoTab] = useState<'commerciale' | 'comptable' | 'statistiques'>('comptable');

  const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

  const commercialeSummary = useMemo(() => {
    const validSales = sales.filter(s => s.status !== 'cancelled');
    const itemsBySale = new Map<string, any[]>();
    saleItems.forEach(it => {
      const arr = itemsBySale.get(it.sale_id) || [];
      arr.push(it);
      itemsBySale.set(it.sale_id, arr);
    });
    const rows: { saleNumber: string; date: string; items: any[]; qty: number; total: number; cost: number; saleId: string }[] = [];
    validSales.forEach(s => {
      const its = itemsBySale.get(s.id) || [];
      const qty = its.reduce((a: number, it: any) => a + Number(it.quantity), 0);
      const cost = its.reduce((a: number, it: any) => a + Number(it.purchase_cost || 0) * Number(it.quantity), 0);
      rows.push({ saleNumber: s.sale_number, date: s.created_at, items: its, qty, total: Number(s.total), cost, saleId: s.id });
    });
    const totalCA = rows.reduce((a, r) => a + r.total, 0);
    const totalCost = rows.reduce((a, r) => a + r.cost, 0);
    const totalQty = rows.reduce((a, r) => a + r.qty, 0);
    return { rows, totalCA, totalCost, totalMarge: totalCA - totalCost, totalQty };
  }, [sales, saleItems]);

  if (key === 'info') {
    return (
      <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-4 animate-fade-in">
        <div className="scrim" onClick={onClose} />
        <div className="relative w-full h-full sm:h-[90vh] sm:max-w-5xl bg-white sm:rounded-lg border border-slate-200 shadow-lg flex flex-col overflow-hidden">
          {/* Header */}
          <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-slate-200 bg-white">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-900 truncate">{c.name}</div>
              <div className="text-[10px] text-slate-500 font-mono">{(c as any).account_code || ''}</div>
            </div>
            <div className="text-right shrink-0">
              {!loading && (
                netDebt > 0 ? (
                  <div className="text-black">
                    <div className="text-[9px] font-bold uppercase tracking-wider opacity-50">Solde</div>
                    <div className="text-sm font-bold num">{formatFCFA(netDebt)}</div>
                  </div>
                ) : excessPrepay > 0 ? (
                  <div className="text-black">
                    <div className="text-[9px] font-bold uppercase tracking-wider opacity-50">Acompte dispo.</div>
                    <div className="text-sm font-bold num">{formatFCFA(excessPrepay)}</div>
                  </div>
                ) : excessAvoir > 0 ? (
                  <div className="text-black">
                    <div className="text-[9px] font-bold uppercase tracking-wider opacity-50">Avoir dispo.</div>
                    <div className="text-sm font-bold num">{formatFCFA(excessAvoir)}</div>
                  </div>
                ) : (
                  <div className="text-black">
                    <div className="text-[9px] font-bold uppercase tracking-wider opacity-50">Solde</div>
                    <div className="text-sm font-bold num">0 FCFA</div>
                  </div>
                )
              )}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"><X className="w-5 h-5" /></button>
          </div>

          {/* Body: left nav + content */}
          <div className="flex-1 flex min-h-0">
            {/* Left nav — desktop */}
            <aside className="hidden md:flex flex-col w-44 shrink-0 bg-white border-r border-neutral-100 py-3 px-2 gap-0">
              {([
                { k: 'comptable' as const, l: 'Comptable', icon: FileText },
                { k: 'commerciale' as const, l: 'Commerciale', icon: ShoppingBag },
                { k: 'statistiques' as const, l: 'Statistiques', icon: TrendingUp },
              ]).map(t => (
                <button key={t.k} onClick={() => setInfoTab(t.k)}
                  className={`flex items-center gap-2 px-3 py-2 text-left text-xs font-medium transition-colors ${infoTab === t.k ? 'text-black font-bold border-b-2 border-black' : 'text-neutral-400 hover:text-black border-b-2 border-transparent'}`}>
                  <t.icon className="w-3.5 h-3.5 shrink-0" />
                  {t.l}
                </button>
              ))}
            </aside>

            {/* Mobile tabs */}
            <div className="md:hidden absolute top-[3.25rem] left-0 right-0 z-10 bg-white border-b border-neutral-100 px-3 py-1.5 flex gap-1.5">
              {([
                { k: 'comptable' as const, l: 'Comptable' },
                { k: 'commerciale' as const, l: 'Commerciale' },
                { k: 'statistiques' as const, l: 'Statistiques' },
              ]).map(t => (
                <button key={t.k} onClick={() => setInfoTab(t.k)}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${infoTab === t.k ? 'text-black font-bold border-b-2 border-black' : 'text-neutral-400 border-b-2 border-transparent'}`}>
                  {t.l}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 overflow-auto p-4 md:pt-4 pt-12">
              {loading ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
              ) : (
                <>
                  {infoTab === 'comptable' && (
                    <LedgerView customerName={c.name} ledger={ledger} totalDebit={totals.total} totalCredit={totals.paid} balance={totals.due} unusedAvoir={totals.unusedAvoir}
                      dateFrom={dateFrom} dateTo={dateTo} onOpenPicker={() => setPickerOpen(true)} onClearDates={() => { setDateFrom(''); setDateTo(''); }} />
                  )}

                  {infoTab === 'commerciale' && (
                    <div>
                      <div className="flex items-center gap-4 mb-4 pb-3 border-b border-neutral-100 text-xs">
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold">Factures</div>
                          <div className="text-sm font-bold text-black num">{commercialeSummary.rows.length}</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold">CA total</div>
                          <div className="text-sm font-bold text-black num">{formatFCFA(commercialeSummary.totalCA)}</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold">Marge</div>
                          <div className="text-sm font-bold text-black num">{formatFCFA(commercialeSummary.totalMarge)}</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold">Articles</div>
                          <div className="text-sm font-bold text-black num">{commercialeSummary.totalQty.toLocaleString('fr-FR')}</div>
                        </div>
                      </div>
                      <div className="overflow-hidden">
                        <div className="max-h-[55vh] overflow-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 z-[2] bg-white border-b border-neutral-200">
                              <tr>
                                <th className="px-3 py-2 text-left font-semibold text-black">N° Facture</th>
                                <th className="px-3 py-2 text-left font-semibold text-black">Date</th>
                                <th className="px-3 py-2 text-right font-semibold text-black">Qté</th>
                                <th className="px-3 py-2 text-right font-semibold text-black">Total</th>
                                <th className="px-3 py-2 text-right font-semibold text-black hidden sm:table-cell">Coût</th>
                                <th className="px-3 py-2 text-right font-semibold text-black hidden sm:table-cell">Marge</th>
                              </tr>
                            </thead>
                            <tbody>
                              {commercialeSummary.rows.map(r => {
                                const marge = r.total - r.cost;
                                return (
                                  <tr key={r.saleId} className="border-b border-neutral-100 hover:bg-neutral-50 cursor-pointer" onClick={() => openInvoice(r.saleId)}>
                                    <td className="px-3 py-2 font-mono font-semibold text-black">{r.saleNumber}</td>
                                    <td className="px-3 py-2 text-black">{new Date(r.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                                    <td className="px-3 py-2 text-right num text-black">{r.qty.toLocaleString('fr-FR')}</td>
                                    <td className="px-3 py-2 text-right num font-semibold text-black">{formatFCFA(r.total)}</td>
                                    <td className="px-3 py-2 text-right num text-black hidden sm:table-cell">{formatFCFA(r.cost)}</td>
                                    <td className="px-3 py-2 text-right num font-semibold text-black hidden sm:table-cell">{formatFCFA(marge)}</td>
                                  </tr>
                                );
                              })}
                              {commercialeSummary.rows.length === 0 && (
                                <tr><td colSpan={6} className="px-3 py-8 text-center text-neutral-400">Aucune vente enregistrée.</td></tr>
                              )}
                            </tbody>
                            {commercialeSummary.rows.length > 0 && (
                              <tfoot className="border-t border-neutral-300 sticky bottom-0">
                                <tr>
                                  <td className="px-3 py-2 font-bold text-[11px] text-black" colSpan={2}>TOTAUX</td>
                                  <td className="px-3 py-2 text-right num font-bold text-black">{commercialeSummary.totalQty.toLocaleString('fr-FR')}</td>
                                  <td className="px-3 py-2 text-right num font-bold text-black">{formatFCFA(commercialeSummary.totalCA)}</td>
                                  <td className="px-3 py-2 text-right num font-bold text-black hidden sm:table-cell">{formatFCFA(commercialeSummary.totalCost)}</td>
                                  <td className="px-3 py-2 text-right num font-bold text-black hidden sm:table-cell">{formatFCFA(commercialeSummary.totalMarge)}</td>
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {infoTab === 'statistiques' && (
                    <div>
                      <div className="text-xs font-bold text-black mb-3">Statistiques mensuelles {yearStats.year}</div>
                      <div className="overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="border-b border-neutral-200">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold text-black">Mois</th>
                              <th className="px-3 py-2 text-right font-semibold text-black">Factures</th>
                              <th className="px-3 py-2 text-right font-semibold text-black">CA</th>
                              <th className="px-3 py-2 text-right font-semibold text-black hidden sm:table-cell">Coût</th>
                              <th className="px-3 py-2 text-right font-semibold text-black">Marge</th>
                              <th className="px-3 py-2 w-24 font-semibold text-black hidden sm:table-cell"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {yearStats.months.map((m: any) => {
                              const marge = m.total - m.cost;
                              const maxTotal = Math.max(1, ...yearStats.months.map((x: any) => x.total));
                              const pct = m.total > 0 ? (m.total / maxTotal) * 100 : 0;
                              return (
                                <tr key={m.m} className="border-b border-neutral-100">
                                  <td className="px-3 py-2 font-semibold text-black">{monthNames[m.m]}</td>
                                  <td className="px-3 py-2 text-right num text-black">{m.count}</td>
                                  <td className="px-3 py-2 text-right num font-semibold text-black">{formatFCFA(m.total)}</td>
                                  <td className="px-3 py-2 text-right num text-black hidden sm:table-cell">{formatFCFA(m.cost)}</td>
                                  <td className="px-3 py-2 text-right num font-semibold text-black">{formatFCFA(marge)}</td>
                                  <td className="px-3 py-2 hidden sm:table-cell">
                                    <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                                      <div className="h-full bg-black rounded-full transition-all" style={{ width: `${pct}%` }} />
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="border-t border-neutral-300">
                            <tr>
                              <td className="px-3 py-2 font-bold text-black">TOTAL</td>
                              <td className="px-3 py-2 text-right num font-bold text-black">{yearStats.months.reduce((a: number, m: any) => a + m.count, 0)}</td>
                              <td className="px-3 py-2 text-right num font-bold text-black">{formatFCFA(yearStats.months.reduce((a: number, m: any) => a + m.total, 0))}</td>
                              <td className="px-3 py-2 text-right num font-bold text-black hidden sm:table-cell">{formatFCFA(yearStats.months.reduce((a: number, m: any) => a + m.cost, 0))}</td>
                              <td className="px-3 py-2 text-right num font-bold text-black">{formatFCFA(yearStats.months.reduce((a: number, m: any) => a + m.total - m.cost, 0))}</td>
                              <td className="hidden sm:table-cell" />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <PremiumDateRangePicker open={pickerOpen} onClose={() => setPickerOpen(false)} from={dateFrom} to={dateTo} onApply={(f, t) => { setDateFrom(f); setDateTo(t); setPickerOpen(false); }} />

      {invoiceView && (
        <InvoiceViewModal data={invoiceView} customerName={c.name} onClose={() => setInvoiceView(null)} onPrint={() => printInvoice(invoiceView)} />
      )}
      </>
    );
  }

  return (
    <Modal open onClose={onClose} title={modalTitle} size="sm" layer="top" fullscreenMobile
      footer={<button onClick={onClose} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>}>

      <div className="pb-3 border-b border-neutral-100">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-black">{c.name}</div>
            <div className="text-[9px] font-semibold tracking-wider uppercase text-neutral-400 mt-0.5">
              {key === 'payment' && 'Encaissement avec imputation'}
              {key === 'docs' && 'Documents de ventes · statistiques'}
              {key === 'pricing' && 'Prix spéciaux par article'}
            </div>
          </div>
          {key !== 'pricing' && !loading && (
          <div className="text-right">
            {netDebt > 0 ? (
              <div className="text-amber-700">
                <div className="text-[9px] font-bold uppercase tracking-wider opacity-70 leading-none">Solde comptable</div>
                <div className="text-sm font-bold tabular-nums leading-none mt-0.5">{formatFCFA(netDebt)}</div>
              </div>
            ) : excessPrepay > 0 ? (
              <div className="text-emerald-700">
                <div className="text-[9px] font-bold uppercase tracking-wider opacity-70 leading-none">Acompte dispo.</div>
                <div className="text-sm font-bold tabular-nums leading-none mt-0.5">{formatFCFA(excessPrepay)}</div>
              </div>
            ) : excessAvoir > 0 ? (
              <div className="text-teal-700">
                <div className="text-[9px] font-bold uppercase tracking-wider opacity-70 leading-none">Avoir dispo.</div>
                <div className="text-sm font-bold tabular-nums leading-none mt-0.5">{formatFCFA(excessAvoir)}</div>
              </div>
            ) : (
              <div className="text-slate-500">
                <div className="text-[9px] font-bold uppercase tracking-wider opacity-70 leading-none">Solde</div>
                <div className="text-sm font-bold tabular-nums leading-none mt-0.5">0 FCFA</div>
              </div>
            )}
          </div>
          )}
        </div>
      </div>

      {loading ? <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div> : (
        <>
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
  const [kindFilter, setKindFilter] = useState<'' | 'sale' | 'payment' | 'loan'>('');

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

  const sortedLedger = useMemo(() => [...filteredLedger].reverse(), [filteredLedger]);
  const filteredDebit = useMemo(() => filteredLedger.reduce((s, r) => s + r.debit, 0), [filteredLedger]);
  const filteredCredit = useMemo(() => filteredLedger.reduce((s, r) => s + r.credit, 0), [filteredLedger]);
  const filteredBalance = filteredDebit - filteredCredit;

  if (ledger.length === 0) {
    return (
      <div className="py-10 text-center">
        <div className="text-sm font-medium text-slate-500">Aucun mouvement pour {customerName}.</div>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button onClick={onOpenPicker} className="inline-flex items-center gap-1.5 px-0 py-1 text-[11px] font-medium text-black hover:underline">
          <Calendar className="w-3 h-3 text-black" />
          {dateFrom || dateTo ? (
            <span>{dateFrom && new Date(dateFrom).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} — {dateTo && new Date(dateTo).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>
          ) : 'Période'}
        </button>
        {(dateFrom || dateTo) && (
          <button onClick={onClearDates} className="text-slate-400 hover:text-slate-600 p-0.5" title="Effacer"><X className="w-3.5 h-3.5" /></button>
        )}
        <div className="flex items-center gap-0.5 ml-auto">
          {[{ v: '' as const, l: 'Tout' }, { v: 'sale' as const, l: 'Ventes' }, { v: 'payment' as const, l: 'Règlements' }, { v: 'loan' as const, l: 'Prêts' }].map(o => (
            <button key={o.v} onClick={() => setKindFilter(o.v)}
              className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${kindFilter === o.v ? 'text-slate-900 border-b-2 border-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>
              {o.l}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-slate-400 ml-2 num">{sortedLedger.length} ligne{sortedLedger.length > 1 ? 's' : ''}</span>
      </div>

      {/* Flat accounting table */}
      <div className="">
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-[2] bg-white border-b border-neutral-200">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-black w-[90px]">Date</th>
                <th className="px-3 py-2 text-left font-semibold text-black w-[110px] hidden sm:table-cell">Pièce</th>
                <th className="px-3 py-2 text-left font-semibold text-black">Libellé</th>
                <th className="px-3 py-2 text-right font-semibold text-black w-[130px]">Débit</th>
                <th className="px-3 py-2 text-right font-semibold text-black w-[130px]">Crédit</th>
                <th className="px-3 py-2 text-right font-semibold text-black w-[140px] hidden sm:table-cell">Solde</th>
              </tr>
            </thead>
            <tbody>
              {sortedLedger.map(r => (
                <tr key={r.id} className="border-b border-neutral-100 hover:bg-neutral-50/50">
                  <td className="px-3 py-1.5 text-black whitespace-nowrap">{new Date(r.ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</td>
                  <td className="px-3 py-1.5 font-mono text-black hidden sm:table-cell">{r.ref || '—'}</td>
                  <td className="px-3 py-1.5 text-black font-medium truncate max-w-[200px]">{r.label}</td>
                  <td className="px-3 py-1.5 text-right num font-medium text-black whitespace-nowrap">{r.debit > 0 ? formatFCFA(r.debit) : ''}</td>
                  <td className="px-3 py-1.5 text-right num font-medium text-black whitespace-nowrap">{r.credit > 0 ? formatFCFA(r.credit) : ''}</td>
                  <td className="px-3 py-1.5 text-right num font-semibold text-black hidden sm:table-cell whitespace-nowrap">{formatFCFA(r.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Totals row */}
        <div className="border-t border-neutral-300 px-3 py-2.5 flex items-center text-xs gap-3">
          <span className="font-semibold text-black w-[90px]">TOTAUX</span>
          <span className="flex-1" />
          <span className="num font-bold text-black w-[130px] text-right whitespace-nowrap">{formatFCFA(filteredDebit)}</span>
          <span className="num font-bold text-black w-[130px] text-right whitespace-nowrap">{formatFCFA(filteredCredit)}</span>
          <span className="num font-bold text-black w-[140px] text-right hidden sm:inline whitespace-nowrap">{formatFCFA(filteredBalance)}</span>
        </div>
      </div>

      {/* Balance summary line */}
      <div className="mt-2 flex items-center gap-4 text-[11px] text-black px-1">
        {filteredBalance > 0 && <span>Solde dû : <span className="font-bold text-black num">{formatFCFA(filteredBalance)}</span></span>}
        {filteredBalance < 0 && <span>Solde créditeur : <span className="font-bold text-black num">{formatFCFA(Math.abs(filteredBalance))}</span></span>}
        {filteredBalance === 0 && <span>Solde : <span className="font-bold text-black num">0 FCFA</span></span>}
        {unusedAvoir > 0 && <span className="ml-auto">Avoirs disponibles : <span className="font-bold text-black num">{formatFCFA(unusedAvoir)}</span></span>}
      </div>
    </div>
  );
}

/* ───────────────────────── Payment form ───────────────────────── */
function PaymentForm({
  unpaid, methods, paySale, setPaySale, payAmount, setPayAmount, payMethod, setPayMethod,
  payRef, setPayRef, paying, onSubmit, onSelectSale, recentPayments,
}: any) {
  const selected = unpaid.find((s: any) => s.id === paySale);
  const due = selected ? Math.max(0, Number(selected.total) - Number(selected.paid)) : 0;
  const amt = Number(payAmount) || 0;
  const remaining = Math.max(0, due - amt);

  return (
    <div className="space-y-3">
      {/* Compact form */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1 block">Imputer sur</label>
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
          {unpaid.length === 0 && <div className="text-[11px] text-emerald-600 mt-1 inline-flex items-center gap-1"><Check className="w-3 h-3" />Aucune créance en attente.</div>}
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1 block">Montant (FCFA)</label>
          <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
            className="input" placeholder="0" min={0} />
          {selected && amt > 0 && (
            <div className="text-[10px] text-slate-500 mt-0.5">
              Dû : <span className="num font-semibold">{formatFCFA(due)}</span>
              {remaining > 0 && <> — Reste : <span className="num font-semibold text-amber-600">{formatFCFA(remaining)}</span></>}
              {remaining === 0 && amt > 0 && <> — <span className="text-emerald-600 font-semibold">Soldé</span></>}
            </div>
          )}
        </div>
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1 block">Mode de règlement</label>
        <div className="flex flex-wrap gap-1.5">
          {methods.map((m: any) => (
            <button key={m.id} type="button" onClick={() => setPayMethod(m.id)}
              className={`px-3 py-1.5 rounded text-[11px] font-semibold border transition-colors ${payMethod === m.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
              {m.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1 block">Référence (optionnel)</label>
          <input value={payRef} onChange={e => setPayRef(e.target.value)} className="input text-xs" placeholder="N° bordereau, transaction…" />
        </div>
        <button onClick={onSubmit} disabled={paying || !paySale || amt <= 0} className="h-[38px] px-5 rounded bg-slate-900 text-white text-xs font-semibold hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5">
          {paying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Valider
        </button>
      </div>

      {recentPayments.length > 0 && (
        <div className="mt-2 pt-3 border-t border-slate-200">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Derniers encaissements</div>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-2.5 py-1.5 text-left font-semibold text-slate-600">Date</th>
                  <th className="px-2.5 py-1.5 text-left font-semibold text-slate-600">Facture</th>
                  <th className="px-2.5 py-1.5 text-left font-semibold text-slate-600 hidden sm:table-cell">Mode</th>
                  <th className="px-2.5 py-1.5 text-right font-semibold text-slate-600">Montant</th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map((p: any) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="px-2.5 py-1.5 text-slate-500">{formatDateTime(p.created_at)}</td>
                    <td className="px-2.5 py-1.5 font-mono text-slate-600">{p.sale_number || '—'}</td>
                    <td className="px-2.5 py-1.5 text-slate-500 hidden sm:table-cell">{p.method_name}{p.reference ? ` · ${p.reference}` : ''}</td>
                    <td className="px-2.5 py-1.5 text-right num font-semibold text-emerald-700">{formatFCFA(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Documents view ───────────────────────── */
function DocsView({ kpis, yearStats, docs, saleItems, dateFrom, dateTo, onOpenPicker, onClearDates, onOpenInvoice }: any) {
  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button onClick={onOpenPicker} className="inline-flex items-center gap-1.5 px-0 py-1 text-[11px] font-medium text-black hover:underline">
          <Calendar className="w-3 h-3 text-black" />
          {dateFrom && dateTo ? `${formatDate(dateFrom)} → ${formatDate(dateTo)}` : dateFrom ? `Depuis ${formatDate(dateFrom)}` : dateTo ? `Jusqu'au ${formatDate(dateTo)}` : 'Période'}
        </button>
        {(dateFrom || dateTo) && <button onClick={onClearDates} className="text-slate-400 hover:text-slate-600 p-0.5"><X className="w-3.5 h-3.5" /></button>}
        <span className="ml-auto text-[10px] text-slate-400 num">{kpis.count} factures | CA {formatFCFA(kpis.ca)} | Marge {formatFCFA(kpis.marge)} ({kpis.margePct.toFixed(1)}%)</span>
      </div>

      {/* Documents table */}
      {docs.length === 0 ? (
        <div className="text-sm text-slate-500 py-10 text-center">Aucun document sur cette période.</div>
      ) : (
        <div className="">
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-[2] bg-white border-b border-neutral-200">
                <tr>
                  <th className="px-2.5 py-2 text-left font-semibold text-black">N° document</th>
                  <th className="px-2.5 py-2 text-left font-semibold text-black hidden sm:table-cell">Date</th>
                  <th className="px-2.5 py-2 text-left font-semibold text-black">Statut</th>
                  <th className="px-2.5 py-2 text-right font-semibold text-black">Qté</th>
                  <th className="px-2.5 py-2 text-right font-semibold text-black hidden sm:table-cell">PU moyen</th>
                  <th className="px-2.5 py-2 text-right font-semibold text-black">Total</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((s: any) => {
                  const items = (saleItems || []).filter((it: any) => it.sale_id === s.id);
                  const qty = items.reduce((a: number, it: any) => a + Number(it.quantity || 0), 0);
                  const avgPU = qty > 0 ? items.reduce((a: number, it: any) => a + Number(it.unit_price || 0) * Number(it.quantity || 0), 0) / qty : 0;
                  return (
                    <tr key={s.id} onClick={() => onOpenInvoice(s.id)} className="border-b border-neutral-100 hover:bg-neutral-50 cursor-pointer">
                      <td className="px-2.5 py-1.5 font-mono font-semibold text-black">{s.sale_number}</td>
                      <td className="px-2.5 py-1.5 text-black hidden sm:table-cell">{new Date(s.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</td>
                      <td className="px-2.5 py-1.5"><StatusBadgeSale sale={s} /></td>
                      <td className="px-2.5 py-1.5 text-right num text-black">{qty.toLocaleString('fr-FR')}</td>
                      <td className="px-2.5 py-1.5 text-right num text-black hidden sm:table-cell">{formatFCFA(avgPU)}</td>
                      <td className="px-2.5 py-1.5 text-right num font-semibold text-black">{formatFCFA(s.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-neutral-300 px-2.5 py-1.5 flex items-center text-xs">
            <span className="font-semibold text-black">TOTAL</span>
            <span className="flex-1" />
            <span className="num font-bold text-black">{formatFCFA(kpis.ca)}</span>
          </div>
        </div>
      )}
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

  const unpaidOrders = useMemo(() => {
    const result = orders.filter(o => o.status !== 'cancelled' && Number(o.paid || 0) < Number(o.total));
    const invoiceDue = result.reduce((a, o) => a + (Number(o.total) - Number(o.paid || 0)), 0);
    const positionedDue = Math.max(0, supplierBalance - invoiceDue);
    if (positionedDue > 0) {
      result.unshift({ id: '__balance__', order_number: 'Report de solde', total: positionedDue, paid: 0, status: 'validated', created_at: new Date(0).toISOString() } as any);
    }
    return result;
  }, [orders, supplierBalance]);

  const ledger = useMemo(() => {
    type Row = { id: string; ts: string; label: string; ref: string; debit: number; credit: number; kind: 'order' | 'payment' | 'cancel' | 'adjustment' };
    const rows: Row[] = [];
    balanceAdjs.forEach(adj => {
      const amt = Number(adj.amount);
      if (amt > 0) {
        rows.push({ id: 'adj-' + adj.id, ts: adj.created_at, label: adj.note || 'Report de solde', ref: '', debit: 0, credit: amt, kind: 'adjustment' });
      } else if (amt < 0) {
        rows.push({ id: 'adj-' + adj.id, ts: adj.created_at, label: adj.note || 'Règlement solde', ref: '', debit: Math.abs(amt), credit: 0, kind: 'payment' });
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
      if (!p.order_id) return;
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
    if (!tenant || !currentSite) return;
    const now = Date.now();
    const dup = payments.find(p => Number(p.amount) === amt && Math.abs(now - new Date(p.created_at || p.paid_at).getTime()) < 60000);
    if (dup) { toast(`Règlement de ${formatFCFA(amt)} effectué il y a moins d'une minute — vérifiez qu'il ne s'agit pas d'un doublon.`, 'info'); }
    setPaying(true);
    const { data: sess } = await supabase.from('cash_sessions')
      .select('id, opening_amount, theoretical_amount')
      .eq('tenant_id', tenant.id).eq('site_id', currentSite.id)
      .eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle();
    if (!sess) { setPaying(false); error("La caisse doit être ouverte d'abord"); return; }
    const available = Number(sess.opening_amount || 0) + Number(sess.theoretical_amount || 0);
    if (available < amt) { setPaying(false); error('Solde caisse insuffisant'); return; }
    const isBalance = payOrder === '__balance__';
    const { error: e } = await supabase.rpc('register_supplier_payment', {
      p_supplier_id: s.id, p_payment_method_id: pm.id, p_method_name: pm.name,
      p_amount: amt, p_reference: payRef || (isBalance ? `Règlement solde · ${s.name}` : ''),
      p_cash_session_id: sess.id, p_order_id: isBalance ? null : (payOrder || null),
      p_from_cash: true,
    });
    setPaying(false);
    if (e) { error(e.message); return; }
    success('Règlement enregistré · imputé sur la caisse du jour');
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

  const modalTitle = key === 'info' ? 'Interrogation fournisseur' : key === 'payment' ? 'Saisir un règlement' : key === 'articles' ? 'Articles liés' : 'Documents d\'achats';
  const [infoTab, setInfoTab] = useState<'comptable' | 'commerciale' | 'statistiques'>('comptable');
  const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

  const commercialeSummary = useMemo(() => {
    const validOrders = orders.filter(o => o.status !== 'cancelled');
    const itemsByOrder = new Map<string, any[]>();
    orderItems.forEach((it: any) => {
      const arr = itemsByOrder.get(it.order_id) || [];
      arr.push(it);
      itemsByOrder.set(it.order_id, arr);
    });
    const rows: { orderNumber: string; date: string; qty: number; total: number; paid: number; orderId: string }[] = [];
    validOrders.forEach(o => {
      const its = itemsByOrder.get(o.id) || [];
      const qty = its.reduce((a: number, it: any) => a + Number(it.quantity_ordered || 0), 0);
      rows.push({ orderNumber: o.order_number, date: o.created_at, qty, total: Number(o.total), paid: Number(o.paid || 0), orderId: o.id });
    });
    const totalAchats = rows.reduce((a, r) => a + r.total, 0);
    const totalPaid = rows.reduce((a, r) => a + r.paid, 0);
    const totalQty = rows.reduce((a, r) => a + r.qty, 0);
    return { rows, totalAchats, totalPaid, totalDue: Math.max(0, totalAchats - totalPaid), totalQty };
  }, [orders, orderItems]);

  if (key === 'info') {
    return (
      <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-4 animate-fade-in">
        <div className="scrim" onClick={onClose} />
        <div className="relative w-full h-full sm:h-[90vh] sm:max-w-5xl bg-white sm:rounded-lg border border-slate-200 shadow-lg flex flex-col overflow-hidden">
          {/* Header */}
          <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-slate-200 bg-white">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-900 truncate">{s.name}</div>
              <div className="text-[10px] text-slate-500 font-mono">{(s as any).account_code || ''}</div>
            </div>
            <div className={`text-right shrink-0 text-black`}>
              <div className="text-[9px] font-bold uppercase tracking-wider opacity-50">Solde</div>
              <div className="text-sm font-bold num">{loading ? '...' : formatFCFA(supplierBalance)}</div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"><X className="w-5 h-5" /></button>
          </div>

          {/* Body */}
          <div className="flex-1 flex min-h-0">
            <aside className="hidden md:flex flex-col w-44 shrink-0 bg-white border-r border-neutral-100 py-3 px-2 gap-0">
              {([
                { k: 'comptable' as const, l: 'Comptable', icon: FileText },
                { k: 'commerciale' as const, l: 'Commerciale', icon: ShoppingBag },
                { k: 'statistiques' as const, l: 'Statistiques', icon: TrendingUp },
              ]).map(t => (
                <button key={t.k} onClick={() => setInfoTab(t.k)}
                  className={`flex items-center gap-2 px-3 py-2 text-left text-xs font-medium transition-colors ${infoTab === t.k ? 'text-black font-bold border-b-2 border-black' : 'text-neutral-400 hover:text-black border-b-2 border-transparent'}`}>
                  <t.icon className="w-3.5 h-3.5 shrink-0" />
                  {t.l}
                </button>
              ))}
            </aside>

            <div className="md:hidden absolute top-[3.25rem] left-0 right-0 z-10 bg-white border-b border-neutral-100 px-3 py-1.5 flex gap-1.5">
              {([
                { k: 'comptable' as const, l: 'Comptable' },
                { k: 'commerciale' as const, l: 'Commerciale' },
                { k: 'statistiques' as const, l: 'Statistiques' },
              ]).map(t => (
                <button key={t.k} onClick={() => setInfoTab(t.k)}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${infoTab === t.k ? 'text-black font-bold border-b-2 border-black' : 'text-neutral-400 border-b-2 border-transparent'}`}>
                  {t.l}
                </button>
              ))}
            </div>

            <div className="flex-1 min-w-0 overflow-auto p-4 md:pt-4 pt-12">
              {loading ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
              ) : (
                <>
                  {infoTab === 'comptable' && (
                    <SupplierLedgerView supplierName={s.name} ledger={ledger} totalCredit={totals.total} totalDebit={totals.paid} due={totals.due}
                      dateFrom={dateFrom} dateTo={dateTo} onOpenPicker={() => setPickerOpen(true)} onClearDates={() => { setDateFrom(''); setDateTo(''); }} />
                  )}

                  {infoTab === 'commerciale' && (
                    <div>
                      <div className="flex items-center gap-4 mb-4 pb-3 border-b border-neutral-100 text-xs">
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold">Commandes</div>
                          <div className="text-sm font-bold text-black num">{commercialeSummary.rows.length}</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold">Achats</div>
                          <div className="text-sm font-bold text-black num">{formatFCFA(commercialeSummary.totalAchats)}</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold">Payé</div>
                          <div className="text-sm font-bold text-black num">{formatFCFA(commercialeSummary.totalPaid)}</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold">Dette</div>
                          <div className="text-sm font-bold text-black num">{formatFCFA(commercialeSummary.totalDue)}</div>
                        </div>
                      </div>
                      <div className="overflow-hidden">
                        <div className="max-h-[55vh] overflow-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-white z-[2] border-b border-neutral-200">
                              <tr>
                                <th className="px-3 py-2 text-left font-semibold text-black">N° Commande</th>
                                <th className="px-3 py-2 text-left font-semibold text-black">Date</th>
                                <th className="px-3 py-2 text-right font-semibold text-black">Qté</th>
                                <th className="px-3 py-2 text-right font-semibold text-black">Total</th>
                                <th className="px-3 py-2 text-right font-semibold text-black hidden sm:table-cell">Payé</th>
                                <th className="px-3 py-2 text-right font-semibold text-black hidden sm:table-cell">Reste</th>
                              </tr>
                            </thead>
                            <tbody>
                              {commercialeSummary.rows.map(r => {
                                const reste = Math.max(0, r.total - r.paid);
                                return (
                                  <tr key={r.orderId} className="border-b border-neutral-100 hover:bg-neutral-50 cursor-pointer" onClick={() => openOrder(r.orderId)}>
                                    <td className="px-3 py-2 font-mono font-semibold text-black">{r.orderNumber}</td>
                                    <td className="px-3 py-2 text-black">{new Date(r.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                                    <td className="px-3 py-2 text-right num text-black">{r.qty.toLocaleString('fr-FR')}</td>
                                    <td className="px-3 py-2 text-right num font-semibold text-black">{formatFCFA(r.total)}</td>
                                    <td className="px-3 py-2 text-right num text-black hidden sm:table-cell">{formatFCFA(r.paid)}</td>
                                    <td className="px-3 py-2 text-right num font-semibold text-black hidden sm:table-cell">{formatFCFA(reste)}</td>
                                  </tr>
                                );
                              })}
                              {commercialeSummary.rows.length === 0 && (
                                <tr><td colSpan={6} className="px-3 py-8 text-center text-neutral-400">Aucune commande enregistrée.</td></tr>
                              )}
                            </tbody>
                            {commercialeSummary.rows.length > 0 && (
                              <tfoot className="border-t border-neutral-300 sticky bottom-0">
                                <tr>
                                  <td className="px-3 py-2 font-bold text-[11px] text-black" colSpan={2}>TOTAUX</td>
                                  <td className="px-3 py-2 text-right num font-bold text-black">{commercialeSummary.totalQty.toLocaleString('fr-FR')}</td>
                                  <td className="px-3 py-2 text-right num font-bold text-black">{formatFCFA(commercialeSummary.totalAchats)}</td>
                                  <td className="px-3 py-2 text-right num font-bold text-black hidden sm:table-cell">{formatFCFA(commercialeSummary.totalPaid)}</td>
                                  <td className="px-3 py-2 text-right num font-bold text-black hidden sm:table-cell">{formatFCFA(commercialeSummary.totalDue)}</td>
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {infoTab === 'statistiques' && (
                    <div>
                      <div className="text-xs font-bold text-black mb-3">Statistiques mensuelles {yearStats.year}</div>
                      <div className="overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="border-b border-neutral-200">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold text-black">Mois</th>
                              <th className="px-3 py-2 text-right font-semibold text-black">Commandes</th>
                              <th className="px-3 py-2 text-right font-semibold text-black">Achats</th>
                              <th className="px-3 py-2 text-right font-semibold text-black hidden sm:table-cell">Payé</th>
                              <th className="px-3 py-2 text-right font-semibold text-black">Dette</th>
                              <th className="px-3 py-2 w-24 hidden sm:table-cell"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {yearStats.months.map((m: any) => {
                              const due = Math.max(0, m.total - m.paid);
                              const maxTotal = Math.max(1, ...yearStats.months.map((x: any) => x.total));
                              const pct = m.total > 0 ? (m.total / maxTotal) * 100 : 0;
                              return (
                                <tr key={m.m} className="border-b border-neutral-100">
                                  <td className="px-3 py-2 font-semibold text-black">{monthNames[m.m]}</td>
                                  <td className="px-3 py-2 text-right num text-black">{m.count}</td>
                                  <td className="px-3 py-2 text-right num font-semibold text-black">{formatFCFA(m.total)}</td>
                                  <td className="px-3 py-2 text-right num text-black hidden sm:table-cell">{formatFCFA(m.paid)}</td>
                                  <td className="px-3 py-2 text-right num font-semibold text-black">{formatFCFA(due)}</td>
                                  <td className="px-3 py-2 hidden sm:table-cell">
                                    <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                                      <div className="h-full bg-black rounded-full transition-all" style={{ width: `${pct}%` }} />
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="border-t border-neutral-300">
                            <tr>
                              <td className="px-3 py-2 font-bold text-black">TOTAL</td>
                              <td className="px-3 py-2 text-right num font-bold text-black">{yearStats.months.reduce((a: number, m: any) => a + m.count, 0)}</td>
                              <td className="px-3 py-2 text-right num font-bold text-black">{formatFCFA(yearStats.months.reduce((a: number, m: any) => a + m.total, 0))}</td>
                              <td className="px-3 py-2 text-right num font-bold text-black hidden sm:table-cell">{formatFCFA(yearStats.months.reduce((a: number, m: any) => a + m.paid, 0))}</td>
                              <td className="px-3 py-2 text-right num font-bold text-black">{formatFCFA(yearStats.months.reduce((a: number, m: any) => a + Math.max(0, m.total - m.paid), 0))}</td>
                              <td className="hidden sm:table-cell" />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <PremiumDateRangePicker open={pickerOpen} onClose={() => setPickerOpen(false)} from={dateFrom} to={dateTo} onApply={(f, t) => { setDateFrom(f); setDateTo(t); setPickerOpen(false); }} />

      {orderView && (
        <OrderViewModal data={orderView} supplierName={s.name} onClose={() => setOrderView(null)} onPrint={() => printOrder(orderView)} />
      )}
      </>
    );
  }

  return (
    <Modal open onClose={onClose} title={modalTitle} size="sm" layer="top" fullscreenMobile
      footer={<button onClick={onClose} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>}>

      <div className="pb-3 border-b border-neutral-100">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-black">{s.name}</div>
            <div className="text-[9px] font-semibold tracking-wider uppercase text-neutral-400 mt-0.5">
              {key === 'payment' && 'Règlement avec imputation'}
              {key === 'docs' && 'Documents d\'achats · statistiques'}
              {key === 'articles' && `${articles.length} article${articles.length > 1 ? 's' : ''} lié${articles.length > 1 ? 's' : ''}`}
            </div>
          </div>
          <div className={`text-right text-black`}>
            <div className="text-[9px] font-bold uppercase tracking-wider opacity-50 leading-none">Solde comptable</div>
            <div className="text-sm font-bold tabular-nums leading-none mt-0.5">{loading ? '...' : formatFCFA(supplierBalance)}</div>
          </div>
        </div>
      </div>

      {loading ? <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div> : (
        <>
          {key === 'payment' && (
            <SupplierPaymentForm
              unpaid={unpaidOrders} methods={methods}
              payOrder={payOrder} setPayOrder={setPayOrder}
              payAmount={payAmount} setPayAmount={setPayAmount}
              payMethod={payMethod} setPayMethod={setPayMethod}
              payRef={payRef} setPayRef={setPayRef}
              paying={paying} onSubmit={submitPayment}
              onSelectOrder={(id: string) => { const o = unpaidOrders.find(x => x.id === id); if (o) setPayAmount(String(Math.max(0, Number(o.total) - Number(o.paid || 0)))); }}
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
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">{a.internal_ref}</td>
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

  const filteredLedger = useMemo(() => {
    let r = ledger;
    if (dateFrom) { const f = new Date(dateFrom); f.setHours(0, 0, 0, 0); r = r.filter(row => new Date(row.ts) >= f); }
    if (dateTo) { const t = new Date(dateTo); t.setHours(23, 59, 59, 999); r = r.filter(row => new Date(row.ts) <= t); }
    if (kindFilter) r = r.filter(row => row.kind === kindFilter);
    return r;
  }, [ledger, dateFrom, dateTo, kindFilter]);

  const sortedLedger = useMemo(() => [...filteredLedger].reverse(), [filteredLedger]);
  const filteredAchats = useMemo(() => filteredLedger.reduce((s, r) => s + r.credit, 0), [filteredLedger]);
  const filteredRegle = useMemo(() => filteredLedger.reduce((s, r) => s + r.debit, 0), [filteredLedger]);
  const filteredDette = filteredAchats - filteredRegle;

  if (ledger.length === 0) {
    return <div className="py-10 text-center text-sm text-slate-500">Aucun mouvement pour {supplierName}.</div>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button onClick={onOpenPicker} className="inline-flex items-center gap-1.5 px-0 py-1 text-[11px] font-medium text-black hover:underline">
          <Calendar className="w-3 h-3 text-black" />
          {dateFrom || dateTo ? (
            <span>{dateFrom && new Date(dateFrom).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} — {dateTo && new Date(dateTo).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>
          ) : 'Période'}
        </button>
        {(dateFrom || dateTo) && <button onClick={onClearDates} className="text-slate-400 hover:text-slate-600 p-0.5"><X className="w-3.5 h-3.5" /></button>}
        <div className="flex items-center gap-0.5 ml-auto">
          {[{ v: '' as const, l: 'Tout' }, { v: 'order' as const, l: 'Achats' }, { v: 'payment' as const, l: 'Règlements' }].map(o => (
            <button key={o.v} onClick={() => setKindFilter(o.v)}
              className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${kindFilter === o.v ? 'text-slate-900 border-b-2 border-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>
              {o.l}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-slate-400 ml-2 num">{sortedLedger.length} ligne{sortedLedger.length > 1 ? 's' : ''}</span>
      </div>

      <div className="">
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-[2] bg-white border-b border-neutral-200">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-black w-[90px]">Date</th>
                <th className="px-3 py-2 text-left font-semibold text-black w-[110px] hidden sm:table-cell">Pièce</th>
                <th className="px-3 py-2 text-left font-semibold text-black">Libellé</th>
                <th className="px-3 py-2 text-right font-semibold text-black w-[130px]">Crédit</th>
                <th className="px-3 py-2 text-right font-semibold text-black w-[130px]">Débit</th>
                <th className="px-3 py-2 text-right font-semibold text-black w-[140px] hidden sm:table-cell">Solde</th>
              </tr>
            </thead>
            <tbody>
              {sortedLedger.map(r => (
                <tr key={r.id} className="border-b border-neutral-100 hover:bg-neutral-50/50">
                  <td className="px-3 py-1.5 text-black whitespace-nowrap">{new Date(r.ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</td>
                  <td className="px-3 py-1.5 font-mono text-black hidden sm:table-cell">{r.ref || '—'}</td>
                  <td className="px-3 py-1.5 text-black font-medium truncate max-w-[200px]">{r.label}</td>
                  <td className="px-3 py-1.5 text-right num font-medium text-black whitespace-nowrap">{r.credit > 0 ? formatFCFA(r.credit) : ''}</td>
                  <td className="px-3 py-1.5 text-right num font-medium text-black whitespace-nowrap">{r.debit > 0 ? formatFCFA(r.debit) : ''}</td>
                  <td className="px-3 py-1.5 text-right num font-semibold text-black hidden sm:table-cell whitespace-nowrap">{formatFCFA(r.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-neutral-300 px-3 py-2.5 flex items-center text-xs gap-3">
          <span className="font-semibold text-black w-[90px]">TOTAUX</span>
          <span className="flex-1" />
          <span className="num font-bold text-black w-[130px] text-right whitespace-nowrap">{formatFCFA(filteredAchats)}</span>
          <span className="num font-bold text-black w-[130px] text-right whitespace-nowrap">{formatFCFA(filteredRegle)}</span>
          <span className="num font-bold text-black w-[140px] text-right hidden sm:inline whitespace-nowrap">{formatFCFA(filteredDette)}</span>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-4 text-[11px] text-black px-1">
        {filteredDette > 0 && <span>Dette : <span className="font-bold text-black num">{formatFCFA(filteredDette)}</span></span>}
        {filteredDette < 0 && <span>Avoir : <span className="font-bold text-black num">{formatFCFA(Math.abs(filteredDette))}</span></span>}
        {filteredDette === 0 && <span>Solde : <span className="font-bold text-black num">0 FCFA</span></span>}
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
  const isBalance = selected?.id === '__balance__';
  const due = selected ? Math.max(0, Number(selected.total) - Number(selected.paid || 0)) : 0;
  const amt = Number(payAmount) || 0;
  const remaining = Math.max(0, due - amt);

  return (
    <div>
      <div className="border border-slate-200 rounded-lg overflow-hidden mb-3">
        <div className="grid grid-cols-2 gap-px bg-slate-200">
          <div className="bg-white p-3">
            <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wide">Montant à régler</label>
            <div className="mt-1 flex items-baseline gap-1">
              <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                className="text-lg font-bold text-slate-900 focus:outline-none flex-1 min-w-0 placeholder:text-slate-300 bg-transparent" placeholder="0" min={0} />
              <span className="text-xs text-slate-500 font-medium">FCFA</span>
            </div>
          </div>
          <div className="bg-white p-3">
            {selected ? (
              <>
                <div className="text-[10px] uppercase font-semibold text-slate-500 tracking-wide">{isBalance ? 'Solde positionné' : 'Dû'}</div>
                <div className="mt-1 text-sm font-bold text-slate-800 num">{formatFCFA(due)}</div>
                {amt > 0 && <div className="text-[11px] text-slate-500 mt-0.5">Reste : <span className={`font-bold num ${remaining === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{formatFCFA(remaining)}</span></div>}
              </>
            ) : (
              <>
                <div className="text-[10px] uppercase font-semibold text-slate-500 tracking-wide">Imputation</div>
                <div className="mt-1 text-xs text-slate-400">Aucune commande</div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wide mb-1 block">Imputer sur</label>
          <SearchableSelect
            options={[
              { value: '', label: 'Acompte libre (sans commande)' },
              ...unpaid.filter((o: any) => o.id !== '__balance__').map((o: any) => {
                const d = Math.max(0, Number(o.total) - Number(o.paid || 0));
                return { value: o.id, label: `${o.order_number} · dû ${formatFCFA(d)}` };
              })
            ]}
            value={payOrder}
            onChange={v => { setPayOrder(v); onSelectOrder(v); }}
            placeholder="Acompte libre (sans commande)"
          />
          {unpaid.some((o: any) => o.id === '__balance__') && (
            <button type="button" onClick={() => { setPayOrder('__balance__'); onSelectOrder('__balance__'); }}
              className={`mt-1.5 w-full px-2.5 py-1.5 rounded text-[11px] font-medium border transition-colors ${isBalance ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
              Solde positionné · {formatFCFA(unpaid.find((o: any) => o.id === '__balance__')?.total || 0)}
            </button>
          )}
          {unpaid.length === 0 && <div className="text-[11px] text-emerald-700 mt-1 inline-flex items-center gap-1"><Check className="w-3 h-3" />Tout soldé</div>}
        </div>
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wide mb-1 block">Mode</label>
          <div className="grid grid-cols-2 gap-1">
            {methods.map((m: any) => (
              <button key={m.id} type="button" onClick={() => setPayMethod(m.id)}
                className={`px-2 py-1.5 rounded text-[11px] font-medium border transition-colors ${payMethod === m.id ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                {m.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-3">
        <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wide mb-1 block">Référence (optionnel)</label>
        <input value={payRef} onChange={e => setPayRef(e.target.value)} className="input" placeholder="N° chèque, virement…" />
      </div>

      <div className="flex items-center gap-2 mb-3 text-[11px] text-slate-500">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        Imputé sur la caisse du jour
      </div>

      <button onClick={onSubmit} disabled={paying || amt <= 0} className="btn-icon-primary w-full justify-center py-2.5" title="Valider le règlement">
        {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
      </button>

      {recentPayments.length > 0 && (
        <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 px-2.5 py-1.5 text-[10px] uppercase font-semibold text-slate-500 tracking-wide">Derniers règlements</div>
          <table className="w-full text-xs">
            <tbody>
              {recentPayments.map((p: any) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-2.5 py-1.5 text-slate-600">{p.method_name}{p.reference ? ` · ${p.reference}` : ''}</td>
                  <td className="px-2.5 py-1.5 text-slate-400 text-[11px]">{p.order_number || 'Acompte'} · {formatDateTime(p.paid_at || p.created_at)}</td>
                  <td className="px-2.5 py-1.5 text-right font-bold text-emerald-700 num">{formatFCFA(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
    <div>
      <div className="flex items-center gap-4 text-xs mb-3 px-1 text-black">
        <span>Commandes : <span className="font-bold num">{kpis.count}</span></span>
        <span>Achats : <span className="font-bold num">{formatFCFA(kpis.achats)}</span></span>
        <span>Dette : <span className="font-bold num">{formatFCFA(kpis.due)}</span></span>
      </div>

      <div className="mb-3">
        <button onClick={() => setStatsOpen(v => !v)} className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600 hover:text-slate-800">
          <ChevronRight className={`w-3 h-3 transition-transform ${statsOpen ? 'rotate-90' : ''}`} />
          Statistiques {yearStats.year}
        </button>
        {statsOpen && (
          <div className="mt-1.5">
            <table className="w-full text-[11px]">
              <thead className="border-b border-neutral-200">
                <tr>
                  <th className="px-2 py-1 text-left font-semibold text-black w-10">Mois</th>
                  <th className="px-2 py-1 text-center font-semibold text-black w-8">Nb</th>
                  <th className="px-2 py-1 text-left font-semibold text-black">Répartition</th>
                  <th className="px-2 py-1 text-right font-semibold text-black">Total</th>
                  <th className="px-2 py-1 text-right font-semibold text-black hidden sm:table-cell">Dû</th>
                </tr>
              </thead>
              <tbody>
                {yearStats.months.map((m: any) => {
                  const pct = m.total > 0 ? (m.total / maxMonth) * 100 : 0;
                  const due = Math.max(0, m.total - m.paid);
                  return (
                    <tr key={m.m} className="border-b border-neutral-100">
                      <td className="px-2 py-1 font-medium text-black">{monthNames[m.m]}</td>
                      <td className="px-2 py-1 text-center num text-black">{m.count}</td>
                      <td className="px-2 py-1"><div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden"><div className="h-full bg-black" style={{ width: `${pct}%` }} /></div></td>
                      <td className="px-2 py-1 text-right num font-medium text-black">{formatFCFA(m.total)}</td>
                      <td className="px-2 py-1 text-right num font-medium text-black hidden sm:table-cell">{due > 0 ? formatFCFA(due) : 'Soldé'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <button onClick={onOpenPicker} className="inline-flex items-center gap-1.5 px-0 py-1 text-[11px] font-medium text-black hover:underline">
          <Calendar className="w-3 h-3 text-black" />
          {dateFrom && dateTo ? `${formatDate(dateFrom)} → ${formatDate(dateTo)}` : dateFrom ? `Depuis ${formatDate(dateFrom)}` : dateTo ? `Jusqu'au ${formatDate(dateTo)}` : 'Période'}
        </button>
        {(dateFrom || dateTo) && <button onClick={onClearDates} className="text-slate-400 hover:text-slate-600 p-0.5"><X className="w-3.5 h-3.5" /></button>}
        <span className="ml-auto text-[10px] text-slate-400">{docs.length} document{docs.length > 1 ? 's' : ''}</span>
      </div>

      {docs.length === 0 ? <div className="text-xs text-slate-500 py-6 text-center">Aucune commande sur cette période.</div> : (
        <div className="">
          <table className="w-full text-xs">
            <thead className="border-b border-neutral-200">
              <tr>
                <th className="px-2.5 py-2 text-left font-semibold text-black">N°</th>
                <th className="px-2.5 py-2 text-left font-semibold text-black">Désignation</th>
                <th className="px-2.5 py-2 text-left font-semibold text-black hidden sm:table-cell">Date</th>
                <th className="px-2.5 py-2 text-right font-semibold text-black">Total</th>
                <th className="px-2.5 py-2 text-center font-semibold text-black w-16">Statut</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((o: any) => {
                const items = (orderItems || []).filter((it: any) => it.order_id === o.id);
                const designation = items.length === 0
                  ? o.order_number
                  : items.length === 1
                    ? items[0].name
                    : `${items[0].name} + ${items.length - 1} autre${items.length - 1 > 1 ? 's' : ''}`;
                return (
                  <tr key={o.id} onClick={() => onOpenOrder(o.id)} className="border-b border-neutral-100 hover:bg-neutral-50 cursor-pointer">
                    <td className="px-2.5 py-1.5 font-mono text-black whitespace-nowrap">{o.order_number}</td>
                    <td className="px-2.5 py-1.5 text-black font-medium truncate max-w-[160px]">{designation}</td>
                    <td className="px-2.5 py-1.5 text-black hidden sm:table-cell whitespace-nowrap">{formatDateTime(o.created_at)}</td>
                    <td className="px-2.5 py-1.5 text-right num font-bold text-black">{formatFCFA(o.total)}</td>
                    <td className="px-2.5 py-1.5 text-center"><StatusBadgeOrder order={o} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
            <button onClick={onPrint} className="btn-icon" title="Imprimer"><FileText className="w-4 h-4" /></button>
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
            <div className="w-full sm:w-80 border border-slate-200 rounded-lg p-3 space-y-1.5">
              <Line label="Sous-total" value={formatFCFA(items.reduce((a: number, it: any) => a + Number(it.total), 0))} />
              <Line label="Total" value={formatFCFA(order.total)} strong />
              <div className="pt-2 mt-2 border-t border-slate-200 space-y-1">
                {pays.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between text-[12px] text-slate-600"><span>{p.method_name}</span><span className="tabular-nums">{formatFCFA(p.amount)}</span></div>
                ))}
                {pays.length === 0 && <div className="text-[12px] text-slate-400 text-center py-1">Aucun règlement</div>}
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

  if (loading) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;

  return (
    <div>
      {/* Add row - compact toolbar */}
      <div className="flex flex-wrap items-end gap-2 mb-3 pb-3 border-b border-slate-200">
        <div className="flex-1 min-w-[150px]">
          <label className="text-[10px] font-semibold text-slate-500 uppercase mb-0.5 block">Article</label>
          <SearchableSelect
            options={filteredAvailable.map(a => ({ value: a.id, label: a.name, sublabel: `${a.internal_ref} — ${formatFCFA(a.sale_price)}` }))}
            value={newArticleId}
            onChange={v => {
              setNewArticleId(v);
              const art = articles.find(a => a.id === v);
              if (art && newPrice === '') setNewPrice(art.sale_price);
            }}
            placeholder="— Choisir —"
          />
        </div>
        <div className="w-[100px]">
          <label className="text-[10px] font-semibold text-slate-500 uppercase mb-0.5 block">Prix spécial</label>
          <input type="number" min={0} value={newPrice} onChange={e => setNewPrice(Number(e.target.value))} className="input text-xs" placeholder="FCFA" />
        </div>
        <div className="w-[120px] hidden sm:block">
          <label className="text-[10px] font-semibold text-slate-500 uppercase mb-0.5 block">Note</label>
          <input value={newNote} onChange={e => setNewNote(e.target.value)} className="input text-xs" placeholder="Optionnelle" />
        </div>
        <button onClick={addPrice} disabled={saving || !newArticleId || newPrice === ''} className="h-[38px] px-3 rounded bg-slate-900 text-white text-xs font-semibold hover:bg-slate-700 disabled:opacity-40 transition-colors inline-flex items-center gap-1">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Ajouter
        </button>
      </div>

      {/* Table of existing prices */}
      {prices.length === 0 ? (
        <div className="text-center py-8 text-sm text-slate-400">Aucun tarif d'exception configuré.</div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-2.5 py-2 text-left font-semibold text-slate-600">Référence</th>
                <th className="px-2.5 py-2 text-left font-semibold text-slate-600">Désignation</th>
                <th className="px-2.5 py-2 text-right font-semibold text-slate-600">Prix normal</th>
                <th className="px-2.5 py-2 text-right font-semibold text-slate-600">Prix exception</th>
                <th className="px-2.5 py-2 text-right font-semibold text-slate-600 hidden sm:table-cell">Écart</th>
                <th className="px-2.5 py-2 text-left font-semibold text-slate-600 hidden sm:table-cell">Note</th>
                <th className="px-2.5 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p: any) => {
                const art = p.articles;
                const normalPrice = art?.sale_price || 0;
                const diff = Number(p.exception_price) - normalPrice;
                const pct = normalPrice > 0 ? ((diff / normalPrice) * 100).toFixed(1) : '0';
                return (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-2.5 py-1.5 font-mono text-slate-500">{art?.internal_ref || '-'}</td>
                    <td className="px-2.5 py-1.5 font-medium text-slate-800 truncate max-w-[150px]">{art?.name || 'Supprimé'}</td>
                    <td className="px-2.5 py-1.5 text-right num text-slate-500">{formatFCFA(normalPrice)}</td>
                    <td className="px-2.5 py-1.5 text-right num font-semibold text-slate-900">{formatFCFA(p.exception_price)}</td>
                    <td className={`px-2.5 py-1.5 text-right num font-medium hidden sm:table-cell ${diff < 0 ? 'text-emerald-600' : diff > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{diff < 0 ? '' : '+'}{pct}%</td>
                    <td className="px-2.5 py-1.5 text-slate-400 truncate max-w-[80px] hidden sm:table-cell">{p.note || '—'}</td>
                    <td className="px-2.5 py-1.5">
                      <button onClick={() => removePrice(p.id)} className="p-1 text-slate-400 hover:text-red-600 transition-colors"><Trash2 className="w-3 h-3" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] text-slate-500">
            {prices.length} tarif{prices.length > 1 ? 's' : ''} configuré{prices.length > 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Balance Quick Select ───────────────────────── */
function BalanceQuickSelect({ open, onClose, customers, suppliers, onSelect, tab, prepayMap, avoirMap }: {
  open: boolean; onClose: () => void;
  customers: Customer[]; suppliers: Supplier[];
  onSelect: (id: string, name: string, type: 'customer' | 'supplier', balance: number, prepay: number, avoir: number) => void;
  tab: TabKey;
  prepayMap: Record<string, number>;
  avoirMap: Record<string, number>;
}) {
  const [search, setSearch] = useState('');
  const custItems = tab !== 'suppliers' ? customers.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase())) : [];
  const supItems = tab !== 'customers' ? suppliers.filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase())) : [];
  const items: any[] = [...custItems, ...supItems];

  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="Positionner un solde" size="sm" fullscreenMobile>
      <div className="space-y-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input text-xs border-b border-neutral-200 rounded-none px-0 py-2"
          placeholder="Rechercher un tiers..."
          autoFocus
        />
        <div className="max-h-72 overflow-y-auto divide-y divide-neutral-100">
          {items.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Aucun résultat</p>}
          {items.map((item: any) => (
            <button
              key={item.id}
              onClick={() => { const isCust = custItems.some(c => c.id === item.id); onClose(); onSelect(item.id, item.name, isCust ? 'customer' : 'supplier', Number(item.balance || 0), isCust ? (prepayMap[item.id] || 0) : 0, isCust ? (avoirMap[item.id] || 0) : 0); }}
              className="w-full flex items-center justify-between gap-2 py-2.5 hover:bg-neutral-50 transition-all text-left"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 truncate">{item.name}</div>
                <div className="text-[10px] text-slate-400">{item.phone || item.email || '-'}</div>
              </div>
              <div className="text-right shrink-0">
                {(() => {
                  const bal = Number(item.balance || 0);
                  const isCust = custItems.some(c => c.id === item.id);
                  const prepay = isCust ? (prepayMap[item.id] || 0) : 0;
                  const avoir = isCust ? (avoirMap[item.id] || 0) : 0;
                  const net = bal - prepay - avoir;
                  if (prepay > 0 || avoir > 0) {
                    return (
                      <>
                        <div className={`text-xs font-bold num ${net > 0 ? 'text-amber-600' : net < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {formatFCFA(net)}
                        </div>
                        <div className="text-[9px] text-slate-400">position nette</div>
                      </>
                    );
                  }
                  return (
                    <>
                      <div className={`text-xs font-bold num ${bal > 0 ? 'text-amber-600' : bal < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {formatFCFA(bal)}
                      </div>
                      <div className="text-[9px] text-slate-400">solde actuel</div>
                    </>
                  );
                })()}
              </div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
