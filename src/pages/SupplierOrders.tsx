import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  Plus, ShoppingBag, Loader2, Search, RefreshCw,
  CheckCircle, Check, Truck, Trash2, X, Car, Package, Calendar,
  User, Minus, ChevronRight, FileText, Printer, MessageCircle, Pencil, Link2, GripVertical,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog, DocPanel } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { SearchableSelect } from '../components/SearchableSelect';
import { VehicleArticlePicker } from '../components/VehicleArticlePicker';
import { isAutoParts } from '../lib/types';
import { formatFCFA, formatDate } from '../lib/format';
import { printDocumentA4, buildPrintTenantForSite, type PrintTenant } from '../lib/print';
import { consumeNavContext } from '../lib/navHighlight';
import { DocItems, DocTotals, DocSectionTitle, DocSlimHeader } from '../components/DocLayout';
import type { DocItem, DocStatusConfig } from '../components/DocLayout';
import { MobileBillingWizard } from '../components/MobileBillingWizard';

type SupplierOrder = {
  id: string; order_number: string; total: number; status: string;
  created_at: string; expected_date: string | null;
  public_token?: string | null;
  public_code?: string | null;
  supplier_id?: string | null;
  suppliers: { name: string; phone?: string | null; whatsapp?: string | null; email?: string | null; address?: string | null } | null;
  doc_header?: any;
};

const STATUS_MAP: Record<string, { label: string; pill: string; dot: string }> = {
  draft:     { label: 'Brouillon',           pill: 'bg-slate-100 text-slate-700 border-slate-200',     dot: 'bg-slate-400' },
  sent:      { label: 'Envoyée',             pill: 'bg-neutral-50 text-neutral-800 border-neutral-200',         dot: 'bg-neutral-500' },
  confirmed: { label: 'Confirmée',           pill: 'bg-brand-50 text-brand-700 border-brand-200',      dot: 'bg-brand-500' },
  partial:   { label: 'Partielle',           pill: 'bg-amber-50 text-amber-700 border-amber-200',      dot: 'bg-amber-500' },
  received:  { label: 'Reçue',               pill: 'bg-emerald-50 text-emerald-700 border-emerald-200',dot: 'bg-emerald-500' },
  cancelled: { label: 'Annulée',             pill: 'bg-red-50 text-red-700 border-red-200',            dot: 'bg-red-500' },
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
  const [list, setList] = useState<SupplierOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<SupplierOrder | null>(null);
  const [detailItems, setDetailItems] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [toCancel, setToCancel] = useState<SupplierOrder | null>(null);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editItems, setEditItems] = useState<any[]>([]);
  const [receiveMode, setReceiveMode] = useState(false);
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const [receiveLotData, setReceiveLotData] = useState<Record<string, { batch_number: string; expiry_date: string }>>({});
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchData, setDispatchData] = useState<Record<string, Record<string, number>>>({});
  const stockMethod = (tenant as any)?.settings?.stock_method || 'none';
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [flashList, setFlashList] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingOrder, setEditingOrder] = useState<SupplierOrder | null>(null);
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;

  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [articles, setArticles] = useState<any[]>([]);
  const [form, setForm] = useState<{ supplier_id: string; expected_date: string; note: string }>({ supplier_id: '', expected_date: '', note: '' });
  const [orderItems, setOrderItems] = useState<any[]>([
    { article_id: '', name: '', supplier_ref: '', quantity_ordered: 1, unit_price: 0, total: 0 },
  ]);

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

  useEffect(() => { load(); }, [tenant?.id, currentSite?.id]);
  useEffect(() => { if (dataTick > 0) { const t = setTimeout(() => load(true), 400); return () => clearTimeout(t); } }, [dataTick]);

  useEffect(() => {
    const ctx = consumeNavContext();
    if (!ctx?.target) return;
    if (ctx.target === 'payables') {
      setStatusFilter('');
      setFlashList(true);
      setTimeout(() => setFlashList(false), 6800);
    }
    if (ctx.target === 'newOrder') {
      setOpen(true);
    }
  }, []);
  useEffect(() => {
    if (!tenant) return;
    const isShared = (tenant as any)?.settings?.shared_articles !== false;
    const isSharedSup = (tenant as any)?.settings?.shared_suppliers !== false;
    const fetchAllArticles = async () => {
      const all: any[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        let q = supabase.from('articles').select('id, name, purchase_price, supplier_ref, internal_ref').eq('tenant_id', tenant.id).eq('is_active', true).order('name').range(from, from + pageSize - 1);
        if (!isShared && currentSite) q = q.eq('site_id', currentSite.id);
        const { data } = await q;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    };
    let supQuery = supabase.from('suppliers').select('id, name, phone, balance, credit_limit, credit_blocked').eq('tenant_id', tenant.id).eq('is_active', true).order('name');
    if (!isSharedSup && currentSite) {
      supQuery = supQuery.eq('site_id', currentSite.id);
    }
    Promise.all([
      supQuery,
      fetchAllArticles(),
    ]).then(([{ data: s }, a]) => { setSuppliers(s || []); setArticles(a); });
  }, [tenant?.id, currentSite?.id]);

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

  const updateItem = (idx: number, field: string, val: any) => {
    setOrderItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      if (field === 'article_id') {
        const art = articles.find(a => a.id === val);
        if (art) {
          next[idx].name = art.name;
          next[idx].unit_price = art.purchase_price;
          next[idx].supplier_ref = art.supplier_ref || '';
          if (!Number(next[idx].quantity_ordered) || Number(next[idx].quantity_ordered) < 1) next[idx].quantity_ordered = 1;
        }
      }
      const it = next[idx];
      next[idx].total = Number(it.quantity_ordered || 0) * Number(it.unit_price || 0);
      return next;
    });
  };

  const incQty = (idx: number, delta: number) => {
    updateItem(idx, 'quantity_ordered', Math.max(1, Number(orderItems[idx].quantity_ordered || 0) + delta));
  };

  const subtotal = orderItems.reduce((s, i) => s + Number(i.total), 0);
  const totalItems = orderItems.reduce((s, i) => s + (i.name.trim() ? Number(i.quantity_ordered || 0) : 0), 0);

  const save = async () => {
    if (!tenant || !currentSite) { error('Magasin introuvable'); return; }
    if (!can('manage_supplier_orders')) { error('Vous n\'avez pas la permission de gerer les achats'); return; }
    if (!form.supplier_id) { error('Sélectionnez un fournisseur'); return; }
    if (orderItems.every(i => !i.name.trim())) { error('Ajoutez au moins un article'); return; }
    const validItems = orderItems.filter(i => i.name.trim());
    const total = validItems.reduce((s, i) => s + Number(i.total), 0);
    if (!editingOrderId) {
      const { data: freshSup } = await supabase
        .from('suppliers')
        .select('id, balance, credit_limit, credit_blocked')
        .eq('id', form.supplier_id)
        .maybeSingle();
      if (freshSup) {
        if (freshSup.credit_blocked === true) {
          error('Commandes à crédit bloquées pour ce fournisseur');
          return;
        }
        const limit = Number(freshSup.credit_limit || 0);
        if (limit > 0) {
          const { data: outstanding } = await supabase
            .from('supplier_orders')
            .select('total')
            .eq('supplier_id', form.supplier_id)
            .eq('tenant_id', tenant.id)
            .not('status', 'in', '("cancelled","received")');
          const currentDebt = (outstanding || []).reduce((s: number, o: any) => s + Number(o.total || 0), 0);
          if ((currentDebt + total) > limit) {
            error(`Plafond crédit fournisseur dépassé (${formatFCFA(limit)}). Encours actuel : ${formatFCFA(currentDebt)}`);
            return;
          }
        }
      }
    }
    setSaving(true);

    if (editingOrderId) {
      await supabase.from('supplier_orders').update({
        supplier_id: form.supplier_id,
        subtotal: total, total,
        expected_date: form.expected_date || null, note: form.note,
      }).eq('id', editingOrderId);
      await supabase.from('supplier_order_items').delete().eq('order_id', editingOrderId);
      await supabase.from('supplier_order_items').insert(validItems.map(i => ({
        tenant_id: tenant.id, order_id: editingOrderId,
        article_id: i.article_id || null, name: i.name, supplier_ref: i.supplier_ref,
        quantity_ordered: i.quantity_ordered, quantity_received: 0,
        unit_price: i.unit_price, total: i.total,
      })));
      setSaving(false);
      success('Commande mise à jour'); closeOrderPanel();
      load();
    } else {
      const { data: numData } = await supabase.rpc('next_doc_number', {
        p_tenant_id: tenant.id, p_kind: 'supplier_order', p_prefix: 'CMD',
      });
      const oNum = (numData as string) || ('CMD-' + Date.now());
      const { data: o, error: e } = await supabase.from('supplier_orders').insert({
        tenant_id: tenant.id, site_id: currentSite.id,
        supplier_id: form.supplier_id,
        order_number: oNum, subtotal: total, discount: 0, total,
        expected_date: form.expected_date || null, note: form.note, status: 'draft',
      }).select().single();
      if (e || !o) { error(e?.message || 'Erreur'); setSaving(false); return; }
      await supabase.from('supplier_order_items').insert(validItems.map(i => ({
        tenant_id: tenant.id, order_id: o.id,
        article_id: i.article_id || null, name: i.name, supplier_ref: i.supplier_ref,
        quantity_ordered: i.quantity_ordered, quantity_received: 0,
        unit_price: i.unit_price, total: i.total,
      })));
      setEditingOrderId(o.id);
      setSaving(false);
      success('Commande créée'); closeOrderPanel();
      load();
    }
  };

  const closeOrderPanel = () => {
    setOpen(false);
    setEditingOrderId(null);
    setEditingOrder(null);
    setOrderItems([{ article_id: '', name: '', supplier_ref: '', quantity_ordered: 1, unit_price: 0, total: 0 }]);
    setForm({ supplier_id: '', expected_date: '', note: '' });
  };

  const openOrderForEdit = async (o: SupplierOrder) => {
    const { data } = await supabase.from('supplier_order_items').select('*, articles(internal_ref, oem_ref)').eq('order_id', o.id);
    setEditingOrderId(o.id);
    setEditingOrder(o);
    setForm({ supplier_id: o.supplier_id || '', expected_date: o.expected_date || '', note: (o as any).note || '' });
    setOrderItems((data || []).map((i: any) => ({
      article_id: i.article_id || '', name: i.name, supplier_ref: i.supplier_ref || '',
      quantity_ordered: Number(i.quantity_ordered), unit_price: Number(i.unit_price), total: Number(i.total),
    })));
    setOpen(true);
  };

  const openDetailPanel = async (o: SupplierOrder, forceReceive = false) => {
    setSelected(o); setDetailOpen(true);
    setEditMode(false); setReceiveMode(forceReceive);
    const [{ data: itemsData }, { data: supData }] = await Promise.all([
      supabase.from('supplier_order_items').select('*, articles(internal_ref, oem_ref)').eq('order_id', o.id),
      supabase.from('suppliers').select('*').eq('id', (o as any).supplier_id || '').maybeSingle(),
    ]);
    setDetailItems(itemsData || []);
    setSelectedSupplier(supData || null);
    const rq: Record<string, number> = {};
    (itemsData || []).forEach((it: any) => {
      const remaining = Math.max(0, Number(it.quantity_ordered || 0) - Number(it.quantity_received || 0));
      rq[it.id] = remaining;
    });
    setReceiveQty(rq);
  };

  const openDetail = async (o: SupplierOrder) => {
    if (isDesktop && ['draft', 'sent', 'confirmed', 'partial'].includes(o.status)) {
      openOrderForEdit(o);
    } else {
      await openDetailPanel(o);
    }
  };

  const openReceive = async (o: SupplierOrder) => {
    await openDetailPanel(o, true);
  };

  const tenantForPrint = (): PrintTenant => buildPrintTenantForSite(tenant, currentSite);

  const printOrder = () => {
    if (!selected) return;
    printDocumentA4({
      tenant: tenantForPrint(),
      docLabel: 'BON DE COMMANDE',
      docNumber: selected.order_number,
      docDate: formatDate(selected.created_at),
      customer: selectedSupplier ? { name: selectedSupplier.name, phone: selectedSupplier.phone, address: selectedSupplier.address } : null,
      extraMeta: selected.expected_date ? [{ label: 'Livraison prévue', value: formatDate(selected.expected_date) }] : [],
      items: detailItems.map(i => ({ name: i.name, supplier_ref: i.supplier_ref || null, oem_ref: i.articles?.oem_ref || null, quantity: Number(i.quantity_ordered), unit_price: Number(i.unit_price), discount: 0 })),
      subtotal: Number(selected.total), total: Number(selected.total),
      footerNote: 'Merci de confirmer réception et délai de livraison.',
      issuedBy: creatorName((selected as any).user_id),
      docHeader: selected.doc_header ?? null,
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
    try {
      await navigator.clipboard.writeText(url);
      success('Lien copié');
    } catch {
      window.prompt('Copiez le lien :', url);
    }
  };

  const sendWhatsAppFor = (o: SupplierOrder) => {
    const sup = o.suppliers;
    if (!sup) { error('Fournisseur introuvable'); return; }
    const phoneRaw = ((sup as any).whatsapp || sup.phone || '').replace(/[^0-9]/g, '');
    if (!phoneRaw) { error('Aucun numéro WhatsApp/téléphone'); return; }
    const phone = phoneRaw.startsWith('221') ? phoneRaw : phoneRaw.length === 9 ? `221${phoneRaw}` : phoneRaw;
    const link = publicOrderUrl(o);
    const msg = [
      `Bonjour ${sup.name || ''},`,
      '',
      `Notre commande *${o.order_number}* du ${formatDate(o.created_at)}.`,
      o.expected_date ? `Livraison souhaitée : ${formatDate(o.expected_date)}` : '',
      `*Total : ${formatFCFA(o.total)}*`,
      link ? `\nBon de commande (PDF) : ${link}` : '',
      '',
      'Merci de confirmer.',
    ].filter(Boolean).join('\n');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const copyPublicLink = () => selected && copyLinkFor(selected);

  const sendWhatsApp = () => selected && sendWhatsAppFor(selected);

  const beginEdit = () => {
    setEditItems(detailItems.map(i => ({
      ...i,
      quantity_ordered: Number(i.quantity_ordered),
      unit_price: Number(i.unit_price),
      total: Number(i.total),
    })));
    setEditMode(true);
  };

  const updateEditItem = (idx: number, field: string, val: any) => {
    setEditItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      const it = next[idx];
      next[idx].total = Number(it.quantity_ordered || 0) * Number(it.unit_price || 0);
      return next;
    });
  };

  const removeEditItem = (idx: number) => {
    setEditItems(prev => prev.filter((_, i) => i !== idx));
  };

  const saveEdit = async () => {
    if (!selected || !tenant) return;
    if (!can('edit_supplier_orders')) { error('Vous n\'avez pas la permission de modifier les achats'); return; }
    setSaving(true);
    const kept = editItems.filter(i => (i.name || '').trim());
    const deletedIds = detailItems
      .filter(orig => !kept.some(k => k.id === orig.id))
      .map(o => o.id);
    if (deletedIds.length > 0) {
      await supabase.from('supplier_order_items').delete().in('id', deletedIds);
    }
    for (const it of kept) {
      const minReceived = Number(it.quantity_received || 0);
      const qty = Math.max(minReceived, Number(it.quantity_ordered || 0));
      await supabase.from('supplier_order_items').update({
        name: it.name, supplier_ref: it.supplier_ref || '',
        quantity_ordered: qty, unit_price: Number(it.unit_price || 0),
        total: qty * Number(it.unit_price || 0),
      }).eq('id', it.id);
    }
    const newSubtotal = kept.reduce((s, i) => s + Number(i.quantity_ordered) * Number(i.unit_price), 0);
    await supabase.from('supplier_orders').update({ subtotal: newSubtotal, total: newSubtotal }).eq('id', selected.id);
    success('Commande mise à jour');
    setEditMode(false);
    setSaving(false);
    await openDetail({ ...selected, total: newSubtotal });
    load(true);
  };

  const initiateReceive = () => {
    if (!isMultiSiteDispatch) {
      receivePartial();
      return;
    }
    // Build dispatch data: for each item with qty > 0, distribute across sites
    const dd: Record<string, Record<string, number>> = {};
    for (const item of detailItems) {
      const addQty = Number(receiveQty[item.id] || 0);
      if (addQty > 0 && item.article_id) {
        dd[item.id] = {};
        if (sites.length === 1) {
          dd[item.id][sites[0].id] = addQty;
        } else {
          // Default: assign all to current site
          dd[item.id][currentSite!.id] = addQty;
        }
      }
    }
    if (Object.keys(dd).length === 0) {
      error('Aucune quantité à réceptionner');
      return;
    }
    setDispatchData(dd);
    if (sites.length === 1) {
      receiveWithDispatch(dd);
    } else {
      setDispatchOpen(true);
    }
  };

  const receiveWithDispatch = async (dd: Record<string, Record<string, number>>) => {
    if (!selected || !tenant || !currentSite) return;
    if (!can('manage_supplier_orders')) { error('Vous n\'avez pas la permission de réceptionner les commandes'); return; }
    setSaving(true);
    let anyReceived = 0;
    let fullyReceived = true;
    for (const item of detailItems) {
      const siteAlloc = dd[item.id];
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
          const lotData = receiveLotData[item.id] || { batch_number: '', expiry_date: '' };
          await supabase.rpc('adjust_stock_lot', {
            p_article_id: item.article_id, p_site_id: siteId,
            p_quantity: qty, p_batch_number: lotData.batch_number || `LOT-${Date.now()}`,
            p_expiry_date: lotData.expiry_date || null,
            p_purchase_price: Number(item.unit_price || 0),
            p_note: `Réception commande ${selected.order_number}`,
          });
        } else {
          await supabase.rpc('adjust_stock', {
            p_article_id: item.article_id, p_site_id: siteId,
            p_quantity: qty, p_movement_type: 'purchase',
            p_note: `Réception commande ${selected.order_number}`,
          });
        }
        anyReceived += qty;
      }
      await supabase.from('supplier_order_items').update({ quantity_received: newTotalReceived }).eq('id', item.id);
      if (newTotalReceived < ordered) fullyReceived = false;
    }
    const newStatus = fullyReceived ? 'received' : 'partial';
    const update: any = { status: newStatus };
    if (fullyReceived) update.received_date = new Date().toISOString().slice(0, 10);
    await supabase.from('supplier_orders').update(update).eq('id', selected.id);
    success(fullyReceived ? 'Commande entièrement réceptionnée' : `Réception partielle enregistrée (+${anyReceived})`);
    setSaving(false);
    setReceiveMode(false);
    setDispatchOpen(false);
    setDetailOpen(false);
    load();
  };

  const receivePartial = async () => {
    if (!selected || !tenant || !currentSite) return;
    if (!can('manage_supplier_orders')) { error('Vous n\'avez pas la permission de réceptionner les commandes'); return; }
    setSaving(true);
    let anyReceived = 0;
    let fullyReceived = true;
    for (const item of detailItems) {
      const addQty = Number(receiveQty[item.id] || 0);
      const alreadyReceived = Number(item.quantity_received || 0);
      const ordered = Number(item.quantity_ordered || 0);
      const newTotalReceived = alreadyReceived + addQty;
      if (addQty > 0 && item.article_id) {
        if (stockMethod === 'lot') {
          const lotData = receiveLotData[item.id] || { batch_number: '', expiry_date: '' };
          await supabase.rpc('adjust_stock_lot', {
            p_article_id: item.article_id, p_site_id: currentSite.id,
            p_quantity: addQty, p_batch_number: lotData.batch_number || `LOT-${Date.now()}`,
            p_expiry_date: lotData.expiry_date || null,
            p_purchase_price: Number(item.unit_price || 0),
            p_note: `Réception commande ${selected.order_number}`,
          });
        } else {
          await supabase.rpc('adjust_stock', {
            p_article_id: item.article_id, p_site_id: currentSite.id,
            p_quantity: addQty, p_movement_type: 'purchase',
            p_note: `Réception commande ${selected.order_number}`,
          });
        }
        await supabase.from('supplier_order_items').update({ quantity_received: newTotalReceived }).eq('id', item.id);
        anyReceived += addQty;
      }
      if (newTotalReceived < ordered) fullyReceived = false;
    }
    const newStatus = fullyReceived ? 'received' : 'partial';
    const update: any = { status: newStatus };
    if (fullyReceived) update.received_date = new Date().toISOString().slice(0, 10);
    await supabase.from('supplier_orders').update(update).eq('id', selected.id);
    success(fullyReceived ? 'Commande entièrement réceptionnée' : `Réception partielle enregistrée (+${anyReceived})`);
    setSaving(false);
    setReceiveMode(false);
    setDetailOpen(false);
    load();
  };

  const changeStatus = async (o: SupplierOrder, status: string) => {
    if (!can('edit_supplier_orders')) { error('Vous n\'avez pas la permission de modifier les achats'); return; }
    await supabase.from('supplier_orders').update({ status }).eq('id', o.id);
    success('Statut mis à jour'); load();
    if (selected?.id === o.id) setSelected({ ...o, status });
  };

  const totalPending = list.filter(o => ['sent', 'confirmed', 'partial'].includes(o.status)).reduce((s, o) => s + Number(o.total), 0);

  return (
    <div className="space-y-3">
      <h1 className="sr-only">Achats</h1>
      {/* Header: title + search integrated */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 pb-3 pt-3 sm:pt-4 lg:pt-6 -mt-3 sm:-mt-4 lg:-mt-6 bg-slate-50/95 backdrop-blur-sm space-y-2">
      <div className="flex items-center gap-2 bg-white border border-slate-200/70 rounded-2xl shadow-card px-3 py-2">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-sm shrink-0">
          <Truck className="w-4.5 h-4.5 text-white" strokeWidth={2.2} />
        </div>
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Achats…"
            className="w-full pl-8 pr-2 py-2 bg-slate-50/70 border border-transparent rounded-xl text-sm placeholder:text-slate-400 focus:outline-none focus:border-brand-300 focus:bg-white transition"
          />
        </div>
        <button onClick={() => load(true)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition" title="Rafraîchir">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
        <button
          onClick={() => setOpen(true)}
          className="btn-icon-primary"
          title="Nouvelle commande"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* KPI chips */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white border border-slate-200/70 rounded-2xl p-2.5 shadow-card">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Total</div>
          <div className="text-lg font-extrabold text-slate-900 mt-0.5 num">{list.length}</div>
        </div>
        <div className="bg-white border border-slate-200/70 rounded-2xl p-2.5 shadow-card">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">En attente</div>
          <div className="text-lg font-extrabold text-amber-600 mt-0.5 num">{(counts.sent || 0) + (counts.confirmed || 0) + (counts.partial || 0)}</div>
        </div>
        <div className="bg-white border border-slate-200/70 rounded-2xl p-2.5 shadow-card">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">À recevoir</div>
          <div className="text-sm font-extrabold text-brand-700 mt-0.5 num truncate" title={formatFCFA(totalPending)}>{formatFCFA(totalPending)}</div>
        </div>
      </div>

      {/* Status chips */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
        {FILTERS.map(f => {
          const active = statusFilter === f.key;
          const count = counts[f.key] || 0;
          return (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-full text-xs font-semibold border transition ${
                active
                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {f.label}
              {count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] num ${active ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="Aucune commande"
          description="Créez votre première commande fournisseur."
          action={<button onClick={() => setOpen(true)} className="btn-icon-primary" title="Nouvelle commande"><Plus className="w-4 h-4" /></button>}
        />
      ) : (
        <div className={`space-y-2 ${flashList ? 'waarwi-flash waarwi-flash-scroll' : ''}`}>
          {filtered.map(o => {
            const st = STATUS_MAP[o.status] || STATUS_MAP.draft;
            const canReceive = ['sent', 'confirmed', 'partial'].includes(o.status);
            const canCancel = ['draft', 'sent'].includes(o.status);
            return (
              <div
                key={o.id}
                onClick={() => openDetail(o)}
                className="group bg-white border border-slate-200/70 rounded-2xl shadow-card p-3 hover:shadow-md hover:border-slate-300 transition cursor-pointer"
              >
                {/* line 1: number + status + amount */}
                <div className="flex items-center gap-2">
                  <span className="doc-number text-[13px] font-semibold text-slate-700 truncate">{o.order_number}</span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold border ${st.pill}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                    {st.label}
                  </span>
                  <div className="ml-auto text-sm font-extrabold text-slate-900 num whitespace-nowrap">{formatFCFA(o.total)}</div>
                </div>
                {/* line 2: supplier + date */}
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 min-w-0">
                  <User className="w-3 h-3 shrink-0" />
                  <span className="truncate">{o.suppliers?.name || '—'}</span>
                  <span className="ml-auto flex items-center gap-1 shrink-0">
                    <Calendar className="w-3 h-3" />
                    {formatDate(o.created_at)}
                  </span>
                </div>
                {/* line 3: expected + quick actions */}
                <div className="mt-1.5 flex items-center gap-1.5">
                  {o.expected_date && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-50 border border-slate-200/70 text-[10px] text-slate-600">
                      <Truck className="w-3 h-3" />
                      {formatDate(o.expected_date)}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={e => { e.stopPropagation(); sendWhatsAppFor(o); }}
                      className="p-1.5 rounded-lg hover:bg-emerald-50 text-[#25D366] transition"
                      title="Envoyer par WhatsApp"
                    ><MessageCircle className="w-3.5 h-3.5" /></button>
                    <button
                      onClick={e => { e.stopPropagation(); copyLinkFor(o); }}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition"
                      title="Copier le lien PDF"
                    ><Link2 className="w-3.5 h-3.5" /></button>
                    {o.status === 'draft' && (
                      <button
                        onClick={e => { e.stopPropagation(); changeStatus(o, 'sent'); }}
                        className="p-1.5 rounded-lg hover:bg-neutral-50 text-neutral-700 transition"
                        title="Marquer envoyée"
                      ><CheckCircle className="w-3.5 h-3.5" /></button>
                    )}
                    {canReceive && (
                      <button
                        onClick={e => { e.stopPropagation(); openReceive(o); }}
                        className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600 transition"
                        title="Réceptionner"
                      ><Truck className="w-3.5 h-3.5" /></button>
                    )}
                    {canCancel && (
                      <button
                        onClick={e => { e.stopPropagation(); setToCancel(o); }}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition"
                        title="Annuler"
                      ><X className="w-3.5 h-3.5" /></button>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit - full screen panel on desktop */}
      {open && isDesktop && (
        <SupplierOrderFullPanel
          suppliers={suppliers}
          articles={articles}
          form={form}
          setForm={setForm}
          orderItems={orderItems}
          setOrderItems={setOrderItems}
          updateItem={updateItem}
          incQty={incQty}
          subtotal={subtotal}
          totalItems={totalItems}
          saving={saving}
          save={save}
          onClose={closeOrderPanel}
          autoMode={autoMode}
          onVehiclePicker={() => setVehiclePickerOpen(true)}
          editingOrderId={editingOrderId}
          editingOrder={editingOrder}
          onPrint={() => {
            if (!editingOrder || !tenant) return;
            const items = orderItems.filter(i => i.name.trim()).map(i => ({ name: i.name, supplier_ref: i.supplier_ref || null, oem_ref: null, quantity: Number(i.quantity_ordered), unit_price: Number(i.unit_price), discount: 0 }));
            printDocumentA4({ tenant: tenantForPrint(), docLabel: 'BON DE COMMANDE', docNumber: editingOrder.order_number, docDate: formatDate(editingOrder.created_at), customer: editingOrder.suppliers ? { name: editingOrder.suppliers.name } : null, items, subtotal: items.reduce((s, i) => s + i.quantity * i.unit_price, 0), total: items.reduce((s, i) => s + i.quantity * i.unit_price, 0), footerNote: 'Merci de confirmer réception et délai de livraison.', docHeader: editingOrder.doc_header ?? null });
          }}
          onChangeStatus={(status: string) => { if (editingOrder) { changeStatus(editingOrder, status); setEditingOrder({ ...editingOrder, status }); } }}
        />
      )}

      {/* Create modal - mobile only */}
      {open && !isDesktop && (
        <MobileBillingWizard
          open={true}
          onClose={() => setOpen(false)}
          title="Nouvelle commande fournisseur"
          headerFields={[
            { key: 'supplier_id', label: 'Fournisseur', type: 'select', required: true, options: suppliers.map(s => ({ value: s.id, label: s.name })), placeholder: 'Sélectionner...' },
            { key: 'expected_date', label: 'Livraison prévue', type: 'date' },
            { key: 'note', label: 'Note', type: 'text', placeholder: 'Note optionnelle...' },
          ]}
          headerValues={form}
          onHeaderChange={(k, v) => setForm(f => ({ ...f, [k]: v }))}
          items={orderItems.map(i => ({
            article_id: i.article_id || null,
            name: i.name,
            quantity: i.quantity_ordered,
            unit_price: i.unit_price,
            discount: 0,
            total: i.total,
            supplier_ref: i.supplier_ref,
          }))}
          onAddItem={(articleId) => {
            const art = articles.find(a => a.id === articleId);
            if (!art) return;
            setOrderItems(p => [...p, { article_id: articleId, name: art.name, supplier_ref: art.supplier_ref || '', quantity_ordered: 1, unit_price: art.purchase_price || 0, total: art.purchase_price || 0 }]);
          }}
          onUpdateItem={(idx, field, val) => {
            if (field === 'quantity') {
              updateItem(idx, 'quantity_ordered', val);
            } else {
              updateItem(idx, field, val);
            }
          }}
          onRemoveItem={(idx) => setOrderItems(p => p.filter((_, i) => i !== idx))}
          articles={articles}
          saving={saving}
          onSave={save}
          total={subtotal}
          saveLabel="Créer commande"
          itemPriceField="purchase_price"
        />
      )}

      {/* Detail panel */}
      <DocPanel
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={selected ? `Commande ${selected.order_number}` : ''}
        footer={
          <>
            {selected && !editMode && !receiveMode && (
              <div className="flex gap-1.5 mr-auto">
                <button onClick={printOrder} className="btn-icon" title="Imprimer"><Printer className="w-4 h-4" /></button>
                <button onClick={copyPublicLink} className="btn-icon" title="Copier le lien"><Link2 className="w-4 h-4" /></button>
                <button onClick={sendWhatsApp} className="btn-icon" title="WhatsApp" style={{ color: '#25D366' }}><MessageCircle className="w-4 h-4" /></button>
                {['draft', 'sent', 'confirmed', 'partial'].includes(selected.status) && (
                  <button onClick={beginEdit} className="btn-icon" title="Modifier"><Pencil className="w-4 h-4" /></button>
                )}
                {selected.status === 'draft' && (
                  <button onClick={() => changeStatus(selected, 'sent')} className="btn-icon" title="Marquer envoyée"><CheckCircle className="w-4 h-4" /></button>
                )}
              </div>
            )}
            <button onClick={() => setDetailOpen(false)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
            {selected && !editMode && !receiveMode && ['sent', 'confirmed', 'partial'].includes(selected.status) && (
              <button onClick={() => setReceiveMode(true)} className="btn-icon-success" title="Réceptionner"><Truck className="w-4 h-4" /></button>
            )}
            {selected && editMode && (
              <>
                <button onClick={() => setEditMode(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
                <button onClick={saveEdit} disabled={saving} className="btn-icon-primary" title="Enregistrer">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}</button>
              </>
            )}
            {selected && receiveMode && (
              <>
                <button onClick={() => setReceiveMode(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
                <button onClick={initiateReceive} disabled={saving} className="btn-icon-success" title="Confirmer réception">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}</button>
              </>
            )}
          </>
        }
      >
        {selected && (() => {
          const STATUS_COLOR_MAP: Record<string, DocStatusConfig['color']> = {
            draft: 'slate', sent: 'slate', confirmed: 'teal', partial: 'amber', received: 'emerald', cancelled: 'rose',
          };
          const slimStatus: DocStatusConfig = {
            label: STATUS_MAP[selected.status]?.label || selected.status,
            color: STATUS_COLOR_MAP[selected.status] || 'slate',
          };
          return (
          <div className="space-y-4">
            <DocSlimHeader
              status={slimStatus}
              customerName={selected.suppliers?.name ?? null}
              date={formatDate(selected.created_at)}
            />

            {/* Articles list */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-slate-500" />
                <span className="text-xs uppercase tracking-wider text-slate-600 font-semibold">
                  {editMode ? 'Modifier les articles' : receiveMode ? 'Saisir les quantités reçues' : `Articles (${detailItems.length})`}
                </span>
              </div>

              {editMode ? (
                <div className="space-y-2">
                  {editItems.map((it, idx) => {
                    const minReceived = Number(it.quantity_received || 0);
                    return (
                      <div key={it.id} className="bg-slate-50/70 border border-slate-200/70 rounded-xl p-2.5 space-y-2">
                        <div className="flex items-start gap-2">
                          <input value={it.name} onChange={e => updateEditItem(idx, 'name', e.target.value)} className="input text-xs flex-1" placeholder="Désignation" />
                          {minReceived === 0 && (
                            <button onClick={() => removeEditItem(idx)} className="p-1.5 rounded-lg bg-white hover:bg-red-50 border border-slate-200 text-red-500 transition shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-0.5">Quantité</div>
                            <input type="number" value={it.quantity_ordered || ''} onChange={e => updateEditItem(idx, 'quantity_ordered', Number(e.target.value))} onBlur={() => { if (!Number(editItems[idx]?.quantity_ordered) || Number(editItems[idx]?.quantity_ordered) < minReceived) updateEditItem(idx, 'quantity_ordered', Math.max(1, minReceived)); }} className="input text-xs num" />
                            {minReceived > 0 && <div className="text-[10px] text-slate-400 mt-0.5">Min: {minReceived} (déjà reçus)</div>}
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-0.5">P.U. (FCFA)</div>
                            <input type="number" value={it.unit_price || ''} onChange={e => updateEditItem(idx, 'unit_price', Number(e.target.value))} onBlur={() => { if (Number(editItems[idx]?.unit_price) < 0) updateEditItem(idx, 'unit_price', 0); }} className="input text-xs num" />
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Sous-total</span>
                          <span className="text-sm font-extrabold text-slate-900 num">{formatFCFA(it.total)}</span>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">Nouveau total</span>
                    <span className="text-base font-extrabold text-slate-900 num">
                      {formatFCFA(editItems.reduce((s, i) => s + Number(i.quantity_ordered || 0) * Number(i.unit_price || 0), 0))}
                    </span>
                  </div>
                </div>
              ) : receiveMode ? (
                <div className="space-y-2">
                  {detailItems.map(i => {
                    const received = Number(i.quantity_received || 0);
                    const ordered = Number(i.quantity_ordered || 0);
                    const remaining = Math.max(0, ordered - received);
                    return (
                      <div key={i.id} className="bg-white border border-slate-200/70 rounded-xl p-3 space-y-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{i.name}</div>
                          {(i.supplier_ref || i.articles?.internal_ref) && <div className="text-[10px] text-slate-400 font-mono mt-0.5">{i.supplier_ref || i.articles?.internal_ref}</div>}
                          {i.articles?.oem_ref && <div className="text-[10px] text-slate-400 font-mono">OEM: {i.articles.oem_ref}</div>}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          <span>Commandé: <span className="font-semibold text-slate-700 num">{ordered}</span></span>
                          <span>·</span>
                          <span>Déjà reçu: <span className="font-semibold text-slate-700 num">{received}</span></span>
                          <span>·</span>
                          <span>Restant: <span className="font-semibold text-amber-700 num">{remaining}</span></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-slate-600 font-medium">Reçu aujourd'hui :</label>
                          <input
                            type="number" min={0} max={remaining}
                            value={receiveQty[i.id] ?? 0}
                            onChange={e => setReceiveQty(p => ({ ...p, [i.id]: Math.max(0, Math.min(remaining, Number(e.target.value) || 0)) }))}
                            className="input text-xs num w-24"
                          />
                        </div>
                        {stockMethod === 'lot' && (receiveQty[i.id] ?? 0) > 0 && (
                          <div className="flex items-center gap-2 pt-1">
                            <div className="flex-1">
                              <label className="text-[10px] text-slate-500 font-medium">N° Lot</label>
                              <input
                                type="text"
                                placeholder="Batch..."
                                value={receiveLotData[i.id]?.batch_number || ''}
                                onChange={e => setReceiveLotData(p => ({ ...p, [i.id]: { ...(p[i.id] || { batch_number: '', expiry_date: '' }), batch_number: e.target.value } }))}
                                className="input text-xs mt-0.5"
                              />
                            </div>
                            <div className="flex-1">
                              <label className="text-[10px] text-slate-500 font-medium">Date d'expiration</label>
                              <input
                                type="date"
                                value={receiveLotData[i.id]?.expiry_date || ''}
                                onChange={e => setReceiveLotData(p => ({ ...p, [i.id]: { ...(p[i.id] || { batch_number: '', expiry_date: '' }), expiry_date: e.target.value } }))}
                                className="input text-xs mt-0.5"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-3">
                  <DocSectionTitle title="Articles" count={detailItems.length} />
                  <DocItems
                    items={detailItems.map(i => ({
                      id: i.id,
                      name: i.name,
                      supplier_ref: i.supplier_ref || null,
                      internal_ref: i.articles?.internal_ref || null,
                      oem_ref: i.articles?.oem_ref || null,
                      quantity: Number(i.quantity_ordered || 0),
                      quantity_ordered: Number(i.quantity_ordered || 0),
                      quantity_received: Number(i.quantity_received || 0),
                      unit_price: Number(i.unit_price),
                      total: Number(i.total),
                    }) satisfies DocItem)}
                    showReceived
                    qtyLabel="Cmd./Reçu"
                  />
                  <DocTotals
                    subtotal={detailItems.reduce((s, i) => s + Number(i.total), 0)}
                    total={detailItems.reduce((s, i) => s + Number(i.total), 0)}
                    totalLabel="Total commande"
                  />
                </div>
              )}
            </div>
          </div>
          );
        })()}
      </DocPanel>

      <ConfirmDialog
        open={!!toCancel}
        onClose={() => setToCancel(null)}
        onConfirm={async () => { if (!toCancel) return; await changeStatus(toCancel, 'cancelled'); setToCancel(null); }}
        title="Annuler la commande ?"
        message={`La commande "${toCancel?.order_number}" sera annulée.`}
        danger
      />

      {/* Dispatch modal for multi-site reception */}
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
              className="btn-icon-success"
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
            {detailItems.filter(i => (receiveQty[i.id] || 0) > 0 && i.article_id).map(item => {
              const totalQty = Number(receiveQty[item.id] || 0);
              const allocated = Object.values(dispatchData[item.id] || {}).reduce((s, v) => s + v, 0);
              const isValid = allocated === totalQty;
              return (
                <div key={item.id} className="bg-white border border-slate-200/70 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{item.name}</div>
                      {item.supplier_ref && <div className="text-[10px] text-slate-400 font-mono">{item.supplier_ref}</div>}
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">Qte reçue</div>
                      <div className="text-sm font-bold text-slate-900 num">{totalQty}</div>
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    {sites.map(site => {
                      const val = dispatchData[item.id]?.[site.id] || 0;
                      return (
                        <div key={site.id} className="flex items-center gap-2">
                          <span className="text-xs text-slate-600 font-medium flex-1 truncate">{site.name}</span>
                          <input
                            type="number"
                            min={0}
                            max={totalQty}
                            value={val}
                            onChange={e => {
                              const v = Math.max(0, Math.min(totalQty, Number(e.target.value) || 0));
                              setDispatchData(prev => ({
                                ...prev,
                                [item.id]: { ...prev[item.id], [site.id]: v },
                              }));
                            }}
                            className="input text-xs num w-20 text-center"
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
                      <Check className="w-3 h-3" /> Répartition correcte
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Modal>

      {autoMode && tenant && currentSite && (
        <VehicleArticlePicker
          open={vehiclePickerOpen}
          onClose={() => setVehiclePickerOpen(false)}
          onSelect={a => {
            setOrderItems(p => [...p, {
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

/* ═══════════════════════════════════════════════════════════════════════════════
   SupplierOrderFullPanel — full-screen panel for creating supplier orders
   ═══════════════════════════════════════════════════════════════════════════════ */

function SupplierSearchInput({ suppliers, value, onSelect, placeholder }: {
  suppliers: any[];
  value: string;
  onSelect: (s: any) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const selected = suppliers.find(s => s.id === value);

  const filtered = useMemo(() => {
    if (!query.trim()) return suppliers.slice(0, 20);
    const q = query.toLowerCase().trim();
    return suppliers.filter((s: any) =>
      s.name.toLowerCase().includes(q) ||
      (s.phone || '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [query, suppliers]);

  useEffect(() => { setHighlighted(0); }, [filtered.length]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === 'ArrowDown') setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && filtered[highlighted]) { e.preventDefault(); e.stopPropagation(); onSelect(filtered[highlighted]); setOpen(false); setQuery(''); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input
          value={open ? query : (selected?.name || '')}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setQuery(''); setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "Rechercher fournisseur..."}
          className="input text-xs h-8 pl-8 pr-2 max-w-[220px]"
          autoComplete="off"
        />
      </div>
      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto min-w-[260px]">
          {filtered.map((s: any, i: number) => (
            <button
              key={s.id}
              onMouseDown={e => { e.preventDefault(); onSelect(s); setOpen(false); setQuery(''); }}
              onMouseEnter={() => setHighlighted(i)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 text-xs transition-colors ${i === highlighted ? 'bg-teal-50 text-teal-800' : 'hover:bg-slate-50 text-slate-700'}`}
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{s.name}</p>
                {s.phone && <p className="text-[10px] text-slate-400">{s.phone}</p>}
              </div>
            </button>
          ))}
          {filtered.length === 0 && query.trim() && (
            <div className="px-3 py-3 text-center text-xs text-slate-400">Aucun fournisseur trouvé</div>
          )}
        </div>
      )}
    </div>
  );
}

function SOArticleSearchInput({ articles, value, onSelect, placeholder }: {
  articles: any[];
  value: string;
  onSelect: (a: any) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  const filtered = useMemo(() => {
    if (!query.trim()) return articles.slice(0, 20);
    const q = query.toLowerCase().trim();
    return articles.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.internal_ref || '').toLowerCase().includes(q) ||
      (a.supplier_ref || '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [query, articles]);

  useEffect(() => { setHighlighted(0); }, [filtered.length]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === 'ArrowDown') setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && filtered[highlighted]) { e.preventDefault(); e.stopPropagation(); onSelect(filtered[highlighted]); setOpen(false); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "Rechercher article..."}
          className="input text-xs pl-8 pr-2"
          autoComplete="off"
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
          {filtered.map((a, i) => (
            <button
              key={a.id}
              onMouseDown={e => { e.preventDefault(); onSelect(a); setOpen(false); }}
              onMouseEnter={() => setHighlighted(i)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 text-xs transition-colors ${i === highlighted ? 'bg-teal-50 text-teal-800' : 'hover:bg-slate-50 text-slate-700'}`}
            >
              <Package className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{a.name}</p>
                {a.internal_ref && <p className="text-[10px] text-slate-400">{a.internal_ref}</p>}
              </div>
              <span className="text-[11px] font-bold text-slate-500 num flex-shrink-0">{formatFCFA(a.purchase_price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SupplierOrderFullPanel({ suppliers, articles, form, setForm, orderItems, setOrderItems, updateItem, incQty, subtotal, totalItems, saving, save, onClose, autoMode, onVehiclePicker, editingOrderId, editingOrder, onPrint, onChangeStatus }: {
  suppliers: any[];
  articles: any[];
  form: { supplier_id: string; expected_date: string; note: string };
  setForm: (fn: any) => void;
  orderItems: any[];
  setOrderItems: (fn: any) => void;
  updateItem: (idx: number, field: string, val: any) => void;
  incQty: (idx: number, delta: number) => void;
  subtotal: number;
  totalItems: number;
  saving: boolean;
  save: () => void;
  onClose: () => void;
  autoMode: boolean;
  onVehiclePicker: () => void;
  editingOrderId: string | null;
  editingOrder: SupplierOrder | null;
  onPrint: () => void;
  onChangeStatus: (status: string) => void;
}) {
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [onClose]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startWidth = panelRef.current?.offsetWidth || window.innerWidth - 256;
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const diff = startX - ev.clientX;
      setPanelWidth(Math.max(600, Math.min(window.innerWidth - 64, startWidth + diff)));
    };
    const onUp = () => { resizing.current = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const handleRowKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = orderItems[idx];
      if (item.name.trim() && item.unit_price > 0) {
        if (idx === orderItems.length - 1) {
          setOrderItems((p: any[]) => [...p, { article_id: '', name: '', supplier_ref: '', quantity_ordered: 1, unit_price: 0, total: 0 }]);
          setTimeout(() => {
            const rows = panelRef.current?.querySelectorAll('[data-row-idx]');
            const lastRow = rows?.[rows.length - 1];
            const input = lastRow?.querySelector('input') as HTMLInputElement;
            input?.focus();
          }, 50);
        }
      }
    }
  };

  return (
    <div className="fixed inset-0 lg:left-64 z-50 flex animate-fade-in">
      <div
        className="hidden lg:flex items-center justify-center w-2 cursor-col-resize hover:bg-teal-100 transition-colors group flex-shrink-0 relative z-10"
        style={{ marginLeft: panelWidth ? `calc(100% - ${panelWidth}px - 8px)` : '0' }}
        onMouseDown={startResize}
      >
        <GripVertical className="w-3 h-3 text-slate-300 group-hover:text-teal-500 transition-colors" />
      </div>

      <div
        ref={panelRef}
        className="bg-white h-full flex flex-col shadow-2xl flex-1 w-full"
        style={panelWidth ? { width: `${panelWidth}px`, flex: 'none' } : undefined}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50/80 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-neutral-900 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">{editingOrderId ? `Commande ${editingOrder?.order_number || ''}` : 'Nouvelle commande fournisseur'}</h2>
              <p className="text-[11px] text-slate-500">
                {editingOrderId ? 'Sauvegarde automatique à chaque modification' : 'Entrée valide la ligne et ajoute une suivante'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saving && <span className="text-[10px] text-teal-600 font-medium animate-pulse">Sauvegarde...</span>}
            {editingOrder && (
              <>
                {editingOrder.status === 'draft' && <button onClick={() => onChangeStatus('sent')} className="btn-icon" title="Marquer envoyée"><CheckCircle className="w-4 h-4" /></button>}
                <button onClick={onPrint} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" title="Imprimer"><Printer className="w-4 h-4" /></button>
              </>
            )}
            <button onClick={onClose} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
            <button onClick={save} disabled={saving} className="btn-icon-primary" title={editingOrderId ? 'Enregistrer' : 'Créer'}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {!saving && (editingOrderId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />)}
            </button>
          </div>
        </div>

        {/* Meta bar */}
        <div className="flex items-center gap-4 px-5 py-3 border-b border-slate-100 bg-white flex-shrink-0">
          <SupplierSearchInput
            suppliers={suppliers}
            value={form.supplier_id}
            onSelect={(s) => setForm((f: any) => ({ ...f, supplier_id: s.id }))}
            placeholder="Rechercher fournisseur..."
          />
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <input type="date" value={form.expected_date} onChange={e => setForm((f: any) => ({ ...f, expected_date: e.target.value }))} className="input text-xs h-8 w-36" />
          </div>
          <div className="flex items-center gap-2 flex-1 max-w-[240px]">
            <MessageCircle className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <input value={form.note} onChange={e => setForm((f: any) => ({ ...f, note: e.target.value }))} placeholder="Note..." className="input text-xs h-8" />
          </div>
          {autoMode && (
            <button onClick={onVehiclePicker} className="btn-icon" title="Par véhicule">
              <Car className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[1fr_1.2fr_80px_120px_80px_40px] gap-2 px-5 py-2 border-b border-slate-200 bg-slate-50/50 flex-shrink-0">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Article</span>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Désignation</span>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide text-center">Qte</span>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide text-right">Prix achat</span>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide text-right">Total</span>
          <span></span>
        </div>

        {/* Scrollable rows */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {orderItems.map((it: any, idx: number) => (
            <div
              key={idx}
              data-row-idx={idx}
              className={`grid grid-cols-[1fr_1.2fr_80px_120px_80px_40px] gap-2 px-5 py-1.5 items-center border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${idx === orderItems.length - 1 ? 'bg-neutral-50/30' : ''}`}
              onKeyDown={e => handleRowKeyDown(e, idx)}
            >
              <div>
                <SOArticleSearchInput
                  articles={articles}
                  value={it.article_id ? (articles.find((a: any) => a.id === it.article_id)?.name || '') : ''}
                  onSelect={a => updateItem(idx, 'article_id', a.id)}
                  placeholder="Rechercher..."
                />
              </div>
              <div>
                <input
                  value={it.name}
                  onChange={e => updateItem(idx, 'name', e.target.value)}
                  placeholder="Désignation"
                  className="input text-xs"
                />
              </div>
              <div>
                <input
                  type="number"
                  value={it.quantity_ordered || ''}
                  onChange={e => updateItem(idx, 'quantity_ordered', Number(e.target.value))}
                  onBlur={() => { if (!Number(orderItems[idx]?.quantity_ordered) || Number(orderItems[idx]?.quantity_ordered) < 1) updateItem(idx, 'quantity_ordered', 1); }}
                  className="input text-xs text-center"
                />
              </div>
              <div>
                <input
                  type="number"
                  value={it.unit_price || ''}
                  onChange={e => updateItem(idx, 'unit_price', Number(e.target.value))}
                  onBlur={() => { if (Number(orderItems[idx]?.unit_price) < 0) updateItem(idx, 'unit_price', 0); }}
                  className="input text-xs text-right num"
                />
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-slate-800 num">{formatFCFA(it.total)}</span>
              </div>
              <div className="flex justify-center">
                <button
                  onClick={() => setOrderItems((p: any[]) => p.filter((_: any, i: number) => i !== idx))}
                  disabled={orderItems.length === 1}
                  className="p-1 rounded hover:bg-red-50 text-red-400 disabled:opacity-30 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}

          <div className="px-5 py-2">
            <button
              onClick={() => setOrderItems((p: any[]) => [...p, { article_id: '', name: '', supplier_ref: '', quantity_ordered: 1, unit_price: 0, total: 0 }])}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700 hover:text-neutral-800 hover:bg-neutral-50 px-3 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />Ajouter une ligne
            </button>
          </div>
        </div>

        {/* Footer totals */}
        <div className="border-t border-slate-200 bg-slate-50/80 px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-slate-500">
            {totalItems} article{totalItems > 1 ? 's' : ''}
          </div>
          <div className="text-right">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wide block">Total commande</span>
            <span className="text-lg font-black text-slate-900 num">{formatFCFA(subtotal)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
