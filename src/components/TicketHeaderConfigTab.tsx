import { useEffect, useState } from 'react';
import { Loader2, Save, Check, Eye, EyeOff, ChevronUp, ChevronDown, GripVertical, CornerDownLeft, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import {
  DEFAULT_TICKET_HEADER_CONFIG,
  TICKET_HEADER_FIELD_LABELS,
  mergeTicketHeaderConfig,
  type TicketHeaderItem,
  type TicketHeaderSize,
} from '../lib/types';

const SIZE_OPTIONS: { value: TicketHeaderSize; label: string }[] = [
  { value: 'xs', label: 'XS' },
  { value: 'sm', label: 'S' },
  { value: 'md', label: 'M' },
  { value: 'lg', label: 'L' },
  { value: 'xl', label: 'XL' },
];

const PREVIEW_FONT_SIZE: Record<TicketHeaderSize, number> = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 17,
  xl: 21,
};

const PREVIEW_FONT_WEIGHT: Record<TicketHeaderSize, number> = {
  xs: 500,
  sm: 500,
  md: 600,
  lg: 700,
  xl: 900,
};

export function TicketHeaderConfigTab() {
  const { tenant, refresh } = useApp();
  const { success, error } = useToast();
  const [config, setConfig] = useState<TicketHeaderItem[]>(DEFAULT_TICKET_HEADER_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setConfig(mergeTicketHeaderConfig(tenant.ticket_header_config || null));
    setLoading(false);
  }, [tenant?.id, tenant?.ticket_header_config]);

  const move = (idx: number, dir: -1 | 1) => {
    setConfig(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const update = (idx: number, patch: Partial<TicketHeaderItem>) => {
    setConfig(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const reset = () => setConfig(DEFAULT_TICKET_HEADER_CONFIG.map(d => ({ ...d })));

  const save = async () => {
    if (!tenant) return;
    setSaving(true);
    const { error: e } = await supabase
      .from('tenants')
      .update({ ticket_header_config: config })
      .eq('id', tenant.id);
    setSaving(false);
    if (e) { error(e.message); return; }
    setSaved(true);
    success('Entête enregistrée');
    setTimeout(() => setSaved(false), 2000);
    refresh();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
      </div>
    );
  }

  const tenantPreview: any = tenant || {};
  const previewActivity = (tenantPreview.business_activity_type_name || '').trim();

  const previewValue = (key: TicketHeaderItem['key']): string => {
    switch (key) {
      case 'name':       return tenantPreview.name || '—';
      case 'legal_name': return tenantPreview.legal_name || '';
      case 'activity':   return previewActivity || '';
      case 'address':    return tenantPreview.address || '';
      case 'phone':      return tenantPreview.phone ? `Tél: ${tenantPreview.phone}` : '';
      case 'email':      return tenantPreview.email || '';
      case 'website':    return tenantPreview.website || '';
      case 'ninea':      return tenantPreview.ninea ? `NINEA: ${tenantPreview.ninea}` : '';
      case 'rccm':       return tenantPreview.rccm ? `RCCM: ${tenantPreview.rccm}` : '';
      default:           return '';
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-center shrink-0">
            <Printer className="w-4.5 h-4.5 text-neutral-700" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-900">En-tête des tickets et documents imprimés</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Choisissez les informations à afficher, leur ordre, leur taille et l'ajout d'un saut de ligne après chaque champ. Le type d'activité affiché provient du Type de commerce défini par la console plateforme admin.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Config list */}
          <div className="space-y-2">
            {config.map((item, idx) => (
              <div
                key={item.key}
                className={`rounded-xl border transition-colors ${item.show ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100 opacity-70'}`}
              >
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className={`text-[13px] font-semibold ${item.show ? 'text-slate-800' : 'text-slate-400'}`}>
                      {TICKET_HEADER_FIELD_LABELS[item.key]}
                    </div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider">{item.key}</div>
                  </div>

                  <button
                    onClick={() => update(idx, { show: !item.show })}
                    title={item.show ? 'Masquer' : 'Afficher'}
                    className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    {item.show ? <Eye className="w-4 h-4 text-teal-600" /> : <EyeOff className="w-4 h-4 text-slate-400" />}
                  </button>

                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => move(idx, -1)} disabled={idx === 0}
                      className="p-1 rounded hover:bg-slate-100 disabled:opacity-20 transition-colors">
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                    <button onClick={() => move(idx, 1)} disabled={idx === config.length - 1}
                      className="p-1 rounded hover:bg-slate-100 disabled:opacity-20 transition-colors">
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  </div>
                </div>

                {item.show && (
                  <div className="flex items-center gap-2 px-3 pb-3 pt-1 border-t border-slate-50">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mr-1">Taille</span>
                      <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                        {SIZE_OPTIONS.map(s => (
                          <button
                            key={s.value}
                            onClick={() => update(idx, { size: s.value })}
                            className={`px-2 py-1 text-[10px] font-bold transition-colors ${
                              item.size === s.value
                                ? 'bg-slate-900 text-white'
                                : 'bg-white text-slate-500 hover:bg-slate-50'
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => update(idx, { breakAfter: !item.breakAfter })}
                      title="Saut de ligne après"
                      className={`ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                        item.breakAfter
                          ? 'bg-amber-100 border-amber-300 text-amber-800'
                          : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <CornerDownLeft className="w-3 h-3" />
                      Saut
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Preview */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Printer className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Aperçu en-tête (80mm)</span>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-3 mx-auto" style={{ maxWidth: 280 }}>
              {config.map(item => {
                if (!item.show) return null;
                if (item.key === 'logo') {
                  if (!tenantPreview.logo_url) return null;
                  const px = item.size === 'xl' ? 80 : item.size === 'lg' ? 64 : item.size === 'md' ? 52 : item.size === 'sm' ? 42 : 32;
                  return (
                    <div key={item.key} className="flex justify-center" style={{ marginBottom: item.breakAfter ? 12 : 6 }}>
                      <img src={tenantPreview.logo_url} alt="" style={{ maxHeight: px, maxWidth: 200, objectFit: 'contain' }} />
                    </div>
                  );
                }
                const val = previewValue(item.key);
                if (!val) return null;
                return (
                  <div
                    key={item.key}
                    style={{
                      textAlign: 'center',
                      fontSize: PREVIEW_FONT_SIZE[item.size],
                      fontWeight: PREVIEW_FONT_WEIGHT[item.size],
                      marginBottom: item.breakAfter ? 8 : 0,
                      textTransform: item.key === 'activity' ? 'uppercase' : 'none',
                      letterSpacing: item.key === 'activity' ? 1.2 : 0,
                      color: '#000',
                    }}
                  >
                    {val}
                  </div>
                );
              })}
            </div>

            {!previewActivity && (
              <p className="mt-3 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 leading-snug">
                Aucun type d'activité défini par la plateforme. Demandez à un administrateur plateforme d'assigner un type d'activité.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={reset} className="text-xs px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold transition-colors">
          Réinitialiser
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="ml-auto h-11 px-5 rounded-2xl bg-brand-600 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg shadow-brand-600/20 disabled:opacity-50 disabled:shadow-none hover:bg-brand-700"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saving ? 'Enregistrement…' : saved ? 'Enregistré !' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
