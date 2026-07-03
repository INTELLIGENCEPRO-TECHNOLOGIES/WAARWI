import { useState, useEffect, useRef } from 'react';
import { Sparkles, Check, Bug, X, Rocket } from 'lucide-react';
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
    setPhase('Téléchargement des composants...');

    const phases = [
      { at: 12, text: 'Installation des modules...' },
      { at: 30, text: 'Mise à jour de la base de données...' },
      { at: 50, text: 'Compilation des interfaces...' },
      { at: 70, text: 'Optimisation des performances...' },
      { at: 88, text: 'Finalisation...' },
      { at: 100, text: 'Mise à jour terminée !' },
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
        onClick={!installing ? handleDismiss : undefined}
      />

      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in slide-in-from-bottom-4 duration-500">
        {/* Header */}
        <div className="relative overflow-hidden bg-white px-7 pt-7 pb-5 border-b border-neutral-100">
          {/* Subtle decorative background */}
          <div className="absolute -top-20 -right-20 w-56 h-56 bg-gradient-to-bl from-emerald-50 to-transparent rounded-full opacity-80" />
          <div className="absolute -bottom-16 -left-16 w-40 h-40 bg-gradient-to-tr from-sky-50 to-transparent rounded-full opacity-60" />

          {!installing && (
            <button
              onClick={handleDismiss}
              className="absolute top-4 right-4 p-2 rounded-full text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          <div className="relative flex items-center gap-4">
            <div className="w-14 h-14 bg-white rounded-2xl shadow-md border border-neutral-100 flex items-center justify-center p-2">
              <img src="/newlogoo.png" alt="Waarwi" className="w-full h-full object-contain" />
            </div>
            <div>
              <h2 className="text-xl font-black text-neutral-900 tracking-tight">{release.title}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold">
                  <Rocket className="w-3 h-3" />v{release.version}
                </span>
                <span className="text-xs text-neutral-400 font-medium">{formattedDate}</span>
              </div>
            </div>
          </div>

          <p className="relative mt-4 text-sm text-neutral-500 leading-relaxed">
            Une nouvelle version de Waarwi est disponible avec des améliorations et des corrections importantes pour votre expérience.
          </p>
        </div>

        {/* Content */}
        <div className="px-7 py-5 max-h-[42vh] overflow-y-auto bg-neutral-50/50">
          {release.features.length > 0 && (
            <div className="mb-5">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center shadow-sm">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                </div>
                <h3 className="text-xs font-black text-neutral-900 uppercase tracking-wider">Nouveautés</h3>
              </div>
              <ul className="space-y-2.5 pl-1">
                {release.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-3 group">
                    <span className="mt-2 w-2 h-2 rounded-full bg-emerald-500 shrink-0 shadow-sm shadow-emerald-200 group-hover:scale-150 transition-transform duration-200" />
                    <span className="text-[13px] text-neutral-700 leading-relaxed font-medium">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {release.fixes.length > 0 && (
            <div>
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-7 h-7 rounded-lg bg-sky-100 flex items-center justify-center shadow-sm">
                  <Bug className="w-3.5 h-3.5 text-sky-600" />
                </div>
                <h3 className="text-xs font-black text-neutral-900 uppercase tracking-wider">Corrections</h3>
              </div>
              <ul className="space-y-2.5 pl-1">
                {release.fixes.map((f, i) => (
                  <li key={i} className="flex items-start gap-3 group">
                    <span className="mt-2 w-2 h-2 rounded-full bg-sky-500 shrink-0 shadow-sm shadow-sky-200 group-hover:scale-150 transition-transform duration-200" />
                    <span className="text-[13px] text-neutral-700 leading-relaxed font-medium">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-7 pb-7 pt-4 bg-white border-t border-neutral-100">
          {!installing ? (
            <button
              onClick={handleInstall}
              className="w-full relative overflow-hidden group bg-neutral-900 hover:bg-neutral-800 text-white font-bold py-4 px-6 rounded-2xl shadow-lg shadow-neutral-900/15 hover:shadow-xl hover:shadow-neutral-900/25 transition-all duration-300 active:scale-[0.98]"
            >
              <span className="relative z-10 flex items-center justify-center gap-2.5 text-[15px]">
                <Check className="w-5 h-5" />
                Appliquer la mise à jour
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-600 to-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl" />
              <span className="absolute inset-0 z-10 flex items-center justify-center gap-2.5 text-[15px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                <Check className="w-5 h-5" />
                Appliquer la mise à jour
              </span>
            </button>
          ) : (
            <div className="space-y-3">
              <div className="relative h-3.5 bg-neutral-100 rounded-full overflow-hidden shadow-inner">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-150 ease-out"
                  style={{ width: `${progress}%` }}
                />
                {progress < 100 && (
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-white/20 to-transparent rounded-full"
                    style={{ width: `${progress}%`, animation: 'pulse 1.5s ease-in-out infinite' }}
                  />
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-600 font-semibold">{phase}</span>
                <span className="text-sm font-black text-neutral-900 tabular-nums">{progress}%</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
