import { useEffect, useMemo, useState } from 'react';
import {
  Plus, ShoppingBag, Loader2, Search, RefreshCw,
  CheckCircle, Check, Truck, Trash2, X, Car, Package, Calendar,
  User, Minus, ChevronRight, FileText, Printer, MessageCircle, Pencil, Link2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { VehicleArticlePicker } from '../components/VehicleArticlePicker';
import { isAutoParts } from '../lib/types';
import { formatFCFA, formatDate } from '../lib/format';
import { printDocumentA4, type PrintTenant } from '../lib/print';
import { consumeNavContext } from '../lib/navHighlight';
import { DocItems, DocTotals, DocSectionTitle, DocSlimHeader } from '../components/DocLayout';
import type { DocItem, DocStatusConfig } from '../components/DocLayout';

type SupplierOrder = {
  id: string; order_number: string; total: number; status: string;
  created_at: string; expected_date: string | null;
  public_token?: string | null;
  public_code?: string | null;
  supplier_id?: string | null;
  suppliers: { name: string; phone?: string | null; whatsapp?: string | null; email?: string | null; address?: string | null } | null;
};

const STATUS_MAP: Record<string, { label: string; pill: string; dot: string }> = {
  draft:     { label: 'Brouillon',           pill: 'bg-slate-100 text-slate-700 border-slate-200',     dot: 'bg-slate-400' },
  sent:      { label: 'Envoyée',             pill: 'bg-blue-50 text-blue-700 border-blue-200',         dot: 'bg-blue-500' },
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
  const { tenant, currentSite, dataTick, profile } = useApp();
  const autoMode = isAutoParts(tenant);
  const { success, error } = useToast();
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
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [flashList, setFlashList] = useState(false);

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

  useEffect(() => { load(); }, [tenant?.id, currentSite?.id]);

  useEffect(() => {
    const ctx = consumeNavContext();
    if (!ctx?.target) return;
    if (ctx.target === 'payables') {
      setStatusFilter('');
      setFlashList(true);
      setTimeout(() => setFlashList(false), 6800);
    }
  }, []);
  useEffect(() => {
    if (!tenant) return;
    Promise.all([
      supabase.from('suppliers').select('id, name').eq('tenant_id', tenant.id).eq('is_active', true).order('name'),
      supabase.from('articles').select('id, name, purchase_price, supplier_ref, internal_ref').eq('tenant_id', tenant.id).eq('is_active', true).order('name').limit(500),
    ]).then(([{ data: s }, { data: a }]) => { setSuppliers(s || []); setArticles(a || []); });
  }, [tenant?.id]);

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
    if (!form.supplier_id) { error('Sélectionnez un fournisseur'); return; }
    if (orderItems.every(i => !i.name.trim())) { error('Ajoutez au moins un article'); return; }
    setSaving(true);
    const { data: numData } = await supabase.rpc('next_doc_number', {
      p_tenant_id: tenant.id, p_kind: 'supplier_order', p_prefix: 'CMD',
    });
    const oNum = (numData as string) || ('CMD-' + Date.now());
    const { data: o, error: e } = await supabase.from('supplier_orders').insert({
      tenant_id: tenant.id, site_id: currentSite.id,
      supplier_id: form.supplier_id,
      order_number: oNum, subtotal, discount: 0, total: subtotal,
      expected_date: form.expected_date || null, note: form.note, status: 'draft',
    }).select().single();
    if (e || !o) { error(e?.message || 'Erreur'); setSaving(false); return; }
    const validItems = orderItems.filter(i => i.name.trim());
    await supabase.from('supplier_order_items').insert(validItems.map(i => ({
      tenant_id: tenant.id, order_id: o.id,
      article_id: i.article_id || null, name: i.name, supplier_ref: i.supplier_ref,
      quantity_ordered: i.quantity_ordered, quantity_received: 0,
      unit_price: i.unit_price, total: i.total,
    })));
    setSaving(false);
    success('Commande créée'); setOpen(false);
    setOrderItems([{ article_id: '', name: '', supplier_ref: '', quantity_ordered: 1, unit_price: 0, total: 0 }]);
    setForm({ supplier_id: '', expected_date: '', note: '' });
    load();
  };

  const openDetail = async (o: SupplierOrder) => {
    setSelected(o); setDetailOpen(true);
    setEditMode(false); setReceiveMode(false);
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

  const tenantForPrint = (): PrintTenant => {
    const t: any = tenant || {};
    return {
      name: t.name || '', legal_name: t.legal_name, ninea: t.ninea, rccm: t.rccm,
      address: t.address, phone: t.phone, email: t.email, website: t.website,
      logo_url: t.logo_url, business_type: t.business_type,
    };
  };

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
      issuedBy: profile?.full_name || undefined,
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

  const receivePartial = async () => {
    if (!selected || !tenant || !currentSite) return;
    setSaving(true);
    let anyReceived = 0;
    let fullyReceived = true;
    for (const item of detailItems) {
      const addQty = Number(receiveQty[item.id] || 0);
      const alreadyReceived = Number(item.quantity_received || 0);
      const ordered = Number(item.quantity_ordered || 0);
      const newTotalReceived = alreadyReceived + addQty;
      if (addQty > 0 && item.article_id) {
        await supabase.rpc('adjust_stock', {
          p_article_id: item.article_id, p_site_id: currentSite.id,
          p_quantity: addQty, p_movement_type: 'purchase',
          p_note: `Réception commande ${selected.order_number}`,
        });
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
    await supabase.from('supplier_orders').update({ status }).eq('id', o.id);
    success('Statut mis à jour'); load();
    if (selected?.id === o.id) setSelected({ ...o, status });
  };

  const totalPending = list.filter(o => ['sent', 'confirmed', 'partial'].includes(o.status)).reduce((s, o) => s + Number(o.total), 0);

  return (
    <div className="space-y-3">
      {/* Header: title + search integrated */}
      <div className="flex items-center gap-2 bg-white border border-slate-200/70 rounded-2xl shadow-card px-3 py-2">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-sm shrink-0">
          <ShoppingBag className="w-4.5 h-4.5 text-white" strokeWidth={2.2} />
        </div>
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Commandes fournisseurs…"
            className="w-full pl-8 pr-2 py-2 bg-slate-50/70 border border-transparent rounded-xl text-sm placeholder:text-slate-400 focus:outline-none focus:border-brand-300 focus:bg-white transition"
          />
        </div>
        <button onClick={() => load(true)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition" title="Rafraîchir">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 px-3 py-2 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 text-white text-xs font-semibold shadow-sm hover:shadow-md transition"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Nouvelle</span>
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

      {/* List */}
      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="Aucune commande"
          description="Créez votre première commande fournisseur."
          action={<button onClick={() => setOpen(true)} className="btn-primary"><Plus className="w-4 h-4" />Nouvelle commande</button>}
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
                  <span className="font-mono text-[11px] font-semibold text-slate-700 truncate">{o.order_number}</span>
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
                        className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition"
                        title="Marquer envoyée"
                      ><CheckCircle className="w-3.5 h-3.5" /></button>
                    )}
                    {canReceive && (
                      <button
                        onClick={e => { e.stopPropagation(); openDetail(o); }}
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

      {/* Create modal */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nouvelle commande fournisseur"
        size="lg"
        footer={
          <>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Total</div>
              <div className="text-base font-extrabold text-slate-900 num truncate">{formatFCFA(subtotal)}</div>
            </div>
            <button onClick={() => setOpen(false)} className="btn-secondary">Annuler</button>
            <button onClick={save} disabled={saving} className="btn-primary">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}Créer
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {/* Supplier + date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="label">Fournisseur *</label>
              <select
                value={form.supplier_id}
                onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}
                className="input"
              >
                <option value="">— Sélectionnez —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Livraison prévue</label>
              <input
                type="date"
                value={form.expected_date}
                onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))}
                className="input"
              />
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-semibold text-slate-700">Articles</span>
                {totalItems > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-brand-50 text-brand-700 rounded-full font-semibold num">{totalItems}</span>}
              </div>
              <div className="flex items-center gap-1.5">
                {autoMode && <button
                  onClick={() => setVehiclePickerOpen(true)}
                  className="text-[11px] text-slate-600 border border-slate-200 rounded-lg px-2 py-1 hover:bg-slate-50 flex items-center gap-1 transition"
                ><Car className="w-3 h-3" />Véhicule</button>}
                <button
                  onClick={() => setOrderItems(p => [...p, { article_id: '', name: '', supplier_ref: '', quantity_ordered: 1, unit_price: 0, total: 0 }])}
                  className="text-[11px] text-white bg-brand-700 hover:bg-brand-800 rounded-lg px-2 py-1 flex items-center gap-1 transition"
                ><Plus className="w-3 h-3" />Ajouter</button>
              </div>
            </div>

            <div className="space-y-2 max-h-[46vh] overflow-y-auto pr-1">
              {orderItems.map((it, idx) => (
                <div key={idx} className="bg-slate-50/70 border border-slate-200/70 rounded-xl p-2.5 space-y-2">
                  {/* Article select */}
                  <div className="flex items-start gap-2">
                    <select
                      value={it.article_id}
                      onChange={e => updateItem(idx, 'article_id', e.target.value)}
                      className="input text-xs flex-1 min-w-0"
                    >
                      <option value="">— Choisir un article —</option>
                      {articles.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    {orderItems.length > 1 && (
                      <button
                        onClick={() => setOrderItems(p => p.filter((_, i) => i !== idx))}
                        className="p-1.5 rounded-lg bg-white hover:bg-red-50 border border-slate-200 text-red-500 transition shrink-0"
                      ><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>

                  {/* Name override */}
                  <input
                    value={it.name}
                    onChange={e => updateItem(idx, 'name', e.target.value)}
                    placeholder="Désignation"
                    className="input text-xs"
                  />

                  {/* Qty stepper + Price */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white border border-slate-200 rounded-lg flex items-center overflow-hidden">
                      <button
                        type="button"
                        onClick={() => incQty(idx, -1)}
                        disabled={Number(it.quantity_ordered) <= 1}
                        className="w-9 h-9 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition"
                      ><Minus className="w-3.5 h-3.5" /></button>
                      <input
                        type="number"
                        value={it.quantity_ordered}
                        onChange={e => updateItem(idx, 'quantity_ordered', Math.max(1, Number(e.target.value) || 1))}
                        min="1"
                        className="flex-1 min-w-0 h-9 text-center text-sm font-semibold bg-transparent focus:outline-none num"
                      />
                      <button
                        type="button"
                        onClick={() => incQty(idx, +1)}
                        className="w-9 h-9 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition"
                      ><Plus className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        value={it.unit_price}
                        onChange={e => updateItem(idx, 'unit_price', Math.max(0, Number(e.target.value) || 0))}
                        min="0"
                        className="input text-xs pr-10 h-9 num"
                        placeholder="P.U."
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-semibold">FCFA</span>
                    </div>
                  </div>

                  {/* Line total */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Sous-total ligne</span>
                    <span className="text-sm font-extrabold text-slate-900 num">{formatFCFA(it.total)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Note</label>
            <textarea
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              className="input resize-none"
              rows={2}
              placeholder="Optionnelle…"
            />
          </div>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={selected ? `Commande ${selected.order_number}` : ''}
        size="lg"
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
                <button onClick={receivePartial} disabled={saving} className="btn-icon-success" title="Confirmer réception">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}</button>
              </>
            )}
          </>
        }
      >
        {selected && (() => {
          const STATUS_COLOR_MAP: Record<string, DocStatusConfig['color']> = {
            draft: 'slate', sent: 'blue', confirmed: 'teal', partial: 'amber', received: 'emerald', cancelled: 'rose',
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
                            <input type="number" min={minReceived} value={it.quantity_ordered} onChange={e => updateEditItem(idx, 'quantity_ordered', Math.max(minReceived, Number(e.target.value) || 0))} className="input text-xs num" />
                            {minReceived > 0 && <div className="text-[10px] text-slate-400 mt-0.5">Min: {minReceived} (déjà reçus)</div>}
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-0.5">P.U. (FCFA)</div>
                            <input type="number" min={0} value={it.unit_price} onChange={e => updateEditItem(idx, 'unit_price', Math.max(0, Number(e.target.value) || 0))} className="input text-xs num" />
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
      </Modal>

      <ConfirmDialog
        open={!!toCancel}
        onClose={() => setToCancel(null)}
        onConfirm={async () => { if (!toCancel) return; await changeStatus(toCancel, 'cancelled'); setToCancel(null); }}
        title="Annuler la commande ?"
        message={`La commande "${toCancel?.order_number}" sera annulée.`}
        danger
      />

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
