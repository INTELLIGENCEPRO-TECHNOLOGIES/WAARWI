import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { supabase } from '../lib/supabase';

type VatSetting = { site_id: string | null; enabled: boolean };

export function SalesVatSettings() {
  const { tenant, sites } = useApp();
  const { success, error } = useToast();
  const [settings, setSettings] = useState<VatSetting[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const tenantId = tenant?.id;

  useEffect(() => {
    if (!tenantId) return;
    const controller = new AbortController();
    setSettings(null);
    setLoadFailed(false);
    void supabase.from('sales_vat_settings').select('site_id, enabled')
      .eq('tenant_id', tenantId).abortSignal(controller.signal).then(({ data, error }) => {
        if (controller.signal.aborted) return;
        if (error) setLoadFailed(true);
        else setSettings(data);
      });
    return () => controller.abort();
  }, [tenantId]);

  const save = async (siteId: string | null, value: string) => {
    const enabled = value === 'inherit' ? null : value === 'enabled';
    setSaving(true);
    try {
      const { error: failure } = await supabase.rpc('save_sales_vat_setting', { p_site_id: siteId, p_enabled: enabled });
      if (failure) { error(failure.message); return; }
      setSettings(previous => {
        const otherSettings = (previous || []).filter(setting => setting.site_id !== siteId);
        return enabled === null ? otherSettings : [...otherSettings, { site_id: siteId, enabled }];
      });
      success('Paramétrage TVA enregistré.');
    } finally {
      setSaving(false);
    }
  };

  const companyEnabled = settings?.some(setting => setting.site_id === null && setting.enabled) ?? false;
  const scopes = [{ id: null, name: 'Entreprise' }, ...sites.filter(site => !site.parent_site_id)
    .map(site => ({ id: site.id, name: site.name }))];

  return (
    <section aria-labelledby="sales-vat-title" className="max-w-4xl space-y-3">
      <div>
        <h1 id="sales-vat-title" className="text-lg font-bold text-[var(--w-text)]">TVA sur les ventes</h1>
        <p className="mt-1 text-sm text-[var(--w-text-sec)]">
          Les prix du catalogue restent TTC. Renseignez le taux de chaque article avant d’activer la TVA.
          Les articles à 0 % restent sans montant de TVA. Le réglage s’applique aux nouvelles ventes.
        </p>
      </div>
      {loadFailed ? <p role="alert" className="text-sm text-red-700">Impossible de charger le paramétrage TVA.</p>
        : !settings ? <p role="status" className="text-sm text-[var(--w-text-sec)]">Chargement…</p>
        : <div className="divide-y divide-[var(--w-separator)] border-y border-[var(--w-separator)]">
          {scopes.map(({ id, name }) => {
            const configured = settings.find(setting => setting.site_id === id);
            const value = configured ? (configured.enabled ? 'enabled' : 'disabled') : id ? 'inherit' : 'disabled';
            return (
              <label key={id ?? 'company'} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="min-w-0 text-sm font-semibold text-[var(--w-text)]">{name}</span>
                <select aria-label={`TVA · ${name}`} className="input-field max-w-full sm:w-72" value={value}
                  disabled={saving} onChange={event => void save(id, event.target.value)}>
                  {id && <option value="inherit">Hériter de l’entreprise ({companyEnabled ? 'activée' : 'désactivée'})</option>}
                  <option value="enabled">TVA activée</option>
                  <option value="disabled">TVA désactivée</option>
                </select>
              </label>
            );
          })}
        </div>}
    </section>
  );
}
