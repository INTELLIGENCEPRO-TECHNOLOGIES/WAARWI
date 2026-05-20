import { useEffect, useState } from 'react';
import {
  Wallet, Play, ShieldCheck, Clock, Calendar, Banknote, AlertTriangle,
  History, ChevronRight, RefreshCw, CheckCircle2, Lock, CircleDot,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatFCFA } from '../lib/format';

type Session = {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number | string;
  closing_amount: number | string | null;
  theoretical_amount: number | string | null;
  variance: number | string | null;
  status: string;
};

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

/* ──────────────────── Active session card (premium) ─────────────────── */

type ActiveProps = {
  session: { opened_at: string; opening_amount: number | string };
  siteName?: string;
  onResume: () => void;
};

export function ActiveCashSessionCard({ session, siteName, onResume }: ActiveProps) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-emerald-200/70 shadow-[0_8px_30px_-12px_rgba(16,185,129,0.35)] bg-gradient-to-br from-white via-emerald-50/40 to-emerald-100/40 backdrop-blur-xl">
      {/* Decorative blobs */}
      <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-emerald-400/20 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -left-12 w-44 h-44 rounded-full bg-teal-300/20 blur-3xl pointer-events-none" />

      <div className="relative p-3.5 sm:p-4">
        {/* Header compact */}
        <div className="flex items-center gap-2.5 mb-3">
          <div className="relative shrink-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white flex items-center justify-center shadow-md ring-2 ring-white">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-700 leading-none mb-0.5">
              Session en cours
            </div>
            <h2 className="text-sm font-bold text-slate-900 leading-tight truncate">
              Caisse ouverte
            </h2>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[9px] font-bold uppercase tracking-wider shadow-sm">
            <span className="w-1 h-1 rounded-full bg-white animate-pulse" />
            Ouverte
          </span>
        </div>

        {/* Info rows ultra-compactes */}
        <div className="space-y-1.5">
          {siteName && (
            <InfoRow icon={ShieldCheck} label="Point de vente" value={siteName} accent="slate" />
          )}
          <InfoRow
            icon={Calendar}
            label="Ouverte le"
            value={`${fmtDate(session.opened_at)} · ${fmtTime(session.opened_at)}`}
            accent="slate"
          />
          <InfoRow
            icon={Banknote}
            label="Fond initial"
            value={formatFCFA(Number(session.opening_amount))}
            accent="emerald"
            strong
          />
        </div>

        {/* Action */}
        <button
          onClick={onResume}
          className="group mt-3 w-full relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-emerald-700 text-white font-bold text-sm py-2.5 px-4 shadow-[0_6px_20px_-8px_rgba(16,185,129,0.55)] hover:shadow-[0_8px_24px_-6px_rgba(16,185,129,0.7)] active:scale-[0.99] transition-all"
        >
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out" />
          <span className="relative flex items-center justify-center gap-2">
            <Play className="w-4 h-4 fill-current" />
            Reprendre la session
            <ChevronRight className="w-4 h-4 opacity-70 group-hover:translate-x-0.5 transition-transform" />
          </span>
        </button>
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon, label, value, accent = 'slate', strong = false,
}: {
  icon: typeof Wallet; label: string; value: string;
  accent?: 'slate' | 'emerald' | 'amber'; strong?: boolean;
}) {
  const accentClass =
    accent === 'emerald' ? 'text-emerald-700 bg-emerald-100/70' :
    accent === 'amber' ? 'text-amber-700 bg-amber-100/70' :
    'text-slate-600 bg-slate-100/80';
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white/70 backdrop-blur-sm border border-white shadow-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-6 h-6 rounded-md flex items-center justify-center ${accentClass}`}>
          <Icon className="w-3 h-3" />
        </span>
        <span className="text-[11px] font-medium text-slate-500 truncate">{label}</span>
      </div>
      <span className={`text-[12px] tabular-nums truncate ${strong ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
        {value}
      </span>
    </div>
  );
}

/* ─────────────────── Recent sessions list (premium) ─────────────────── */

type RecentProps = {
  tenantId?: string;
  siteId?: string;
  excludeSessionId?: string;
  limit?: number;
  onSeeAll?: () => void;
};

export function RecentCashSessionsList({
  tenantId, siteId, excludeSessionId, limit = 1, onSeeAll,
}: RecentProps) {
  const [items, setItems] = useState<Session[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = async () => {
    if (!tenantId || !siteId) return;
    setLoading(true);
    setErrorMsg(null);
    const { data, error } = await supabase
      .from('cash_sessions')
      .select('id, opened_at, closed_at, opening_amount, closing_amount, theoretical_amount, variance, status')
      .eq('tenant_id', tenantId)
      .eq('site_id', siteId)
      .eq('status', 'closed')
      .order('closed_at', { ascending: false, nullsFirst: false })
      .limit(limit + (excludeSessionId ? 1 : 0));
    setLoading(false);
    if (error) {
      setErrorMsg('Impossible de charger les dernières sessions');
      setItems(null);
      return;
    }
    let rows = (data || []) as Session[];
    if (excludeSessionId) rows = rows.filter(r => r.id !== excludeSessionId);
    setItems(rows.slice(0, limit));
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, siteId, excludeSessionId, limit]);

  return (
    <section className="mt-3">
      <header className="flex items-center justify-between mb-1.5 px-1">
        <div className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-md bg-slate-900 text-white flex items-center justify-center">
            <History className="w-2.5 h-2.5" />
          </span>
          <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Dernière session</h3>
        </div>
        {onSeeAll && (
          <button
            onClick={onSeeAll}
            className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 inline-flex items-center gap-0.5 transition-colors"
          >
            Voir tout <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </header>

      {loading && <SkeletonList />}

      {!loading && errorMsg && (
        <div className="rounded-2xl border border-red-200 bg-red-50/60 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-red-900">{errorMsg}</div>
            <button
              onClick={load}
              className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-red-200 text-red-700 text-[11px] font-bold hover:bg-red-100 transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Réessayer
            </button>
          </div>
        </div>
      )}

      {!loading && !errorMsg && items && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2.5 flex items-center gap-2 text-slate-500">
          <History className="w-3.5 h-3.5 shrink-0" />
          <p className="text-[11px] font-semibold">Aucune session récente</p>
        </div>
      )}

      {!loading && !errorMsg && items && items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map(s => (
            <li key={s.id}>
              <RecentCashSessionCard session={s} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SkeletonList() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5 animate-pulse">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-slate-100" />
        <div className="flex-1 space-y-1">
          <div className="h-2 w-2/3 rounded bg-slate-100" />
          <div className="h-2 w-1/3 rounded bg-slate-100" />
        </div>
        <div className="h-4 w-12 rounded-full bg-slate-100" />
      </div>
    </div>
  );
}

export function RecentCashSessionCard({ session: s }: { session: Session }) {
  const status = (s.status || '').toLowerCase();
  const isClosed = status === 'closed' || !!s.closed_at;
  const isOpen = !isClosed && status === 'open';

  const variance = s.variance != null ? Number(s.variance) : null;
  const closingAmount = s.closing_amount != null ? Number(s.closing_amount) : null;
  const theoretical = s.theoretical_amount != null ? Number(s.theoretical_amount) : null;
  const totalCollected = closingAmount != null
    ? closingAmount - Number(s.opening_amount)
    : (theoretical != null ? theoretical - Number(s.opening_amount) : null);

  const badge = isOpen
    ? { label: 'Ouverte', cls: 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200', Icon: CircleDot }
    : { label: 'Clôturée', cls: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200', Icon: Lock };

  return (
    <div className="group rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all p-2.5">
      <div className="flex items-center gap-2.5">
        <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
          isOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
        }`}>
          {isOpen ? <Wallet className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-1.5">
              <span className="text-[12px] font-bold text-slate-900 truncate">
                {fmtDate(s.opened_at)}
              </span>
              <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 tabular-nums">
                <Clock className="w-2.5 h-2.5" />
                {fmtTime(s.opened_at)}
                {s.closed_at && (
                  <>
                    <ChevronRight className="w-2.5 h-2.5 opacity-50" />
                    {fmtTime(s.closed_at)}
                  </>
                )}
              </span>
            </div>
            <span className={`shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${badge.cls}`}>
              <badge.Icon className="w-2 h-2" />
              {badge.label}
            </span>
          </div>

          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            <MiniStat label="Fond" value={formatFCFA(Number(s.opening_amount))} />
            {totalCollected != null && totalCollected !== 0 && (
              <MiniStat label="Encaissé" value={formatFCFA(totalCollected)} accent="emerald" />
            )}
            {variance != null && variance !== 0 && (
              <MiniStat
                label="Écart"
                value={`${variance > 0 ? '+' : ''}${formatFCFA(Math.abs(variance))}`}
                accent={variance < 0 ? 'red' : 'amber'}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label, value, accent = 'slate',
}: { label: string; value: string; accent?: 'slate' | 'emerald' | 'amber' | 'red' }) {
  const valueCls =
    accent === 'emerald' ? 'text-emerald-700' :
    accent === 'amber' ? 'text-amber-700' :
    accent === 'red' ? 'text-red-700' :
    'text-slate-700';
  return (
    <span className="inline-flex items-baseline gap-1 text-[10px]">
      <span className="text-slate-400 font-medium">{label}</span>
      <span className={`font-bold tabular-nums ${valueCls}`}>{value}</span>
    </span>
  );
}

/* ───────────────────── Loading skeleton (full screen) ──────────────── */

export function CashSessionPageSkeleton() {
  return (
    <div className="px-4 pt-6 pb-24 max-w-md mx-auto">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 animate-pulse">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-slate-100" />
          <div className="flex-1 space-y-2">
            <div className="h-2.5 w-1/3 bg-slate-100 rounded" />
            <div className="h-3 w-2/3 bg-slate-100 rounded" />
          </div>
          <div className="h-6 w-16 rounded-full bg-slate-100" />
        </div>
        <div className="space-y-2">
          <div className="h-10 rounded-xl bg-slate-100" />
          <div className="h-10 rounded-xl bg-slate-100" />
          <div className="h-10 rounded-xl bg-slate-100" />
        </div>
        <div className="mt-5 h-12 rounded-2xl bg-slate-200" />
      </div>
      <div className="mt-5">
        <div className="h-3 w-32 bg-slate-100 rounded mb-3" />
        <div className="space-y-2">
          {[0, 1].map(i => (
            <div key={i} className="h-20 rounded-2xl bg-slate-100/70" />
          ))}
        </div>
      </div>
    </div>
  );
}

