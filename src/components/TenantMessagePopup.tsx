import { useEffect, useState } from 'react';
import { AlertTriangle, Info, CheckCircle2, AlertOctagon, X, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';

const SEV_CFG = {
  info: { icon: Info, bg: 'from-sky-500 to-blue-700', border: 'border-sky-200', text: 'text-sky-800', soft: 'bg-sky-50' },
  success: { icon: CheckCircle2, bg: 'from-emerald-500 to-teal-700', border: 'border-emerald-200', text: 'text-emerald-800', soft: 'bg-emerald-50' },
  warning: { icon: AlertTriangle, bg: 'from-amber-500 to-orange-600', border: 'border-amber-200', text: 'text-amber-800', soft: 'bg-amber-50' },
  critical: { icon: AlertOctagon, bg: 'from-red-500 to-rose-700', border: 'border-red-200', text: 'text-red-800', soft: 'bg-red-50' },
} as const;

export function TenantMessagePopup() {
  const { user, tenant, profile } = useApp();
  const [queue, setQueue] = useState<any[]>([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!user) return;
    if (profile?.role === 'super_admin') return;
    (async () => {
      const now = new Date().toISOString();
      const { data: msgs } = await supabase
        .from('tenant_messages')
        .select('*')
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order('created_at', { ascending: false });
      if (!msgs || msgs.length === 0) return;
      const eligible = msgs.filter((m: any) => {
        if (m.target === 'all') return true;
        if (m.target === 'tenant') return m.tenant_id === tenant?.id;
        if (m.target === 'plan') return m.plan_code === tenant?.plan;
        return false;
      });
      if (eligible.length === 0) return;
      const { data: reads } = await supabase
        .from('tenant_message_reads')
        .select('message_id')
        .eq('user_id', user.id);
      const readIds = new Set((reads || []).map((r: any) => r.message_id));
      const unread = eligible.filter((m: any) => !readIds.has(m.id));
      if (unread.length) setQueue(unread);
    })();
  }, [user?.id, tenant?.id, profile?.role]);

  if (queue.length === 0 || idx >= queue.length) return null;
  const m = queue[idx];
  const cfg = SEV_CFG[m.severity as keyof typeof SEV_CFG] || SEV_CFG.info;
  const Icon = cfg.icon;

  const ack = async () => {
    if (user) {
      await supabase.from('tenant_message_reads').insert({ message_id: m.id, user_id: user.id }).then(() => {});
    }
    setIdx(i => i + 1);
  };

  const dismiss = () => {
    if (m.requires_ack) return;
    setIdx(i => i + 1);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-white rounded-3xl overflow-hidden shadow-premium animate-slide-up">
        <div className={`relative overflow-hidden bg-gradient-to-br ${cfg.bg} p-6 text-white`}>
          <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full blur-3xl -translate-y-10 translate-x-10" />
          <div className="relative flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/20 border border-white/30 backdrop-blur flex items-center justify-center shrink-0">
              <Icon className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider font-bold opacity-80">Message de la plateforme</div>
              <h3 className="text-lg font-bold leading-tight mt-0.5">{m.title}</h3>
            </div>
            {!m.requires_ack && (
              <button onClick={dismiss} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center shrink-0">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        <div className="p-6">
          {m.body && <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{m.body}</p>}
          {queue.length > 1 && (
            <div className="text-[11px] text-slate-400 mt-3 font-semibold">
              Message {idx + 1} sur {queue.length}
            </div>
          )}
        </div>
        <div className="px-6 pb-6 flex items-center gap-2">
          {m.cta_url && m.cta_label && (
            <a href={m.cta_url} target="_blank" rel="noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-semibold">
              {m.cta_label}<ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button onClick={ack}
            className={`flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r ${cfg.bg} text-white text-sm font-semibold hover:opacity-95 shadow-md`}>
            {m.requires_ack ? 'J\'ai compris' : 'Fermer'}
          </button>
        </div>
      </div>
    </div>
  );
}
