import { useEffect, useState } from 'react';
import { LogOut, Building2, Phone, Headphones, RefreshCw, Clock, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';

const STEPS = [
  { key: 'created', label: 'Compte créé', desc: 'Votre compte a été créé.' },
  { key: 'email', label: 'Email vérifié', desc: 'Votre email a été confirmé.' },
  { key: 'validation', label: "Validation de l'activité", desc: "Nous vérifions les informations de votre entreprise." },
  { key: 'activation', label: "Activation de l'espace", desc: 'Votre espace sera activé après validation.' },
];

export function PendingApproval() {
  const { tenant, signOut } = useApp();
  const rejected = (tenant as any)?.approval_status === 'rejected';
  const reason = (tenant as any)?.rejection_reason as string | undefined;
  const [activityName, setActivityName] = useState<string | null>(null);

  useEffect(() => {
    const activityTypeId = (tenant as any)?.business_activity_type_id;
    if (activityTypeId) {
      supabase
        .from('business_activity_types')
        .select('name')
        .eq('id', activityTypeId)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.name) setActivityName(data.name);
        });
    } else {
      const bt = (tenant as any)?.business_type;
      if (bt && bt !== 'generic') {
        supabase
          .from('business_activity_types')
          .select('name')
          .or(`slug.eq.${bt},legacy_business_type.eq.${bt}`)
          .maybeSingle()
          .then(({ data }) => {
            if (data?.name) setActivityName(data.name);
          });
      }
    }
  }, [tenant]);

  const currentStep = rejected ? -1 : 2;

  return (
    <div className="h-screen bg-white flex flex-col overflow-hidden">

      {/* TOP HEADER */}
      <header className="shrink-0 flex flex-col items-center pt-8 pb-4 px-4">
        <img
          src="/waarwi.png"
          alt="Waarwi"
          className="h-12 md:h-16 object-contain"
          onError={e => {
            (e.target as HTMLImageElement).style.display = 'none';
            const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement | null;
            if (fallback) fallback.style.display = 'flex';
          }}
        />
        <div className="hidden items-end gap-0 select-none" aria-hidden>
          <span className="text-3xl md:text-4xl font-black tracking-tight text-[#0a1f44]">Waar</span>
          <span className="text-3xl md:text-4xl font-black tracking-tight text-[#00b4d8]">wi</span>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 min-h-0">
        <div className="w-full max-w-md md:max-w-lg">

          {rejected ? (
            <div className="bg-white border border-red-100 rounded-2xl shadow-sm p-6 md:p-8 text-center space-y-4">
              <div className="flex justify-center">
                <div className="w-14 h-14 rounded-full bg-red-50 border-2 border-red-200 flex items-center justify-center">
                  <XCircle className="w-7 h-7 text-red-500" />
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-red-500 mb-1">Acces refuse</div>
                <h2 className="text-xl md:text-2xl font-black text-slate-900">
                  {tenant?.name || 'Votre compte'}
                </h2>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Votre inscription n&apos;a pas ete validee par l&apos;equipe Waarwi.
              </p>
              {reason && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-left">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-red-700">Motif</span>
                  </div>
                  <p className="text-sm text-red-900">{reason}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-6 md:p-8 text-center space-y-5">
              <div className="flex flex-col items-center gap-2">
                <div className="w-14 h-14 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                  <Building2 className="w-7 h-7 text-[#0a1f44]" />
                </div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">
                  Votre entreprise
                </div>
                <h2 className="text-xl md:text-2xl font-black text-slate-900 uppercase tracking-wide leading-tight">
                  {tenant?.name || '\u2014'}
                </h2>
              </div>

              {activityName && (
                <div className="flex flex-col items-center gap-1">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Activite choisie
                  </div>
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-slate-50">
                    <Building2 className="w-4 h-4 text-[#00b4d8] shrink-0" />
                    <span className="text-sm font-semibold text-slate-800">{activityName}</span>
                  </div>
                </div>
              )}

              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange-500" />
                  </span>
                  <span className="text-xs font-black uppercase tracking-widest text-orange-500">
                    Validation en cours
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Votre espace Waarwi est en preparation.
                </p>
              </div>
            </div>
          )}

          {/* PROGRESS STEPS */}
          <div className="mt-6">
            <div className="relative flex items-start justify-between gap-1">
              <div className="absolute top-4 left-[12.5%] right-[12.5%] h-px border-t-2 border-dashed border-slate-200 z-0" />
              {STEPS.map((step, idx) => {
                const isDone = idx < currentStep;
                const isCurrent = idx === currentStep;
                const isPending = idx > currentStep;
                return (
                  <div key={step.key} className="relative z-10 flex flex-col items-center text-center flex-1 px-0.5">
                    <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center mb-1.5 transition-all ${
                      isDone
                        ? 'bg-emerald-50 border-emerald-300'
                        : isCurrent
                          ? 'bg-[#0a1f44] border-[#0a1f44] shadow-sm'
                          : 'bg-white border-slate-200'
                    }`}>
                      {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      {isCurrent && <RefreshCw className="w-3.5 h-3.5 text-white animate-spin" style={{ animationDuration: '2s' }} />}
                      {isPending && <Clock className="w-3.5 h-3.5 text-slate-300" />}
                    </div>
                    <div className={`text-[10px] md:text-[11px] font-bold leading-tight ${
                      isDone ? 'text-emerald-700' : isCurrent ? 'text-slate-900' : 'text-slate-400'
                    }`}>
                      {step.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* FOOTER - always visible */}
      <footer className="shrink-0 flex flex-col items-center gap-3 pb-6 pt-4 px-4">
        <button
          onClick={signOut}
          className="flex items-center gap-2.5 px-8 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 text-sm font-bold transition-all"
        >
          <LogOut className="w-4 h-4" />
          Se deconnecter
        </button>

        <div className="flex items-center gap-3 text-xs text-slate-400 font-medium">
          <span className="flex items-center gap-1.5">
            <Headphones className="w-3.5 h-3.5" />
            Assistance
          </span>
          <span className="text-slate-200">|</span>
          <span className="flex items-center gap-1.5 text-slate-600 font-bold">
            <Phone className="w-3.5 h-3.5" />
            77 525 41 01
          </span>
        </div>
      </footer>
    </div>
  );
}
