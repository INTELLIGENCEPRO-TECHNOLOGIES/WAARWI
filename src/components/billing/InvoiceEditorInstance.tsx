import {useDocumentEditLease} from '../../lib/useDocumentEditLease';
import {useLockedInvoiceSnapshot,invoiceSnapshotForm,type InvoiceBaseline} from '../../lib/useLockedInvoiceSnapshot';
import {DocumentEditLeaseBar} from '../DocumentEditLeaseBar';
import {InvoiceEditSnapshotBar} from '../InvoiceEditSnapshotBar';
import { useSalePrice } from '../../lib/useSalePrice';
import { loadInvoiceReturnLines } from '../../lib/saleReturnLines';
import type { VatAmounts } from '../../lib/salesVat';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { loadFormDraft, clearFormDraft, saveFormDraft, scheduleSaveFormDraft, type OpInProgress } from '../../lib/draftRecovery';
import { Lock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { createDirectInvoice, trackedInvoiceItems } from '../../lib/directInvoice';
import { invoiceIpmShare, invoicePatientDue } from '../../lib/invoiceSettlement';
import { LotPickerModal, type ArticleLotSelection } from '../LotPickerModal';
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

type Invoice = VatAmounts & {
  discount?: number;
  id: string; sale_number: string; total: number; paid: number; status: string;
  ipm_patient_total?: number | null;
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
  stockMethod: string;
  onClose: () => void;
  onSaved: () => void;
  onOpenNew: () => void;
  onInvoiceCreated?: (windowId: string, invoiceId: string, saleNumber: string) => void;
  onOpenPay: (inv: Invoice) => void;
  onOpenCredit?: (inv: Invoice) => void;
  onCancelInvoice: (inv: Invoice) => void;
  onComptabiliser?: (inv: Invoice) => void;
  accountingBusy?: boolean;
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

export function InvoiceEditorInstance({ descriptor, articles, customers, invoices, paymentMethods, docSettings, autoMode, isPharmacy, activeReps, salesReps, repSettings, profileNames, billSourceSiteId, stockMethod, onClose, onSaved, onOpenNew, onInvoiceCreated, onOpenPay, onOpenCredit, onCancelInvoice, onComptabiliser, accountingBusy, onCopyLink, onWhatsApp, onReturnTransform, onSearchOpen, onVehiclePicker, onCreateArticle, onCreateCustomer }: InvoiceEditorInstanceProps) {
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
  const creationInFlight = useRef(false);
  const creationRequest = useRef(crypto.randomUUID());
  const [lotPickerOpen, setLotPickerOpen] = useState(false);
  const stockItems = useMemo(() => trackedInvoiceItems(items, articles), [items, articles]);
  const [invoiceBaseline,setInvoiceBaseline]=useState<InvoiceBaseline|null>(null);
  const originalDraft=useRef<string|null>(null);
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

  const editEnabled=recoveryChecked&&mode==='edit'&&!!editingInvoiceId&&!siteMismatch&&can('edit_invoices');
  const dirtyEdit=mode==='edit'&&originalDraft.current!==JSON.stringify([invoiceForm,items]);
  const editLease=useDocumentEditLease({tenantId:descriptor.tenantId,userId,kind:'sale',resource:editingInvoiceId||'',enabled:editEnabled,dirty:dirtyEdit,saving});
  const editSnapshot=useLockedInvoiceSnapshot({tenantId:descriptor.tenantId,saleId:editingInvoiceId,lease:editLease,enabled:editEnabled,baseline:invoiceBaseline,preserveDraft:hasRecoveredDraftRef.current,hydrate:s=>{const f=invoiceSnapshotForm(s);setInvoiceForm(f);setItems(s.items);setPayList([]);setIsCredit(s.sale.status==='validated'&&Number(s.sale.paid)===0);setInvoiceDetail((old:any)=>({...old,...s.sale}));originalDraft.current=JSON.stringify([f,s.items]);hasRecoveredDraftRef.current=false;},onBaseline:setInvoiceBaseline});
  const editBlocked=mode==='edit'&&(!editLease.held||!editSnapshot.ready);

  // ── Draft recovery: pass 1 — hydrate once from sessionStorage ──
  useEffect(() => {
    if (recoveryChecked) return;
    if (!scope.userId) return;
    const d = loadFormDraft<any>(scope, descriptor.windowId);
    if (d && d.kind === 'invoice' && d.data) {
      hasRecoveredDraftRef.current = true;
      if (d.data.invoiceBaseline?.saleId && typeof d.data.invoiceBaseline.version==='string') setInvoiceBaseline(d.data.invoiceBaseline);
      if (d.data.invoiceForm) setInvoiceForm(d.data.invoiceForm);
      if (Array.isArray(d.data.items) && d.data.items.length > 0) setItems(d.data.items);
      if (Array.isArray(d.data.payList)) setPayList(d.data.payList);
      if (typeof d.data.isCredit === 'boolean') setIsCredit(d.data.isCredit);
      if (d.data.ipmDocuments) setIpmDocuments(d.data.ipmDocuments);
      if (typeof d.data.creationRequestId === 'string') creationRequest.current = d.data.creationRequestId;
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
      data: { invoiceForm, items, payList, isCredit, ipmDocuments, editingInvoiceId, invoiceBaseline, creationRequestId: creationRequest.current },
      opInProgress: opInProgressRef.current,
    }, 400);
  }, [recoveryChecked, scope, siteMismatch, descriptor.windowId, mode, editingInvoiceId, invoiceForm, items, payList, isCredit, ipmDocuments, invoiceBaseline]);

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

  const pricing = useSalePrice(mode === 'create' ? currentSite?.id : null, items.filter(i => i.name.trim()));
  const subtotal = pricing.price?.ttc ?? subtotalRaw;
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
    if (!descriptor.invoiceId || mode==='edit') return;
    let alive=true;
    const inv = invoices.find(i => i.id === descriptor.invoiceId);
    if (!inv) return;

    (async () => {
      const [{ data: saleItems }, { data: full }] = await Promise.all([
        supabase.from('sale_items').select('*, articles(internal_ref, oem_ref, sale_price)').eq('sale_id', inv.id),
        supabase.from('sales').select('*, customers(name, phone, address)').eq('id', inv.id).maybeSingle(),
      ]);
      if(!alive)return;
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
    return()=>{alive=false;};
  }, [recoveryChecked, descriptor.invoiceId, descriptor.mode,mode]);

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
    setReturnLines([]);
    try {
      setReturnLines(await loadInvoiceReturnLines(saleId));
    } catch (failure) {
      error((failure as { message?: string }).message || 'Impossible de charger les lignes retournables.');
    }
  };

  // ── Save invoice (create + edit) ──────────────────────────────
  const saveInvoice = async (lots?: ArticleLotSelection[]) => {
    if (recoveredOp) {
      error("Un enregistrement était en cours au moment du rechargement. Vérifiez si la facture existe déjà côté serveur, puis cliquez sur « J'ai vérifié » avant de relancer.");
      return;
    }
    if (saving || creationInFlight.current) return;
    if (siteMismatch) { error('Cette facture appartient à un autre magasin. Revenez dans le magasin d\'origine pour enregistrer.'); return; }
    if (!tenant || !currentSite) { error('Magasin introuvable'); return; }
    if (!can('edit_invoices')) { error('Vous n\'avez pas la permission de créer des factures'); return; }
    const valid = items.filter(i => i.name.trim());
    if (valid.length === 0) { error('Ajoutez au moins un article'); return; }
    const nonCatalog = valid.filter(i => !i.article_id);
    if (nonCatalog.length > 0) { error(`Chaque ligne doit correspondre à un article du catalogue : ${nonCatalog.map(i => i.name).join(', ')}`); return; }

    // Edit existing invoice
    if (editingInvoiceId) {
      if(mode!=='edit'||!editLease.held||!editLease.token||!editSnapshot.ready||invoiceBaseline?.saleId!==editingInvoiceId){error('Reprenez l’accès et vérifiez la version de la facture avant de l’enregistrer.');return;}
      setSaving(true);
      opInProgressRef.current = 'save';
      saveFormDraft(scope, {
        windowId: descriptor.windowId, kind: 'invoice',
        documentId: editingInvoiceId, mode,
        data: { invoiceForm, items, payList, isCredit, ipmDocuments, editingInvoiceId, invoiceBaseline, creationRequestId: creationRequest.current },
        opInProgress: 'save',
      });
      try {
        const invRepLabel = repLabelOf(invoiceForm.representative);
        const docHeader = { doc_date: invoiceForm.doc_date || null, delivery_date: invoiceForm.delivery_date || null, reference: invoiceForm.reference || null, warranty: invoiceForm.warranty || null, representative: invRepLabel, imei: invoiceForm.imei || null };
        const editSubtotal=valid.reduce((sum,i)=>sum+Number(i.total),0);
        const editRepSnapshot=await buildRepSnapshot(invoiceForm.representative||null,valid,editSubtotal);
        const {data:result,error:rpcErr}=await supabase.rpc('save_locked_invoice_edit',{
          p_tenant_id:tenant.id,p_sale_id:editingInvoiceId,p_window_id:editLease.windowId,p_lock_token:editLease.token,p_expected_version:invoiceBaseline.version,
          p_items:valid.map(i=>({article_id:i.article_id,name:i.name,quantity:i.quantity,unit_price:i.unit_price,discount:i.discount})),
          p_customer_id:invoiceForm.customer_id||null,p_doc_header:docHeader,p_representative_id:invoiceForm.representative||null,p_rep_commission:editRepSnapshot,p_release:true,
        });
        if(rpcErr){if(rpcErr.code==='40001')editSnapshot.retry();throw rpcErr;}
        if(!(result as any)?.success)throw new Error('La facture n’a pas été modifiée.');
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

    const beneficiary = ipmBeneficiaire?.customer_id === invoiceForm.customer_id ? ipmBeneficiaire : null;
    if (beneficiary && !ipmConfig) { error('Convention IPM indisponible.'); return; }
    if (beneficiary && !ipmDocValidation.valide) {
      error(`Documents IPM manquants : ${ipmDocValidation.champs_manquants.join(', ')}`);
      return;
    }
    if (!pricing.price) {
      error(pricing.error || 'Le montant de la facture est en cours de calcul.');
      if (pricing.error) pricing.refresh();
      return;
    }
    if (beneficiary && pricing.price.enabled) {
      error('La répartition d’une facture avec TVA entre le client et l’IPM doit être validée.');
      return;
    }
    const total = pricing.price.ttc;
    const payments = isCredit ? [] : payList;
    const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (paid > (beneficiary ? total - ipmPartIpm : total)) {
      error('Le montant payé dépasse la part client.');
      return;
    }
    if (isCredit && !invoiceForm.customer_id) {
      error('Un client est requis pour une facture à crédit.');
      return;
    }
    if (stockMethod === 'lot' && stockItems.length && !lots) {
      setLotPickerOpen(true);
      return;
    }

    creationInFlight.current = true;
    setSaving(true);
    opInProgressRef.current = 'save';
    const draft = {
      windowId: descriptor.windowId,
      kind: 'invoice' as const,
      documentId: null,
      mode,
      data: { invoiceForm, items, payList, isCredit, ipmDocuments, creationRequestId: creationRequest.current },
    };
    saveFormDraft(scope, { ...draft, opInProgress: 'save' });
    try {
      const sale = await createDirectInvoice({
        tenantId: tenant.id,
        siteId: currentSite.id,
        stockSiteId: billSourceSiteId || currentSite.id,
        customerId: invoiceForm.customer_id || null,
        representativeId: invoiceForm.representative || null,
        total,
        lines: valid,
        payments,
        lots: lots ?? [],
        docHeader: {
          doc_date: invoiceForm.doc_date || null,
          delivery_date: invoiceForm.delivery_date || null,
          reference: invoiceForm.reference || null,
          warranty: invoiceForm.warranty || null,
          representative: repLabelOf(invoiceForm.representative),
          imei: invoiceForm.imei || null,
        },
        ipm: beneficiary ? {
          beneficiaryId: beneficiary.id,
          organizationName: beneficiary.ipm_organismes?.nom,
          expectedShare: ipmPartIpm,
          documents: ipmDocuments,
        } : undefined,
      }, creationRequest.current);

      clearFormDraft(scope, descriptor.windowId);
      opInProgressRef.current = null;
      setPostCreation({ saleNumber: sale.number, createdAt: new Date().toISOString(), createdBy: profile?.full_name || profile?.email || '' });
      setEditingInvoiceId(sale.id);
      setMode('view');
      onInvoiceCreated?.(descriptor.windowId, sale.id, sale.number);
      const [{ data: newFull }, { data: savedPayments }] = await Promise.all([
        supabase.from('sales').select('*, customers(name, phone, address)').eq('id', sale.id).maybeSingle(),
        supabase.from('sale_payments').select('*').eq('sale_id', sale.id),
      ]);
      if (newFull) setInvoiceDetail(newFull);
      if (savedPayments) setPayList(savedPayments.map(payment => ({
        method_id: payment.payment_method_id || '', method_name: payment.method_name,
        amount: Number(payment.amount), reference: payment.reference || '',
      })));
      success(`Facture ${sale.number} créée${isCredit ? ' (à crédit)' : ''}`);
      onSaved();
    } catch (failure: any) {
      if (failure?.code === '40001') pricing.refresh();
      opInProgressRef.current = null;
      saveFormDraft(scope, { ...draft, opInProgress: null });
      error(failure?.message || 'La facture n’a pas été enregistrée.');
    } finally {
      creationInFlight.current = false;
      setSaving(false);
    }
  };

  // ── Print ─────────────────────────────────────────────────────
  const handlePrint = () => {
    const inv = invForLookup;
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
      items: pitems, subtotal: psubtotal, discount: Number(inv.discount ?? 0), vat: inv, total: Number(inv.total),
      payments: payList.map(p => ({ method_name: p.method_name, amount: p.amount })),
      paid: Number(inv.paid),
      ipmPatientTotal: inv.ipm_patient_total,
      issuedBy: creatorName((inv as any).user_id),
      docHeader: invoiceForm.reference || invoiceForm.delivery_date || invoiceForm.warranty || invoiceForm.imei || repLabelOf(invoiceForm.representative) ? { reference: invoiceForm.reference || null, delivery_date: invoiceForm.delivery_date || null, warranty: invoiceForm.warranty || null, representative: repLabelOf(invoiceForm.representative), imei: invoiceForm.imei || null } : null,
    });
  };

  // ── Render ────────────────────────────────────────────────────
  const listedInvoice = editingInvoiceId ? invoices.find(invoice => invoice.id === editingInvoiceId) : undefined;
  const fullInvoice = editingInvoiceId && invoiceDetail?.id === editingInvoiceId ? invoiceDetail as Invoice : null;
  const invForLookup: Invoice | null = listedInvoice
    ? { ...fullInvoice, ...listedInvoice, customers: fullInvoice?.customers ?? listedInvoice.customers }
    : fullInvoice;
  const ipmShare = invForLookup ? invoiceIpmShare(invForLookup) : null;

  const listedPaid = invForLookup?.paid;
  useEffect(() => {
    if (mode !== 'view' || !editingInvoiceId || listedPaid == null) return;
    const controller = new AbortController();
    void supabase.from('sale_payments').select('*').eq('sale_id', editingInvoiceId)
      .abortSignal(controller.signal).then(({ data }) => {
        if (!data || controller.signal.aborted) return;
        setPayList(data.map(payment => ({
          method_id: payment.payment_method_id || '',
          method_name: payment.method_name,
          amount: Number(payment.amount),
          reference: '',
        })));
      });
    return () => controller.abort();
  }, [editingInvoiceId, listedPaid, mode]);


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
    <div ref={containerRef} className="flex flex-col h-full relative" onPointerDownCapture={editLease.markActivity} onKeyDownCapture={editLease.markActivity} onInputCapture={editLease.markActivity}>
    {mode==='edit'&&<div className="px-3 pt-2 shrink-0"><DocumentEditLeaseBar lease={editLease} dirty={dirtyEdit} saving={saving} label={'cette facture'} onSaveAndRelease={editSnapshot.ready?()=>void saveInvoice():undefined}/><InvoiceEditSnapshotBar state={editSnapshot}/></div>}
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
      mode={editBlocked?'view':mode}
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
      vat={pricing.price?.enabled ? { vat_net_amount: pricing.price.ht, vat_amount: pricing.price.vat } : invoiceDetail ?? undefined}
      documentTotal={pricing.price?.ttc ?? invoiceDetail?.total}
      saving={saving}
      onSave={editBlocked ? undefined : () => void saveInvoice()}
      onClose={onClose}
      hasPrev={mode==='view'&&navIdx > 0}
      hasNext={mode==='view'&&navIdx >= 0 && navIdx < invoices.length - 1}
      onPrev={mode==='view'&&navIdx > 0 ? () => { const prev = invoices[navIdx - 1]; if (prev) navigateToInvoice(prev); } : undefined}
      onNext={mode==='view'&&navIdx >= 0 && navIdx < invoices.length - 1 ? () => { const next = invoices[navIdx + 1]; if (next) navigateToInvoice(next); } : undefined}
      onSearchOpen={onSearchOpen}
      editingId={editingInvoiceId}
      documentNumber={invForLookup?.sale_number || undefined}
      documentStatus={invForLookup?.status || undefined}
      accountingStatus={(invForLookup as any)?.accounting_status || undefined}
      invoiceDue={invForLookup ? invoicePatientDue(invForLookup) : 0}
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
      ipmBeneficiaire={mode === 'create' ? ipmBeneficiaire : null}
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
      onEdit={mode==='view'&&editingInvoiceId&&can('edit_invoices') ? () => {
        setPostCreation(null);hasRecoveredDraftRef.current=false;originalDraft.current=null;setInvoiceBaseline(null);setMode('edit');
      } : undefined}
      onApplyCredit={mode === 'view' && invForLookup?.customer_id && onOpenCredit ? () => onOpenCredit(invForLookup) : undefined}
      onPay={mode==='view'&&editingInvoiceId && invForLookup ? () => onOpenPay(invForLookup) : undefined}
      onCopyLink={editingInvoiceId && invForLookup ? () => onCopyLink(invForLookup) : undefined}
      onWhatsApp={editingInvoiceId && invForLookup?.customers ? () => onWhatsApp(invForLookup) : undefined}
      onCancel={mode==='view'&&editingInvoiceId && invForLookup ? () => onCancelInvoice(invForLookup) : undefined}
      onComptabiliser={mode==='view'&&editingInvoiceId && invForLookup && onComptabiliser ? () => onComptabiliser(invForLookup) : undefined}
      accountingBusy={accountingBusy}
      onPrint={editingInvoiceId ? handlePrint : undefined}
      inactive={siteMismatch}
      transformReturnLines={returnLines}
      loadReturnLines={loadReturnLines}
      onTransformToReturn={mode==='view'&&editingInvoiceId ? async (config) => {
        await onReturnTransform(config, editingInvoiceId);
      } : undefined}
    />
    {mode === 'view' && invForLookup && ipmShare != null && (
      <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 border-t border-[var(--w-separator-l)] px-3 py-2 text-xs tabular-nums">
        <span>Part organisme à l’émission <strong>{formatFCFA(ipmShare)}</strong></span>
        <span>Part patient à l’émission <strong>{formatFCFA(Number(invForLookup.ipm_patient_total))}</strong></span>
        <span>Solde patient <strong>{formatFCFA(invoicePatientDue(invForLookup))}</strong></span>
      </div>
    )}
    <LotPickerModal
      open={lotPickerOpen}
      onClose={() => setLotPickerOpen(false)}
      items={stockItems}
      siteId={billSourceSiteId || descriptor.siteId}
      strict
      onConfirm={lots => { setLotPickerOpen(false); if (mode === 'create' && !siteMismatch) void saveInvoice(lots); }}
      title="Sélection des lots de la facture"
      confirmLabel="Confirmer et facturer"
    />
    </div>
  );
}
