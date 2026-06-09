import { useEffect, useState, useCallback } from 'react';
import {
  Loader2, ChevronUp, ChevronDown, Eye, EyeOff, Lock,
  Save, CalendarDays, Tag, ShieldCheck, User as User2,
  GripVertical, Check, FileText, ClipboardList, RotateCcw, Truck, LayoutGrid,
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
  show_representative: boolean;
  default_representative: string;
  require_header_lock: boolean;
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
  show_representative: false,
  default_representative: '',
  require_header_lock: false,
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

const DOC_TYPE_CONFIG: {
  key: DocType;
  label: string;
  sublabel: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  border: string;
  activeBg: string;
  accentBar: string;
}[] = [
  { key: 'invoice',        label: 'Facture',      sublabel: 'Vente client',      icon: FileText,       color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200',  activeBg: 'bg-blue-600',   accentBar: 'bg-blue-500' },
  { key: 'quote',          label: 'Devis',         sublabel: 'Proposition prix',  icon: ClipboardList, color: 'text-teal-700',   bg: 'bg-teal-50',   border: 'border-teal-200',  activeBg: 'bg-teal-600',   accentBar: 'bg-teal-500' },
  { key: 'supplier_order', label: 'Cmd. fourn.',   sublabel: 'Achat fournisseur', icon: Truck,  color: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200', activeBg: 'bg-amber-600',  accentBar: 'bg-amber-500' },
  { key: 'credit_note',    label: 'Avoir',         sublabel: 'Retour / Avoir',    icon: RotateCcw,     color: 'text-rose-700',   bg: 'bg-rose-50',   border: 'border-rose-200',  activeBg: 'bg-rose-600',   accentBar: 'bg-rose-500' },
];

function SectionTitle({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className={`w-0.5 h-4 rounded-full ${accent}`} />
      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{children}</span>
    </div>
  );
}

function Toggle({ on, onChange, label, sub }: { on: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer select-none py-2.5 px-3 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors">
      <div className="flex-1 min-w-0">
        <span className="text-[13px] font-semibold text-slate-700">{label}</span>
        {sub && <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">{sub}</p>}
      </div>
      <div className="shrink-0 relative">
        <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} className="sr-only peer" />
        <div className="w-10 h-[20px] bg-slate-200 peer-checked:bg-brand-600 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-[15px] after:w-[15px] after:transition-transform peer-checked:after:translate-x-5" />
      </div>
    </label>
  );
}

const FIELD_META = [
  { key: 'show_delivery_date' as const, label: 'Date de livraison', sub: 'Date de livraison prévue',     icon: CalendarDays, iconBg: 'bg-blue-50 border-blue-100',       iconColor: 'text-blue-500' },
  { key: 'show_reference'     as const, label: 'Référence',         sub: 'Réf. commande / dossier',      icon: Tag,          iconBg: 'bg-amber-50 border-amber-100',     iconColor: 'text-amber-500' },
  { key: 'show_warranty'      as const, label: 'Garantie',          sub: 'Conditions de garantie',       icon: ShieldCheck,  iconBg: 'bg-emerald-50 border-emerald-100', iconColor: 'text-emerald-500' },
  { key: 'show_representative' as const, label: 'Représentant',     sub: 'Commercial en charge',          icon: User2,        iconBg: 'bg-slate-50 border-slate-200',     iconColor: 'text-slate-500' },
];

export function DocumentSettingsTab() {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const [docType, setDocType] = useState<DocType>('invoice');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<DocSettings>(DEFAULT_DOC_SETTINGS);
  const [saved, setSaved] = useState(false);

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
        show_representative: data.show_representative ?? false,
        default_representative: data.default_representative ?? '',
        require_header_lock: data.require_header_lock ?? false,
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
        show_representative: s.show_representative,
        default_representative: s.default_representative,
        require_header_lock: s.require_header_lock,
        columns_config:      s.columns_config,
        updated_at:          new Date().toISOString(),
      }, { onConflict: 'tenant_id,doc_type' });
    setSaving(false);
    if (e) { error(e.message); return; }
    setSaved(true);
    success('Paramètres enregistrés');
    setTimeout(() => setSaved(false), 2000);
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

  const currentType = DOC_TYPE_CONFIG.find(d => d.key === docType)!;
  const sortedCols = [...settings.columns_config].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-4">

      {/* ── Doc type selector — horizontal pill row ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5 scrollbar-hide">
        {DOC_TYPE_CONFIG.map(dt => {
          const Icon = dt.icon;
          const active = docType === dt.key;
          return (
            <button
              key={dt.key}
              onClick={() => { if (!active) { setSaved(false); setDocType(dt.key); } }}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all shrink-0 ${
                active
                  ? `${dt.bg} ${dt.border} shadow-sm`
                  : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                active ? `${dt.activeBg} shadow-sm` : 'bg-slate-100'
              }`}>
                <Icon className={`w-3.5 h-3.5 ${active ? 'text-white' : 'text-slate-500'}`} />
              </div>
              <div className="text-left">
                <div className={`text-[12px] font-bold leading-tight ${active ? dt.color : 'text-slate-700'}`}>{dt.label}</div>
                <div className={`text-[10px] leading-tight ${active ? dt.color + ' opacity-70' : 'text-slate-400'}`}>{dt.sublabel}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
        </div>
      ) : (
        <div className="space-y-3">

          {/* Active type banner */}
          <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${currentType.bg} ${currentType.border}`}>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${currentType.activeBg} shadow-sm`}>
              {(() => { const Icon = currentType.icon; return <Icon className="w-4.5 h-4.5 text-white" />; })()}
            </div>
            <div>
              <div className={`text-[14px] font-bold ${currentType.color}`}>{currentType.label}</div>
              <div className={`text-[11px] ${currentType.color} opacity-60`}>Paramètres indépendants par type de document</div>
            </div>
          </div>

          {/* Optional header fields */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
              <div className={`w-0.5 h-4 rounded-full ${currentType.accentBar}`} />
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Champs d'en-tête</span>
            </div>
            <p className="text-[11px] text-slate-400 px-4 pb-2 leading-relaxed">Champs proposés à la saisie et visibles sur le document imprimé.</p>
            <div className="divide-y divide-slate-50 px-2">
              {FIELD_META.map(f => (
                <div key={f.key}>
                  <div className="flex items-center gap-2.5 py-1">
                    <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${f.iconBg} ml-1`}>
                      <f.icon className={`w-3.5 h-3.5 ${f.iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <Toggle
                        on={settings[f.key]}
                        onChange={v => set({ [f.key]: v })}
                        label={f.label}
                        sub={f.sub}
                      />
                    </div>
                  </div>
                  {f.key === 'show_representative' && settings.show_representative && (
                    <div className="pl-12 pb-3 pr-4">
                      <input
                        value={settings.default_representative}
                        onChange={e => set({ default_representative: e.target.value })}
                        placeholder="Nom par défaut (optionnel)"
                        className="input text-sm h-9 w-full max-w-xs"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="pb-2" />
          </div>

          {/* Header lock */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
              <div className="w-0.5 h-4 rounded-full bg-rose-400" />
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Validation en-tête</span>
            </div>
            <div className="flex items-center gap-2.5 px-3 pb-2">
              <div className="w-7 h-7 rounded-lg border border-rose-100 bg-rose-50 flex items-center justify-center shrink-0 ml-1">
                <Lock className="w-3.5 h-3.5 text-rose-500" />
              </div>
              <div className="flex-1">
                <Toggle
                  on={settings.require_header_lock}
                  onChange={v => set({ require_header_lock: v })}
                  label="Exiger la validation"
                  sub="L'en-tête doit être validé avant la saisie des articles"
                />
              </div>
            </div>
            {settings.require_header_lock && (
              <div className="mx-4 mb-4 flex items-start gap-2 text-[11px] bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2.5">
                <Lock className="w-3 h-3 shrink-0 mt-0.5 text-amber-600" />
                <span>Un bouton <strong>Valider l'en-tête</strong> sera affiché lors de la création.</span>
              </div>
            )}
            {!settings.require_header_lock && <div className="pb-2" />}
          </div>

          {/* Columns config */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
              <div className="w-0.5 h-4 rounded-full bg-teal-400" />
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Colonnes du document</span>
            </div>
            <p className="text-[11px] text-slate-400 px-4 pb-3 leading-relaxed">Colonnes affichées et leur ordre dans l'interface de saisie.</p>

            <div className="space-y-1 px-3 mb-3">
              {sortedCols.map((col, idx) => (
                <div
                  key={col.key}
                  className={`flex items-center gap-2.5 px-3 py-3 rounded-xl border transition-colors ${
                    col.visible ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100 opacity-50'
                  }`}
                >
                  <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className={`text-[13px] font-semibold ${col.visible ? 'text-slate-800' : 'text-slate-400'}`}>{col.label}</span>
                    {col.required && <span className="ml-2 text-[9px] font-bold text-slate-300 uppercase tracking-wide">requis</span>}
                  </div>
                  <button
                    onClick={() => !col.required && toggleCol(col.key)}
                    disabled={!!col.required}
                    title={col.required ? 'Obligatoire' : col.visible ? 'Masquer' : 'Afficher'}
                    className={`p-1.5 rounded-lg transition-colors ${col.required ? 'opacity-20 cursor-default' : 'hover:bg-slate-100 active:bg-slate-200 cursor-pointer'}`}
                  >
                    {col.visible
                      ? <Eye className="w-4 h-4 text-teal-500" />
                      : <EyeOff className="w-4 h-4 text-slate-400" />}
                  </button>
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveCol(col.key, -1)} disabled={idx === 0}
                      className="p-1 rounded-lg hover:bg-slate-100 active:bg-slate-200 disabled:opacity-20 transition-colors">
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                    <button onClick={() => moveCol(col.key, 1)} disabled={idx === sortedCols.length - 1}
                      className="p-1 rounded-lg hover:bg-slate-100 active:bg-slate-200 disabled:opacity-20 transition-colors">
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Column preview */}
            <div className="mx-3 mb-3 rounded-xl border border-slate-100 overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 border-b border-slate-100 flex items-center gap-1.5">
                <LayoutGrid className="w-3 h-3 text-slate-400" />
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Aperçu colonnes</span>
              </div>
              <div className="flex items-center divide-x divide-slate-100 overflow-x-auto">
                {sortedCols.filter(c => c.visible).map(col => (
                  <div key={col.key} className="px-3 py-2 text-[11px] font-semibold text-slate-600 whitespace-nowrap bg-white">
                    {col.label}
                  </div>
                ))}
                <div className="px-3 py-2 text-[11px] text-slate-300 bg-white whitespace-nowrap">Actions</div>
              </div>
            </div>
          </div>

          {/* Save button */}
          <button
            onClick={() => save(settings)}
            disabled={saving}
            className="w-full h-12 rounded-2xl bg-brand-600 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg shadow-brand-600/20 disabled:opacity-50 disabled:shadow-none hover:bg-brand-700"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saving ? 'Enregistrement…' : saved ? 'Enregistré !' : 'Enregistrer les paramètres'}
          </button>
        </div>
      )}
    </div>
  );
}
