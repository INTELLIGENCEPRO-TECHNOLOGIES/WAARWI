import { Clock, LogOut, ShieldCheck, XCircle, Mail } from 'lucide-react';
import { useApp } from '../context/AppContext';

export function PendingApproval() {
  const { tenant, profile, signOut } = useApp();
  const rejected = (tenant as any)?.approval_status === 'rejected';
  const reason = (tenant as any)?.rejection_reason as string | undefined;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-brand-50/30 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="flex flex-col items-center mb-6">
          <div className="w-20 h-20 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center overflow-hidden p-2">
            <img src="/Picsart_26-05-30_02-43-37-384.png" alt="WAARWI" className="w-full h-full object-contain" />
          </div>
          <div className="text-sm font-bold tracking-wider text-slate-900 mt-2">WAARWI</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Plateforme Business 2.0 made in Sénégal</div>
        </div>
        <div className="bg-white rounded-3xl shadow-premium overflow-hidden">
          <div className={`relative overflow-hidden bg-gradient-to-br ${rejected ? 'from-red-500 to-rose-700' : 'from-amber-500 to-orange-600'} p-8 text-white`}>
            <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full blur-3xl -translate-y-12 translate-x-12" />
            <div className="relative">
              <div className="w-14 h-14 rounded-2xl bg-white/20 border border-white/30 backdrop-blur flex items-center justify-center mb-4">
                {rejected ? <XCircle className="w-7 h-7" /> : <Clock className="w-7 h-7" />}
              </div>
              <div className="text-[10px] uppercase tracking-wider font-bold opacity-80 mb-1">
                {rejected ? 'Accès refusé' : 'Validation requise'}
              </div>
              <h1 className="text-2xl font-bold leading-tight">
                {rejected ? 'Votre compte a été rejeté' : 'Votre compte est en attente'}
              </h1>
            </div>
          </div>

          <div className="p-8 space-y-6">
            {rejected ? (
              <>
                <p className="text-sm text-slate-700 leading-relaxed">
                  Un administrateur de la plateforme n'a pas validé votre inscription.
                </p>
                {reason && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-red-700 mb-1">Motif</div>
                    <div className="text-sm text-red-900">{reason}</div>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-slate-700 leading-relaxed">
                  Merci d'avoir créé votre compte <span className="font-semibold text-slate-900">{tenant?.name}</span>.
                  Un administrateur de la plateforme doit approuver votre inscription avant que vous puissiez accéder à l'application.
                </p>
                <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2 text-brand-800">
                    <ShieldCheck className="w-4 h-4" />
                    <div className="text-sm font-semibold">Processus sécurisé</div>
                  </div>
                  <p className="text-xs text-brand-900/80 leading-relaxed">
                    Cette étape protège la plateforme et garantit une mise en service adaptée à votre activité.
                  </p>
                </div>
                <div className="flex items-start gap-3 text-xs text-slate-600">
                  <Mail className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
                  <span>Vous serez notifié par email à l'adresse <span className="font-semibold text-slate-800">{profile?.email}</span> dès validation.</span>
                </div>
              </>
            )}

            <button
              onClick={signOut}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Se déconnecter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
