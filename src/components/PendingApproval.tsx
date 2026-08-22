import { useEffect, useState } from 'react';
import { LogOut, Building2, Phone, Headphones, RefreshCw, Clock, CheckCircle2, XCircle, AlertTriangle, CreditCard, MessageCircle } from 'lucide-react';
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
  const [planName, setPlanName] = useState<string | null>(null);

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

    const planCode = (tenant as any)?.selected_plan_code || (tenant as any)?.plan;
    if (planCode) {
      supabase.from('plans').select('name').eq('code', planCode).maybeSingle().then(({ data }) => {
        if (data?.name) setPlanName(data.name);
      });
    }
  }, [tenant]);

  const currentStep = rejected ? -1 : 2;
  const whatsapp = (tenant as any)?.whatsapp_phone;

  return (
    <div className="h-screen bg-white flex flex-col overflow-hidden">

      {/* TOP HEADER */}
      <header className="shrink-0 flex flex-col items-center pt-10 pb-4 px-4">
        <img
          src="/newlogo.png"
          alt="Waarwi"
          className="h-8 w-auto object-contain"
          onError={e => {
            (e.target as HTMLImageElement).style.display = 'none';
            const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement | null;
            if (fallback) fallback.style.display = 'flex';
          }}
        />
        <div className="hidden items-end gap-0 select-none" aria-hidden>
          <span className="text-3xl font-black tracking-tight text-neutral-900">Waar</span>
          <span className="text-3xl font-black tracking-tight text-[#00b4d8]">wi</span>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 min-h-0">
        <div className="w-full max-w-md md:max-w-lg">

          {rejected ? (
            /* ---- REJECTED STATE ---- */
            <div className="text-center space-y-6">
              <div className="flex justify-center">
                <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
                  <XCircle className="w-7 h-7 text-red-500" />
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-500 mb-2">Accès refusé</p>
                <h2 className="text-xl md:text-2xl font-bold text-neutral-900">
                  {tenant?.name || 'Votre compte'}
                </h2>
              </div>
              <p className="text-sm text-neutral-500 leading-relaxed max-w-sm mx-auto">
                Votre inscription n'a pas été validée par l'équipe Waarwi.
              </p>
              {reason && (
                <div className="text-left max-w-sm mx-auto border-b border-red-200 pb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-red-600">Motif</span>
                  </div>
                  <p className="text-sm text-red-800">{reason}</p>
                </div>
              )}
            </div>
          ) : (
            /* ---- PENDING STATE ---- */
            <div className="text-center space-y-6">
              {/* Company info */}
              <div className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-full bg-neutral-50 flex items-center justify-center">
                  <Building2 className="w-6 h-6 text-neutral-900" />
                </div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400 mt-1">
                  Votre entreprise
                </p>
                <h2 className="text-xl md:text-2xl font-bold text-neutral-900 uppercase tracking-wide leading-tight">
                  {tenant?.name || '\u2014'}
                </h2>
              </div>

              {/* Tags — underline-separated, no cards */}
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                {activityName && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
                    <Building2 className="w-3.5 h-3.5 text-neutral-400" />
                    {activityName}
                  </span>
                )}
                {planName && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
                    <CreditCard className="w-3.5 h-3.5 text-neutral-400" />
                    Plan {planName}
                  </span>
                )}
                {whatsapp && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
                    <MessageCircle className="w-3.5 h-3.5 text-neutral-400" />
                    {whatsapp}
                  </span>
                )}
              </div>

              {/* Status badge */}
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-600">
                    Validation en cours
                  </span>
                </div>
                <p className="text-xs text-neutral-400 mt-1">
                  Notre équipe vous contactera par WhatsApp après vérification.
                </p>
              </div>
            </div>
          )}

          {/* PROGRESS STEPS — clean minimal */}
          <div className="mt-10">
            <div className="relative flex items-start justify-between">
              {/* Connecting line */}
              <div className="absolute top-3.5 left-[12.5%] right-[12.5%] h-px border-t border-dashed border-neutral-200 z-0" />
              {STEPS.map((step, idx) => {
                const isDone = idx < currentStep;
                const isCurrent = idx === currentStep;
                return (
                  <div key={step.key} className="relative z-10 flex flex-col items-center text-center flex-1 px-0.5">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center mb-1.5 transition-all ${
                      isDone
                        ? 'bg-emerald-50'
                        : isCurrent
                          ? 'bg-neutral-900'
                          : 'bg-white border border-neutral-200'
                    }`}>
                      {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      {isCurrent && <RefreshCw className="w-3.5 h-3.5 text-white animate-spin" style={{ animationDuration: '2s' }} />}
                      {!isDone && !isCurrent && <Clock className="w-3.5 h-3.5 text-neutral-300" />}
                    </div>
                    <div className={`text-[10px] md:text-[11px] font-semibold leading-tight ${
                      isDone ? 'text-emerald-600' : isCurrent ? 'text-neutral-900' : 'text-neutral-400'
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

      {/* FOOTER */}
      <footer className="shrink-0 flex flex-col items-center gap-4 pb-8 pt-4 px-4">
        <button
          onClick={signOut}
          className="h-10 px-8 bg-neutral-100 hover:bg-neutral-200 active:scale-[0.98] text-neutral-700 text-[13px] font-semibold transition-all flex items-center gap-2"
        >
          <LogOut className="w-4 h-4" />
          Se déconnecter
        </button>

        <div className="flex items-center gap-3 text-[11px] text-neutral-400">
          <span className="flex items-center gap-1.5">
            <Headphones className="w-3 h-3" />
            Assistance
          </span>
          <span className="text-neutral-200">|</span>
          <span className="flex items-center gap-1.5 text-neutral-600 font-semibold">
            <Phone className="w-3 h-3" />
            77 525 41 01
          </span>
        </div>
      </footer>
    </div>
  );
}
