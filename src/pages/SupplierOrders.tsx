import { useEffect, useMemo, useState, useRef } from 'react';
import {
  Plus, ShoppingBag, Loader2, Search, RefreshCw,
  CheckCircle, Truck, X, Calendar,
  User, Package, MessageCircle, Link2,
  Printer, Pencil, Ban, ChevronDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { VehicleArticlePicker } from '../components/VehicleArticlePicker';
import { isAutoParts } from '../lib/types';
import { formatFCFA, formatDate } from '../lib/format';
import { printDocumentA4, buildPrintTenantForSite, type PrintTenant } from '../lib/print';
import { consumeNavContext } from '../lib/navHighlight';
import { MobileBillingWizard } from '../components/MobileBillingWizard';
import { SupplierOrderEditor, type SOLineItem, type SOHeaderForm, type ReceiveQtyMap, type ReceiveLotMap } from '../components/SupplierOrderEditor';

type SupplierOrder = {
  id: string; order_number: string; total: number; status: string;
  created_at: string; expected_date: string | null;
  public_token?: string | null;
  public_code?: string | null;
  supplier_id?: string | null;
  note?: string | null;
  user_id?: string | null;
  suppliers: { name: string; phone?: string | null; whatsapp?: string | null; email?: string | null; address?: string | null } | null;
  doc_header?: any;
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyée', confirmed: 'Confirmée',
  partial: 'Partielle', received: 'Reçue', cancelled: 'Annulée',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'text-slate-500', sent: 'text-neutral-700', confirmed: 'text-brand-600',
  partial: 'text-amber-600', received: 'text-emerald-600', cancelled: 'text-red-600',
};

const FILTERS: { key: string; label: string }[] = [
  { key: '',          label: 'Toutes' },
  { key: 'draft',     label: 'Brouillon' },
  { key: 'sent',      label: 'Envoyée' },
  { key: 'confirmed', label: 'Confirmée' },
  { key: 'partial',   label: 'Partielle' },
  { key: 'received',  label: 'Reçue' },
  { key: 'cancelled', label: 'Annulée' },
];

export function SupplierOrders() {
  const { tenant, currentSite, sites, dataTick } = useApp();
  const { can } = usePermissions();
  const autoMode = isAutoParts(tenant);
  const { success, error } = useToast();
  const sharedSuppliers = (tenant as any)?.settings?.shared_suppliers !== false;
  const isMultiSiteDispatch = sharedSuppliers && sites.length > 1;
  const stockMethod = (tenant as any)?.settings?.stock_method || 'none';
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;

  // ── List state ──────────────────────────────────────────────────
  const [list, setList] = useState<SupplierOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [toCancel, setToCancel] = useState<SupplierOrder | null>(null);
  const [flashList, setFlashList] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data sources ────────────────────────────────────────────────
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [articles, setArticles] = useState<any[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});

  // ── Editor state ────────────────────────────────────────────────
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'view' | 'edit' | 'receive'>('create');
  const [editorOrderId, setEditorOrderId] = useState<string | null>(null);
  const [editorOrder, setEditorOrder] = useState<SupplierOrder | null>(null);
  const [headerForm, setHeaderForm] = useState<SOHeaderForm>({ supplier_id: '', expected_date: '', note: '' });
  const [editorItems, setEditorItems] = useState<SOLineItem[]>([]);
  const [saving, setSaving] = useState(false);

  // ── Receive state ───────────────────────────────────────────────
  const [receiveQty, setReceiveQty] = useState<ReceiveQtyMap>({});
  const [receiveLotData, setReceiveLotData] = useState<ReceiveLotMap>({});

  // ── Dispatch state (multi-site) ────────────────────────────────
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchData, setDispatchData] = useState<Record<string, Record<string, number>>>({});

  // ── Mobile create state ─────────────────────────────────────────
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileForm, setMobileForm] = useState<{ supplier_id: string; expected_date: string; note: string }>({ supplier_id: '', expected_date: '', note: '' });
  const [mobileItems, setMobileItems] = useState<any[]>([{ article_id: '', name: '', supplier_ref: '', quantity_ordered: 1, unit_price: 0, total: 0 }]);

  // ── Vehicle picker ──────────────────────────────────────────────
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);

  // ── Load data ──────────────────────────────────────────────────

  const load = async (silent = false) => {
    if (!tenant || !currentSite) return;
    if (!silent) setLoading(true); else setRefreshing(true);
    const { data } = await supabase
      .from('supplier_orders')
      .select('*, suppliers(name, phone, whatsapp, email, address)')
      .eq('tenant_id', tenant.id)
      .eq('site_id', currentSite.id)
      .order('created_at', { ascending: false })
      .limit(200);
    setList((data as any) || []);
    setLoading(false); setRefreshing(false);
  };

  useEffect(() => {
    if (!tenant) return;
    supabase.from('profiles').select('id, full_name, email').eq('tenant_id', tenant.id).then(({ data }) => {
      const m: Record<string, string> = {};
      (data || []).forEach((p: any) => { m[p.id] = p.full_name || p.email || ''; });
      setProfileNames(m);
    });
  }, [tenant?.id]);

  const creatorName = (userId?: string | null) => (userId && profileNames[userId]) || 'Utilisateur non renseigné';

  useEffect(() => { load(); }, [tenant?.id, currentSite?.id]);
  useEffect(() => { if (dataTick > 0) { const t = setTimeout(() => load(true), 400); return () => clearTimeout(t); } }, [dataTick]);

  useEffect(() => {
    const ctx = consumeNavContext();
    if (!ctx) return;
    if (ctx.highlightId) {
      setHighlightId(ctx.highlightId);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => setHighlightId(null), 6800);
    }
    if (ctx.target === 'payables') {
      setStatusFilter('');
      setFlashList(true);
      setTimeout(() => setFlashList(false), 6800);
    }
    if (ctx.target === 'newOrder') {
      openCreate();
    }
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
  }, [highlightId, list, loading]);

  const loadRefData = async () => {
    if (!tenant) return;
    const isShared = (tenant as any)?.settings?.shared_articles !== false;
    const isSharedSup = (tenant as any)?.settings?.shared_suppliers !== false;

    const all: any[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      let q = supabase
        .from('articles')
        .select('id, name, purchase_price, sale_price, supplier_ref, internal_ref, category_id')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .order('name')
        .range(from, from + pageSize - 1);
      if (!isShared && currentSite) q = q.eq('site_id', currentSite.id);
      const { data, error: articleError } = await q;
      if (articleError) {
        console.error('[SupplierOrders] Impossible de charger les articles', articleError);
        break;
      }
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    // Load stock quantities from stock_levels
    const stockMap: Record<string, number> = {};
    if (all.length > 0) {
      let slq = supabase
        .from('stock_levels')
        .select('article_id, quantity')
        .eq('tenant_id', tenant.id);
      if (currentSite) slq = slq.eq('site_id', currentSite.id);
      const { data: slData, error: slError } = await slq;
      if (slError) {
        console.error('[SupplierOrders] Impossible de charger le stock', slError);
      } else if (slData) {
        for (const sl of slData) {
          stockMap[sl.article_id] = Number(sl.quantity || 0);
        }
      }
    }

    setArticles(all.map(a => ({ ...a, stock_quantity: stockMap[a.id] ?? null })));

    let sq = supabase.from('suppliers').select('id, name, phone, balance, credit_limit, credit_blocked').eq('tenant_id', tenant.id).eq('is_active', true).order('name');
    if (!isSharedSup && currentSite) sq = sq.eq('site_id', currentSite.id);
    const { data: supData, error: supError } = await sq;
    if (supError) console.error('[SupplierOrders] Impossible de charger les fournisseurs', supError);
    setSuppliers(supData || []);
  };

  useEffect(() => { loadRefData(); }, [tenant?.id, currentSite?.id]);

  // ── Filtering ───────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let r = list;
    if (statusFilter) r = r.filter(o => o.status === statusFilter);
    const q = search.toLowerCase().trim();
    if (q) r = r.filter(x => x.order_number.toLowerCase().includes(q) || (x.suppliers?.name || '').toLowerCase().includes(q));
    return r;
  }, [list, search, statusFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': list.length };
    for (const o of list) c[o.status] = (c[o.status] || 0) + 1;
    return c;
  }, [list]);

  const totalPending = list.filter(o => ['sent', 'confirmed', 'partial'].includes(o.status)).reduce((s, o) => s + Number(o.total), 0);

  // ── Editor helpers ──────────────────────────────────────────────

  const editorSubtotal = editorItems.filter(i => i.name.trim()).reduce((s, i) => s + Number(i.total || 0), 0);

  const openCreate = () => {
    if (articles.length === 0) loadRefData();
    if (isDesktop) {
      setEditorMode('create');
      setEditorOrderId(null);
      setEditorOrder(null);
      setHeaderForm({ supplier_id: '', expected_date: '', note: '' });
      setEditorItems([]);
      setEditorOpen(true);
    } else {
      setMobileForm({ supplier_id: '', expected_date: '', note: '' });
      setMobileItems([{ article_id: '', name: '', supplier_ref: '', quantity_ordered: 1, unit_price: 0, total: 0 }]);
      setMobileOpen(true);
    }
  };

  const loadOrderItems = async (orderId: string) => {
    const { data } = await supabase.from('supplier_order_items')
      .select('*, articles(internal_ref, oem_ref)')
      .eq('order_id', orderId);
    return (data || []).map((i: any) => ({
      id: i.id,
      article_id: i.article_id || null,
      name: i.name,
      supplier_ref: i.supplier_ref || '',
      quantity_ordered: Number(i.quantity_ordered),
      unit_price: Number(i.unit_price),
      total: Number(i.total),
      quantity_received: Number(i.quantity_received || 0),
    })) as SOLineItem[];
  };

  const openOrderView = async (o: SupplierOrder) => {
    const items = await loadOrderItems(o.id);
    setEditorOrderId(o.id);
    setEditorOrder(o);
    setHeaderForm({ supplier_id: o.supplier_id || '', expected_date: o.expected_date || '', note: o.note || '' });
    setEditorItems(items);
    setEditorMode('view');
    setEditorOpen(true);
  };

  const openOrderEdit = async (o: SupplierOrder) => {
    const items = await loadOrderItems(o.id);
    setEditorOrderId(o.id);
    setEditorOrder(o);
    setHeaderForm({ supplier_id: o.supplier_id || '', expected_date: o.expected_date || '', note: o.note || '' });
    setEditorItems(items);
    setEditorMode('edit');
    setEditorOpen(true);
  };

  const openOrderReceive = async (o: SupplierOrder) => {
    const items = await loadOrderItems(o.id);
    setEditorOrderId(o.id);
    setEditorOrder(o);
    setHeaderForm({ supplier_id: o.supplier_id || '', expected_date: o.expected_date || '', note: o.note || '' });
    setEditorItems(items);
    // Default receive qty = remaining
    const rq: ReceiveQtyMap = {};
    items.forEach(it => {
      const remaining = Math.max(0, (it.quantity_ordered || 0) - (it.quantity_received || 0));
      rq[it.id || `idx-${items.indexOf(it)}`] = remaining;
    });
    setReceiveQty(rq);
    setReceiveLotData({});
    setEditorMode('receive');
    setEditorOpen(true);
  };

  const openDetail = async (o: SupplierOrder) => {
    if (!isDesktop) {
      await openOrderView(o);
      return;
    }
    if (['draft', 'sent', 'confirmed', 'partial'].includes(o.status)) {
      await openOrderView(o);
    } else {
      await openOrderView(o);
    }
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditorOrderId(null);
    setEditorOrder(null);
    setEditorItems([]);
    setHeaderForm({ supplier_id: '', expected_date: '', note: '' });
  };

  // ── Editor navigation ──────────────────────────────────────────

  const editorNavIdx = editorOrderId ? filtered.findIndex(o => o.id === editorOrderId) : -1;

  const goToPrev = () => {
    if (editorNavIdx > 0) {
      const prev = filtered[editorNavIdx - 1];
      if (prev) openOrderView(prev);
    }
  };

  const goToNext = () => {
    if (editorNavIdx >= 0 && editorNavIdx < filtered.length - 1) {
      const next = filtered[editorNavIdx + 1];
      if (next) openOrderView(next);
    }
  };

  // ── Save ────────────────────────────────────────────────────────

  const saveOrder = async () => {
    if (!tenant || !currentSite) { error('Magasin introuvable'); return; }
    if (!can('manage_supplier_orders')) { error('Vous n\'avez pas la permission de gérer les achats'); return; }
    if (!headerForm.supplier_id) { error('Sélectionnez un fournisseur'); return; }
    const validItems = editorItems.filter(i => i.name.trim());
    if (validItems.length === 0) { error('Ajoutez au moins un article'); return; }
    const total = validItems.reduce((s, i) => s + Number(i.total), 0);

    // Credit check for new orders
    if (!editorOrderId) {
      const { data: freshSup } = await supabase.from('suppliers')
        .select('id, balance, credit_limit, credit_blocked')
        .eq('id', headerForm.supplier_id).maybeSingle();
      if (freshSup) {
        if (freshSup.credit_blocked === true) { error('Commandes à crédit bloquées pour ce fournisseur'); return; }
        const limit = Number(freshSup.credit_limit || 0);
        if (limit > 0) {
          const { data: outstanding } = await supabase.from('supplier_orders')
            .select('total').eq('supplier_id', headerForm.supplier_id)
            .eq('tenant_id', tenant.id).not('status', 'in', '("cancelled","received")');
          const currentDebt = (outstanding || []).reduce((s: number, o: any) => s + Number(o.total || 0), 0);
          if ((currentDebt + total) > limit) {
            error(`Plafond crédit fournisseur dépassé (${formatFCFA(limit)}). Encours actuel : ${formatFCFA(currentDebt)}`);
            return;
          }
        }
      }
    }

    setSaving(true);
    if (editorOrderId) {
      // Update existing
      await supabase.from('supplier_orders').update({
        supplier_id: headerForm.supplier_id,
        subtotal: total, total,
        expected_date: headerForm.expected_date || null, note: headerForm.note,
      }).eq('id', editorOrderId);
      await supabase.from('supplier_order_items').delete().eq('order_id', editorOrderId);
      await supabase.from('supplier_order_items').insert(validItems.map(i => ({
        tenant_id: tenant.id, order_id: editorOrderId,
        article_id: i.article_id || null, name: i.name, supplier_ref: i.supplier_ref,
        quantity_ordered: i.quantity_ordered, quantity_received: 0,
        unit_price: i.unit_price, total: i.total,
      })));
      setSaving(false);
      success('Commande mise à jour');
      closeEditor();
      load();
    } else {
      // Create new
      const { data: numData } = await supabase.rpc('next_doc_number', {
        p_tenant_id: tenant.id, p_kind: 'supplier_order', p_prefix: 'CMD',
      });
      const oNum = (numData as string) || ('CMD-' + Date.now());
      const { data: o, error: e } = await supabase.from('supplier_orders').insert({
        tenant_id: tenant.id, site_id: currentSite.id,
        supplier_id: headerForm.supplier_id,
        order_number: oNum, subtotal: total, discount: 0, total,
        expected_date: headerForm.expected_date || null, note: headerForm.note, status: 'draft',
      }).select().single();
      if (e || !o) { error(e?.message || 'Erreur'); setSaving(false); return; }
      await supabase.from('supplier_order_items').insert(validItems.map(i => ({
        tenant_id: tenant.id, order_id: o.id,
        article_id: i.article_id || null, name: i.name, supplier_ref: i.supplier_ref,
        quantity_ordered: i.quantity_ordered, quantity_received: 0,
        unit_price: i.unit_price, total: i.total,
      })));
      setSaving(false);
      success('Commande créée');
      closeEditor();
      load();
    }
  };

  // ── Status change ───────────────────────────────────────────────

  const changeStatus = async (o: SupplierOrder, status: string) => {
    if (!can('edit_supplier_orders')) { error('Permission insuffisante'); return; }
    await supabase.from('supplier_orders').update({ status }).eq('id', o.id);
    success('Statut mis à jour');
    load();
    if (editorOrder?.id === o.id) {
      setEditorOrder({ ...o, status });
    }
  };

  // ── Receive logic ───────────────────────────────────────────────

  const confirmReceive = async () => {
    if (!editorOrder || !tenant || !currentSite) return;
    if (!can('manage_supplier_orders')) { error('Permission insuffisante'); return; }

    if (isMultiSiteDispatch) {
      // Build dispatch data
      const dd: Record<string, Record<string, number>> = {};
      for (const item of editorItems) {
        const itemId = item.id || '';
        const addQty = Number(receiveQty[itemId] || 0);
        if (addQty > 0 && item.article_id) {
          dd[itemId] = {};
          if (sites.length === 1) {
            dd[itemId][sites[0].id] = addQty;
          } else {
            dd[itemId][currentSite!.id] = addQty;
          }
        }
      }
      if (Object.keys(dd).length === 0) { error('Aucune quantité à réceptionner'); return; }
      setDispatchData(dd);
      if (sites.length === 1) {
        await receiveWithDispatch(dd);
      } else {
        setDispatchOpen(true);
      }
    } else {
      await receivePartial();
    }
  };

  const receiveWithDispatch = async (dd: Record<string, Record<string, number>>) => {
    if (!editorOrder || !tenant || !currentSite) return;
    setSaving(true);
    let anyReceived = 0;
    let fullyReceived = true;
    for (const item of editorItems) {
      const itemId = item.id || '';
      const siteAlloc = dd[itemId];
      if (!siteAlloc || !item.article_id) {
        const ordered = Number(item.quantity_ordered || 0);
        const alreadyReceived = Number(item.quantity_received || 0);
        if (alreadyReceived < ordered) fullyReceived = false;
        continue;
      }
      const totalAddQty = Object.values(siteAlloc).reduce((s, v) => s + v, 0);
      const alreadyReceived = Number(item.quantity_received || 0);
      const ordered = Number(item.quantity_ordered || 0);
      const newTotalReceived = alreadyReceived + totalAddQty;

      for (const [siteId, qty] of Object.entries(siteAlloc)) {
        if (qty <= 0) continue;
        if (stockMethod === 'lot') {
          const lotData = receiveLotData[itemId] || { batch_number: '', expiry_date: '' };
          await supabase.rpc('adjust_stock_lot', {
            p_article_id: item.article_id, p_site_id: siteId,
            p_quantity: qty, p_batch_number: lotData.batch_number || `LOT-${Date.now()}`,
            p_expiry_date: lotData.expiry_date || null,
            p_purchase_price: Number(item.unit_price || 0),
            p_note: `Réception commande ${editorOrder.order_number}`,
          });
        } else {
          await supabase.rpc('adjust_stock', {
            p_article_id: item.article_id, p_site_id: siteId,
            p_quantity: qty, p_movement_type: 'purchase',
            p_note: `Réception commande ${editorOrder.order_number}`,
          });
        }
        anyReceived += qty;
      }
      if (item.id) {
        await supabase.from('supplier_order_items').update({ quantity_received: newTotalReceived }).eq('id', item.id);
      }
      if (newTotalReceived < ordered) fullyReceived = false;
    }
    const newStatus = fullyReceived ? 'received' : 'partial';
    const update: any = { status: newStatus };
    if (fullyReceived) update.received_date = new Date().toISOString().slice(0, 10);
    await supabase.from('supplier_orders').update(update).eq('id', editorOrder.id);
    success(fullyReceived ? 'Commande entièrement réceptionnée' : `Réception partielle enregistrée (+${anyReceived})`);
    setSaving(false);
    setDispatchOpen(false);
    closeEditor();
    load();
  };

  const receivePartial = async () => {
    if (!editorOrder || !tenant || !currentSite) return;
    setSaving(true);
    let anyReceived = 0;
    let fullyReceived = true;
    for (const item of editorItems) {
      const itemId = item.id || '';
      const addQty = Number(receiveQty[itemId] || 0);
      const alreadyReceived = Number(item.quantity_received || 0);
      const ordered = Number(item.quantity_ordered || 0);
      const newTotalReceived = alreadyReceived + addQty;
      if (addQty > 0 && item.article_id) {
        if (stockMethod === 'lot') {
          const lotData = receiveLotData[itemId] || { batch_number: '', expiry_date: '' };
          await supabase.rpc('adjust_stock_lot', {
            p_article_id: item.article_id, p_site_id: currentSite.id,
            p_quantity: addQty, p_batch_number: lotData.batch_number || `LOT-${Date.now()}`,
            p_expiry_date: lotData.expiry_date || null,
            p_purchase_price: Number(item.unit_price || 0),
            p_note: `Réception commande ${editorOrder.order_number}`,
          });
        } else {
          await supabase.rpc('adjust_stock', {
            p_article_id: item.article_id, p_site_id: currentSite.id,
            p_quantity: addQty, p_movement_type: 'purchase',
            p_note: `Réception commande ${editorOrder.order_number}`,
          });
        }
        if (item.id) {
          await supabase.from('supplier_order_items').update({ quantity_received: newTotalReceived }).eq('id', item.id);
        }
        anyReceived += addQty;
      }
      if (newTotalReceived < ordered) fullyReceived = false;
    }
    const newStatus = fullyReceived ? 'received' : 'partial';
    const update: any = { status: newStatus };
    if (fullyReceived) update.received_date = new Date().toISOString().slice(0, 10);
    await supabase.from('supplier_orders').update(update).eq('id', editorOrder.id);
    success(fullyReceived ? 'Commande entièrement réceptionnée' : `Réception partielle enregistrée (+${anyReceived})`);
    setSaving(false);
    closeEditor();
    load();
  };

  // ── Print / link / WhatsApp ─────────────────────────────────────

  const tenantForPrint = (): PrintTenant => buildPrintTenantForSite(tenant, currentSite);

  const printFromEditor = () => {
    if (!editorOrder || !tenant) return;
    const sup = suppliers.find(s => s.id === headerForm.supplier_id);
    const pitems = editorItems.filter(i => i.name.trim()).map(i => ({
      name: i.name, supplier_ref: i.supplier_ref || null, oem_ref: null,
      quantity: Number(i.quantity_ordered), unit_price: Number(i.unit_price), discount: 0,
    }));
    const psubtotal = pitems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    printDocumentA4({
      tenant: tenantForPrint(), docLabel: 'BON DE COMMANDE',
      docNumber: editorOrder.order_number, docDate: formatDate(editorOrder.created_at),
      customer: sup ? { name: sup.name, phone: sup.phone, address: sup.address } : null,
      extraMeta: editorOrder.expected_date ? [{ label: 'Livraison prévue', value: formatDate(editorOrder.expected_date) }] : [],
      items: pitems, subtotal: psubtotal, total: psubtotal,
      footerNote: 'Merci de confirmer réception et délai de livraison.',
      issuedBy: creatorName(editorOrder.user_id),
      docHeader: editorOrder.doc_header ?? null,
    });
  };

  const publicOrderUrl = (o: SupplierOrder | null) => {
    const code = o?.public_code || o?.public_token;
    if (!code) return '';
    return `${window.location.origin}/po/${code}`;
  };

  const copyLinkFor = async (o: SupplierOrder) => {
    const url = publicOrderUrl(o);
    if (!url) { error('Lien indisponible'); return; }
    try { await navigator.clipboard.writeText(url); success('Lien copié'); }
    catch { window.prompt('Copiez le lien :', url); }
  };

  const sendWhatsAppFor = (o: SupplierOrder) => {
    const sup = o.suppliers;
    if (!sup) { error('Fournisseur introuvable'); return; }
    const phoneRaw = ((sup as any).whatsapp || sup.phone || '').replace(/[^0-9]/g, '');
    if (!phoneRaw) { error('Aucun numéro WhatsApp/téléphone'); return; }
    const phone = phoneRaw.startsWith('221') ? phoneRaw : phoneRaw.length === 9 ? `221${phoneRaw}` : phoneRaw;
    const link = publicOrderUrl(o);
    const msg = [
      `Bonjour ${sup.name || ''},`, '',
      `Notre commande *${o.order_number}* du ${formatDate(o.created_at)}.`,
      o.expected_date ? `Livraison souhaitée : ${formatDate(o.expected_date)}` : '',
      `*Total : ${formatFCFA(o.total)}*`,
      link ? `\nBon de commande (PDF) : ${link}` : '', '',
      'Merci de confirmer.',
    ].filter(Boolean).join('\n');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // ── Mobile save ─────────────────────────────────────────────────

  const mobileSave = async () => {
    if (!tenant || !currentSite) { error('Magasin introuvable'); return; }
    if (!mobileForm.supplier_id) { error('Sélectionnez un fournisseur'); return; }
    const validItems = mobileItems.filter((i: any) => i.name.trim());
    if (validItems.length === 0) { error('Ajoutez au moins un article'); return; }
    const total = validItems.reduce((s: number, i: any) => s + Number(i.total), 0);
    setSaving(true);
    const { data: numData } = await supabase.rpc('next_doc_number', {
      p_tenant_id: tenant.id, p_kind: 'supplier_order', p_prefix: 'CMD',
    });
    const oNum = (numData as string) || ('CMD-' + Date.now());
    const { data: o, error: e } = await supabase.from('supplier_orders').insert({
      tenant_id: tenant.id, site_id: currentSite.id,
      supplier_id: mobileForm.supplier_id,
      order_number: oNum, subtotal: total, discount: 0, total,
      expected_date: mobileForm.expected_date || null, note: mobileForm.note, status: 'draft',
    }).select().single();
    if (e || !o) { error(e?.message || 'Erreur'); setSaving(false); return; }
    await supabase.from('supplier_order_items').insert(validItems.map((i: any) => ({
      tenant_id: tenant.id, order_id: o.id,
      article_id: i.article_id || null, name: i.name, supplier_ref: i.supplier_ref || '',
      quantity_ordered: i.quantity_ordered, quantity_received: 0,
      unit_price: i.unit_price, total: i.total,
    })));
    setSaving(false);
    success('Commande créée');
    setMobileOpen(false);
    load();
  };

  const mobileUpdateItem = (idx: number, field: string, val: any) => {
    setMobileItems((prev: any[]) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      if (field === 'article_id') {
        const art = articles.find((a: any) => a.id === val);
        if (art) {
          next[idx].name = art.name;
          next[idx].unit_price = art.purchase_price;
          next[idx].supplier_ref = art.supplier_ref || '';
          if (!Number(next[idx].quantity_ordered) || Number(next[idx].quantity_ordered) < 1) next[idx].quantity_ordered = 1;
        }
      }
      next[idx].total = Number(next[idx].quantity_ordered || 0) * Number(next[idx].unit_price || 0);
      return next;
    });
  };

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-0">
      {/* ═══ Header ═══ */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-4 sm:px-5 lg:px-8 pb-3 pt-4 -mt-3 sm:-mt-4 lg:-mt-6 bg-white space-y-3 border-b border-neutral-100">
        <div className="flex items-start justify-between">
          <h1 className="text-lg font-bold text-neutral-900 leading-tight">Achats</h1>
          <button onClick={openCreate} className="shrink-0" title="Nouvelle commande">
            <Plus className="w-5 h-5 text-neutral-900 hover:text-neutral-600 transition-colors" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 relative">
            <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une commande…"
              className="bare-input w-full text-sm py-1.5 pl-5" />
            <div className="h-px bg-neutral-200 mt-1" />
          </div>
          {search && <button onClick={() => setSearch('')} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4" /></button>}
          <button onClick={() => load(true)} className="shrink-0 p-1.5 text-neutral-400 hover:text-neutral-600 transition" title="Rafraîchir">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {/* Mobile: centered tabs with dividers, no counts/badges */}
        <div className="md:hidden flex items-stretch text-[13px] font-bold overflow-x-auto no-scrollbar">
          {FILTERS.map((f, i) => {
            const active = statusFilter === f.key;
            return (
              <div key={f.key} className="flex items-stretch shrink-0 min-w-[80px]">
                {i > 0 && <div className="w-px bg-neutral-200 shrink-0" />}
                <button
                  onClick={() => setStatusFilter(f.key)}
                  className={`flex-1 flex items-center justify-center py-2 px-3 transition-all ${
                    active
                      ? 'text-neutral-900 bg-neutral-100/80 border-b-2 border-neutral-900 font-bold'
                      : 'text-neutral-400 hover:text-neutral-600 border-b-2 border-transparent'
                  }`}
                >
                  {f.label}
                </button>
              </div>
            );
          })}
        </div>
        {/* Desktop: original filter bar with counts and stats */}
        <div className="hidden md:flex items-center gap-3 text-[11px] font-semibold overflow-x-auto no-scrollbar whitespace-nowrap">
          <span className="shrink-0 text-neutral-900 num">{list.length} commandes</span>
          {(counts.sent || 0) + (counts.confirmed || 0) + (counts.partial || 0) > 0 && (
            <span className="shrink-0 text-amber-600 num">{(counts.sent || 0) + (counts.confirmed || 0) + (counts.partial || 0)} en attente</span>
          )}
          {totalPending > 0 && (
            <span className="shrink-0 text-brand-700 num">{formatFCFA(totalPending)} à recevoir</span>
          )}
          {FILTERS.map(f => {
            const active = statusFilter === f.key;
            const count = counts[f.key] || 0;
            if (count === 0 && !active && f.key) return null;
            return (
              <button key={f.key} onClick={() => setStatusFilter(f.key)} className={`shrink-0 py-1 transition-all ${active ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'}`}>
                {f.label}{count > 0 && <span className="num"> {count}</span>}
              </button>
            );
          })}
          {statusFilter && <button onClick={() => setStatusFilter('')} className="shrink-0 py-1 text-neutral-400 inline-flex items-center gap-1 hover:text-neutral-600 transition-all"><X className="w-3 h-3" />Effacer</button>}
        </div>
      </div>

      {/* ═══ List ═══ */}
      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="Aucune commande"
          description="Créez votre première commande fournisseur."
          action={<button onClick={openCreate} className="p-2 text-neutral-900 hover:text-neutral-600 transition"><Plus className="w-5 h-5" /></button>}
        />
      ) : (
        <div className={flashList ? 'waarwi-flash waarwi-flash-scroll' : ''}>
          {/* Desktop table header */}
          <div className="hidden lg:flex items-center px-8 h-8 border-b border-neutral-200 bg-neutral-50/60 text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
            <div className="w-[140px]">N° Commande</div>
            <div className="flex-1 min-w-0">Fournisseur</div>
            <div className="w-[100px]">Statut</div>
            <div className="w-[120px] text-right">Date</div>
            <div className="w-[130px] text-right">Montant</div>
            <div className="w-[100px] text-right pr-1">Actions</div>
          </div>
          <div className="divide-y divide-neutral-100">
            {filtered.map(o => {
              const stColor = STATUS_COLORS[o.status] || 'text-slate-500';
              const stLabel = STATUS_LABELS[o.status] || o.status;
              const canReceive = ['sent', 'confirmed', 'partial'].includes(o.status);
              return (
                <div
                  key={o.id}
                  data-row-id={o.id}
                  onClick={() => openDetail(o)}
                  className="group cursor-pointer transition hover:bg-neutral-50/60"
                >
                  {/* Desktop: single row */}
                  <div className="hidden lg:flex items-center px-8 h-10">
                    <div className="w-[140px] text-[13px] font-semibold text-neutral-800 truncate">{o.order_number}</div>
                    <div className="flex-1 min-w-0 text-xs text-neutral-600 truncate">{o.suppliers?.name || '—'}</div>
                    <div className="w-[100px]"><span className={`text-[11px] font-semibold ${stColor}`}>{stLabel}</span></div>
                    <div className="w-[120px] text-right text-xs text-neutral-500 num whitespace-nowrap">{formatDate(o.created_at)}</div>
                    <div className="w-[130px] text-right text-sm font-extrabold text-neutral-900 num whitespace-nowrap">{formatFCFA(o.total)}</div>
                    <div className="w-[100px] flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={e => { e.stopPropagation(); sendWhatsAppFor(o); }} className="p-1.5 rounded-lg hover:bg-emerald-50 text-[#25D366] transition" title="WhatsApp"><MessageCircle className="w-3.5 h-3.5" /></button>
                      <button onClick={e => { e.stopPropagation(); copyLinkFor(o); }} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-600 transition" title="Copier le lien"><Link2 className="w-3.5 h-3.5" /></button>
                      {o.status === 'draft' && <button onClick={e => { e.stopPropagation(); changeStatus(o, 'sent'); }} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-600 transition" title="Marquer envoyée"><CheckCircle className="w-3.5 h-3.5" /></button>}
                      {canReceive && <button onClick={e => { e.stopPropagation(); openOrderReceive(o); }} className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600 transition" title="Réceptionner"><Truck className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>
                  {/* Mobile: 3-line layout */}
                  <div className="lg:hidden px-4 py-2.5">
                    {/* Line 1: supplier only */}
                    <div className="text-xs font-medium text-neutral-700 truncate">{o.suppliers?.name || '—'}</div>
                    {/* Line 2: order#, date, status */}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[13px] font-semibold text-neutral-900 shrink-0">{o.order_number}</span>
                      <span className={`text-[10px] font-semibold ${stColor} shrink-0`}>{stLabel}</span>
                      <span className="text-xs text-neutral-400 shrink-0">{formatDate(o.created_at)}</span>
                    </div>
                    {/* Line 3: icon buttons + amount */}
                    <div className="flex items-center gap-1 mt-1.5">
                      <button onClick={e => { e.stopPropagation(); sendWhatsAppFor(o); }} className="p-1.5 rounded-md hover:bg-emerald-50 text-[#25D366] transition" title="WhatsApp"><MessageCircle className="w-4 h-4" /></button>
                      <button onClick={e => { e.stopPropagation(); copyLinkFor(o); }} className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-500 transition" title="Copier le lien"><Link2 className="w-4 h-4" /></button>
                      {o.status === 'draft' && <button onClick={e => { e.stopPropagation(); changeStatus(o, 'sent'); }} className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-500 transition" title="Marquer envoyée"><CheckCircle className="w-4 h-4" /></button>}
                      {canReceive && <button onClick={e => { e.stopPropagation(); openOrderReceive(o); }} className="p-1.5 rounded-md hover:bg-emerald-50 text-emerald-600 transition" title="Réceptionner"><Truck className="w-4 h-4" /></button>}
                      <div className="flex-1" />
                      <div className="w-px h-5 bg-neutral-200 mx-1" />
                      <span className="text-sm font-extrabold text-neutral-900 num whitespace-nowrap shrink-0">{formatFCFA(o.total)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ Full-screen editor (desktop) ═══ */}
      {editorOpen && isDesktop && (
        <SupplierOrderEditor
          mode={editorMode}
          articles={articles}
          suppliers={suppliers}
          headerForm={headerForm}
          setHeaderForm={setHeaderForm}
          items={editorItems}
          setItems={setEditorItems}
          subtotal={editorSubtotal}
          saving={saving}
          onSave={editorMode === 'create' || editorMode === 'edit' ? saveOrder : undefined}
          onClose={closeEditor}
          editingId={editorOrderId}
          documentNumber={editorOrder?.order_number}
          documentStatus={editorOrder?.status}
          autoMode={autoMode}
          onVehiclePicker={() => setVehiclePickerOpen(true)}
          onEdit={editorOrderId && ['draft', 'sent', 'confirmed', 'partial'].includes(editorOrder?.status || '') ? () => {
            if (editorOrder) openOrderEdit(editorOrder);
          } : undefined}
          onPrint={editorOrderId ? printFromEditor : undefined}
          onCopyLink={editorOrder ? () => copyLinkFor(editorOrder) : undefined}
          onWhatsApp={editorOrder?.suppliers ? () => sendWhatsAppFor(editorOrder!) : undefined}
          onCancel={editorOrder && ['draft', 'sent'].includes(editorOrder.status) ? () => setToCancel(editorOrder) : undefined}
          onChangeStatus={editorOrder ? (status: string) => {
            changeStatus(editorOrder, status);
            setEditorOrder({ ...editorOrder, status });
          } : undefined}
          onStartReceive={editorOrder && ['sent', 'confirmed', 'partial'].includes(editorOrder.status) ? () => {
            if (editorOrder) openOrderReceive(editorOrder);
          } : undefined}
          receiveQty={receiveQty}
          setReceiveQty={setReceiveQty}
          receiveLotData={receiveLotData}
          setReceiveLotData={setReceiveLotData}
          stockMethod={stockMethod}
          onConfirmReceive={editorMode === 'receive' ? confirmReceive : undefined}
          hasPrev={editorNavIdx > 0}
          hasNext={editorNavIdx >= 0 && editorNavIdx < filtered.length - 1}
          onPrev={editorNavIdx > 0 ? goToPrev : undefined}
          onNext={editorNavIdx >= 0 && editorNavIdx < filtered.length - 1 ? goToNext : undefined}
        />
      )}

      {/* ═══ Mobile view/receive ═══ */}
      {editorOpen && !isDesktop && editorMode !== 'create' && (
        <MobileOrderDetail
          mode={editorMode as 'view' | 'receive'}
          order={editorOrder}
          items={editorItems}
          articles={articles}
          suppliers={suppliers}
          headerForm={headerForm}
          subtotal={editorSubtotal}
          saving={saving}
          onClose={closeEditor}
          onPrint={editorOrderId ? printFromEditor : undefined}
          onCopyLink={editorOrder ? () => copyLinkFor(editorOrder) : undefined}
          onWhatsApp={editorOrder?.suppliers ? () => sendWhatsAppFor(editorOrder!) : undefined}
          onEdit={editorOrder && ['draft', 'sent', 'confirmed', 'partial'].includes(editorOrder.status) ? () => { if (editorOrder) openOrderEdit(editorOrder); } : undefined}
          onStartReceive={editorOrder && ['sent', 'confirmed', 'partial'].includes(editorOrder.status) ? () => { if (editorOrder) openOrderReceive(editorOrder); } : undefined}
          onChangeStatus={editorOrder ? (status: string) => { changeStatus(editorOrder, status); setEditorOrder({ ...editorOrder, status }); } : undefined}
          onCancel={editorOrder && ['draft', 'sent'].includes(editorOrder.status) ? () => setToCancel(editorOrder) : undefined}
          receiveQty={receiveQty}
          setReceiveQty={setReceiveQty}
          receiveLotData={receiveLotData}
          setReceiveLotData={setReceiveLotData}
          stockMethod={stockMethod}
          onConfirmReceive={editorMode === 'receive' ? confirmReceive : undefined}
        />
      )}

      {/* ═══ Mobile create wizard (unchanged) ═══ */}
      {mobileOpen && !isDesktop && (
        <MobileBillingWizard
          open={true}
          onClose={() => setMobileOpen(false)}
          title="Nouvelle commande fournisseur"
          headerFields={[
            { key: 'supplier_id', label: 'Fournisseur', type: 'select', required: true, options: suppliers.map(s => ({ value: s.id, label: s.name })), placeholder: 'Sélectionner...' },
            { key: 'expected_date', label: 'Livraison prévue', type: 'date' },
            { key: 'note', label: 'Note', type: 'text', placeholder: 'Note optionnelle...' },
          ]}
          headerValues={mobileForm}
          onHeaderChange={(k, v) => setMobileForm(f => ({ ...f, [k]: v }))}
          items={mobileItems.map(i => ({
            article_id: i.article_id || null, name: i.name,
            quantity: i.quantity_ordered, unit_price: i.unit_price, discount: 0, total: i.total,
            supplier_ref: i.supplier_ref,
          }))}
          onAddItem={(articleId) => {
            const art = articles.find(a => a.id === articleId);
            if (!art) return;
            setMobileItems(p => [...p, { article_id: articleId, name: art.name, supplier_ref: art.supplier_ref || '', quantity_ordered: 1, unit_price: art.purchase_price || 0, total: art.purchase_price || 0 }]);
          }}
          onUpdateItem={(idx, field, val) => {
            if (field === 'quantity') mobileUpdateItem(idx, 'quantity_ordered', val);
            else mobileUpdateItem(idx, field, val);
          }}
          onRemoveItem={(idx) => setMobileItems(p => p.filter((_, i) => i !== idx))}
          articles={articles}
          saving={saving}
          onSave={mobileSave}
          total={mobileItems.reduce((s: number, i: any) => s + Number(i.total || 0), 0)}
          saveLabel="Créer commande"
          itemPriceField="purchase_price"

        />
      )}

      {/* ═══ Cancel confirmation ═══ */}
      <ConfirmDialog
        open={!!toCancel}
        onClose={() => setToCancel(null)}
        onConfirm={async () => {
          if (!toCancel) return;
          await changeStatus(toCancel, 'cancelled');
          setToCancel(null);
          if (editorOrder?.id === toCancel.id) closeEditor();
        }}
        title="Annuler la commande ?"
        message={`La commande "${toCancel?.order_number}" sera annulée.`}
        danger
      />

      {/* ═══ Dispatch modal for multi-site reception ═══ */}
      <Modal
        open={dispatchOpen}
        onClose={() => setDispatchOpen(false)}
        title="Dispatcher la réception entre magasins"
        size="lg"
        footer={
          <>
            <button onClick={() => setDispatchOpen(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
            <button
              onClick={() => receiveWithDispatch(dispatchData)}
              disabled={saving}
              className="btn-icon-primary"
              title="Confirmer la réception"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2 p-3 rounded-xl bg-neutral-50 border border-neutral-200">
            <Package className="w-4 h-4 text-neutral-700 mt-0.5 shrink-0" />
            <p className="text-xs text-neutral-800">
              Le mode fournisseurs partagés est actif. Répartissez les quantités reçues entre vos {sites.length} magasins.
            </p>
          </div>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {editorItems.filter(i => {
              const itemId = i.id || '';
              return (receiveQty[itemId] || 0) > 0 && i.article_id;
            }).map(item => {
              const itemId = item.id || '';
              const totalQty = Number(receiveQty[itemId] || 0);
              const allocated = Object.values(dispatchData[itemId] || {}).reduce((s, v) => s + v, 0);
              const isValid = allocated === totalQty;
              return (
                <div key={itemId} className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-neutral-900">{item.name}</div>
                      {item.supplier_ref && <div className="text-[10px] text-neutral-400 font-mono">{item.supplier_ref}</div>}
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-neutral-500">Qte reçue</div>
                      <div className="text-sm font-bold text-neutral-900 num">{totalQty}</div>
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    {sites.map(site => {
                      const val = dispatchData[itemId]?.[site.id] || 0;
                      return (
                        <div key={site.id} className="flex items-center gap-2">
                          <span className="text-xs text-neutral-600 font-medium flex-1 truncate">{site.name}</span>
                          <input
                            type="number" min={0} max={totalQty}
                            value={val}
                            onChange={e => {
                              const v = Math.max(0, Math.min(totalQty, Number(e.target.value) || 0));
                              setDispatchData(prev => ({ ...prev, [itemId]: { ...prev[itemId], [site.id]: v } }));
                            }}
                            className="w-20 text-xs num text-center bg-transparent border-b border-neutral-300 focus:border-neutral-500 outline-none py-1 focus:ring-0"
                          />
                        </div>
                      );
                    })}
                  </div>
                  {!isValid && (
                    <div className="text-[10px] text-amber-600 font-medium">
                      Alloué : {allocated}/{totalQty} — {allocated < totalQty ? `${totalQty - allocated} restant(s)` : 'surplus'}
                    </div>
                  )}
                  {isValid && (
                    <div className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Répartition correcte
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Modal>

      {/* ═══ Vehicle picker ═══ */}
      {autoMode && tenant && currentSite && (
        <VehicleArticlePicker
          open={vehiclePickerOpen}
          onClose={() => setVehiclePickerOpen(false)}
          onSelect={a => {
            setEditorItems(p => [...p, {
              article_id: a.id, name: a.name, supplier_ref: a.supplier_ref || '',
              quantity_ordered: 1, unit_price: a.purchase_price, total: a.purchase_price,
            }]);
          }}
          priceMode="purchase"
          tenantId={tenant.id}
          siteId={currentSite.id}
        />
      )}
    </div>
  );
}

// ─── Mobile Order Detail (view / receive) ─────────────────────────

const MOBILE_STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyée', confirmed: 'Confirmée',
  partial: 'Partielle', received: 'Reçue', cancelled: 'Annulée',
};
const MOBILE_STATUS_COLORS: Record<string, string> = {
  draft: 'text-slate-500', sent: 'text-neutral-700', confirmed: 'text-brand-600',
  partial: 'text-amber-600', received: 'text-emerald-600', cancelled: 'text-red-600',
};

function MobileOrderDetail({
  mode, order, items, headerForm, subtotal, saving,
  onClose, onPrint, onCopyLink, onWhatsApp, onEdit, onStartReceive,
  onChangeStatus, onCancel,
  receiveQty, setReceiveQty, receiveLotData, setReceiveLotData,
  stockMethod, onConfirmReceive,
}: {
  mode: 'view' | 'receive';
  order: any; items: SOLineItem[]; articles: any[]; suppliers: any[];
  headerForm: SOHeaderForm; subtotal: number; saving: boolean;
  onClose: () => void;
  onPrint?: () => void; onCopyLink?: () => void; onWhatsApp?: () => void;
  onEdit?: () => void; onStartReceive?: () => void;
  onChangeStatus?: (s: string) => void; onCancel?: () => void;
  receiveQty: ReceiveQtyMap; setReceiveQty: React.Dispatch<React.SetStateAction<ReceiveQtyMap>>;
  receiveLotData: ReceiveLotMap; setReceiveLotData: React.Dispatch<React.SetStateAction<ReceiveLotMap>>;
  stockMethod: string; onConfirmReceive?: () => void;
}) {
  const stLabel = MOBILE_STATUS_LABELS[order?.status || ''] || order?.status;
  const stColor = MOBILE_STATUS_COLORS[order?.status || ''] || 'text-slate-500';
  const supplierName = order?.suppliers?.name || '—';
  const validItems = items.filter(i => i.name.trim());

  return (
    <div className="fixed inset-0 z-[55] bg-white flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-neutral-200 shrink-0">
        <button onClick={onClose} className="p-1"><X className="w-5 h-5 text-neutral-700" /></button>
        <div className="text-center flex-1 min-w-0">
          <div className="text-sm font-bold text-neutral-900 truncate">{order?.order_number || 'Commande'}</div>
        </div>
        <span className={`text-xs font-semibold ${stColor}`}>{stLabel}</span>
      </div>

      {/* Receive banner */}
      {mode === 'receive' && (
        <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-200">
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-emerald-700" />
            <span className="text-xs font-semibold text-emerald-800">Réception en cours</span>
          </div>
        </div>
      )}

      {/* Order info */}
      <div className="px-4 py-3 border-b border-neutral-100 space-y-1">
        <div className="flex items-center gap-2 text-xs text-neutral-700">
          <User className="w-3.5 h-3.5 text-neutral-400" />
          <span className="font-medium">{supplierName}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-neutral-500">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {formatDate(order?.created_at)}
          </span>
          {order?.expected_date && (
            <span>Livraison : {formatDate(order.expected_date)}</span>
          )}
        </div>
        {order?.note && <div className="text-xs text-neutral-400 italic">{order.note}</div>}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {mode === 'view' ? (
          <div className="divide-y divide-neutral-100">
            {validItems.map((item, idx) => (
              <div key={idx} className="px-4 py-2.5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-neutral-800 truncate">{item.name}</div>
                    {item.supplier_ref && <div className="text-[10px] text-neutral-400 font-mono">{item.supplier_ref}</div>}
                  </div>
                  <div className="text-sm font-bold text-neutral-900 num shrink-0 ml-2">{formatFCFA(item.total)}</div>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-neutral-500">
                  <span>{item.quantity_ordered} x {formatFCFA(item.unit_price)}</span>
                  {(item.quantity_received || 0) > 0 && (
                    <span className="text-emerald-600 font-medium">
                      {item.quantity_received}/{item.quantity_ordered} reçu
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Receive mode */
          <div className="divide-y divide-neutral-100">
            {validItems.map((item, idx) => {
              const itemId = item.id || `idx-${idx}`;
              const remaining = Math.max(0, (item.quantity_ordered || 0) - (item.quantity_received || 0));
              const todayQty = receiveQty[itemId] ?? remaining;
              const lotData = receiveLotData[itemId] || { batch_number: '', expiry_date: '' };
              if (remaining <= 0) return null;
              return (
                <div key={idx} className="px-4 py-3 space-y-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-neutral-800 truncate">{item.name}</div>
                    {item.supplier_ref && <div className="text-[10px] text-neutral-400 font-mono">{item.supplier_ref}</div>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-neutral-400 mb-0.5">Commandé</div>
                      <div className="font-semibold text-neutral-700 num">{item.quantity_ordered}</div>
                    </div>
                    <div>
                      <div className="text-neutral-400 mb-0.5">Déjà reçu</div>
                      <div className="font-semibold text-neutral-700 num">{item.quantity_received || 0}</div>
                    </div>
                    <div>
                      <div className="text-neutral-400 mb-0.5">Restant</div>
                      <div className="font-semibold text-amber-600 num">{remaining}</div>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-neutral-500 block mb-0.5">Qte à recevoir</label>
                    <input
                      type="number" min={0} max={remaining} value={todayQty}
                      onChange={e => setReceiveQty(prev => ({ ...prev, [itemId]: Math.max(0, Math.min(remaining, Number(e.target.value) || 0)) }))}
                      className="w-full text-sm font-semibold num bg-transparent border-b border-neutral-300 focus:border-neutral-500 outline-none py-1 focus:ring-0"
                    />
                  </div>
                  {stockMethod === 'lot' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-neutral-400 block mb-0.5">N° Lot</label>
                        <input
                          value={lotData.batch_number} placeholder="LOT-..."
                          onChange={e => setReceiveLotData(prev => ({ ...prev, [itemId]: { ...lotData, batch_number: e.target.value } }))}
                          className="w-full text-xs bg-transparent border-b border-neutral-300 focus:border-neutral-500 outline-none py-1 focus:ring-0"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-neutral-400 block mb-0.5">Expiration</label>
                        <input
                          type="date" value={lotData.expiry_date}
                          onChange={e => setReceiveLotData(prev => ({ ...prev, [itemId]: { ...lotData, expiry_date: e.target.value } }))}
                          className="w-full text-xs bg-transparent border-b border-neutral-300 focus:border-neutral-500 outline-none py-1 focus:ring-0"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-neutral-200 px-4 py-3 space-y-2 shrink-0 bg-white">
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-500">{validItems.length} article{validItems.length > 1 ? 's' : ''}</span>
          <span className="text-base font-extrabold text-neutral-900 num">{formatFCFA(subtotal)}</span>
        </div>
        {mode === 'view' && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {onEdit && (
              <button onClick={onEdit} className="btn-icon" title="Modifier"><Pencil className="w-4 h-4" /></button>
            )}
            {order?.status === 'draft' && onChangeStatus && (
              <button onClick={() => onChangeStatus('sent')} className="btn-icon" title="Envoyer"><CheckCircle className="w-4 h-4" /></button>
            )}
            {onCopyLink && (
              <button onClick={onCopyLink} className="btn-icon" title="Copier le lien"><Link2 className="w-4 h-4" /></button>
            )}
            {onWhatsApp && (
              <button onClick={onWhatsApp} className="btn-icon" title="WhatsApp"><MessageCircle className="w-4 h-4" /></button>
            )}
            {onCancel && (
              <button onClick={onCancel} className="btn-icon-danger" title="Annuler"><Ban className="w-4 h-4" /></button>
            )}
            <span className="flex-1" />
            {onStartReceive && (
              <button onClick={onStartReceive} className="btn-icon-primary" title="Réceptionner"><Truck className="w-4 h-4" /></button>
            )}
            {onPrint && (
              <button onClick={onPrint} className="btn-icon-primary" title="Imprimer"><Printer className="w-4 h-4" /></button>
            )}
          </div>
        )}
        {mode === 'receive' && onConfirmReceive && (
          <button
            onClick={onConfirmReceive}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-neutral-900 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
            Confirmer la réception
          </button>
        )}
      </div>
    </div>
  );
}
