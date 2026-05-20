import { useEffect, useState } from 'react';

type Props = {
  logoUrl?: string | null;
  name: string;
  tagline?: string | null;
  onDone: () => void;
};

export function TenantWelcome({ logoUrl, name, tagline, onDone }: Props) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const leaveAt = window.setTimeout(() => setLeaving(true), 6800);
    const doneAt = window.setTimeout(() => onDone(), 7800);
    return () => {
      window.clearTimeout(leaveAt);
      window.clearTimeout(doneAt);
    };
  }, [onDone]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-hidden transition-opacity duration-1000 ${leaving ? 'opacity-0' : 'opacity-100'}`}
      style={{
        background:
          'radial-gradient(1400px 700px at 80% -10%, rgba(13,148,136,0.18), transparent 60%),' +
          'radial-gradient(1200px 600px at -10% 120%, rgba(20,184,166,0.14), transparent 60%),' +
          'radial-gradient(900px 500px at 50% 50%, rgba(15,118,110,0.06), transparent 70%),' +
          'linear-gradient(180deg, #f8fafc 0%, #ffffff 55%, #f1f5f9 100%)',
      }}
      aria-hidden
    >
      {/* Animated orbs */}
      <div className="absolute top-[-10%] right-[-10%] w-[520px] h-[520px] rounded-full bg-gradient-to-br from-brand-400/25 via-brand-300/10 to-transparent blur-3xl welcome-orb-a" />
      <div className="absolute bottom-[-15%] left-[-15%] w-[620px] h-[620px] rounded-full bg-gradient-to-tr from-teal-300/20 via-brand-200/10 to-transparent blur-3xl welcome-orb-b" />

      {/* Dot pattern */}
      <div
        className="absolute inset-0 opacity-[0.22] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(15,23,42,0.08) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'radial-gradient(ellipse at center, black 35%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 35%, transparent 75%)',
        }}
      />

      <div className="relative flex flex-col items-center px-6">
        {/* Aura behind logo */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[320px] h-[320px] rounded-full bg-gradient-to-br from-brand-400/30 via-brand-300/15 to-transparent blur-3xl welcome-aura" />

        {/* Rotating ring */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[55%] w-[240px] h-[240px] welcome-ring">
          <div
            className="w-full h-full rounded-full"
            style={{
              background:
                'conic-gradient(from 0deg, rgba(13,148,136,0) 0deg, rgba(13,148,136,0.35) 90deg, rgba(20,184,166,0.15) 180deg, rgba(13,148,136,0) 360deg)',
              maskImage: 'radial-gradient(circle, transparent 60%, black 62%, black 68%, transparent 70%)',
              WebkitMaskImage: 'radial-gradient(circle, transparent 60%, black 62%, black 68%, transparent 70%)',
            }}
          />
        </div>

        {logoUrl ? (
          <img
            src={logoUrl}
            alt={name}
            className="relative w-40 h-40 object-contain welcome-logo-reveal drop-shadow-[0_20px_50px_rgba(15,23,42,0.22)]"
          />
        ) : (
          <img
            src="/waarwi-logo.png"
            alt={name}
            className="relative w-56 h-auto object-contain welcome-logo-reveal drop-shadow-[0_20px_50px_rgba(15,23,42,0.22)]"
          />
        )}

        <h1 className="relative mt-6 text-3xl sm:text-4xl font-bold text-slate-900 text-center welcome-name-reveal">
          <span className="welcome-shine-text">{name}</span>
        </h1>

        {tagline && (
          <p className="relative mt-2 text-sm text-slate-600 text-center max-w-sm welcome-sub-reveal">
            {tagline}
          </p>
        )}

        <div className="relative mt-8 welcome-dots-reveal flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-600 welcome-dot welcome-dot-1" />
          <span className="w-1.5 h-1.5 rounded-full bg-brand-600 welcome-dot welcome-dot-2" />
          <span className="w-1.5 h-1.5 rounded-full bg-brand-600 welcome-dot welcome-dot-3" />
        </div>
      </div>
    </div>
  );
}
