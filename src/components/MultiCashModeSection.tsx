import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { Modal } from './Modal';

type Anomaly = { code: string; label: string; items: string[] };

type MultiStatus = {
  multi_enabled: boolean;
  enabled_at: string | null;
  enabled_by_name: string | null;
  sites_count: number;
  active_registers_count: number;
  open_sessions_count: number;
  blocking_enable: Anomaly[];
  blocking_disable: Anomaly[];
};

function isStatus(d: unknown): d is MultiStatus {
  return !!d && typeof d === 'object' && typeof (d as MultiStatus).multi_enabled === 'boolean';
}

export function MultiCashModeSection({ onChanged }: { onChanged?: () => void }) {
  const { success, error } = useToast();
  const [status, setStatus] = useState<MultiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await supabase.rpc('cash_multi_status');
    setLoading(false);
    if (e) { setStatus(null); setLoadError(e.code === '42501' ? null : e.message); return; }
    if (!isStatus(data)) { setStatus(null); setLoadError('Réponse inattendue du serveur'); return; }
    setLoadError(null);
    setStatus(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !status) {
    return <div className="py-5 flex items-center gap-2 text-[13px] text-neutral-400 border-b border-neutral-200"><Loader2 className="w-4 h-4 animate-spin" />Mode multi-caisse…</div>;
  }
  if (loadError) {
    return <div className="py-5 text-[13px] text-red-600 border-b border-neutral-200">{loadError}</div>;
  }
  if (!status) return null;

  const enabled = status.multi_enabled;
  const blocking = enabled ? status.blocking_disable : status.blocking_enable;
  const blocked = blocking.length > 0;

  const apply = async () => {
    setSaving(true);
    const { data, error: e } = await supabase.rpc('cash_multi_set_enabled', { p_enabled: !enabled });
    setSaving(false);
    if (e) { error(e.message); load(); return; }
    if (isStatus(data)) setStatus(data); else load();
    setConfirmOpen(false);
    success(!enabled ? 'Mode multi-caisse activé' : 'Mode multi-caisse désactivé');
    onChanged?.();
  };

  return (
    <section className="py-6 border-b border-neutral-200">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-[15px] font-bold text-neutral-900">Mode multi-caisse</h4>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${enabled ? 'bg-neutral-900 text-white' : 'border border-neutral-300 text-neutral-600'}`}>
              {enabled ? 'Activé' : 'Désactivé'}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-neutral-500 leading-relaxed max-w-2xl">
            {enabled
              ? 'Chaque collaborateur ouvre et clôture sa propre caisse. Personne ne peut encaisser ni consulter la session d’un collègue ; les responsables suivent les magasins qui leur sont confiés.'
              : 'Une seule session de caisse est partagée par magasin. En activant ce mode, chaque collaborateur travaillera dans sa propre caisse, avec son propre compte.'}
          </p>
          {enabled && status.enabled_at && (
            <p className="mt-1 text-[12px] text-neutral-400">
              Activé le {new Date(status.enabled_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {status.enabled_by_name ? ` par ${status.enabled_by_name}` : ''}
            </p>
          )}
          <div className="mt-3 flex items-center gap-5 text-[12.5px] text-neutral-600 flex-wrap">
            <span><span className="font-bold text-neutral-900 tabular-nums">{status.sites_count}</span> magasins</span>
            <span><span className="font-bold text-neutral-900 tabular-nums">{status.active_registers_count}</span> caisses actives</span>
            <span><span className="font-bold text-neutral-900 tabular-nums">{status.open_sessions_count}</span> sessions ouvertes</span>
          </div>
        </div>
        <button onClick={() => setConfirmOpen(true)} disabled={blocked || saving}
          className={`inline-flex items-center justify-center gap-2 px-4 h-10 text-[13px] font-bold rounded-[5px] transition active:translate-y-px shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
            enabled ? 'border border-neutral-300 text-neutral-800 hover:bg-neutral-100' : 'bg-neutral-900 text-white hover:bg-neutral-800'}`}>
          {enabled ? 'Désactiver' : 'Activer'}
        </button>
      </div>

      {blocked && (
        <div className="mt-4 border border-neutral-300 rounded-md">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-200 text-[12.5px] font-semibold text-neutral-800">
            <AlertTriangle className="w-4 h-4 text-neutral-700" />
            {enabled ? 'Désactivation impossible pour le moment' : 'Activation impossible pour le moment'} — corrigez les points suivants :
          </div>
          <ul className="divide-y divide-neutral-100">
            {blocking.map(a => (
              <li key={a.code} className="px-3 py-2">
                <div className="text-[12.5px] font-semibold text-neutral-900">{a.label} <span className="text-neutral-400 font-normal">({a.items.length}{a.items.length >= 50 ? '+' : ''})</span></div>
                <div className="mt-0.5 text-[12px] text-neutral-500 leading-relaxed break-words">{a.items.join(' · ')}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal open={confirmOpen} onClose={() => !saving && setConfirmOpen(false)} title={enabled ? 'Désactiver le mode multi-caisse' : 'Activer le mode multi-caisse'} size="sm"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setConfirmOpen(false)} disabled={saving} className="px-3 h-9 text-[13px] font-medium text-neutral-500 hover:text-neutral-800 disabled:opacity-40">Annuler</button>
            <button onClick={apply} disabled={saving} className="inline-flex items-center gap-2 px-4 h-9 rounded-[5px] bg-neutral-900 text-white text-[13px] font-bold hover:bg-neutral-800 disabled:opacity-50">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}Confirmer
            </button>
          </div>
        }>
        <div className="space-y-3 text-[13px] text-neutral-700 leading-relaxed">
          {enabled ? (
            <p>Le point de vente reviendra à une session unique par magasin. Les sessions déjà ouvertes ne sont pas modifiées.</p>
          ) : (
            <>
              <p>Chaque collaborateur devra se connecter avec <strong>son propre compte</strong> et ouvrir la caisse qui lui est affectée.</p>
              <ul className="space-y-1.5">
                <li className="flex gap-2"><ShieldCheck className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />Une caisse ne peut être ouverte que par une personne à la fois.</li>
                <li className="flex gap-2"><ShieldCheck className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />Personne, même un administrateur, n’encaisse dans la session d’un collègue.</li>
                <li className="flex gap-2"><ShieldCheck className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />Les sessions déjà ouvertes restent inchangées.</li>
              </ul>
            </>
          )}
        </div>
      </Modal>
    </section>
  );
}
