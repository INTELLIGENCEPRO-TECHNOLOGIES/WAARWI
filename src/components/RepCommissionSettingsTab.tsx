import { useEffect, useState } from 'react';
import { Loader2, Save, Check, Info, UserCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { usePermissions } from '../lib/permissions';
import {
  type RepCommissionSettings, type CommissionType, type CommissionBase,
  DEFAULT_REP_SETTINGS, COMMISSION_TYPE_LABELS, COMMISSION_BASE_LABELS,
} from '../lib/repCommission';

export function RepCommissionSettingsTab() {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const { can } = usePermissions();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState<RepCommissionSettings>(DEFAULT_REP_SETTINGS);

  const canEdit = can('rep_settings_edit');

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      const { data } = await supabase
        .from('rep_commission_settings')
        .select('enabled, commission_type, commission_base, rate, fixed_amount')
        .eq('tenant_id', tenant.id)
        .maybeSingle();
      if (data) {
        setSettings({
          enabled: data.enabled === true,
          commission_type: (data.commission_type || 'pct_ca') as CommissionType,
          commission_base: (data.commission_base || 'ttc') as CommissionBase,
          rate: Number(data.rate || 0),
          fixed_amount: Number(data.fixed_amount || 0),
        });
      }
      setLoading(false);
    })();
  }, [tenant?.id]);

  const save = async () => {
    if (!tenant || !canEdit) return;
    setSaving(true);
    const { error: e } = await supabase
      .from('rep_commission_settings')
      .upsert({
        tenant_id: tenant.id,
        enabled: settings.enabled,
        commission_type: settings.commission_type,
        commission_base: settings.commission_base,
        rate: settings.rate,
        fixed_amount: settings.fixed_amount,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id' });
    setSaving(false);
    if (e) { error(e.message); return; }
    setSaved(true);
    success('Paramètres de commission enregistrés');
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-neutral-300" /></div>;
  }

  if (!canEdit) {
    return <div className="py-16 text-center text-sm text-neutral-500">Vous n'avez pas la permission de modifier ces paramètres.</div>;
  }

  const isFixed = settings.commission_type === 'fixe';
  const isMargin = settings.commission_type === 'pct_marge';

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="py-4 border-b border-neutral-200">
        <div className="text-[14px] font-bold text-neutral-900">Représentants et commissions</div>
        <div className="text-[11px] text-neutral-500 mt-0.5">Règle générale appliquée à tous les représentants (sauf règle spécifique)</div>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between py-4 border-b border-neutral-200">
        <div className="flex items-center gap-2.5 min-w-0">
          <UserCheck className="w-4 h-4 text-neutral-400 shrink-0" />
          <div className="min-w-0">
            <span className="text-xs font-medium text-neutral-800 block">Activer les commissions</span>
            <p className="text-[10px] text-neutral-500 mt-0.5">La commission est calculée uniquement à la validation finale du document</p>
          </div>
        </div>
        <button onClick={() => setSettings(s => ({ ...s, enabled: !s.enabled }))} className="shrink-0 relative ml-3">
          <div className={`w-9 h-5 rounded-full transition-colors relative ${settings.enabled ? 'bg-neutral-900' : 'bg-neutral-200'}`}>
            <div className={`absolute top-0.5 bg-white rounded-full h-4 w-4 transition-transform shadow-sm ${settings.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
          </div>
        </button>
      </div>

      {/* Settings */}
      <div className={`py-4 border-b border-neutral-200 space-y-4 ${settings.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <label className="block text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Type de commission</label>
            <select
              value={settings.commission_type}
              onChange={e => setSettings(s => ({ ...s, commission_type: e.target.value as CommissionType }))}
              className="bare-input text-sm py-1.5 w-full"
            >
              {(Object.keys(COMMISSION_TYPE_LABELS) as CommissionType[]).map(t => (
                <option key={t} value={t}>{COMMISSION_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          {!isFixed && !isMargin && (
            <div>
              <label className="block text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Base de calcul</label>
              <select
                value={settings.commission_base}
                onChange={e => setSettings(s => ({ ...s, commission_base: e.target.value as CommissionBase }))}
                className="bare-input text-sm py-1.5 w-full"
              >
                {(['ht', 'ttc', 'net'] as CommissionBase[]).map(b => (
                  <option key={b} value={b}>{COMMISSION_BASE_LABELS[b]}</option>
                ))}
              </select>
            </div>
          )}

          {isFixed ? (
            <div>
              <label className="block text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Montant fixe par vente (FCFA)</label>
              <input
                type="number" min={0} step="1"
                value={settings.fixed_amount || ''}
                onChange={e => setSettings(s => ({ ...s, fixed_amount: Number(e.target.value) || 0 }))}
                className="bare-input text-sm py-1.5 w-full num"
                placeholder="Ex: 1000"
              />
            </div>
          ) : (
            <div>
              <label className="block text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Taux (%)</label>
              <input
                type="number" min={0} max={100} step="0.01"
                value={settings.rate || ''}
                onChange={e => setSettings(s => ({ ...s, rate: Number(e.target.value) || 0 }))}
                className="bare-input text-sm py-1.5 w-full num"
                placeholder="Ex: 2.5"
              />
            </div>
          )}
        </div>

        <div className="flex items-start gap-2 text-[11px] text-neutral-600">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-neutral-400" />
          <span>
            Une règle spécifique peut être définie par représentant (elle est prioritaire sur cette règle générale).
            Le changement de règle ne modifie jamais les commissions déjà calculées sur les ventes validées.
          </span>
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end pt-4">
        <button onClick={save} disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white text-xs font-medium rounded-md hover:bg-neutral-800 transition active:scale-[0.97] disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          Enregistrer
        </button>
      </div>
    </div>
  );
}
