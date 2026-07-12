import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

const STORAGE_KEY = 'waarwi_last_seen_release';

interface Release {
  id: string;
  version: string;
  title: string;
  release_date: string;
  features: string[];
  fixes: string[];
}

export default function UpdateNotification() {
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  const [release, setRelease] = useState<Release | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('app_releases')
        .select('id, version, title, release_date, features, fixes')
        .eq('is_published', true)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || !data) return;
      const lastSeen = localStorage.getItem(STORAGE_KEY);
      if (lastSeen === data.version) return;
      setRelease({
        id: data.id,
        version: data.version,
        title: data.title,
        release_date: data.release_date,
        features: Array.isArray(data.features) ? data.features : [],
        fixes: Array.isArray(data.fixes) ? data.fixes : [],
      });
      setTimeout(() => { if (!cancelled) setVisible(true); }, 1000);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleInstall = () => {
    if (!release) return;
    setInstalling(true);
    setProgress(0);
    setPhase('Téléchargement des composants…');

    const phases = [
      { at: 12, text: 'Installation des modules…' },
      { at: 30, text: 'Mise à jour de la base de données…' },
      { at: 50, text: 'Compilation des interfaces…' },
      { at: 70, text: 'Optimisation des performances…' },
      { at: 88, text: 'Finalisation…' },
      { at: 100, text: 'Mise à jour terminée' },
    ];

    let current = 0;
    intervalRef.current = setInterval(() => {
      current += Math.random() * 3.5 + 1.2;
      if (current >= 100) current = 100;
      setProgress(Math.round(current));

      const activePhase = [...phases].reverse().find(p => current >= p.at);
      if (activePhase) setPhase(activePhase.text);

      if (current >= 100) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        localStorage.setItem(STORAGE_KEY, release.version);
        setTimeout(() => window.location.reload(), 900);
      }
    }, 70);
  };

  const handleDismiss = () => {
    if (!release) return;
    localStorage.setItem(STORAGE_KEY, release.version);
    setVisible(false);
  };

  if (!visible || !release) return null;

  const formattedDate = new Date(release.release_date).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  return (
    <div className="fixed inset-0 z-[9999] bg-white flex flex-col animate-in fade-in duration-300">
      {/* Top bar */}
      <div className="shrink-0 border-b border-neutral-100">
        <div className="max-w-2xl mx-auto w-full px-6 sm:px-8 h-16 flex items-center justify-between">
          <img src="/newlogoo.png" alt="Waarwi" className="h-8 object-contain" />
          {!installing && (
            <button
              onClick={handleDismiss}
              className="text-[13px] font-semibold text-neutral-400 hover:text-neutral-900 transition-colors"
            >
              Plus tard
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto w-full px-6 sm:px-8 py-10 sm:py-14">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold tracking-widest uppercase text-neutral-400">Mise à jour</span>
            <span className="h-px flex-1 bg-neutral-100" />
            <span className="text-[12px] font-bold text-neutral-900 tabular-nums border border-neutral-200 rounded-full px-2.5 py-0.5">v{release.version}</span>
          </div>

          <h1 className="mt-5 text-3xl sm:text-4xl font-black tracking-tight text-neutral-900 leading-tight">
            {release.title}
          </h1>
          <p className="mt-2 text-sm text-neutral-400 font-medium">{formattedDate}</p>

          <p className="mt-6 text-[15px] text-neutral-600 leading-relaxed max-w-xl">
            Une nouvelle version de Waarwi est disponible. Appliquez la mise à jour pour bénéficier
            des dernières améliorations et corrections.
          </p>

          {release.features.length > 0 && (
            <div className="mt-10">
              <h2 className="text-[11px] font-bold tracking-widest uppercase text-neutral-400">Nouveautés</h2>
              <ul className="mt-4 divide-y divide-neutral-100 border-t border-b border-neutral-100">
                {release.features.map((f, i) => (
                  <li key={i} className="flex items-baseline gap-4 py-3.5">
                    <span className="text-[11px] font-bold text-neutral-300 tabular-nums shrink-0 w-6">{String(i + 1).padStart(2, '0')}</span>
                    <span className="text-[14px] text-neutral-800 leading-relaxed font-medium">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {release.fixes.length > 0 && (
            <div className="mt-10">
              <h2 className="text-[11px] font-bold tracking-widest uppercase text-neutral-400">Corrections</h2>
              <ul className="mt-4 divide-y divide-neutral-100 border-t border-b border-neutral-100">
                {release.fixes.map((f, i) => (
                  <li key={i} className="flex items-baseline gap-4 py-3.5">
                    <span className="text-[11px] font-bold text-neutral-300 tabular-nums shrink-0 w-6">{String(i + 1).padStart(2, '0')}</span>
                    <span className="text-[14px] text-neutral-800 leading-relaxed font-medium">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 border-t border-neutral-100 bg-white">
        <div className="max-w-2xl mx-auto w-full px-6 sm:px-8 py-5">
          {!installing ? (
            <button
              onClick={handleInstall}
              className="w-full h-14 rounded-2xl bg-neutral-900 text-white text-[15px] font-bold tracking-tight hover:bg-neutral-800 active:scale-[0.99] transition-all"
            >
              Appliquer la mise à jour
            </button>
          ) : (
            <div className="space-y-3">
              <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-neutral-900 rounded-full transition-all duration-150 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-500 font-semibold">{phase}</span>
                <span className="text-sm font-black text-neutral-900 tabular-nums">{progress}%</span>
              </div>
            </div>
          )}
          <p className="mt-4 text-center text-[10px] font-semibold tracking-widest uppercase text-neutral-300">
            Propulsé par Waarwi — Plateforme Business 2.0
          </p>
        </div>
      </div>
    </div>
  );
}
