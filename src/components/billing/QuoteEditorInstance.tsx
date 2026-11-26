import { useState, useEffect, useMemo, useRef } from 'react';
import { Lock, AlertTriangle, X } from 'lucide-react';
import { loadFormDraft, clearFormDraft, saveFormDraft, scheduleSaveFormDraft, type OpInProgress } from '../../lib/draftRecovery';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { usePermissions } from '../../lib/permissions';
import { useToast } from '../../context/ToastContext';
import { printDocumentA4, buildPrintTenantForSite, type PrintTenant } from '../../lib/print';
import { calculerIpm, parseConvention, type IpmArticleLine } from '../../lib/ipm';
import { type SalesRepresentative, repDisplayName } from '../../lib/repCommission';
import {useDocumentEditLease} from '../../lib/useDocumentEditLease';
import {useLockedQuoteSnapshot,quoteSnapshotForm,readQuoteActionSnapshot,type QuoteBaseline,type LockedQuoteSnapshot} from '../../lib/useLockedQuoteSnapshot';
import {DocumentEditLeaseBar} from '../DocumentEditLeaseBar';
import {InvoiceEditSnapshotBar} from '../InvoiceEditSnapshotBar';
import { DocumentEditor } from '../DocumentEditor';
import type { DocSettings } from '../DocumentSettingsTab';

type QuoteItem = {
  id?: string; article_id: string | null; name: string;
  quantity: number; unit_price: number; discount: number; total: number;
  tier_name?: string; ipm_eligible?: boolean;
};

type Quote = {
  id: string; quote_number: string; total: number; subtotal: number; discount: number;
  status: string; created_at: string; valid_until: string | null; note: string;
  converted_sale_id: string | null; customer_id: string | null;
  user_id?: string | null; representative_id?: string | null;
  customers: { name: string } | null;
  doc_header?: { doc_date?: string; delivery_date?: string; reference?: string; warranty?: string; representative?: string; imei?: string } | null;
};

export type QuoteWindowDescriptor = {
  windowId: string;
  quoteId: string | null;
  mode: 'create' | 'edit' | 'view';
  siteId: string;
  tenantId: string;
};

export type QuoteEditorInstanceProps = {
  descriptor: QuoteWindowDescriptor;
  articles: any[];
  customers: any[];
  articleTiers: { article_id: string; tier_name: string; price: number }[];
  docSettings: DocSettings;
  autoMode: boolean;
  isPharmacy: boolean;
  activeReps: SalesRepresentative[];
  profileNames: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
  onCreated: (quoteId: string, quoteNumber: string) => void;
  onConvert: (q: Quote) => void;
  onVehiclePicker: (idx: number | null) => void;
  onCreateArticle: (name: string) => void;
  onCreateCustomer: (name: string) => void;
  onTierPicker: (art: any, idx: number) => void;
};

const tenantForPrint = (t: any, site?: any): PrintTenant => buildPrintTenantForSite(t, site);
const EMPTY_ITEM: QuoteItem = { article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 };

export function QuoteEditorInstance({ descriptor, articles, customers, docSettings, autoMode, isPharmacy, activeReps, profileNames, onClose, onSaved, onCreated, onConvert, onVehiclePicker, onCreateArticle, onCreateCustomer }: QuoteEditorInstanceProps) {
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

  const [mode, setMode] = useState(descriptor.mode);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(descriptor.quoteId);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
  const [quoteForm, setQuoteForm] = useState<{
    customer_id: string; valid_until: string; note: string; doc_date: string;
    delivery_date: string; reference: string; warranty: string;
    representative: string; imei: string;
  }>({ customer_id: '', valid_until: '', note: '', doc_date: new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Dakar'}), delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
  const [items, setItems] = useState<QuoteItem[]>([{ ...EMPTY_ITEM }]);
  const [saving, setSaving] = useState(false);
  const savingRef=useRef(false);
  const [baseline,setBaseline]=useState<QuoteBaseline|null>(null);
  const originalDraft=useRef<string|null>(null);
  const [viewVersion,setViewVersion]=useState<string|null>(null);

  const [ipmBeneficiaire, setIpmBeneficiaire] = useState<any>(null);
  const [ipmConvention, setIpmConvention] = useState<any>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const siteMismatch = !!(currentSite?.id && descriptor.siteId && currentSite.id !== descriptor.siteId);

  const editEnabled=recoveryChecked&&mode==='edit'&&!!editingQuoteId&&!siteMismatch&&can('edit_quotes');
  const dirtyEdit=mode==='edit'&&originalDraft.current!==JSON.stringify([quoteForm,items]);
  const editLease=useDocumentEditLease({tenantId:descriptor.tenantId,userId,kind:'quote',resource:editingQuoteId||'',enabled:editEnabled,dirty:dirtyEdit,saving});
  const hydrateQuote=(snap:LockedQuoteSnapshot)=>{
    const f=quoteSnapshotForm(snap),lines=snap.items.map(i=>({...i,quantity:Number(i.quantity),unit_price:Number(i.unit_price),discount:Number(i.discount||0),total:Number(i.total)}));
    setQuoteForm(f);setItems(lines);setEditingQuote({...snap.quote,customers:customers.find(c=>c.id===snap.quote.customer_id)?{name:customers.find(c=>c.id===snap.quote.customer_id).name}:null} as Quote);
    originalDraft.current=JSON.stringify([f,lines]);hasRecoveredDraftRef.current=false;setViewVersion(snap.version);
  };
  const editSnapshot=useLockedQuoteSnapshot({tenantId:descriptor.tenantId,quoteId:editingQuoteId,lease:editLease,enabled:editEnabled,baseline,preserveDraft:hasRecoveredDraftRef.current,hydrate:hydrateQuote,onBaseline:setBaseline});
  const editBlocked=mode==='edit'&&(!editLease.held||!editSnapshot.ready);
  const ipmConfig = useMemo(() => parseConvention(ipmConvention), [ipmConvention]);
  const subtotal = items.reduce((s, i) => s + Number(i.total), 0);
  const ipmResult = useMemo(() => {
    if (!ipmBeneficiaire || !ipmConfig) return null;
    const lignes: IpmArticleLine[] = items.filter(i => i.name.trim()).map(i => ({
      montant_ligne: Number(i.total), ipm_eligible: i.ipm_eligible !== false,
    }));
    return calculerIpm(ipmConfig, lignes, 0);
  }, [ipmBeneficiaire, ipmConfig, items]);
  const ipmPartIpm = ipmResult?.part_ipm || 0;
  const ipmTaux = ipmConfig?.taux_defaut || 0;
  const ipmPartClient = ipmBeneficiaire ? subtotal - ipmPartIpm : subtotal;

  const creatorName = (uid: string | null | undefined) =>
    uid ? (profileNames[uid] || 'Utilisateur') : '';

  const repLabelOf = (repId: string | undefined | null) => {
    if (!repId) return null;
    const r = activeReps.find(rp => rp.id === repId);
    return r ? repDisplayName(r) : null;
  };

  // Draft recovery: pass 1 — hydrate once from sessionStorage
  useEffect(() => {
    if (recoveryChecked) return;
    if (!scope.userId) return;
    const d = loadFormDraft<any>(scope, descriptor.windowId);
    if (d && d.kind === 'quote' && d.data) {
      hasRecoveredDraftRef.current = true;
      if(d.data.baseline?.quoteId&&typeof d.data.baseline.version==='string')setBaseline(d.data.baseline);
      if (d.data.quoteForm) setQuoteForm(d.data.quoteForm);
      if (Array.isArray(d.data.items) && d.data.items.length > 0) setItems(d.data.items);
      if (d.mode) setMode(d.mode as any);
      if (d.documentId && !editingQuoteId) setEditingQuoteId(d.documentId);
      if (d.opInProgress) { setRecoveredOp(d.opInProgress); opInProgressRef.current = d.opInProgress; }
    }
    setRecoveryChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.userId, scope.tenantId, scope.siteId]);

  // Debounced draft save on any editable change
  useEffect(() => {
    if (!recoveryChecked || !scope.userId) return;
    if (siteMismatch) return;
    scheduleSaveFormDraft(scope, {
      windowId: descriptor.windowId,
      kind: 'quote',
      documentId: editingQuoteId,
      mode,
      data: { quoteForm, items, editingQuoteId, baseline },
      opInProgress: opInProgressRef.current,
    }, 400);
  }, [recoveryChecked, scope, siteMismatch, descriptor.windowId, mode, editingQuoteId, quoteForm, items, baseline]);

  // Load existing quote data on mount
  useEffect(() => {
    if (!recoveryChecked || mode==='edit') return;
    const targetId = editingQuoteId || descriptor.quoteId;
    if (!targetId) return;
    let cancelled = false;
    (async () => {
      if(can('edit_quotes')&&!siteMismatch){try{const snap=await readQuoteActionSnapshot(descriptor.tenantId,targetId);if(!cancelled){hydrateQuote(snap);setBaseline({quoteId:targetId,version:snap.version});}return;}catch{/* lecture ordinaire, aucune action de statut sans version */}}
      const [{ data: q }, { data: qItems }] = await Promise.all([
        supabase.from('quotes').select('*, customers(name)').eq('id', targetId).maybeSingle(),
        supabase.from('quote_items').select('*, articles(internal_ref, oem_ref, sale_price)').eq('quote_id', targetId),
      ]);
      if (cancelled || !q) return;
      setEditingQuote(q as Quote);
      if (!hasRecoveredDraftRef.current) {
        setQuoteForm({
          customer_id: q.customer_id || '', valid_until: q.valid_until || '', note: q.note || '', doc_date: q.doc_header?.doc_date || new Date(q.created_at).toLocaleDateString('sv-SE',{timeZone:'Africa/Dakar'}),
          delivery_date: q.doc_header?.delivery_date || '', reference: q.doc_header?.reference || '',
          warranty: q.doc_header?.warranty || '', representative: (q as any).representative_id || '',
          imei: q.doc_header?.imei || '',
        });
        setItems((qItems || []).map((i: any) => ({
          article_id: i.article_id, name: i.name,
          quantity: Number(i.quantity), unit_price: Number(i.unit_price),
          discount: Number(i.discount || 0), total: Number(i.total),
        })));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveryChecked, descriptor.quoteId, editingQuoteId, mode]);

  // Auto-focus first input on create
  useEffect(() => {
    if (descriptor.mode === 'create') {
      requestAnimationFrame(() => {
        containerRef.current?.querySelector<HTMLInputElement>('input')?.focus();
      });
    }
  }, []);

  // IPM lookup on customer change
  useEffect(() => {
    if (!isPharmacy || !quoteForm.customer_id || !tenant) {
      setIpmBeneficiaire(null); setIpmConvention(null); return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('ipm_beneficiaires')
        .select('*, ipm_organismes(nom), ipm_conventions(nom, taux_defaut, plafond_facture, mode_calcul, mode_arrondi, application_plafond, ordonnance_obligatoire, bon_prise_en_charge_obligatoire, numero_bon_obligatoire, numero_ordonnance_obligatoire, medecin_prescripteur_obligatoire, matricule_obligatoire)')
        .eq('tenant_id', tenant.id)
        .eq('customer_id', quoteForm.customer_id)
        .eq('statut', 'actif')
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data) { setIpmBeneficiaire(data); setIpmConvention(data.ipm_conventions); }
      else { setIpmBeneficiaire(null); setIpmConvention(null); }
    })();
    return () => { cancelled = true; };
  }, [isPharmacy, quoteForm.customer_id, tenant?.id]);

  // ── Item helpers ──────────────────────────────────────────
  

  

  // ── Save ──────────────────────────────────────────────────
  const saveQuote = async (opts?: { silent?: boolean }) => {
    if (recoveredOp) {
      error("Un enregistrement était en cours au moment du rechargement. Vérifiez le devis côté serveur puis cliquez sur « J'ai vérifié » avant de relancer.");
      return;
    }
    if (savingRef.current||saving) return;
    if (!tenant || !currentSite) { if (!opts?.silent) error('Magasin introuvable'); return; }
    if (siteMismatch) { if (!opts?.silent) error('Ce devis appartient à un autre magasin'); return; }
    if (!can(editingQuoteId?'edit_quotes':'create_quotes')) { if (!opts?.silent) error('Vous n\'avez pas la permission de créer des devis'); return; }
    if (items.every(i => !i.name.trim())) { if (!opts?.silent) error('Ajoutez au moins un article'); return; }
    if(editingQuoteId&&(!editLease.held||!editLease.token||!editSnapshot.ready||baseline?.quoteId!==editingQuoteId)){error('Reprenez l’accès et vérifiez la version du devis.');return;}
    savingRef.current=true;setSaving(true);
    const valid = items.filter(i => i.name.trim());
    const st = valid.reduce((s, i) => s + Number(i.total), 0);
    const quoteRepLabel = repLabelOf(quoteForm.representative);
    const docHeader = (quoteForm.doc_date || quoteForm.delivery_date || quoteForm.reference || quoteForm.warranty || quoteRepLabel || quoteForm.imei)
      ? { doc_date: quoteForm.doc_date || null, delivery_date: quoteForm.delivery_date || null, reference: quoteForm.reference || null, warranty: quoteForm.warranty || null, representative: quoteRepLabel, imei: quoteForm.imei || null }
      : null;

    opInProgressRef.current = 'save';
    saveFormDraft(scope, {
      windowId: descriptor.windowId, kind: 'quote',
      documentId: editingQuoteId, mode,
      data: { quoteForm, items, editingQuoteId, baseline },
      opInProgress: 'save',
    });
    if (editingQuoteId) {
      try{
        const {data,error:e}=await supabase.rpc('save_locked_quote_edit',{p_tenant_id:tenant.id,p_quote_id:editingQuoteId,p_window_id:editLease.windowId,p_lock_token:editLease.token,p_expected_version:baseline!.version,p_items:valid.map(i=>({article_id:i.article_id,name:i.name,quantity:i.quantity,unit_price:i.unit_price,discount:i.discount})),p_customer_id:quoteForm.customer_id||null,p_valid_until:quoteForm.valid_until||null,p_note:quoteForm.note,p_doc_header:docHeader,p_representative_id:quoteForm.representative||null,p_release:!opts?.silent});
        if(e){if(e.code==='40001')editSnapshot.retry();throw e;}
        const snap=data as LockedQuoteSnapshot&{success:boolean};
        if(!snap?.success)throw new Error('Le devis n’a pas été enregistré.');
        hydrateQuote(snap);setBaseline({quoteId:editingQuoteId,version:snap.version});
        opInProgressRef.current=null;clearFormDraft(scope,descriptor.windowId);
        if(!opts?.silent){success('Devis mis à jour');onSaved();onClose();}
      }catch(e){opInProgressRef.current=null;error(e&&typeof e==='object'&&'message' in e?String(e.message):'Enregistrement impossible.');}
      finally{savingRef.current=false;setSaving(false);}
    } else {
      const { data: numData } = await supabase.rpc('next_doc_number', {
        p_tenant_id: tenant.id, p_kind: 'quote', p_prefix: 'DEV',
      });
      const qNum = (numData as string) || ('DEV-' + Date.now());
      const { data: q, error: e } = await supabase.from('quotes').insert({
        tenant_id: tenant.id, site_id: descriptor.siteId,
        customer_id: quoteForm.customer_id || null,
        quote_number: qNum, subtotal: st, discount: 0, total: st,
        valid_until: quoteForm.valid_until || null, note: quoteForm.note, status: 'draft',
        user_id: profile?.id || null,
        representative_id: quoteForm.representative || null,
        doc_header: docHeader,
      }).select().single();
      if (e || !q) { error(e?.message || 'Erreur'); savingRef.current=false;setSaving(false); return; }
      await supabase.from('quote_items').insert(valid.map(i => ({ tenant_id: tenant.id, quote_id: q.id, article_id: i.article_id, name: i.name, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount, total: i.total })));
      setEditingQuoteId(q.id);
      setEditingQuote(q as Quote);
      savingRef.current=false;setSaving(false);
      opInProgressRef.current = null;
      clearFormDraft(scope, descriptor.windowId);
      if (!opts?.silent) {
        success('Devis créé');
        setMode('view');
        onCreated(q.id, qNum);
        onSaved();
      }
    }
  };

  const changeStatus = async(status:string)=>{
    if(!editingQuote||!tenant||!can('edit_quotes')||siteMismatch||savingRef.current)return;
    if(mode==='edit'&&(!editSnapshot.ready||!editLease.held||dirtyEdit)){error('Enregistrez le devis avant de changer son statut.');return;}
    const version=mode==='edit'?baseline?.version:viewVersion;
    if(!version){error('Rechargez le devis avant de changer son statut.');return;}
    savingRef.current=true;setSaving(true);
    try{
      const {data,error:e}=await supabase.rpc('change_locked_quote_status',{p_tenant_id:tenant.id,p_quote_id:editingQuote.id,p_expected_version:version,p_status:status,...(mode==='edit'?{p_window_id:editLease.windowId,p_lock_token:editLease.token}:{})});
      if(e){if(e.code==='40001'&&mode==='edit')editSnapshot.retry();throw e;}
      const snap=data as LockedQuoteSnapshot;
      hydrateQuote(snap);setBaseline({quoteId:editingQuote.id,version:snap.version});
      if(status==='accepted'||status==='rejected')setMode('view');
      success('Statut mis à jour');onSaved();
    }catch(e){error(e&&typeof e==='object'&&'message' in e?String(e.message):'Changement impossible.');}
    finally{savingRef.current=false;setSaving(false);}
  };

  const handleConvert = () => {
    if (!editingQuote) return;
    if (siteMismatch) { error('Ce devis appartient à un autre magasin'); return; }
    onConvert(editingQuote);
  };

  const handlePrint = () => {
    if (!editingQuote || !tenant) return;
    const pitems = items.filter(i => i.name.trim()).map(i => ({
      name: i.name, supplier_ref: null, oem_ref: null,
      quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount || 0),
    }));
    const psubtotal = pitems.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
    printDocumentA4({
      tenant: tenantForPrint(tenant, currentSite),
      docLabel: 'DEVIS',
      docNumber: editingQuote.quote_number || 'Brouillon',
      docDate: new Date(editingQuote.created_at).toLocaleDateString('fr-FR'),
      docCreatedAt: editingQuote.created_at,
      customer: editingQuote.customers ? { name: editingQuote.customers.name } : null,
      items: pitems, subtotal: psubtotal, total: psubtotal,
      payments: [], paid: 0,
      issuedBy: creatorName((editingQuote as any).user_id),
      docHeader: quoteForm.reference || quoteForm.delivery_date || quoteForm.warranty || repLabelOf(quoteForm.representative)
        ? { reference: quoteForm.reference || null, delivery_date: quoteForm.delivery_date || null, warranty: quoteForm.warranty || null, representative: repLabelOf(quoteForm.representative) }
        : null,
    });
  };

  const openForEdit = () => {
    if (!editingQuote||!can('edit_quotes')||!['draft','sent'].includes(editingQuote.status)) return;
    setBaseline(null);originalDraft.current=null;hasRecoveredDraftRef.current=false;setMode('edit');
  };

  // ── Tier picker callback ──────────────────────────────────
  

  // ── Vehicle picker callback ───────────────────────────────
  

  // Expose helpers to parent via ref-like pattern not needed — parent uses callbacks

  return (
    <div ref={containerRef} className="flex flex-col h-full relative" onPointerDownCapture={editLease.markActivity} onKeyDownCapture={editLease.markActivity} onInputCapture={editLease.markActivity}>
      {mode==='edit'&&<div className="px-3 pt-2 shrink-0"><DocumentEditLeaseBar lease={editLease} dirty={dirtyEdit} saving={saving} label="ce devis" onSaveAndRelease={editSnapshot.ready?()=>void saveQuote():undefined}/><InvoiceEditSnapshotBar state={editSnapshot} document="devis"/></div>}
      {siteMismatch && (
        <>
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-xs text-amber-800 relative z-10">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            <span className="font-medium">Ce devis appartient à un autre magasin. Revenez dans le magasin d'origine pour modifier.</span>
          </div>
          <div className="absolute inset-0 bg-white/60 z-[5] cursor-not-allowed" />
        </>
      )}
      {recoveredOp && !siteMismatch && (
        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-start gap-2 text-xs text-amber-900 relative z-10">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold">Opération interrompue par un rechargement</div>
            <div className="mt-0.5">Un enregistrement était en cours — le résultat est incertain. Vérifiez le devis avant de relancer.</div>
          </div>
          <button onClick={() => { setRecoveredOp(null); opInProgressRef.current = null; }} className="shrink-0 p-1 text-amber-700 hover:text-amber-900" title="J'ai vérifié"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
      <DocumentEditor
        embedded
        docType="quote"
        mode={editBlocked?'view':mode}
        articles={articles}
        customers={customers}
        headerForm={{ doc_date: quoteForm.doc_date || '', customer_id: quoteForm.customer_id, note: quoteForm.note, delivery_date: quoteForm.delivery_date, reference: quoteForm.reference, warranty: quoteForm.warranty, representative: quoteForm.representative, imei: quoteForm.imei, valid_until: quoteForm.valid_until }}
        setHeaderForm={(fn: any) => setQuoteForm((prev: any) => typeof fn === 'function' ? fn(prev) : fn)}
        items={items}
        setItems={setItems}
        subtotal={subtotal}
        saving={saving}
        onSave={editBlocked?undefined:saveQuote}
        onClose={onClose}
        inactive={siteMismatch}
        editingId={editingQuoteId}
        documentNumber={editingQuote?.quote_number}
        documentStatus={editingQuote?.status}
        docSettings={docSettings}
        autoMode={autoMode}
        onVehiclePicker={onVehiclePicker}
        onChangeStatus={!saving&&can('edit_quotes')&&(mode==='edit'?editSnapshot.ready&&!dirtyEdit:!!viewVersion)?changeStatus:undefined}
        onConvert={mode==='view'?handleConvert:undefined}
        isPharmacy={isPharmacy}
        ipmBeneficiaire={ipmBeneficiaire}
        ipmTaux={ipmTaux}
        ipmPartIpm={ipmPartIpm}
        ipmPartClient={ipmPartClient}
        onPrint={editingQuoteId ? handlePrint : undefined}
        onCreateArticle={onCreateArticle}
        onCreateCustomer={onCreateCustomer}
        reps={activeReps}
        onEdit={editingQuote && mode === 'view'&&can('edit_quotes')&&['draft','sent'].includes(editingQuote.status) ? openForEdit : undefined}
      />
    </div>
  );
}
