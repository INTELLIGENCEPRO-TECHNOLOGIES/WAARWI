import { useState, useEffect, useMemo, useRef } from 'react';
import { Lock, AlertTriangle, X } from 'lucide-react';
import { loadFormDraft, clearFormDraft, saveFormDraft, scheduleSaveFormDraft, type OpInProgress } from '../../lib/draftRecovery';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { usePermissions } from '../../lib/permissions';
import { useToast } from '../../context/ToastContext';
import { formatFCFA } from '../../lib/format';
import { printDocumentA4, buildPrintTenantForSite, type PrintTenant } from '../../lib/print';
import { calculerIpm, parseConvention, type IpmArticleLine } from '../../lib/ipm';
import { type SalesRepresentative, repDisplayName } from '../../lib/repCommission';
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
  doc_header?: { delivery_date?: string; reference?: string; warranty?: string; representative?: string; imei?: string } | null;
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
  onConvert: (q: Quote) => void;
  onVehiclePicker: (idx: number | null) => void;
  onCreateArticle: (name: string) => void;
  onCreateCustomer: (name: string) => void;
  onTierPicker: (art: any, idx: number) => void;
};

const tenantForPrint = (t: any, site?: any): PrintTenant => buildPrintTenantForSite(t, site);
const EMPTY_ITEM: QuoteItem = { article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 };

export function QuoteEditorInstance({
  descriptor, articles, customers, articleTiers,
  docSettings, autoMode, isPharmacy, activeReps, profileNames,
  onClose, onSaved, onConvert,
  onVehiclePicker, onCreateArticle, onCreateCustomer, onTierPicker,
}: QuoteEditorInstanceProps) {
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
    customer_id: string; valid_until: string; note: string;
    delivery_date: string; reference: string; warranty: string;
    representative: string; imei: string;
  }>({ customer_id: '', valid_until: '', note: '', delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
  const [items, setItems] = useState<QuoteItem[]>([{ ...EMPTY_ITEM }]);
  const [saving, setSaving] = useState(false);

  const [ipmBeneficiaire, setIpmBeneficiaire] = useState<any>(null);
  const [ipmConvention, setIpmConvention] = useState<any>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const siteMismatch = !!(currentSite?.id && descriptor.siteId && currentSite.id !== descriptor.siteId);

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
      data: { quoteForm, items, editingQuoteId },
      opInProgress: opInProgressRef.current,
    }, 400);
  }, [recoveryChecked, scope, siteMismatch, descriptor.windowId, mode, editingQuoteId, quoteForm, items]);

  // Load existing quote data on mount
  useEffect(() => {
    if (!recoveryChecked) return;
    const targetId = editingQuoteId || descriptor.quoteId;
    if (!targetId) return;
    let cancelled = false;
    (async () => {
      const [{ data: q }, { data: qItems }] = await Promise.all([
        supabase.from('quotes').select('*, customers(name)').eq('id', targetId).maybeSingle(),
        supabase.from('quote_items').select('*, articles(internal_ref, oem_ref, sale_price)').eq('quote_id', targetId),
      ]);
      if (cancelled || !q) return;
      setEditingQuote(q as Quote);
      if (!hasRecoveredDraftRef.current) {
        setQuoteForm({
          customer_id: q.customer_id || '', valid_until: q.valid_until || '', note: q.note || '',
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
  }, [recoveryChecked, descriptor.quoteId]);

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
  const updateItem = (idx: number, field: keyof QuoteItem, val: any) => {
    if (field === 'article_id') {
      const art = articles.find((a: any) => a.id === val);
      if (art) {
        const tiers = articleTiers.filter(t => t.article_id === val);
        if (tiers.length > 1) {
          setItems(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], article_id: val, name: art.name };
            if (!Number(next[idx].quantity) || Number(next[idx].quantity) < 1) next[idx].quantity = 1;
            return next;
          });
          onTierPicker(art, idx);
          return;
        }
      }
    }
    setItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      if (field === 'article_id') {
        const art = articles.find((a: any) => a.id === val);
        if (art) {
          next[idx].name = art.name;
          next[idx].ipm_eligible = (art as any).ipm_eligible !== false;
          const tiers = articleTiers.filter(t => t.article_id === val);
          next[idx].unit_price = tiers.length === 1 ? tiers[0].price : art.sale_price;
          next[idx].tier_name = tiers.length === 1 ? tiers[0].tier_name : undefined;
          if (!Number(next[idx].quantity) || Number(next[idx].quantity) < 1) next[idx].quantity = 1;
        }
      }
      const it = next[idx];
      next[idx].total = Math.max(0, Number(it.quantity || 0) * Number(it.unit_price || 0) - Number(it.discount || 0));
      return next;
    });
  };

  const finalizeItem = (idx: number, field: 'quantity' | 'unit_price' | 'discount') => {
    setItems(prev => {
      const next = [...prev];
      if (field === 'quantity' && (!Number(next[idx].quantity) || Number(next[idx].quantity) < 1)) next[idx].quantity = 1;
      if (field === 'unit_price' && (!Number(next[idx].unit_price) || Number(next[idx].unit_price) < 0)) next[idx].unit_price = 0;
      if (field === 'discount' && (!Number(next[idx].discount) || Number(next[idx].discount) < 0)) next[idx].discount = 0;
      const it = next[idx];
      next[idx].total = Math.max(0, Number(it.quantity || 0) * Number(it.unit_price || 0) - Number(it.discount || 0));
      return next;
    });
  };

  // ── Save ──────────────────────────────────────────────────
  const saveQuote = async (opts?: { silent?: boolean }) => {
    if (recoveredOp) {
      error("Un enregistrement était en cours au moment du rechargement. Vérifiez le devis côté serveur puis cliquez sur « J'ai vérifié » avant de relancer.");
      return;
    }
    if (saving) return;
    if (!tenant || !currentSite) { if (!opts?.silent) error('Magasin introuvable'); return; }
    if (siteMismatch) { if (!opts?.silent) error('Ce devis appartient à un autre magasin'); return; }
    if (!can('create_quotes')) { if (!opts?.silent) error('Vous n\'avez pas la permission de créer des devis'); return; }
    if (items.every(i => !i.name.trim())) { if (!opts?.silent) error('Ajoutez au moins un article'); return; }
    setSaving(true);
    const valid = items.filter(i => i.name.trim());
    const st = valid.reduce((s, i) => s + Number(i.total), 0);
    const quoteRepLabel = repLabelOf(quoteForm.representative);
    const docHeader = (quoteForm.delivery_date || quoteForm.reference || quoteForm.warranty || quoteRepLabel || quoteForm.imei)
      ? { delivery_date: quoteForm.delivery_date || null, reference: quoteForm.reference || null, warranty: quoteForm.warranty || null, representative: quoteRepLabel, imei: quoteForm.imei || null }
      : null;

    opInProgressRef.current = 'save';
    saveFormDraft(scope, {
      windowId: descriptor.windowId, kind: 'quote',
      documentId: editingQuoteId, mode,
      data: { quoteForm, items, editingQuoteId },
      opInProgress: 'save',
    });
    if (editingQuoteId) {
      const prevRepId = (editingQuote as any)?.representative_id || null;
      await supabase.from('quotes').update({
        customer_id: quoteForm.customer_id || null,
        subtotal: st, discount: 0, total: st,
        valid_until: quoteForm.valid_until || null, note: quoteForm.note,
        representative_id: quoteForm.representative || null,
        doc_header: docHeader,
      }).eq('id', editingQuoteId).eq('tenant_id', descriptor.tenantId).eq('site_id', descriptor.siteId);
      if (prevRepId !== (quoteForm.representative || null)) {
        await supabase.from('audit_logs').insert({
          tenant_id: tenant.id, user_id: profile?.id || null,
          action: 'representative_change', module: 'billing', reference_id: editingQuoteId,
          old_value: { representative_id: prevRepId }, new_value: { representative_id: quoteForm.representative || null },
        });
      }
      await supabase.from('quote_items').delete().eq('quote_id', editingQuoteId);
      await supabase.from('quote_items').insert(valid.map(i => ({ tenant_id: tenant.id, quote_id: editingQuoteId, article_id: i.article_id, name: i.name, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount, total: i.total })));
      setSaving(false);
      opInProgressRef.current = null;
      clearFormDraft(scope, descriptor.windowId);
      if (!opts?.silent) { success('Devis mis à jour'); onSaved(); onClose(); }
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
      if (e || !q) { error(e?.message || 'Erreur'); setSaving(false); return; }
      await supabase.from('quote_items').insert(valid.map(i => ({ tenant_id: tenant.id, quote_id: q.id, article_id: i.article_id, name: i.name, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount, total: i.total })));
      setEditingQuoteId(q.id);
      setEditingQuote(q as Quote);
      setSaving(false);
      opInProgressRef.current = null;
      clearFormDraft(scope, descriptor.windowId);
      if (!opts?.silent) { success('Devis créé'); onSaved(); onClose(); }
    }
  };

  const changeStatus = async (status: string) => {
    if (!editingQuote) return;
    if (!can('edit_quotes')) { error('Vous n\'avez pas la permission de modifier les devis'); return; }
    if (siteMismatch) { error('Ce devis appartient à un autre magasin'); return; }
    await supabase.from('quotes').update({ status }).eq('id', editingQuote.id);
    success('Statut mis à jour');
    setEditingQuote({ ...editingQuote, status });
    onSaved();
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
    if (!editingQuote) return;
    setMode('edit');
  };

  // ── Tier picker callback ──────────────────────────────────
  const applyTier = (tierName: string, tierPrice: number, idx: number) => {
    setItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], unit_price: tierPrice, tier_name: tierName || undefined };
      next[idx].total = Math.max(0, Number(next[idx].quantity || 1) * tierPrice - Number(next[idx].discount || 0));
      return next;
    });
  };

  // ── Vehicle picker callback ───────────────────────────────
  const applyVehicleArticle = (art: any) => {
    setItems(p => [...p, { article_id: art.id, name: art.name, quantity: 1, unit_price: art.sale_price, discount: 0, total: art.sale_price }]);
  };

  // Expose helpers to parent via ref-like pattern not needed — parent uses callbacks

  return (
    <div ref={containerRef} className="flex flex-col h-full relative">
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
        mode={mode}
        articles={articles}
        customers={customers}
        headerForm={{ customer_id: quoteForm.customer_id, note: quoteForm.note, delivery_date: quoteForm.delivery_date, reference: quoteForm.reference, warranty: quoteForm.warranty, representative: quoteForm.representative, imei: quoteForm.imei, valid_until: quoteForm.valid_until }}
        setHeaderForm={(fn: any) => setQuoteForm((prev: any) => typeof fn === 'function' ? fn(prev) : fn)}
        items={items}
        setItems={setItems}
        subtotal={subtotal}
        saving={saving}
        onSave={saveQuote}
        onClose={onClose}
        inactive={siteMismatch}
        editingId={editingQuoteId}
        documentNumber={editingQuote?.quote_number}
        documentStatus={editingQuote?.status}
        docSettings={docSettings}
        autoMode={autoMode}
        onVehiclePicker={onVehiclePicker}
        onChangeStatus={changeStatus}
        onConvert={handleConvert}
        isPharmacy={isPharmacy}
        ipmBeneficiaire={ipmBeneficiaire}
        ipmTaux={ipmTaux}
        ipmPartIpm={ipmPartIpm}
        ipmPartClient={ipmPartClient}
        onPrint={editingQuoteId ? handlePrint : undefined}
        onCreateArticle={onCreateArticle}
        onCreateCustomer={onCreateCustomer}
        reps={activeReps}
        onEdit={editingQuote && mode === 'view' ? openForEdit : undefined}
      />
    </div>
  );
}
