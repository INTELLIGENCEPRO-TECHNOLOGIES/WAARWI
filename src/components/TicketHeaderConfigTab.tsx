import { useEffect, useState } from 'react';
import { Loader2, Save, Check, Eye, EyeOff, ChevronUp, ChevronDown, GripVertical, CornerDownLeft, Printer, RotateCcw, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import {
  DEFAULT_TICKET_HEADER_CONFIG,
  TICKET_HEADER_FIELD_LABELS,
  mergeTicketHeaderConfig,
  mergeA4HeaderConfig,
  DEFAULT_A4_HEADER_CONFIG,
  type TicketHeaderItem,
  type TicketHeaderSize,
  type A4LogoPosition,
  type A4HeaderConfig,
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
  const { tenant, sites, refresh, currentSite, isOwner } = useApp();
  const { success, error } = useToast();
  const [config, setConfig] = useState<TicketHeaderItem[]>(DEFAULT_TICKET_HEADER_CONFIG);
  const [a4Config, setA4Config] = useState<A4HeaderConfig>(DEFAULT_A4_HEADER_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [targetSiteId, setTargetSiteId] = useState<string>('');

  // Non-owner: force to currentSite
  useEffect(() => {
    if (!isOwner && currentSite?.id) {
      setTargetSiteId(currentSite.id);
    }
  }, [isOwner, currentSite?.id]);

  const activeSites = (sites || []).filter((s: any) => !s.is_warehouse && s.is_active);
  const selectedSite = targetSiteId ? activeSites.find((s: any) => s.id === targetSiteId) : null;

  useEffect(() => {
    if (!tenant) return;
    if (selectedSite?.ticket_header_config) {
      setConfig(mergeTicketHeaderConfig(selectedSite.ticket_header_config));
    } else {
      setConfig(mergeTicketHeaderConfig(tenant.ticket_header_config || null));
    }
    const rawA4 = (selectedSite?.a4_header_config ?? tenant.a4_header_config ?? null) as A4HeaderConfig | null;
    setA4Config(mergeA4HeaderConfig(rawA4));
    setLoading(false);
  }, [tenant?.id, tenant?.ticket_header_config, tenant?.a4_header_config, targetSiteId, selectedSite?.ticket_header_config, selectedSite?.a4_header_config]);

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

  const reset = () => { setConfig(DEFAULT_TICKET_HEADER_CONFIG.map(d => ({ ...d }))); setA4Config({ ...DEFAULT_A4_HEADER_CONFIG }); };

  const save = async () => {
    if (!tenant) return;
    setSaving(true);
    let e: any = null;
    if (selectedSite || !isOwner) {
      const siteId = selectedSite?.id || currentSite?.id;
      if (!siteId) { error('Aucun site sélectionné'); setSaving(false); return; }
      const { error: err } = await supabase
        .from('sites')
        .update({ ticket_header_config: config, a4_header_config: a4Config })
        .eq('id', siteId);
      e = err;
    } else {
      const { error: err } = await supabase
        .from('tenants')
        .update({ ticket_header_config: config, a4_header_config: a4Config })
        .eq('id', tenant.id);
      e = err;
    }
    setSaving(false);
    if (e) { error(e.message); return; }
    setSaved(true);
    success(selectedSite ? `Entête ${selectedSite.name} enregistrée` : 'Entête générale enregistrée');
    setTimeout(() => setSaved(false), 2000);
    refresh();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-300" />
      </div>
    );
  }

  const tenantPreview: any = selectedSite ? { ...tenant, ...Object.fromEntries(Object.entries(selectedSite).filter(([_, v]) => v != null && v !== '')) } : (tenant || {});
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
    <div className="space-y-0">
      {/* Header */}
      <div className="py-4 border-b border-neutral-200">
        <h3 className="text-[14px] font-bold text-neutral-900">En-tête des tickets et documents imprimés</h3>
        <p className="text-[11px] text-neutral-500 mt-0.5">Choisissez les informations à afficher, leur ordre, leur taille et l'ajout d'un saut de ligne après chaque champ.</p>
      </div>

      {/* Site selector for multi-store */}
      {activeSites.length > 1 && (
        <div className="py-4 border-b border-neutral-200">
          <label className="block text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Configurer l'entête pour</label>
          {isOwner ? (
            <select
              value={targetSiteId}
              onChange={e => setTargetSiteId(e.target.value)}
              className="bare-input text-sm py-1.5 w-full"
            >
              <option value="">Tous les magasins (configuration par défaut)</option>
              {activeSites.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}{s.ticket_header_config ? ' (personnalisé)' : ''}</option>
              ))}
            </select>
          ) : (
            <div className="text-sm text-neutral-700 py-1.5">{currentSite?.name || 'Mon magasin'}</div>
          )}
          {selectedSite && (
            <p className="text-[10px] text-neutral-400 mt-1">Les champs laissés vides utiliseront les valeurs de la configuration par défaut de l'entreprise.</p>
          )}
        </div>
      )}

      {/* Config list */}
      <div className="py-4 border-b border-neutral-200">
        <div className="divide-y divide-neutral-100">
          {config.map((item, idx) => (
            <div key={item.key} className={`py-3 ${!item.show ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2.5">
                <GripVertical className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-medium ${item.show ? 'text-neutral-800' : 'text-neutral-400'}`}>
                    {TICKET_HEADER_FIELD_LABELS[item.key]}
                  </div>
                  <div className="text-[10px] text-neutral-400 uppercase tracking-wider">{item.key}</div>
                </div>

                <button
                  onClick={() => update(idx, { show: !item.show })}
                  title={item.show ? 'Masquer' : 'Afficher'}
                  className="p-1.5 rounded-md hover:bg-neutral-100 transition-colors"
                >
                  {item.show ? <Eye className="w-4 h-4 text-neutral-600" /> : <EyeOff className="w-4 h-4 text-neutral-400" />}
                </button>

                <div className="flex flex-col gap-0.5">
                  <button onClick={() => move(idx, -1)} disabled={idx === 0}
                    className="p-1 rounded hover:bg-neutral-100 disabled:opacity-20 transition-colors">
                    <ChevronUp className="w-3.5 h-3.5 text-neutral-400" />
                  </button>
                  <button onClick={() => move(idx, 1)} disabled={idx === config.length - 1}
                    className="p-1 rounded hover:bg-neutral-100 disabled:opacity-20 transition-colors">
                    <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
                  </button>
                </div>
              </div>

              {item.show && (
                <div className="flex items-center gap-2 pt-2 pl-6">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mr-1">Taille</span>
                    <div className="flex gap-1">
                      {SIZE_OPTIONS.map(s => (
                        <button
                          key={s.value}
                          onClick={() => update(idx, { size: s.value })}
                          className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all ${
                            item.size === s.value
                              ? 'bg-neutral-900 text-white'
                              : 'text-neutral-500 hover:bg-neutral-100'
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
                    className={`ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors ${
                      item.breakAfter
                        ? 'text-amber-700'
                        : 'text-neutral-400 hover:bg-neutral-100'
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
      </div>

      {/* Preview */}
      <div className="py-4 border-b border-neutral-200">
        <div className="flex items-center gap-2 mb-3">
          <Printer className="w-3.5 h-3.5 text-neutral-400" />
          <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Aperçu en-tête (80mm)</span>
        </div>
        <div className="bg-white border border-neutral-200 rounded-lg p-3 mx-auto" style={{ maxWidth: 280 }}>
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
          <p className="mt-3 text-[10px] text-amber-700 leading-snug">
            Aucun type d'activité défini par la plateforme. Demandez à un administrateur plateforme d'assigner un type d'activité.
          </p>
        )}
      </div>

      {/* A4 layout config */}
      <div className="py-4 border-b border-neutral-200">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-3.5 h-3.5 text-neutral-400" />
          <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Mise en page A4</span>
        </div>
        <p className="text-[10px] text-neutral-500 mb-3">Position et taille du logo sur les documents A4 (factures, commandes, rapports, livre d\'inventaire). Les tickets 80mm ne sont pas affectés.</p>

        {/* Logo position */}
        <div className="divide-y divide-neutral-100">
          <div className="py-3">
            <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">Position du logo</div>
            <div className="flex gap-2">
              {([
                { value: 'above', label: 'Au-dessus' },
                { value: 'left', label: 'À gauche' },
                { value: 'right', label: 'À droite' },
              ] as { value: A4LogoPosition; label: string }[]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setA4Config(prev => ({ ...prev, logo_position: opt.value }))}
                  className={`px-3 py-1.5 text-[11px] font-bold rounded-md transition-all ${
                    a4Config.logo_position === opt.value
                      ? 'bg-neutral-900 text-white'
                      : 'text-neutral-500 hover:bg-neutral-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Logo size */}
          <div className="py-3">
            <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">Taille du logo</div>
            <div className="flex gap-1">
              {SIZE_OPTIONS.map(s => (
                <button
                  key={s.value}
                  onClick={() => setA4Config(prev => ({ ...prev, logo_size: s.value }))}
                  className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all ${
                    a4Config.logo_size === s.value
                      ? 'bg-neutral-900 text-white'
                      : 'text-neutral-500 hover:bg-neutral-100'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* A4 preview */}
          <div className="py-3">
            <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">Aperçu A4</div>
            <div className="bg-white border border-neutral-200 rounded-lg p-3" style={{ maxWidth: 480 }}>
              {(() => {
                const logoPx = a4Config.logo_size === 'xl' ? 80 : a4Config.logo_size === 'lg' ? 60 : a4Config.logo_size === 'md' ? 45 : a4Config.logo_size === 'sm' ? 35 : 25;
                const logoEl = tenantPreview.logo_url
                  ? <img src={tenantPreview.logo_url} alt="" style={{ maxWidth: logoPx, maxHeight: logoPx, objectFit: 'contain' }} />
                  : null;
                const infoEl = <div className="min-w-0">
                  <div className="text-[13px] font-bold text-neutral-900 leading-tight">{tenantPreview.name || '—'}</div>
                  {tenantPreview.legal_name && <div className="text-[10px] font-semibold text-neutral-700">{tenantPreview.legal_name}</div>}
                  {previewActivity && <div className="text-[9px] font-semibold text-neutral-500 uppercase tracking-wider">{previewActivity}</div>}
                  {tenantPreview.address && <div className="text-[9px] text-neutral-500">{tenantPreview.address}</div>}
                  {tenantPreview.phone && <div className="text-[9px] text-neutral-500">Tél: {tenantPreview.phone}</div>}
                  {tenantPreview.ninea && <div className="text-[9px] text-neutral-500">NINEA: {tenantPreview.ninea}</div>}
                </div>;
                const metaEl = <div className="text-right shrink-0">
                  <div className="text-[11px] font-bold text-neutral-900 uppercase tracking-wide">Facture</div>
                  <div className="text-[14px] font-bold text-neutral-900">N° FAC-001</div>
                  <div className="text-[9px] text-neutral-500">Date : 01/01/2025</div>
                </div>;
                if (a4Config.logo_position === 'above') {
                  return <div className="border-b-2 border-neutral-900 pb-2 mb-2">
                    {logoEl && <div className="mb-2">{logoEl}</div>}
                    <div className="flex justify-between items-start gap-3">{infoEl}{metaEl}</div>
                  </div>;
                } else if (a4Config.logo_position === 'left') {
                  return <div className="border-b-2 border-neutral-900 pb-2 mb-2">
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex gap-2 items-start flex-1 min-w-0">{logoEl}<div className="flex-1 min-w-0">{infoEl}</div></div>
                      {metaEl}
                    </div>
                  </div>;
                } else {
                  return <div className="border-b-2 border-neutral-900 pb-2 mb-2">
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1 min-w-0">{infoEl}</div>
                      <div className="flex flex-col items-end gap-1 shrink-0">{logoEl}{metaEl}</div>
                    </div>
                  </div>;
                }
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-4">
        <button onClick={reset} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-500 hover:text-neutral-900 transition">
          <RotateCcw className="w-3 h-3" />Réinitialiser
        </button>
        <button onClick={save} disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white text-xs font-medium rounded-md hover:bg-neutral-800 transition active:scale-[0.97] disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          Enregistrer
        </button>
      </div>
    </div>
  );
}
