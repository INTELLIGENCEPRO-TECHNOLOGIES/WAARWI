import { useEffect, useState } from 'react';
import { Loader2, Save, Check, BadgePercent, Info, UserCheck } from 'lucide-react';
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
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div>;
  }

  if (!canEdit) {
    return <div className="py-16 text-center text-sm text-slate-500">Vous n'avez pas la permission de modifier ces paramètres.</div>;
  }

  const isFixed = settings.commission_type === 'fixe';
  const isMargin = settings.commission_type === 'pct_marge';

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-slate-100">
          <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center">
            <BadgePercent className="w-4.5 h-4.5 text-teal-600" />
          </div>
          <div>
            <div className="text-[14px] font-bold text-slate-900">Représentants et commissions</div>
            <div className="text-[11px] text-slate-500">Règle générale appliquée à tous les représentants (sauf règle spécifique)</div>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <label className="flex items-center justify-between gap-3 cursor-pointer select-none py-2.5 px-3 rounded-xl hover:bg-slate-50 transition-colors border border-slate-100">
            <div className="flex items-center gap-2.5">
              <UserCheck className="w-4 h-4 text-slate-500" />
              <div>
                <span className="text-[13px] font-semibold text-slate-700">Activer les commissions</span>
                <p className="text-[11px] text-slate-400 mt-0.5">La commission est calculée uniquement à la validation finale du document</p>
              </div>
            </div>
            <div className="shrink-0 relative">
              <input type="checkbox" checked={settings.enabled} onChange={e => setSettings(s => ({ ...s, enabled: e.target.checked }))} className="sr-only peer" />
              <div className="w-10 h-[20px] bg-slate-200 peer-checked:bg-brand-600 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-[15px] after:w-[15px] after:transition-transform peer-checked:after:translate-x-5" />
            </div>
          </label>

          <div className={settings.enabled ? '' : 'opacity-50 pointer-events-none'}>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Type de commission</label>
                <select
                  value={settings.commission_type}
                  onChange={e => setSettings(s => ({ ...s, commission_type: e.target.value as CommissionType }))}
                  className="w-full h-10 rounded-xl border border-slate-200 bg-white text-[13px] text-slate-800 px-3 outline-none focus:border-slate-400 transition-colors"
                >
                  {(Object.keys(COMMISSION_TYPE_LABELS) as CommissionType[]).map(t => (
                    <option key={t} value={t}>{COMMISSION_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>

              {!isFixed && !isMargin && (
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Base de calcul</label>
                  <select
                    value={settings.commission_base}
                    onChange={e => setSettings(s => ({ ...s, commission_base: e.target.value as CommissionBase }))}
                    className="w-full h-10 rounded-xl border border-slate-200 bg-white text-[13px] text-slate-800 px-3 outline-none focus:border-slate-400 transition-colors"
                  >
                    {(['ht', 'ttc', 'net'] as CommissionBase[]).map(b => (
                      <option key={b} value={b}>{COMMISSION_BASE_LABELS[b]}</option>
                    ))}
                  </select>
                </div>
              )}

              {isFixed ? (
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Montant fixe par vente (FCFA)</label>
                  <input
                    type="number" min={0} step="1"
                    value={settings.fixed_amount || ''}
                    onChange={e => setSettings(s => ({ ...s, fixed_amount: Number(e.target.value) || 0 }))}
                    className="w-full h-10 rounded-xl border border-slate-200 bg-white text-[13px] text-slate-800 px-3 outline-none focus:border-slate-400 transition-colors"
                    placeholder="Ex: 1000"
                  />
                </div>
              ) : (
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Taux (%)</label>
                  <input
                    type="number" min={0} max={100} step="0.01"
                    value={settings.rate || ''}
                    onChange={e => setSettings(s => ({ ...s, rate: Number(e.target.value) || 0 }))}
                    className="w-full h-10 rounded-xl border border-slate-200 bg-white text-[13px] text-slate-800 px-3 outline-none focus:border-slate-400 transition-colors"
                    placeholder="Ex: 2.5"
                  />
                </div>
              )}
            </div>

            <div className="mt-3 flex items-start gap-2 text-[11px] bg-slate-50 border border-slate-200 text-slate-600 rounded-xl px-3 py-2.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
              <span>
                Une règle spécifique peut être définie par représentant (elle est prioritaire sur cette règle générale).
                Le changement de règle ne modifie jamais les commissions déjà calculées sur les ventes validées.
              </span>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="w-full btn-icon-primary"
        title={saving ? 'Enregistrement…' : saved ? 'Enregistré !' : 'Enregistrer les paramètres'}
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
      </button>
    </div>
  );
}
