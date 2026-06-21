import { useEffect, useState } from 'react';

type Props = {
  logoUrl?: string | null;
  name: string;
  tagline?: string | null;
  onDone: () => void;
};

export function TenantWelcome({ logoUrl, name, onDone }: Props) {
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
          'radial-gradient(1400px 700px at 80% -10%, rgba(13,148,136,0.12), transparent 60%),' +
          'radial-gradient(1200px 600px at -10% 120%, rgba(20,184,166,0.10), transparent 60%),' +
          'linear-gradient(180deg, #f8fafc 0%, #ffffff 55%, #f1f5f9 100%)',
      }}
      aria-hidden
    >
      <div className="relative flex flex-col items-center px-6">
        <img
          src={logoUrl || '/newlogo.png'}
          alt=""
          className="relative w-44 h-44 object-contain welcome-logo-reveal"
        />

        <div className="relative mt-4 text-xs sm:text-sm font-medium text-slate-600 text-center welcome-name-reveal tracking-wide">
          {name}
        </div>
      </div>
    </div>
  );
}
