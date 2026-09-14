import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { loadFormDraft, clearFormDraft, saveFormDraft, scheduleSaveFormDraft, type OpInProgress } from '../../lib/draftRecovery';
import { Lock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { usePermissions } from '../../lib/permissions';
import { useToast } from '../../context/ToastContext';
import { formatFCFA } from '../../lib/format';
import { printDocumentA4, buildPrintTenantForSite, type PrintTenant } from '../../lib/print';
import { calculerIpm, parseConvention, validerDocumentsIpm, type IpmArticleLine, type IpmDocuments as IpmDocsType } from '../../lib/ipm';
import { type SalesRepresentative, type RepCommissionSettings, computeRepCommission, repDisplayName } from '../../lib/repCommission';
import { DocumentEditor } from '../DocumentEditor';

type QuoteItem = {
  id?: string; article_id: string | null; name: string;
  quantity: number; unit_price: number; discount: number; total: number;
  tier_name?: string; ipm_eligible?: boolean;
};

type Invoice = {
  id: string; sale_number: string; total: number; paid: number; status: string;
  customer_id: string | null;
  created_at: string;
  public_code?: string | null;
  accounting_status?: string;
  user_id?: string | null;
  representative_id?: string | null;
  rep_commission?: any;
  customers: { name: string } | null;
};

export type InvoiceWindowDescriptor = {
  windowId: string;
  invoiceId: string | null;
  mode: 'create' | 'edit' | 'view';
  siteId: string;
  tenantId: string;
};

export type InvoiceEditorInstanceProps = {
  descriptor: InvoiceWindowDescriptor;
  articles: any[];
  customers: any[];
  articleTiers: { article_id: string; tier_name: string; price: number }[];
  invoices: Invoice[];
  sales: any[];
  paymentMethods: any[];
  docSettings: any;
  autoMode: boolean;
  isPharmacy: boolean;
  activeReps: SalesRepresentative[];
  salesReps: SalesRepresentative[];
  repSettings: RepCommissionSettings;
  profileNames: Record<string, string>;
  billSourceSiteId: string;
  onClose: () => void;
  onSaved: () => void;
  onOpenNew: () => void;
  onInvoiceCreated?: (windowId: string, invoiceId: string, saleNumber: string) => void;
  onOpenPay: (inv: Invoice) => void;
  onCancelInvoice: (inv: Invoice) => void;
  onComptabiliser: (inv: Invoice) => void;
  onCopyLink: (inv: Invoice) => void;
  onWhatsApp: (inv: Invoice) => void;
  onReturnTransform: (config: any, editingInvoiceId: string) => Promise<void>;
  onSearchOpen: () => void;
  onVehiclePicker: (idx: number | null) => void;
  onCreateArticle: (name: string) => void;
  onCreateCustomer: (name: string) => void;
  onTierPicker: (art: any, idx: number) => void;
  onNavigateInvoice?: (inv: Invoice) => void;
};

const tenantForPrint = (t: any, site?: any): PrintTenant => buildPrintTenantForSite(t, site);

export function InvoiceEditorInstance({
  descriptor,
  articles, customers, articleTiers, invoices, sales,
  paymentMethods, docSettings, autoMode, isPharmacy,
  activeReps, salesReps, repSettings, profileNames,
  billSourceSiteId,
  onClose, onSaved, onOpenNew, onInvoiceCreated, onOpenPay,
  onCancelInvoice, onComptabiliser, onCopyLink, onWhatsApp,
  onReturnTransform, onSearchOpen, onVehiclePicker,
  onCreateArticle, onCreateCustomer, onTierPicker,
  onNavigateInvoice,
}: InvoiceEditorInstanceProps) {
  const { tenant, currentSite, profile, user } = useApp();
  const { can } = usePermissions();
  const { success, error } = useToast();

  const userId = profile?.id || user?.id || '';
  const scope = useMemo(
    () => ({ userId, tenantId: descriptor.tenantId, siteId: descriptor.siteId }),
    [userId, descriptor.tenantId, descriptor.siteId],
  );
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const hasRecoveredDraftRef = useRef(false);
  const opInProgressRef = useRef<OpInProgress>(null);
  const [recoveredOp, setRecoveredOp] = useState<OpInProgress>(null);

  // ── Per-instance state ────────────────────────────────────────
  const [mode, setMode] = useState(descriptor.mode);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(descriptor.invoiceId);
  const [invoiceForm, setInvoiceForm] = useState<{
    customer_id: string; doc_date: string; delivery_date: string;
    reference: string; warranty: string; representative: string; imei: string;
  }>({
    customer_id: '', doc_date: new Date().toISOString().slice(0, 10),
    delivery_date: '', reference: '', warranty: '', representative: '', imei: '',
  });
  const [items, setItems] = useState<QuoteItem[]>([
    { article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 },
  ]);
  const [payList, setPayList] = useState<{ method_id: string; method_name: string; amount: number; reference: string }[]>([]);
  const [isCredit, setIsCredit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [postCreation, setPostCreation] = useState<{ saleNumber: string; createdAt: string; createdBy: string } | null>(null);
  const [invoiceDetail, setInvoiceDetail] = useState<any>(null);
  const editingInvoicePrevRep = useRef<string | null>(null);
  const [navIdx, setNavIdx] = useState(-1);

  // IPM state (pharmacy only)
  const [ipmBeneficiaire, setIpmBeneficiaire] = useState<any>(null);
  const [ipmConvention, setIpmConvention] = useState<any>(null);
  const [ipmLoading, setIpmLoading] = useState(false);
  const [ipmDocuments, setIpmDocuments] = useState<IpmDocsType>({ numero_ordonnance: '', medecin: '', numero_bon: '' });

  // Site-lock: block saves when site changed since window was opened
  const siteMismatch = !!(currentSite?.id && descriptor.siteId && currentSite.id !== descriptor.siteId);

  // Return lines for transform-to-return
  const [returnLines, setReturnLines] = useState<any[]>([]);

  // ── Draft recovery: pass 1 — hydrate once from sessionStorage ──
  useEffect(() => {
    if (recoveryChecked) return;
    if (!scope.userId) return;
    const d = loadFormDraft<any>(scope, descriptor.windowId);
    if (d && d.kind === 'invoice' && d.data) {
      hasRecoveredDraftRef.current = true;
      if (d.data.invoiceForm) setInvoiceForm(d.data.invoiceForm);
      if (Array.isArray(d.data.items) && d.data.items.length > 0) setItems(d.data.items);
      if (Array.isArray(d.data.payList)) setPayList(d.data.payList);
      if (typeof d.data.isCredit === 'boolean') setIsCredit(d.data.isCredit);
      if (d.data.ipmDocuments) setIpmDocuments(d.data.ipmDocuments);
      if (d.mode) setMode(d.mode as any);
      if (d.documentId && !editingInvoiceId) setEditingInvoiceId(d.documentId);
      if (d.opInProgress) { setRecoveredOp(d.opInProgress); opInProgressRef.current = d.opInProgress; }
    }
    setRecoveryChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.userId, scope.tenantId, scope.siteId]);

  // ── Draft recovery: pass 2 — debounced save on any editable change ─
  useEffect(() => {
    if (!recoveryChecked || !scope.userId) return;
    if (siteMismatch) return;
    scheduleSaveFormDraft(scope, {
      windowId: descriptor.windowId,
      kind: 'invoice',
      documentId: editingInvoiceId,
      mode,
      data: { invoiceForm, items, payList, isCredit, ipmDocuments, editingInvoiceId },
      opInProgress: opInProgressRef.current,
    }, 400);
  }, [recoveryChecked, scope, siteMismatch, descriptor.windowId, mode, editingInvoiceId, invoiceForm, items, payList, isCredit, ipmDocuments]);

  // ── IPM lookup on customer change ─────────────────────────────
  useEffect(() => {
    if (!isPharmacy || !invoiceForm.customer_id || !tenant) {
      setIpmBeneficiaire(null);
      setIpmConvention(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setIpmLoading(true);
      const { data } = await supabase
        .from('ipm_beneficiaires')
        .select('*, ipm_organismes(nom), ipm_conventions(nom, taux_defaut, plafond_facture, mode_calcul, mode_arrondi, application_plafond, ordonnance_obligatoire, bon_prise_en_charge_obligatoire, numero_bon_obligatoire, numero_ordonnance_obligatoire, medecin_prescripteur_obligatoire, matricule_obligatoire)')
        .eq('tenant_id', tenant.id)
        .eq('customer_id', invoiceForm.customer_id)
        .eq('statut', 'actif')
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setIpmBeneficiaire(data);
        setIpmConvention(data.ipm_conventions);
      } else {
        setIpmBeneficiaire(null);
        setIpmConvention(null);
      }
      setIpmLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isPharmacy, invoiceForm.customer_id, tenant?.id]);

  const ipmConfig = useMemo(() => parseConvention(ipmConvention), [ipmConvention]);
  const ipmTaux = ipmConfig?.taux_defaut || 0;

  const subtotalRaw = useMemo(
    () => items.filter(i => i.name.trim()).reduce((s, i) => s + Number(i.total), 0),
    [items],
  );
  const ipmResult = useMemo(() => {
    if (!ipmBeneficiaire || !ipmConfig) return null;
    const lignes: IpmArticleLine[] = items.filter(i => i.name.trim()).map(i => ({
      montant_ligne: Number(i.total),
      ipm_eligible: i.ipm_eligible !== false,
    }));
    return calculerIpm(ipmConfig, lignes, 0);
  }, [ipmBeneficiaire, ipmConfig, items]);

  const ipmPartIpm = ipmResult?.part_ipm || 0;
  const ipmPartClient = ipmBeneficiaire ? subtotalRaw - ipmPartIpm : subtotalRaw;
  const ipmDocValidation = useMemo(() => {
    if (!ipmBeneficiaire || !ipmConfig) return { valide: true, champs_manquants: [] as string[] };
    return validerDocumentsIpm(ipmConfig, ipmDocuments, ipmBeneficiaire?.matricule);
  }, [ipmBeneficiaire, ipmConfig, ipmDocuments]);

  const subtotal = subtotalRaw;
  const totalPaid = payList.reduce((s, p) => s + p.amount, 0);

  // ── Rep helpers ────────────────────────────────────────────────
  const repById = useCallback(
    (id?: string | null) => salesReps.find(r => r.id === id) || null,
    [salesReps],
  );
  const repLabelOf = useCallback(
    (id?: string | null) => { const r = repById(id); return r ? repDisplayName(r) : null; },
    [repById],
  );
  const creatorName = useCallback(
    (userId?: string | null) => {
      if (!userId) return 'Utilisateur non renseigné';
      if (profile && userId === profile.id) return profile.full_name || profile.email || 'Utilisateur non renseigné';
      return profileNames[userId] || 'Utilisateur non renseigné';
    },
    [profileNames, profile],
  );

  const computeItemsMargin = async (itms: QuoteItem[]): Promise<number> => {
    const ids = itms.filter(i => i.article_id).map(i => i.article_id!) as string[];
    const pmap = new Map<string, number>();
    if (ids.length > 0) {
      const { data } = await supabase.from('articles').select('id, purchase_price').in('id', ids);
      for (const a of (data || [])) pmap.set(a.id, Number((a as any).purchase_price || 0));
    }
    return itms.reduce((s, i) => s + (Number(i.total || 0) - (pmap.get(i.article_id || '') || 0) * Number(i.quantity || 0)), 0);
  };

  const buildRepSnapshot = async (repId: string | null | undefined, itms: QuoteItem[], sub: number) => {
    const rep = repById(repId);
    if (!rep || !repSettings.enabled) return null;
    const needsMargin = repSettings.commission_base === 'marge' || repSettings.commission_type === 'pct_marge'
      || (rep.commission_override && (rep.commission_type === 'pct_marge' || rep.commission_base === 'marge'));
    const margin = needsMargin ? await computeItemsMargin(itms) : 0;
    return computeRepCommission(rep, repSettings, { subtotal: sub, net: sub, margin });
  };

  // ── Load invoice data on mount (edit/view) ────────────────────
  useEffect(() => {
    if (!recoveryChecked) return;
    if (!descriptor.invoiceId) return;
    const inv = invoices.find(i => i.id === descriptor.invoiceId);
    if (!inv) return;

    (async () => {
      const [{ data: saleItems }, { data: full }] = await Promise.all([
        supabase.from('sale_items').select('*, articles(internal_ref, oem_ref, sale_price)').eq('sale_id', inv.id),
        supabase.from('sales').select('*, customers(name, phone, address)').eq('id', inv.id).maybeSingle(),
      ]);
      if (full) setInvoiceDetail(full);
      setEditingInvoiceId(inv.id);
      setNavIdx(invoices.findIndex(i => i.id === inv.id));
      if (!hasRecoveredDraftRef.current) {
        setMode(descriptor.mode);
        setInvoiceForm({
          customer_id: inv.customer_id || '',
          doc_date: (inv as any).doc_header?.doc_date || new Date(inv.created_at).toISOString().slice(0, 10),
          delivery_date: (inv as any).doc_header?.delivery_date || '',
          reference: (inv as any).doc_header?.reference || '',
          warranty: (inv as any).doc_header?.warranty || '',
          representative: (inv as any).representative_id || '',
          imei: (inv as any).doc_header?.imei || '',
        });
        editingInvoicePrevRep.current = (inv as any).representative_id || null;
        setItems((saleItems || []).map((i: any) => ({
          article_id: i.article_id, name: i.name,
          quantity: Number(i.quantity), unit_price: Number(i.unit_price),
          discount: Number(i.discount || 0), total: Number(i.total),
        })));

        if (descriptor.mode === 'view') {
          const { data: pp } = await supabase.from('sale_payments').select('*').eq('sale_id', inv.id);
          setPayList((pp || []).map((p: any) => ({
            method_id: p.payment_method_id || '', method_name: p.method_name,
            amount: Number(p.amount), reference: '',
          })));
        } else {
          setPayList([]);
        }
        setIsCredit(inv.status === 'validated' && Number(inv.paid) === 0);
      } else {
        editingInvoicePrevRep.current = (inv as any).representative_id || null;
      }
    })();
  }, [recoveryChecked, descriptor.invoiceId, descriptor.mode]);

  // ── Navigate to another invoice (view mode prev/next) ─────────
  const navigateToInvoice = useCallback(async (inv: Invoice) => {
    const [{ data: saleItems }, { data: full }] = await Promise.all([
      supabase.from('sale_items').select('*, articles(internal_ref, oem_ref, sale_price)').eq('sale_id', inv.id),
      supabase.from('sales').select('*, customers(name, phone, address)').eq('id', inv.id).maybeSingle(),
    ]);
    setEditingInvoiceId(inv.id);
    setNavIdx(invoices.findIndex(i => i.id === inv.id));
    setMode('view');
    setInvoiceForm({
      customer_id: inv.customer_id || '',
      doc_date: (inv as any).doc_header?.doc_date || new Date(inv.created_at).toISOString().slice(0, 10),
      delivery_date: (inv as any).doc_header?.delivery_date || '',
      reference: (inv as any).doc_header?.reference || '',
      warranty: (inv as any).doc_header?.warranty || '',
      representative: (inv as any).representative_id || '',
      imei: (inv as any).doc_header?.imei || '',
    });
    setItems((saleItems || []).map((i: any) => ({
      article_id: i.article_id, name: i.name,
      quantity: Number(i.quantity), unit_price: Number(i.unit_price),
      discount: Number(i.discount || 0), total: Number(i.total),
    })));
    const { data: pp } = await supabase.from('sale_payments').select('*').eq('sale_id', inv.id);
    setPayList((pp || []).map((p: any) => ({
      method_id: p.payment_method_id || '', method_name: p.method_name,
      amount: Number(p.amount), reference: '',
    })));
    setIsCredit(inv.status === 'validated' && Number(inv.paid) === 0);
    if (full) setInvoiceDetail(full);
    setPostCreation(null);
  }, [invoices]);

  // ── Load return lines ─────────────────────────────────────────
  const loadReturnLines = async (saleId: string) => {
    const [{ data: saleItems }, { data: retQtys }] = await Promise.all([
      supabase.from('sale_items').select('*').eq('sale_id', saleId),
      supabase.rpc('get_sale_returned_quantities', { p_sale_id: saleId }),
    ]);
    const retMap: Record<string, number> = {};
    (retQtys || []).forEach((r: any) => { retMap[r.article_id] = Number(r.total_returned); });
    const lines = (saleItems || [])
      .map((i: any) => {
        const alreadyReturned = retMap[i.article_id] || 0;
        const remaining = Math.max(0, Number(i.quantity) - alreadyReturned);
        return { item_id: i.id, article_id: i.article_id, name: i.name, max_qty: remaining, quantity: Math.min(remaining, 1), unit_price: i.unit_price, purchase_cost: i.purchase_cost || 0, selected: false };
      })
      .filter((i: any) => i.max_qty > 0);
    setReturnLines(lines);
  };

  // ── Save invoice (create + edit) ──────────────────────────────
  const saveInvoice = async () => {
    if (recoveredOp) {
      error("Un enregistrement était en cours au moment du rechargement. Vérifiez si la facture existe déjà côté serveur, puis cliquez sur « J'ai vérifié » avant de relancer.");
      return;
    }
    if (saving) return;
    if (siteMismatch) { error('Cette facture appartient à un autre magasin. Revenez dans le magasin d\'origine pour enregistrer.'); return; }
    if (!tenant || !currentSite) { error('Magasin introuvable'); return; }
    if (!can('edit_invoices')) { error('Vous n\'avez pas la permission de créer des factures'); return; }
    const valid = items.filter(i => i.name.trim());
    if (valid.length === 0) { error('Ajoutez au moins un article'); return; }
    const nonCatalog = valid.filter(i => !i.article_id);
    if (nonCatalog.length > 0) { error(`Chaque ligne doit correspondre à un article du catalogue : ${nonCatalog.map(i => i.name).join(', ')}`); return; }

    // Edit existing invoice
    if (editingInvoiceId) {
      setSaving(true);
      opInProgressRef.current = 'save';
      saveFormDraft(scope, {
        windowId: descriptor.windowId, kind: 'invoice',
        documentId: editingInvoiceId, mode,
        data: { invoiceForm, items, payList, isCredit, ipmDocuments, editingInvoiceId },
        opInProgress: 'save',
      });
      try {
        const invRepLabel = repLabelOf(invoiceForm.representative);
        const docHeader = { doc_date: invoiceForm.doc_date || null, delivery_date: invoiceForm.delivery_date || null, reference: invoiceForm.reference || null, warranty: invoiceForm.warranty || null, representative: invRepLabel, imei: invoiceForm.imei || null };
        const { data: result, error: rpcErr } = await supabase.rpc('update_sale_items_and_totals', {
          p_sale_id: editingInvoiceId,
          p_tenant_id: tenant.id,
          p_items: valid.map(i => ({
            article_id: i.article_id, name: i.name,
            quantity: i.quantity, unit_price: i.unit_price,
            discount: i.discount,
          })),
          p_customer_id: invoiceForm.customer_id || null,
          p_doc_header: docHeader,
        });
        if (rpcErr) throw rpcErr;
        if (result && !(result as any).success) throw new Error((result as any).error || 'Erreur');

        const editSubtotal = valid.reduce((s, i) => s + Number(i.total), 0);
        const editSnapshot = await buildRepSnapshot(invoiceForm.representative || null, valid, editSubtotal);
        await supabase.from('sales').update({
          representative_id: invoiceForm.representative || null,
          rep_commission: editSnapshot,
        }).eq('id', editingInvoiceId);
        if (editingInvoicePrevRep.current !== (invoiceForm.representative || null)) {
          await supabase.from('audit_logs').insert({
            tenant_id: tenant.id, user_id: profile?.id || null,
            action: 'representative_change', module: 'billing', reference_id: editingInvoiceId,
            old_value: { representative_id: editingInvoicePrevRep.current }, new_value: { representative_id: invoiceForm.representative || null },
          });
        }
        success('Facture mise à jour');
        clearFormDraft(scope, descriptor.windowId);
        opInProgressRef.current = null;
        onClose();
        onSaved();
      } catch (err: any) {
        error(err.message || 'Erreur');
      } finally {
        setSaving(false);
      }
      return;
    }

    // IPM document validation
    if (ipmBeneficiaire && ipmConfig && !ipmDocValidation.valide) {
      error(`Documents IPM manquants : ${ipmDocValidation.champs_manquants.join(', ')}`);
      return;
    }

    const createSubtotal = valid.reduce((s, i) => s + Number(i.total), 0);
    const createTotalPaid = isCredit ? 0 : payList.reduce((s, p) => s + p.amount, 0);
    const clientDueAmount = (ipmBeneficiaire && ipmPartIpm > 0) ? ipmPartClient : createSubtotal;
    if (!isCredit && createTotalPaid > clientDueAmount) { error('Le montant payé dépasse la part client'); return; }

    if (isCredit && !invoiceForm.customer_id) {
      error('Un client est requis pour une facture à crédit');
      return;
    }

    const allowNeg = !!(currentSite as any)?.allow_negative_stock;
    const articleItems = valid.filter(i => i.article_id);
    const trackedItems = articleItems.filter(i => {
      const art = articles.find((a: any) => a.id === i.article_id);
      return art && art.track_stock !== false;
    });
    if (!allowNeg && trackedItems.length > 0) {
      const { data: stk } = await supabase.from('stock_levels')
        .select('article_id, quantity')
        .eq('tenant_id', tenant.id).eq('site_id', currentSite.id)
        .in('article_id', trackedItems.map(i => i.article_id!));
      const stockMap = new Map((stk || []).map((r: any) => [r.article_id, Number(r.quantity)]));
      const insufficient = trackedItems.filter(i => (stockMap.get(i.article_id!) || 0) < i.quantity);
      if (insufficient.length > 0) {
        error(`Stock insuffisant: ${insufficient.map(i => i.name).join(', ')}`);
        return;
      }
    }

    setSaving(true);
    try {
      const { data: numData } = await supabase.rpc('next_doc_number', {
        p_tenant_id: tenant.id, p_kind: 'invoice', p_prefix: 'F',
      });
      const invNum = (numData as string) || ('F-' + Date.now());

      let sessionId: string | null = null;
      if (!isCredit) {
        const { data: sess } = await supabase.from('cash_sessions')
          .select('id').eq('tenant_id', tenant.id).eq('site_id', currentSite.id)
          .eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle();
        sessionId = sess?.id || null;
      }

      const status = isCredit
        ? (ipmBeneficiaire && ipmPartIpm > 0 && createTotalPaid >= clientDueAmount ? 'paid' : 'validated')
        : (createTotalPaid >= clientDueAmount ? 'paid' : createTotalPaid > 0 ? 'partial' : 'validated');

      const ipmCoverage = (ipmBeneficiaire && ipmPartIpm > 0) ? ipmPartIpm : 0;
      const effectivePaid = createTotalPaid + ipmCoverage;

      const repSnapshot = await buildRepSnapshot(invoiceForm.representative || null, valid, createSubtotal);
      const newInvRepLabel = repLabelOf(invoiceForm.representative);

      const { data: sale, error: e } = await supabase.from('sales').insert({
        tenant_id: tenant.id, site_id: currentSite.id,
        customer_id: invoiceForm.customer_id || null,
        user_id: profile?.id || null,
        sale_number: invNum, subtotal: createSubtotal, discount: 0, total: createSubtotal,
        paid: effectivePaid, status,
        source: 'billing', note: ipmCoverage > 0 ? `IPM: ${ipmBeneficiaire.ipm_organismes?.nom}` : null,
        cash_session_id: sessionId,
        representative_id: invoiceForm.representative || null,
        rep_commission: repSnapshot,
        doc_header: { doc_date: invoiceForm.doc_date || null, delivery_date: invoiceForm.delivery_date || null, reference: invoiceForm.reference || null, warranty: invoiceForm.warranty || null, representative: newInvRepLabel, imei: invoiceForm.imei || null },
      }).select('id').single();
      if (e || !sale) { error(e?.message || 'Erreur'); return; }

      const { error: itemsErr } = await supabase.rpc('insert_billing_sale_items', {
        p_sale_id: sale.id,
        p_items: valid.map(i => ({
          article_id: i.article_id, name: i.name,
          quantity: i.quantity, unit_price: i.unit_price,
          discount: i.discount, total: i.total,
        })),
      });
      if (itemsErr) {
        await supabase.from('sales').delete().eq('id', sale.id);
        error(itemsErr.message || 'Erreur lors de l\'enregistrement des lignes de facture');
        return;
      }

      if (!isCredit) {
        let sessionPayTotal = 0;
        for (const p of payList) {
          await supabase.from('sale_payments').insert({
            tenant_id: tenant.id, sale_id: sale.id,
            cash_session_id: sessionId,
            payment_method_id: p.method_id || null,
            method_name: p.method_name, amount: p.amount,
            reference: p.reference || '',
          });
          if (sessionId) sessionPayTotal += p.amount;
        }
        if (sessionId && sessionPayTotal > 0) {
          await supabase.rpc('increment_session_theoretical', {
            p_session_id: sessionId,
            p_amount: sessionPayTotal,
          });
        }
      }

      if (invoiceForm.customer_id) {
        const unpaidAmount = createSubtotal - effectivePaid;
        if (unpaidAmount > 0) {
          const { data: cust } = await supabase.from('customers').select('balance').eq('id', invoiceForm.customer_id).single();
          await supabase.from('customers').update({ balance: Number(cust?.balance || 0) + unpaidAmount }).eq('id', invoiceForm.customer_id);
        }
      }

      const stockSiteId = billSourceSiteId || currentSite.id;
      for (const item of articleItems) {
        if (!item.article_id) continue;
        await supabase.rpc('adjust_stock', {
          p_article_id: item.article_id,
          p_site_id: stockSiteId,
          p_quantity: -item.quantity,
          p_movement_type: 'sale',
          p_note: `Facture ${invNum}${isCredit ? ' (credit)' : ''}`,
        });
      }

      if (ipmBeneficiaire && ipmPartIpm > 0) {
        await supabase.from('ipm_ventes').insert({
          tenant_id: tenant.id,
          organisme_id: ipmBeneficiaire.organisme_id,
          beneficiaire_id: ipmBeneficiaire.id,
          convention_id: ipmBeneficiaire.convention_id || null,
          sale_id: sale.id,
          date_vente: new Date().toISOString().slice(0, 10),
          part_ipm: ipmPartIpm,
          part_client: ipmPartClient,
          montant_total: createSubtotal,
          taux_prise_en_charge: ipmTaux,
          montant_eligible: ipmResult?.montant_eligible || createSubtotal,
          montant_non_eligible: ipmResult?.montant_non_eligible || 0,
          plafond_applique: ipmResult?.plafond_atteint ? ipmConfig?.plafond_facture : null,
          arrondi_applique: ipmConfig?.mode_arrondi || null,
          part_beneficiaire_payee: Math.min(createTotalPaid, ipmPartClient),
          statut: 'en_attente',
          numero_ordonnance: ipmDocuments.numero_ordonnance || null,
          medecin_prescripteur: ipmDocuments.medecin || null,
          numero_bon_pec: ipmDocuments.numero_bon || null,
        });
      }

      success(`Facture ${invNum} créée${isCredit ? ' (à crédit)' : ''}${ipmBeneficiaire && ipmPartIpm > 0 ? ` · Part IPM: ${formatFCFA(ipmPartIpm)}` : ''}`);
      setPostCreation({ saleNumber: invNum, createdAt: new Date().toISOString(), createdBy: profile?.full_name || profile?.email || '' });
      setEditingInvoiceId(sale.id);
      setMode('view');
      onInvoiceCreated?.(descriptor.windowId, sale.id, invNum);
      const { data: newFull } = await supabase.from('sales').select('*, customers(name, phone, address)').eq('id', sale.id).maybeSingle();
      if (newFull) setInvoiceDetail(newFull as any);
      clearFormDraft(scope, descriptor.windowId);
      opInProgressRef.current = null;
      onSaved();
    } catch (err: any) {
      error(err.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  // ── Print ─────────────────────────────────────────────────────
  const handlePrint = () => {
    const inv = invoiceDetail || invoices.find(i => i.id === editingInvoiceId);
    if (!inv || !tenant) return;
    const pitems = items.filter(i => i.name.trim()).map(i => ({ name: i.name, supplier_ref: null, oem_ref: null, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount || 0) }));
    const psubtotal = pitems.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
    printDocumentA4({
      tenant: tenantForPrint(tenant, currentSite),
      docLabel: 'FACTURE',
      docNumber: inv.sale_number || '',
      docDate: new Date(inv.created_at).toLocaleDateString('fr-FR'),
      docCreatedAt: inv.created_at,
      customer: inv.customers ? { name: inv.customers.name, phone: (inv.customers as any).phone || undefined, address: (inv.customers as any).address || undefined } : null,
      items: pitems, subtotal: psubtotal, total: Number(inv.total),
      payments: payList.map(p => ({ method_name: p.method_name, amount: p.amount })),
      paid: Number(inv.paid),
      issuedBy: creatorName((inv as any).user_id),
      docHeader: invoiceForm.reference || invoiceForm.delivery_date || invoiceForm.warranty || invoiceForm.imei || repLabelOf(invoiceForm.representative) ? { reference: invoiceForm.reference || null, delivery_date: invoiceForm.delivery_date || null, warranty: invoiceForm.warranty || null, representative: repLabelOf(invoiceForm.representative), imei: invoiceForm.imei || null } : null,
    });
  };

  // ── Render ────────────────────────────────────────────────────
  const invForLookup = editingInvoiceId ? invoices.find(i => i.id === editingInvoiceId) : null;

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (descriptor.mode === 'create') {
      requestAnimationFrame(() => {
        const input = containerRef.current?.querySelector<HTMLInputElement>('input');
        input?.focus();
      });
    }
  }, []);

  return (
    <div ref={containerRef} className="flex flex-col h-full relative">
    {siteMismatch && (
      <>
      <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-xs text-amber-800 relative z-10">
        <Lock className="w-3.5 h-3.5 shrink-0" />
        <span className="font-medium">Ce brouillon appartient à un autre magasin. Revenez dans le magasin d'origine pour enregistrer.</span>
      </div>
      <div className="absolute inset-0 bg-white/60 z-[5] cursor-not-allowed" />
      </>
    )}
    {recoveredOp && !siteMismatch && (
      <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-start gap-2 text-xs text-amber-900 relative z-10">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-semibold">Opération interrompue par un rechargement</div>
          <div className="mt-0.5">Un enregistrement était en cours — le résultat est incertain. Vérifiez la facture avant de relancer.</div>
        </div>
        <button onClick={() => { setRecoveredOp(null); opInProgressRef.current = null; }} className="shrink-0 px-2 py-0.5 text-amber-700 hover:text-amber-900" title="J'ai vérifié">×</button>
      </div>
    )}
    <DocumentEditor
      embedded
      docType="invoice"
      mode={mode}
      articles={articles}
      customers={customers}
      headerForm={{ ...invoiceForm, valid_until: '', note: '', doc_date: invoiceForm.doc_date || '' }}
      setHeaderForm={(fn: any) => setInvoiceForm((prev: any) => {
        const next = typeof fn === 'function' ? fn(prev) : fn;
        const { valid_until: _, ...rest } = next;
        return rest;
      })}
      items={items}
      setItems={setItems}
      subtotal={subtotal}
      saving={saving}
      onSave={saveInvoice}
      onClose={onClose}
      hasPrev={navIdx > 0}
      hasNext={navIdx >= 0 && navIdx < invoices.length - 1}
      onPrev={navIdx > 0 ? () => { const prev = invoices[navIdx - 1]; if (prev) navigateToInvoice(prev); } : undefined}
      onNext={navIdx >= 0 && navIdx < invoices.length - 1 ? () => { const next = invoices[navIdx + 1]; if (next) navigateToInvoice(next); } : undefined}
      onSearchOpen={onSearchOpen}
      editingId={editingInvoiceId}
      documentNumber={invForLookup?.sale_number || undefined}
      documentStatus={invForLookup?.status || undefined}
      accountingStatus={(invForLookup as any)?.accounting_status || undefined}
      invoiceDue={editingInvoiceId ? Math.max(0, Number(invForLookup?.total || 0) - Number(invForLookup?.paid || 0)) : 0}
      docSettings={docSettings}
      autoMode={autoMode}
      onVehiclePicker={(idx: number | null) => onVehiclePicker(idx)}
      paymentMethods={paymentMethods}
      payments={payList}
      setPayments={setPayList}
      totalPaid={isCredit ? 0 : totalPaid}
      isCredit={isCredit}
      setIsCredit={setIsCredit}
      isPharmacy={isPharmacy}
      ipmLoading={ipmLoading}
      ipmBeneficiaire={ipmBeneficiaire}
      ipmTaux={ipmTaux}
      ipmConvention={ipmConvention}
      ipmPartIpm={ipmPartIpm}
      ipmPartClient={ipmPartClient}
      ipmConfig={ipmConfig}
      ipmDocuments={ipmDocuments}
      setIpmDocuments={setIpmDocuments}
      ipmDocValidation={ipmDocValidation}
      onCreateArticle={onCreateArticle}
      onCreateCustomer={onCreateCustomer}
      reps={activeReps}
      postCreation={postCreation}
      docCreatedInfo={editingInvoiceId ? (() => {
        const inv = invForLookup;
        return inv ? { createdAt: inv.created_at, createdBy: creatorName(inv.user_id) } : null;
      })() : null}
      onNewInvoice={() => {
        onOpenNew();
      }}
      onEdit={editingInvoiceId ? () => {
        setPostCreation(null);
        const inv = invoices.find(i => i.id === editingInvoiceId);
        if (!inv) return;
        (async () => {
          const [{ data: saleItems }, { data: full }] = await Promise.all([
            supabase.from('sale_items').select('*, articles(internal_ref, oem_ref, sale_price)').eq('sale_id', inv.id),
            supabase.from('sales').select('*, customers(name, phone, address)').eq('id', inv.id).maybeSingle(),
          ]);
          if (full) setInvoiceDetail(full);
          setMode('edit');
          setInvoiceForm({
            customer_id: inv.customer_id || '',
            doc_date: (inv as any).doc_header?.doc_date || new Date(inv.created_at).toISOString().slice(0, 10),
            delivery_date: (inv as any).doc_header?.delivery_date || '',
            reference: (inv as any).doc_header?.reference || '',
            warranty: (inv as any).doc_header?.warranty || '',
            representative: (inv as any).representative_id || '',
            imei: (inv as any).doc_header?.imei || '',
          });
          editingInvoicePrevRep.current = (inv as any).representative_id || null;
          setItems((saleItems || []).map((i: any) => ({
            article_id: i.article_id, name: i.name,
            quantity: Number(i.quantity), unit_price: Number(i.unit_price),
            discount: Number(i.discount || 0), total: Number(i.total),
          })));
          setPayList([]);
          setIsCredit(inv.status === 'validated' && Number(inv.paid) === 0);
        })();
      } : undefined}
      onPay={editingInvoiceId && invForLookup ? () => onOpenPay(invForLookup) : undefined}
      onCopyLink={editingInvoiceId && invForLookup ? () => onCopyLink(invForLookup) : undefined}
      onWhatsApp={editingInvoiceId && invForLookup?.customers ? () => onWhatsApp(invForLookup) : undefined}
      onCancel={editingInvoiceId && invForLookup ? () => onCancelInvoice(invForLookup) : undefined}
      onComptabiliser={editingInvoiceId && invForLookup ? () => onComptabiliser(invForLookup) : undefined}
      onPrint={editingInvoiceId ? handlePrint : undefined}
      inactive={siteMismatch}
      transformReturnLines={returnLines}
      loadReturnLines={loadReturnLines}
      onTransformToReturn={editingInvoiceId ? async (config) => {
        await onReturnTransform(config, editingInvoiceId);
      } : undefined}
    />
    </div>
  );
}
