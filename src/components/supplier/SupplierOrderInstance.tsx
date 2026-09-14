import { useState, useEffect, useMemo, useRef } from 'react';
import { Lock, Truck, CheckCircle, X, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { usePermissions } from '../../lib/permissions';
import { useToast } from '../../context/ToastContext';
import { loadFormDraft, clearFormDraft, saveFormDraft, scheduleSaveFormDraft, type OpInProgress } from '../../lib/draftRecovery';
import { formatFCFA, formatDate } from '../../lib/format';
import { printDocumentA4, buildPrintTenantForSite, type PrintTenant } from '../../lib/print';
import { Modal, ConfirmDialog } from '../Modal';
import { VehicleArticlePicker } from '../VehicleArticlePicker';
import {
  SupplierOrderEditor,
  type SOLineItem,
  type SOHeaderForm,
  type ReceiveQtyMap,
  type ReceiveLotMap,
  type SOMode,
} from '../SupplierOrderEditor';

export type SupplierOrderWindowDescriptor = {
  windowId: string;
  orderId: string | null;
  mode: SOMode;
  siteId: string;
  tenantId: string;
};

type Order = {
  id: string; order_number: string; total: number; status: string;
  created_at: string; expected_date: string | null;
  public_token?: string | null; public_code?: string | null;
  supplier_id?: string | null; site_id?: string;
  note?: string | null; user_id?: string | null;
  suppliers: { name: string; phone?: string | null; whatsapp?: string | null; email?: string | null; address?: string | null } | null;
  doc_header?: any;
};

type Props = {
  descriptor: SupplierOrderWindowDescriptor;
  articles: any[];
  suppliers: any[];
  sites: any[];
  depots: any[];
  autoMode: boolean;
  stockMethod: string;
  sharedSuppliers: boolean;
  profileNames: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
  onOrderCreated?: (windowId: string, order: { id: string; order_number: string }) => void;
  onModeChange?: (windowId: string, mode: SOMode) => void;
};

export function SupplierOrderInstance({
  descriptor, articles, suppliers, sites, depots, autoMode, stockMethod,
  sharedSuppliers, profileNames, onClose, onSaved, onOrderCreated, onModeChange,
}: Props) {
  const { tenant, currentSite, profile, user } = useApp();
  const { can } = usePermissions();
  const { success, error } = useToast();

  const [mode, setMode] = useState<SOMode>(descriptor.mode);
  const [orderId, setOrderId] = useState<string | null>(descriptor.orderId);
  const [order, setOrder] = useState<Order | null>(null);
  const [headerForm, setHeaderForm] = useState<SOHeaderForm>({ supplier_id: '', expected_date: '', note: '' });
  const [items, setItems] = useState<SOLineItem[]>([]);
  const [receiveQty, setReceiveQty] = useState<ReceiveQtyMap>({});
  const [receiveLotData, setReceiveLotData] = useState<ReceiveLotMap>({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchData, setDispatchData] = useState<Record<string, Record<string, number>>>({});
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const receiveIdemRef = useRef<string>('');
  const receivingRef = useRef(false);

  const userId = profile?.id || user?.id || '';
  const scope = useMemo(
    () => ({ userId, tenantId: descriptor.tenantId, siteId: descriptor.siteId }),
    [userId, descriptor.tenantId, descriptor.siteId],
  );
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const hasRecoveredDraftRef = useRef(false);
  const opInProgressRef = useRef<OpInProgress>(null);
  const [recoveredOp, setRecoveredOp] = useState<OpInProgress>(null);

  const siteMismatch = !!(currentSite?.id && descriptor.siteId && currentSite.id !== descriptor.siteId);

  // ── Draft recovery: pass 1 — hydrate from sessionStorage once ─────
  useEffect(() => {
    if (recoveryChecked) return;
    if (!scope.userId) return;
    const d = loadFormDraft<any>(scope, descriptor.windowId);
    if (d && d.kind === 'supplier_order' && d.data) {
      hasRecoveredDraftRef.current = true;
      if (d.data.headerForm) setHeaderForm(d.data.headerForm);
      if (Array.isArray(d.data.items)) setItems(d.data.items);
      if (d.data.receiveQty) setReceiveQty(d.data.receiveQty);
      if (d.data.receiveLotData) setReceiveLotData(d.data.receiveLotData);
      if (d.data.dispatchData) setDispatchData(d.data.dispatchData);
      if (d.mode) setMode(d.mode as SOMode);
      if (d.documentId && !orderId) setOrderId(d.documentId);
      if (d.opInProgress) { setRecoveredOp(d.opInProgress); opInProgressRef.current = d.opInProgress; }
    }
    setRecoveryChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.userId, scope.tenantId, scope.siteId]);

  // Load existing order (view/edit/receive). Never runs an insert.
  // Runs after the recovery pass so a rehydrated draft is not overwritten.
  useEffect(() => {
    if (!recoveryChecked) return;
    const targetId = orderId || descriptor.orderId;
    if (!targetId) { setLoaded(true); return; }
    let cancelled = false;
    (async () => {
      const { data: o } = await supabase
        .from('supplier_orders')
        .select('*, suppliers(name, phone, whatsapp, email, address)')
        .eq('id', targetId)
        .maybeSingle();
      if (cancelled) return;
      if (!o) {
        // Server confirms the document no longer exists.
        if (hasRecoveredDraftRef.current) {
          error("La commande de votre brouillon n'existe plus sur le serveur. Le brouillon est conservé mais devra être ré-enregistré.");
        }
        setLoaded(true);
        return;
      }
      const { data: itemsData } = await supabase
        .from('supplier_order_items')
        .select('*, articles(internal_ref, oem_ref)')
        .eq('order_id', o.id);
      if (cancelled) return;
      const loadedItems: SOLineItem[] = (itemsData || []).map((i: any) => ({
        id: i.id,
        article_id: i.article_id || null,
        name: i.name,
        supplier_ref: i.supplier_ref || '',
        quantity_ordered: Number(i.quantity_ordered),
        unit_price: Number(i.unit_price),
        total: Number(i.total),
        quantity_received: Number(i.quantity_received || 0),
      }));
      setOrder(o as any);
      setOrderId(o.id);
      if (!hasRecoveredDraftRef.current) {
        setHeaderForm({ supplier_id: o.supplier_id || '', expected_date: o.expected_date || '', note: o.note || '' });
        setItems(loadedItems);
        if (descriptor.mode === 'receive') primeReceive(loadedItems, o.id);
      } else if (!receiveIdemRef.current && (mode === 'receive' || descriptor.mode === 'receive')) {
        receiveIdemRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID() : `recv-${o.id}-${Date.now()}`;
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveryChecked, descriptor.orderId]);

  // ── Draft recovery: pass 2 — debounced save on every editable change ─
  useEffect(() => {
    if (!recoveryChecked || !scope.userId) return;
    if (siteMismatch) return;
    scheduleSaveFormDraft(scope, {
      windowId: descriptor.windowId,
      kind: 'supplier_order',
      documentId: orderId,
      mode,
      data: { headerForm, items, receiveQty, receiveLotData, dispatchData, orderId },
      opInProgress: opInProgressRef.current,
    }, 400);
  }, [recoveryChecked, scope, siteMismatch, descriptor.windowId, mode, orderId, headerForm, items, receiveQty, receiveLotData, dispatchData]);

  const primeReceive = (loadedItems: SOLineItem[], oid: string) => {
    const rq: ReceiveQtyMap = {};
    loadedItems.forEach((it, idx) => {
      const key = it.id || `idx-${idx}`;
      rq[key] = Math.max(0, (it.quantity_ordered || 0) - (it.quantity_received || 0));
    });
    setReceiveQty(rq);
    setReceiveLotData({});
    receiveIdemRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID() : `recv-${oid}-${Date.now()}`;
  };

  const subtotal = useMemo(
    () => items.filter(i => i.name.trim()).reduce((s, i) => s + Number(i.total || 0), 0),
    [items],
  );

  const receiveDestinations = useMemo(() => {
    const orderSiteId = (order as any)?.site_id || descriptor.siteId || currentSite?.id || '';
    if (!orderSiteId) return [] as { id: string; name: string }[];
    const out: { id: string; name: string }[] = [];
    const store = sites.find(s => s.id === orderSiteId)
      || (currentSite && currentSite.id === orderSiteId ? currentSite : null);
    out.push({ id: orderSiteId, name: store?.name || 'Magasin principal' });
    depots.filter(d => d.parent_site_id === orderSiteId)
      .forEach(d => out.push({ id: d.id, name: d.name }));
    if (sharedSuppliers) {
      sites.filter(s => s.id !== orderSiteId)
        .forEach(s => { if (!out.some(x => x.id === s.id)) out.push({ id: s.id, name: s.name }); });
    }
    return out;
  }, [order, descriptor.siteId, sites, depots, currentSite, sharedSuppliers]);

  const saveOrder = async () => {
    if (recoveredOp) {
      error("Un enregistrement était en cours au moment du rechargement. Vérifiez la commande côté serveur puis cliquez sur « J'ai vérifié » avant de relancer.");
      return;
    }
    if (saving) return;
    if (siteMismatch) { error("Commande d'un autre magasin : revenez dans son magasin d'origine pour enregistrer."); return; }
    if (!tenant || !currentSite) { error('Magasin introuvable'); return; }
    if (!can('manage_supplier_orders')) { error("Vous n'avez pas la permission de gérer les achats"); return; }
    if (!headerForm.supplier_id) { error('Sélectionnez un fournisseur'); return; }
    const validItems = items.filter(i => i.name.trim());
    if (validItems.length === 0) { error('Ajoutez au moins un article'); return; }
    const total = validItems.reduce((s, i) => s + Number(i.total), 0);

    if (!orderId) {
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
    // Mark op-in-progress in the local draft before touching the server.
    opInProgressRef.current = 'save';
    saveFormDraft(scope, {
      windowId: descriptor.windowId, kind: 'supplier_order',
      documentId: orderId, mode,
      data: { headerForm, items, receiveQty, receiveLotData, dispatchData, orderId },
      opInProgress: 'save',
    });
    try {
      if (orderId) {
        const { data: current } = await supabase.from('supplier_orders')
          .select('id, site_id').eq('id', orderId).maybeSingle();
        if (!current) { error('Commande introuvable'); return; }
        if (current.site_id && current.site_id !== currentSite.id) {
          error("Commande d'un autre magasin : enregistrement refusé."); return;
        }
        await supabase.from('supplier_orders').update({
          supplier_id: headerForm.supplier_id, subtotal: total, total,
          expected_date: headerForm.expected_date || null, note: headerForm.note,
        }).eq('id', orderId);
        await supabase.from('supplier_order_items').delete().eq('order_id', orderId);
        await supabase.from('supplier_order_items').insert(validItems.map(i => ({
          tenant_id: tenant.id, order_id: orderId,
          article_id: i.article_id || null, name: i.name, supplier_ref: i.supplier_ref,
          quantity_ordered: i.quantity_ordered, quantity_received: 0,
          unit_price: i.unit_price, total: i.total,
        })));
        success('Commande mise à jour');
        clearFormDraft(scope, descriptor.windowId);
        onSaved();
        onClose();
      } else {
        const insertSiteId = descriptor.siteId || currentSite.id;
        const { data: numData } = await supabase.rpc('next_doc_number', {
          p_tenant_id: tenant.id, p_kind: 'supplier_order', p_prefix: 'CMD',
        });
        const oNum = (numData as string) || ('CMD-' + Date.now());
        const { data: o, error: e } = await supabase.from('supplier_orders').insert({
          tenant_id: tenant.id, site_id: insertSiteId,
          supplier_id: headerForm.supplier_id,
          order_number: oNum, subtotal: total, discount: 0, total,
          expected_date: headerForm.expected_date || null, note: headerForm.note, status: 'draft',
        }).select().single();
        if (e || !o) { error(e?.message || 'Erreur'); return; }
        await supabase.from('supplier_order_items').insert(validItems.map(i => ({
          tenant_id: tenant.id, order_id: o.id,
          article_id: i.article_id || null, name: i.name, supplier_ref: i.supplier_ref,
          quantity_ordered: i.quantity_ordered, quantity_received: 0,
          unit_price: i.unit_price, total: i.total,
        })));
        setOrder(o as any);
        setOrderId(o.id);
        setMode('view');
        onOrderCreated?.(descriptor.windowId, { id: o.id, order_number: oNum });
        onModeChange?.(descriptor.windowId, 'view');
        success(`Commande ${oNum} créée`);
        // Draft no longer needed after successful create — window remains open in view mode.
        clearFormDraft(scope, descriptor.windowId);
        onSaved();
      }
    } catch (err: any) {
      error(err?.message || 'Erreur');
    } finally {
      setSaving(false);
      opInProgressRef.current = null;
    }
  };

  const changeStatus = async (status: string) => {
    if (siteMismatch || !order) return;
    if (!can('edit_supplier_orders')) { error('Permission insuffisante'); return; }
    await supabase.from('supplier_orders').update({ status }).eq('id', order.id);
    setOrder(o => o ? { ...o, status } : o);
    success('Statut mis à jour');
    onSaved();
  };

  const startEdit = () => {
    if (siteMismatch) return;
    setMode('edit');
    onModeChange?.(descriptor.windowId, 'edit');
  };

  const startReceive = () => {
    if (siteMismatch) { error("Réception impossible depuis un autre magasin."); return; }
    if (!order) return;
    primeReceive(items, order.id);
    setMode('receive');
    onModeChange?.(descriptor.windowId, 'receive');
  };

  const confirmReceive = () => {
    if (recoveredOp) {
      error("Une réception était en cours au moment du rechargement. Vérifiez côté serveur puis cliquez sur « J'ai vérifié » avant de relancer.");
      return;
    }
    if (siteMismatch || !order || !currentSite) return;
    if (!can('manage_supplier_orders')) { error('Permission insuffisante'); return; }
    for (const item of items) {
      const itemId = item.id || '';
      const addQty = Number(receiveQty[itemId] || 0);
      const remaining = Math.max(0, Number(item.quantity_ordered || 0) - Number(item.quantity_received || 0));
      if (addQty < 0) { error(`Quantité négative interdite pour ${item.name}`); return; }
      if (addQty > remaining) { error(`Quantité reçue supérieure au restant pour ${item.name}`); return; }
    }
    const anyQty = items.some(it => Number(receiveQty[it.id || ''] || 0) > 0 && it.article_id);
    if (!anyQty) { error('Aucune quantité à réceptionner'); return; }
    const mainId = receiveDestinations[0]?.id || currentSite.id;
    const dd: Record<string, Record<string, number>> = {};
    for (const [idx, item] of items.entries()) {
      const itemId = item.id || `idx-${idx}`;
      const addQty = Number(receiveQty[itemId] || 0);
      if (addQty > 0 && item.article_id) dd[itemId] = { [mainId]: addQty };
    }
    if (receiveDestinations.length > 1) { setDispatchData(dd); setDispatchOpen(true); }
    else void submitReception(dd);
  };

  const isDispatchValid = () => {
    for (const [idx, item] of items.entries()) {
      const itemId = item.id || `idx-${idx}`;
      const addQty = Number(receiveQty[itemId] || 0);
      if (addQty <= 0 || !item.article_id) continue;
      const values = Object.values(dispatchData[itemId] || {}).map(v => Number(v || 0));
      if (values.some(v => v < 0)) return false;
      if (values.reduce((s, v) => s + v, 0) !== addQty) return false;
    }
    return true;
  };

  const submitReception = async (dd: Record<string, Record<string, number>>) => {
    if (recoveredOp) {
      error("Une réception était en cours au moment du rechargement. Vérifiez côté serveur si elle a bien été enregistrée puis cliquez sur « J'ai vérifié » avant de relancer.");
      return;
    }
    if (receivingRef.current) return;
    if (!order || !tenant) return;
    if (siteMismatch || (currentSite && (order as any).site_id && (order as any).site_id !== currentSite.id)) {
      error("Commande d'un autre magasin : réception refusée."); return;
    }
    for (const item of items) {
      const itemId = item.id || '';
      const addQty = Number(receiveQty[itemId] || 0);
      if (addQty <= 0 || !item.article_id) continue;
      const alloc = dd[itemId] || {};
      const values = Object.values(alloc).map(v => Number(v || 0));
      if (values.some(v => v < 0)) { error(`Répartition négative pour ${item.name}`); return; }
      const sum = values.reduce((s, v) => s + v, 0);
      if (sum !== addQty) { error(`Répartition incomplète pour ${item.name} (${sum}/${addQty})`); return; }
    }
    const allocations: Array<{ item_id: string; site_id: string; quantity: number; batch_number: string; expiry_date: string | null }> = [];
    for (const [idx, item] of items.entries()) {
      const itemId = item.id || `idx-${idx}`;
      const addQty = Number(receiveQty[itemId] || 0);
      if (addQty <= 0 || !item.article_id || !item.id) continue;
      const lot = receiveLotData[itemId] || { batch_number: '', expiry_date: '' };
      for (const [siteId, qty] of Object.entries(dd[itemId] || {})) {
        if (Number(qty) <= 0) continue;
        allocations.push({
          item_id: item.id, site_id: siteId, quantity: Number(qty),
          batch_number: lot.batch_number || '', expiry_date: lot.expiry_date || null,
        });
      }
    }
    if (allocations.length === 0) { error('Aucune quantité à réceptionner'); return; }
    receivingRef.current = true;
    setSaving(true);
    opInProgressRef.current = 'receive';
    saveFormDraft(scope, {
      windowId: descriptor.windowId, kind: 'supplier_order',
      documentId: orderId, mode,
      data: { headerForm, items, receiveQty, receiveLotData, dispatchData, orderId },
      opInProgress: 'receive',
    });
    const idemKey = receiveIdemRef.current || `recv-${order.id}-${Date.now()}`;
    const { data, error: e } = await supabase.rpc('receive_supplier_order', {
      p_order_id: order.id,
      p_allocations: allocations,
      p_idempotency_key: idemKey,
    });
    setSaving(false);
    receivingRef.current = false;
    opInProgressRef.current = null;
    if (e) { error(e.message || 'Erreur lors de la réception'); return; }
    const status = (data as any)?.status;
    // Rotate the idempotency key so a follow-up confirm can't resubmit under the same key.
    receiveIdemRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID() : `recv-${order.id}-${Date.now()}`;
    success(status === 'received' ? 'Commande entièrement réceptionnée' : 'Réception partielle enregistrée');
    setDispatchOpen(false);
    clearFormDraft(scope, descriptor.windowId);
    onSaved();
    onClose();
  };

  const tenantForPrint = (): PrintTenant => buildPrintTenantForSite(tenant, currentSite);
  const creatorName = (userId?: string | null) => (userId && profileNames[userId]) || 'Utilisateur non renseigné';

  const doPrint = () => {
    if (!order || !tenant) return;
    const sup = suppliers.find(s => s.id === headerForm.supplier_id);
    const pitems = items.filter(i => i.name.trim()).map(i => ({
      name: i.name, supplier_ref: i.supplier_ref || null, oem_ref: null,
      quantity: Number(i.quantity_ordered), unit_price: Number(i.unit_price), discount: 0,
    }));
    const psubtotal = pitems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    printDocumentA4({
      tenant: tenantForPrint(), docLabel: 'BON DE COMMANDE',
      docNumber: order.order_number, docDate: formatDate(order.created_at),
      customer: sup ? { name: sup.name, phone: sup.phone, address: sup.address } : null,
      extraMeta: order.expected_date ? [{ label: 'Livraison prévue', value: formatDate(order.expected_date) }] : [],
      items: pitems, subtotal: psubtotal, total: psubtotal,
      footerNote: 'Merci de confirmer réception et délai de livraison.',
      issuedBy: creatorName(order.user_id),
      docHeader: order.doc_header ?? null,
    });
  };

  const publicOrderUrl = () => {
    const code = order?.public_code || order?.public_token;
    return code ? `${window.location.origin}/po/${code}` : '';
  };

  const doCopyLink = async () => {
    const url = publicOrderUrl();
    if (!url) { error('Lien indisponible'); return; }
    try { await navigator.clipboard.writeText(url); success('Lien copié'); }
    catch { window.prompt('Copiez le lien :', url); }
  };

  const doWhatsApp = () => {
    const sup = order?.suppliers;
    if (!order || !sup) { error('Fournisseur introuvable'); return; }
    const phoneRaw = ((sup as any).whatsapp || sup.phone || '').replace(/[^0-9]/g, '');
    if (!phoneRaw) { error('Aucun numéro WhatsApp/téléphone'); return; }
    const phone = phoneRaw.startsWith('221') ? phoneRaw : phoneRaw.length === 9 ? `221${phoneRaw}` : phoneRaw;
    const link = publicOrderUrl();
    const msg = [
      `Bonjour ${sup.name || ''},`, '',
      `Notre commande *${order.order_number}* du ${formatDate(order.created_at)}.`,
      order.expected_date ? `Livraison souhaitée : ${formatDate(order.expected_date)}` : '',
      `*Total : ${formatFCFA(order.total)}*`,
      link ? `\nBon de commande (PDF) : ${link}` : '', '',
      'Merci de confirmer.',
    ].filter(Boolean).join('\n');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const canReceive = !!(order && ['sent', 'confirmed', 'partial'].includes(order.status));
  const canCancel = !!(order && ['draft', 'sent'].includes(order.status));
  const canRestart = !!(order && ['draft', 'sent', 'confirmed', 'partial'].includes(order.status));

  if (!loaded) {
    return (
      <div className="relative w-full h-full flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col">
      {siteMismatch && (
        <div className="shrink-0 px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-xs text-amber-800 relative z-10">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span className="font-medium">Cette commande appartient à un autre magasin. Revenez dans son magasin d'origine pour modifier ou réceptionner.</span>
        </div>
      )}
      {recoveredOp && !siteMismatch && (
        <div className="shrink-0 px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-start gap-2 text-xs text-amber-900 relative z-10">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold">Opération interrompue par un rechargement</div>
            <div className="mt-0.5">
              {recoveredOp === 'save'
                ? "Un enregistrement était en cours au moment du rechargement — son résultat est incertain. Vérifiez la commande côté serveur avant de relancer."
                : "Une réception était en cours au moment du rechargement — son résultat est incertain. Vérifiez le statut avant de relancer."}
            </div>
          </div>
          <button onClick={() => { setRecoveredOp(null); opInProgressRef.current = null; }} className="shrink-0 p-1 text-amber-700 hover:text-amber-900" title="J'ai vérifié"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        <SupplierOrderEditor
          embedded
          inactive={siteMismatch}
          mode={mode}
          articles={articles}
          suppliers={suppliers}
          headerForm={headerForm}
          setHeaderForm={setHeaderForm}
          items={items}
          setItems={setItems}
          subtotal={subtotal}
          saving={saving}
          onSave={!siteMismatch && (mode === 'create' || mode === 'edit') ? saveOrder : undefined}
          onClose={onClose}
          editingId={orderId}
          documentNumber={order?.order_number}
          documentStatus={order?.status}
          autoMode={autoMode}
          onVehiclePicker={autoMode && !siteMismatch ? () => setVehiclePickerOpen(true) : undefined}
          onEdit={orderId && canRestart && !siteMismatch ? startEdit : undefined}
          onPrint={orderId ? doPrint : undefined}
          onCopyLink={order ? doCopyLink : undefined}
          onWhatsApp={order?.suppliers ? doWhatsApp : undefined}
          onCancel={canCancel && !siteMismatch ? () => setConfirmCancel(true) : undefined}
          onChangeStatus={order && !siteMismatch ? changeStatus : undefined}
          onStartReceive={canReceive && !siteMismatch ? startReceive : undefined}
          receiveQty={receiveQty}
          setReceiveQty={setReceiveQty}
          receiveLotData={receiveLotData}
          setReceiveLotData={setReceiveLotData}
          stockMethod={stockMethod}
          onConfirmReceive={mode === 'receive' && !siteMismatch ? confirmReceive : undefined}
        />
      </div>

      <Modal
        open={dispatchOpen}
        onClose={() => setDispatchOpen(false)}
        title="Répartition par emplacement"
        size="lg"
        layer="top"
        footer={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setDispatchOpen(false)}
              className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded transition-colors"
            >
              <X className="w-4 h-4" /><span>Annuler</span>
            </button>
            <button
              onClick={() => submitReception(dispatchData)}
              disabled={saving || !isDispatchValid()}
              className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-bold text-neutral-900 hover:bg-neutral-100 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
              <span>Confirmer la réception</span>
            </button>
          </div>
        }
      >
        <div>
          <p className="text-xs text-neutral-500 px-1 pb-3">
            Répartissez la quantité reçue de chaque article entre le magasin principal et les emplacements autorisés ({receiveDestinations.length}).
          </p>
          <div className="divide-y divide-neutral-100 max-h-[60vh] overflow-y-auto">
            {items.filter((i, idx) => {
              const itemId = i.id || `idx-${idx}`;
              return (receiveQty[itemId] || 0) > 0 && i.article_id;
            }).map((item, idx) => {
              const itemId = item.id || `idx-${idx}`;
              const totalQty = Number(receiveQty[itemId] || 0);
              const allocated = Object.values(dispatchData[itemId] || {}).reduce((s, v) => s + v, 0);
              const valid = allocated === totalQty;
              return (
                <div key={itemId} className="py-3 px-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-neutral-900 truncate">{item.name}</div>
                      {item.supplier_ref && <div className="text-[10px] text-neutral-400 font-mono">{item.supplier_ref}</div>}
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <span className="text-[10px] text-neutral-400">Reçue </span>
                      <span className="text-sm font-bold text-neutral-900 num">{totalQty}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {receiveDestinations.map(site => {
                      const val = dispatchData[itemId]?.[site.id] || 0;
                      return (
                        <div key={site.id} className="flex items-center gap-2">
                          <span className="text-xs text-neutral-600 flex-1 truncate">{site.name}</span>
                          <input
                            type="number" min={0} max={totalQty} value={val}
                            onChange={e => {
                              const v = Math.max(0, Math.min(totalQty, Number(e.target.value) || 0));
                              setDispatchData(prev => ({ ...prev, [itemId]: { ...prev[itemId], [site.id]: v } }));
                            }}
                            className="w-20 text-xs num text-center bg-transparent border-b border-neutral-300 focus:border-neutral-900 outline-none py-1 focus:ring-0"
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[10px] font-medium pt-0.5">
                    {valid ? (
                      <span className="text-emerald-600 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Répartition correcte</span>
                    ) : (
                      <span className="text-amber-600">
                        Alloué : {allocated}/{totalQty} — {allocated < totalQty ? `${totalQty - allocated} restant(s)` : 'surplus'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={async () => { await changeStatus('cancelled'); setConfirmCancel(false); onClose(); }}
        title="Annuler la commande ?"
        message={`La commande "${order?.order_number || ''}" sera annulée.`}
        danger
      />

      {autoMode && tenant && !siteMismatch && (
        <VehicleArticlePicker
          open={vehiclePickerOpen}
          onClose={() => setVehiclePickerOpen(false)}
          onSelect={a => {
            setItems(p => [...p, {
              article_id: a.id, name: a.name, supplier_ref: a.supplier_ref || '',
              quantity_ordered: 1, unit_price: a.purchase_price, total: a.purchase_price,
            }]);
          }}
          priceMode="purchase"
          tenantId={tenant.id}
          siteId={descriptor.siteId || currentSite?.id || ''}
        />
      )}
    </div>
  );
}
