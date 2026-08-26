import { useEffect, useState, useCallback } from 'react';
import {
  Loader2, ChevronUp, ChevronDown, Eye, EyeOff, Lock,
  Save, Check, GripVertical, Pencil, Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';

export type DocType = 'invoice' | 'quote' | 'supplier_order' | 'credit_note';

export type DocColumn = {
  key: 'article' | 'designation' | 'qty' | 'unit_price' | 'discount' | 'total';
  label: string;
  visible: boolean;
  order: number;
  width: string;
  align: 'left' | 'center' | 'right';
  required?: boolean;
};

export type DocSettings = {
  show_delivery_date: boolean;
  show_reference: boolean;
  show_warranty: boolean;
  show_imei: boolean;
  show_representative: boolean;
  default_representative: string;
  warranty_terms: string;
  require_header_lock: boolean;
  allow_edit: boolean;
  allow_delete: boolean;
  columns_config: DocColumn[];
};

export const DEFAULT_COLUMNS: DocColumn[] = [
  { key: 'article',     label: 'Article',      visible: true, order: 0, width: '1fr',   align: 'left',    required: true },
  { key: 'designation', label: 'Désignation',   visible: true, order: 1, width: '1.2fr', align: 'left' },
  { key: 'qty',         label: 'Qté',           visible: true, order: 2, width: '80px',  align: 'center' },
  { key: 'unit_price',  label: 'Prix unit.',     visible: true, order: 3, width: '120px', align: 'right' },
  { key: 'discount',    label: 'Remise',         visible: true, order: 4, width: '100px', align: 'right' },
  { key: 'total',       label: 'Total',          visible: true, order: 5, width: '80px',  align: 'right',   required: true },
];

export const DEFAULT_DOC_SETTINGS: DocSettings = {
  show_delivery_date:  false,
  show_reference:      false,
  show_warranty:       false,
  show_imei:           false,
  show_representative: false,
  default_representative: '',
  warranty_terms: '',
  require_header_lock: false,
  allow_edit:          false,
  allow_delete:        false,
  columns_config:      DEFAULT_COLUMNS,
};

export function mergeColumns(stored: DocColumn[]): DocColumn[] {
  if (!stored || stored.length === 0) return [...DEFAULT_COLUMNS];
  return DEFAULT_COLUMNS.map(def => {
    const found = stored.find(s => s.key === def.key);
    if (!found) return def;
    return { ...def, visible: def.required ? true : found.visible, order: found.order };
  }).sort((a, b) => a.order - b.order);
}

const DOC_TYPES: { key: DocType; label: string }[] = [
  { key: 'invoice',        label: 'Facture' },
  { key: 'quote',          label: 'Devis' },
  { key: 'supplier_order', label: 'Cmd. fournisseur' },
  { key: 'credit_note',    label: 'Avoir' },
];

const FIELD_META = [
  { key: 'show_delivery_date' as const, label: 'Date de livraison', sub: 'Date de livraison prévue' },
  { key: 'show_reference'     as const, label: 'Référence',         sub: 'Réf. commande / dossier' },
  { key: 'show_warranty'      as const, label: 'Garantie',          sub: 'Conditions de garantie' },
  { key: 'show_imei'          as const, label: 'IMEI / Téléphone',  sub: 'Numéro IMEI ou série' },
  { key: 'show_representative' as const, label: 'Représentant',     sub: 'Commercial en charge' },
];

const IMEI_ACTIVITY_TYPES = ['électroménager', 'electromenager', 'smartphones et accessoires', 'smartphones'];

export function DocumentSettingsTab() {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const [docType, setDocType] = useState<DocType>('invoice');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<DocSettings>(DEFAULT_DOC_SETTINGS);

  const activityName = (tenant?.business_activity_type_name || '').toLowerCase().trim();
  const showImeiFields = IMEI_ACTIVITY_TYPES.some(t => activityName.includes(t));

  const loadSettings = useCallback(async (type: DocType) => {
    if (!tenant) return;
    setLoading(true);
    const { data } = await supabase
      .from('document_settings')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('doc_type', type)
      .maybeSingle();
    if (data) {
      setSettings({
        show_delivery_date:  data.show_delivery_date  ?? false,
        show_reference:      data.show_reference      ?? false,
        show_warranty:       data.show_warranty       ?? false,
        show_imei:           data.show_imei           ?? false,
        show_representative: data.show_representative ?? false,
        default_representative: data.default_representative ?? '',
        warranty_terms: data.warranty_terms ?? '',
        require_header_lock: data.require_header_lock ?? false,
        allow_edit:          data.allow_edit          ?? false,
        allow_delete:        data.allow_delete        ?? false,
        columns_config:      mergeColumns(data.columns_config ?? []),
      });
    } else {
      setSettings(DEFAULT_DOC_SETTINGS);
    }
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { loadSettings(docType); }, [docType, loadSettings]);

  const save = useCallback(async (s: DocSettings) => {
    if (!tenant) return;
    setSaving(true);
    const { error: e } = await supabase
      .from('document_settings')
      .upsert({
        tenant_id:           tenant.id,
        doc_type:            docType,
        show_delivery_date:  s.show_delivery_date,
        show_reference:      s.show_reference,
        show_warranty:       s.show_warranty,
        show_imei:           s.show_imei,
        show_representative: s.show_representative,
        default_representative: s.default_representative,
        warranty_terms:      s.warranty_terms,
        require_header_lock: s.require_header_lock,
        allow_edit:          s.allow_edit,
        allow_delete:        s.allow_delete,
        columns_config:      s.columns_config,
        updated_at:          new Date().toISOString(),
      }, { onConflict: 'tenant_id,doc_type' });
    setSaving(false);
    if (e) { error(e.message); return; }
    success('Paramètres enregistrés');
  }, [tenant?.id, docType]);

  const set = (patch: Partial<DocSettings>) => setSettings(prev => ({ ...prev, ...patch }));

  const toggleCol = (key: DocColumn['key']) => {
    setSettings(prev => ({
      ...prev,
      columns_config: prev.columns_config.map(c =>
        c.key === key ? { ...c, visible: c.required ? true : !c.visible } : c
      ),
    }));
  };

  const moveCol = (key: DocColumn['key'], dir: -1 | 1) => {
    setSettings(prev => {
      const cols = [...prev.columns_config].sort((a, b) => a.order - b.order);
      const idx = cols.findIndex(c => c.key === key);
      const target = idx + dir;
      if (target < 0 || target >= cols.length) return prev;
      [cols[idx].order, cols[target].order] = [cols[target].order, cols[idx].order];
      return { ...prev, columns_config: cols.sort((a, b) => a.order - b.order) };
    });
  };

  const sortedCols = [...settings.columns_config].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-0">
      {/* Doc type tabs */}
      <div className="flex gap-0 border-b border-neutral-200 -mx-1 overflow-x-auto scrollbar-hide">
        {DOC_TYPES.map(dt => {
          const active = docType === dt.key;
          return (
            <button
              key={dt.key}
              onClick={() => { if (!active) setDocType(dt.key); }}
              className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors relative ${active ? 'text-neutral-900' : 'text-neutral-400 hover:text-neutral-600'}`}
            >
              {dt.label}
              {active && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-neutral-900 rounded-full" />}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-neutral-300" /></div>
      ) : (
        <div className="space-y-0 flat-form">
          {/* Header fields */}
          <div className="py-4 border-b border-neutral-200">
            <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1">Champs d'en-tête</h3>
            <p className="text-[10px] text-neutral-500 mb-3">Champs proposés à la saisie et visibles sur le document.</p>
            <div className="divide-y divide-neutral-100">
              {FIELD_META.filter(f => {
                if ((f.key === 'show_imei' || f.key === 'show_warranty') && !showImeiFields) return false;
                return true;
              }).map(f => (
                <div key={f.key}>
                  <div className="flex items-center justify-between py-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-neutral-800">{f.label}</div>
                      <div className="text-[10px] text-neutral-500">{f.sub}</div>
                    </div>
                    <button onClick={() => set({ [f.key]: !settings[f.key] })} className="shrink-0 ml-3">
                      <div className={`w-9 h-5 rounded-full transition-colors relative ${settings[f.key] ? 'bg-neutral-900' : 'bg-neutral-200'}`}>
                        <div className={`absolute top-0.5 bg-white rounded-full h-4 w-4 transition-transform shadow-sm ${settings[f.key] ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                      </div>
                    </button>
                  </div>
                  {f.key === 'show_representative' && settings.show_representative && (
                    <div className="pb-3 pl-0">
                      <input
                        value={settings.default_representative}
                        onChange={e => set({ default_representative: e.target.value })}
                        placeholder="Nom par défaut (optionnel)"
                        className="input text-sm w-full max-w-xs"
                      />
                    </div>
                  )}
                  {f.key === 'show_warranty' && settings.show_warranty && showImeiFields && (
                    <div className="pb-3 pl-0">
                      <label className="text-[10px] font-medium text-neutral-500 mb-1 block">Mentions de garantie</label>
                      <textarea
                        value={settings.warranty_terms}
                        onChange={e => set({ warranty_terms: e.target.value })}
                        placeholder="Ex: La garantie couvre les défauts de fabrication..."
                        rows={3}
                        className="input resize-y"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Header lock */}
          <div className="py-4 border-b border-neutral-200">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-xs font-medium text-neutral-800 flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-neutral-400" />Exiger la validation d'en-tête
                </div>
                <div className="text-[10px] text-neutral-500">L'en-tête doit être validé avant la saisie des articles</div>
              </div>
              <button onClick={() => set({ require_header_lock: !settings.require_header_lock })} className="shrink-0 ml-3">
                <div className={`w-9 h-5 rounded-full transition-colors relative ${settings.require_header_lock ? 'bg-neutral-900' : 'bg-neutral-200'}`}>
                  <div className={`absolute top-0.5 bg-white rounded-full h-4 w-4 transition-transform shadow-sm ${settings.require_header_lock ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                </div>
              </button>
            </div>
          </div>

          {/* Edition & Suppression */}
          <div className="py-4 border-b border-neutral-200">
            <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3">Édition & Suppression</h3>
            <div className="divide-y divide-neutral-100">
              <div className="flex items-center justify-between py-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-neutral-800 flex items-center gap-1.5"><Pencil className="w-3 h-3 text-neutral-400" />Autoriser la modification</div>
                  <div className="text-[10px] text-neutral-500">Modifier les articles et montants</div>
                </div>
                <button onClick={() => set({ allow_edit: !settings.allow_edit })} className="shrink-0 ml-3">
                  <div className={`w-9 h-5 rounded-full transition-colors relative ${settings.allow_edit ? 'bg-neutral-900' : 'bg-neutral-200'}`}>
                    <div className={`absolute top-0.5 bg-white rounded-full h-4 w-4 transition-transform shadow-sm ${settings.allow_edit ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </div>
                </button>
              </div>
              <div className="flex items-center justify-between py-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-neutral-800 flex items-center gap-1.5"><Trash2 className="w-3 h-3 text-neutral-400" />Autoriser la suppression</div>
                  <div className="text-[10px] text-neutral-500">Supprimer le document et restaurer le stock</div>
                </div>
                <button onClick={() => set({ allow_delete: !settings.allow_delete })} className="shrink-0 ml-3">
                  <div className={`w-9 h-5 rounded-full transition-colors relative ${settings.allow_delete ? 'bg-neutral-900' : 'bg-neutral-200'}`}>
                    <div className={`absolute top-0.5 bg-white rounded-full h-4 w-4 transition-transform shadow-sm ${settings.allow_delete ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Columns config */}
          <div className="py-4 border-b border-neutral-200">
            <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1">Colonnes du document</h3>
            <p className="text-[10px] text-neutral-500 mb-3">Ordre et visibilité dans l'interface de saisie.</p>
            <div className="space-y-0 divide-y divide-neutral-100">
              {sortedCols.map((col, idx) => (
                <div key={col.key} className={`flex items-center gap-2.5 py-2.5 ${!col.visible ? 'opacity-40' : ''}`}>
                  <GripVertical className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                  <span className={`flex-1 text-xs font-medium ${col.visible ? 'text-neutral-800' : 'text-neutral-400'}`}>
                    {col.label}
                    {col.required && <span className="ml-1.5 text-[9px] text-neutral-300 uppercase">requis</span>}
                  </span>
                  <button
                    onClick={() => !col.required && toggleCol(col.key)}
                    disabled={!!col.required}
                    className={`p-1 transition-colors ${col.required ? 'opacity-20 cursor-default' : 'hover:bg-neutral-100 rounded'}`}
                  >
                    {col.visible ? <Eye className="w-3.5 h-3.5 text-neutral-600" /> : <EyeOff className="w-3.5 h-3.5 text-neutral-400" />}
                  </button>
                  <div className="flex flex-col">
                    <button onClick={() => moveCol(col.key, -1)} disabled={idx === 0} className="p-0.5 disabled:opacity-20"><ChevronUp className="w-3 h-3 text-neutral-400" /></button>
                    <button onClick={() => moveCol(col.key, 1)} disabled={idx === sortedCols.length - 1} className="p-0.5 disabled:opacity-20"><ChevronDown className="w-3 h-3 text-neutral-400" /></button>
                  </div>
                </div>
              ))}
            </div>

            {/* Preview */}
            <div className="mt-3 flex items-center gap-0 border-t border-neutral-100 pt-2 overflow-x-auto">
              {sortedCols.filter(c => c.visible).map(col => (
                <span key={col.key} className="px-2.5 py-1.5 text-[10px] font-medium text-neutral-500 whitespace-nowrap border-r border-neutral-100 last:border-r-0">{col.label}</span>
              ))}
            </div>
          </div>

          {/* Save */}
          <div className="flex justify-end pt-4">
            <button onClick={() => save(settings)} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white text-xs font-medium rounded-md hover:bg-neutral-800 transition active:scale-[0.97] disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Enregistrer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
