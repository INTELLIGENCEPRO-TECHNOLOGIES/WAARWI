import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { MULTI_CASH_CAMPAIGN, isCampaignActive, isDismissedForever, dismissForever } from '../lib/multiCashAnnouncement';

type Phase = 'idle' | 'checking' | 'ready' | 'open' | 'done';

const STEPS = [
  <>Ouvrez <b>Paramètres</b>, puis <b>Caisses</b>.</>,
  <>Choisissez le magasin dans le champ <b>Magasin</b>.</>,
  <>Créez une caisse par poste avec <b>Nouvelle caisse</b>, puis affectez l’équipe avec <b>Collaborateurs</b>.</>,
  <>Dans <b>Mode multi-caisse</b>, cliquez sur <b>Activer</b> une fois chaque magasin et chaque collaborateur équipé d’une caisse.</>,
  <>Chaque caissier ouvre ensuite sa propre session depuis <b>Caisse</b>, avec <b>Ouvrir la caisse</b>.</>,
];

const MAX_TIMEOUT = 2_147_483_647;

function screenIsBusy(route: string, cartCount: number): boolean {
  if (route === 'pos' && cartCount > 0) return true;
  if (document.visibilityState !== 'visible') return true;
  if (document.querySelector('[data-app-overlay]')) return true;
  const el = document.activeElement as HTMLElement | null;
  if (el?.isContentEditable) return true;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.trim() !== '';
  return false;
}

export function MultiCashAnnouncement({ route, onConfigure }: { route: string; onConfigure: () => void }) {
  const { user, profile, tenant, posCartCount } = useApp();
  const { can, loading: permsLoading } = usePermissions();
  const [phase, setPhase] = useState<Phase>('idle');
  const primaryRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef({ route, cart: posCartCount });
  busyRef.current = { route, cart: posCartCount };

  const userId = user?.id;
  const tenantId = tenant?.id;
  const eligible = !!userId && !!tenantId && !!profile && profile.role !== 'super_admin' && profile.role !== 'cashier'
    && !permsLoading && can('manage_cash_sessions') && can('manage_settings');

  const started = useRef(false);
  useEffect(() => {
    if (started.current || !eligible || !userId || !tenantId) return;
    if (!isCampaignActive(Date.now()) || isDismissedForever(userId, tenantId)) return;
    started.current = true;
    setPhase('checking');
    supabase.rpc('cash_multi_status').then(({ data, error }) => {
      const ok = !error && !!data && typeof (data as { multi_enabled?: unknown }).multi_enabled === 'boolean';
      setPhase(ok ? 'ready' : 'done');
    });
  }, [eligible, userId, tenantId]);

  useEffect(() => {
    if (phase !== 'ready') return;
    const tick = () => {
      if (!isCampaignActive(Date.now())) { setPhase('done'); return; }
      if (!screenIsBusy(busyRef.current.route, busyRef.current.cart)) setPhase('open');
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'open') return;
    const remaining = Math.min(MULTI_CASH_CAMPAIGN.endsAt - Date.now(), MAX_TIMEOUT);
    if (remaining <= 0) { setPhase('done'); return; }
    const timer = window.setTimeout(() => setPhase('done'), remaining);
    const onVisible = () => { if (!isCampaignActive(Date.now())) setPhase('done'); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPhase('done'); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('keydown', onKey);
    primaryRef.current?.focus({ preventScroll: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('keydown', onKey);
    };
  }, [phase]);

  if (phase !== 'open' || !userId || !tenantId) return null;

  const close = () => setPhase('done');
  const neverAgain = () => { dismissForever(userId, tenantId); setPhase('done'); };
  const configure = () => { setPhase('done'); onConfigure(); };

  return (
    <div className="fixed inset-0 z-[10005] flex items-end sm:items-center justify-center p-3 sm:p-6">
      <div className="mc-announce-scrim absolute inset-0 bg-black/50" onClick={close} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-labelledby="mc-announce-title" aria-describedby="mc-announce-body"
        className="mc-announce-panel relative w-full max-w-[440px] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-lg border border-[var(--w-separator)] bg-[var(--w-surface)] text-[var(--w-text)]">
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-[var(--w-separator)]">
          <img src="/newlogo.png" alt="Waarwi" className="h-6 w-auto max-w-[110px] object-contain w-platform-logo" />
          <button onClick={close} aria-label="Fermer l’annonce"
            className="w-8 h-8 -mr-1.5 rounded-md flex items-center justify-center text-[var(--w-text-muted)] hover:bg-[var(--w-hover)] hover:text-[var(--w-text)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--w-text)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pt-4 pb-5">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--w-text-muted)]">Nouveau</div>
          <h2 id="mc-announce-title" className="mt-1 text-[19px] font-bold leading-[1.2] tracking-tight">Plusieurs caisses. Un seul magasin.</h2>
          <p id="mc-announce-body" className="mt-2 text-[13px] leading-[1.5] text-[var(--w-text-sec)]">
            Le mode multi-caisse est désormais disponible sur Waarwi. Chaque collaborateur utilise sa propre caisse, avec des sessions et des rapports séparés. Vous gardez une vue globale de votre activité.
          </p>

          <ol className="mt-4 border-t border-[var(--w-separator)]">
            {STEPS.map((s, i) => (
              <li key={i} className="flex gap-3 py-2 border-b border-[var(--w-separator)] text-[12.5px] leading-[1.5] text-[var(--w-text-sec)] [&_b]:font-semibold [&_b]:text-[var(--w-text)]">
                <span className="w-5 h-5 mt-px shrink-0 rounded-full border border-[var(--w-text)] flex items-center justify-center text-[10.5px] font-bold tabular-nums text-[var(--w-text)]">{i + 1}</span>
                <span className="min-w-0">{s}</span>
              </li>
            ))}
          </ol>

          <div className="mt-5 flex flex-col-reverse sm:flex-row sm:items-center gap-2">
            <button onClick={neverAgain}
              className="sm:mr-auto h-9 px-1 text-[12.5px] font-medium text-[var(--w-text-muted)] hover:text-[var(--w-text)] underline-offset-4 hover:underline transition-colors">
              Ne plus afficher
            </button>
            <button onClick={close}
              className="h-10 px-4 rounded-md border border-[var(--w-separator)] text-[13px] font-semibold hover:bg-[var(--w-hover)] transition-colors">
              Plus tard
            </button>
            <button ref={primaryRef} onClick={configure}
              className="h-10 px-4 rounded-md bg-[var(--w-text)] text-[var(--w-surface)] text-[13px] font-bold hover:opacity-90 active:translate-y-px transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--w-text)]">
              Configurer mes caisses
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
