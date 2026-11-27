import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Loader2, RefreshCw, Search } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { backupStatusLabels } from '../lib/backupV3';
import { formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import { BackupTab } from './BackupTab';
import { PlatformWorkPage } from './PlatformWorkPage';

type Company = {
  id: string;
  name: string;
  is_active: boolean;
  suspended: boolean;
  verified_at: string | null;
  confirmed_at: string | null;
  latest_job_status: string | null;
};

type Schedule = { enabled: boolean; cron_expression: string; timezone: string };
type Overview = { policy: Schedule; offsite_enabled: boolean; companies: Company[] };

export function CentralizedBackups() {
  const [data, setData] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  const { success, error } = useToast();

  const load = useCallback(async () => {
    const result = await supabase.rpc('br_v3_platform_backups');
    if (result.error) { setLoadError(result.error.message); return; }
    setLoadError('');
    setData(result.data as Overview);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function save(action: () => PromiseLike<{ error: { message: string } | null }>, message: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await action();
      if (result.error) throw result.error;
      setDraft(null);
      success(message);
      await load();
    } catch (cause) {
      error((cause as { message?: string })?.message || 'Opération indisponible.');
    } finally {
      setBusy(false);
    }
  }

  if (draft) return (
    <PlatformWorkPage title="Modifier la planification" backLabel="Retour aux sauvegardes" onBack={() => setDraft(null)} busy={busy}>
      <form className="pa-form" onSubmit={event => {
        event.preventDefault();
        void save(() => supabase.rpc('br_v3_schedule_update', {
          p_enabled: draft.enabled, p_cron_expression: draft.cron_expression,
        }), 'Planification enregistrée.');
      }}>
        <label className="pa-inline"><input type="checkbox" checked={draft.enabled}
          onChange={event => setDraft({ ...draft, enabled: event.target.checked })} /> Sauvegarde automatique</label>
        <label className="pa-field-label">Expression Cron ({draft.timezone})
          <input required className="w-input-ul" value={draft.cron_expression}
            onChange={event => setDraft({ ...draft, cron_expression: event.target.value })} />
        </label>
        <button type="submit" className="pa-button" data-variant="primary" disabled={busy}>Enregistrer</button>
      </form>
    </PlatformWorkPage>
  );

  const selected = data?.companies.find(company => company.id === selectedId);
  if (selected) return (
    <PlatformWorkPage title={selected.name} backLabel="Retour aux sauvegardes" onBack={() => { setSelectedId(null); void load(); }}
      actions={<button type="button" className="pa-button" disabled={busy || !selected.is_active}
        onClick={() => void save(() => supabase.rpc('br_v3_schedule_suspend', {
          p_tenant_id: selected.id, p_suspended: !selected.suspended,
        }), selected.suspended ? 'Planification réactivée.' : 'Planification suspendue.')}>
        {selected.suspended ? 'Réactiver la planification' : 'Suspendre la planification'}
      </button>}>
      <BackupTab key={selected.id} companyId={selected.id} />
    </PlatformWorkPage>
  );

  if (!data) return loadError
    ? <p role="alert" className="pa-danger">{loadError}</p>
    : <p role="status" className="pa-empty"><Loader2 size={16} className="animate-spin" /> Chargement…</p>;

  const active = data.companies.filter(company => company.is_active && !company.suspended);
  const protectedCount = active.filter(company => company.confirmed_at).length;
  const filtered = data.companies.filter(company => company.name.toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr')));

  return (
    <section className="grid gap-4">
      <div className="pa-section-head">
        <h2 className="pa-heading">Sauvegardes V3</h2>
        <div className="pa-inline">
          <button type="button" className="pa-link" onClick={() => setDraft(data.policy)}>Planification</button>
          <button type="button" className="pa-icon-button" aria-label="Actualiser les sauvegardes" onClick={() => void load()}><RefreshCw size={16} /></button>
        </div>
      </div>
      <dl className="pa-keyvals">
        <div><dt>Entreprises avec une copie LWS vérifiée</dt><dd>{protectedCount} sur {active.length}</dd></div>
        <div><dt>Planification</dt><dd>{data.policy.enabled ? data.policy.cron_expression + ' (' + data.policy.timezone + ')' : 'Suspendue'}</dd></div>
        <div><dt>Copie distante</dt><dd>{data.offsite_enabled ? 'Active' : 'Inactive'}</dd></div>
      </dl>
      <label className="pa-inline">
        <Search size={16} aria-hidden="true" />
        <input aria-label="Rechercher une entreprise" className="w-input-ul" placeholder="Rechercher une entreprise"
          value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      {loadError && <p role="alert" className="pa-danger">{loadError}</p>}
      {filtered.length === 0 && <p className="pa-empty">Aucune entreprise trouvée.</p>}
      <ul className="pa-divided">
        {filtered.map(company => (
          <li key={company.id} className="pa-setting-row">
            <div>
              <strong>{company.name}</strong>
              <p className="pa-row-subtitle">{company.verified_at ? 'Dernière archive ' + formatDateTime(company.verified_at) : 'Aucune archive vérifiée'}</p>
              <p className="pa-row-subtitle">{company.confirmed_at ? 'Copie LWS vérifiée ' + formatDateTime(company.confirmed_at) : 'Copie LWS en attente'}</p>
              {company.latest_job_status && company.latest_job_status !== 'succeeded' && (
                <p className="pa-row-subtitle">{backupStatusLabels[company.latest_job_status] || company.latest_job_status}</p>
              )}
              {(!company.is_active || company.suspended) && <p className="pa-row-subtitle">Planification suspendue</p>}
            </div>
            <button type="button" className="pa-link" onClick={() => setSelectedId(company.id)}>Ouvrir <ChevronRight size={16} /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}
