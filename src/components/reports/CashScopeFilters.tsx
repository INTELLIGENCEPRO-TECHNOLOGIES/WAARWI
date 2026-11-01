import { Monitor, User, Clock, Layers } from 'lucide-react';
import type { ReactNode } from 'react';
import { registerText } from '../../lib/cashSession';

export type ScopeRegister = { id: string; name: string; code?: string | null; site_id: string | null };
export type ScopeCashier = { id: string; name: string };
export type ScopeSession = {
  id: string; opened_at: string; closed_at: string | null; status: string;
  user_id: string; cashier_name: string; cash_register_id: string | null;
};
export type CashScopeOptions = {
  multi: true; elevated: boolean; user_id: string;
  registers: ScopeRegister[]; cashiers: ScopeCashier[]; sessions: ScopeSession[];
};

export type CashScopeSelection = { registerId: string; userId: string; sessionId: string };
export const EMPTY_SCOPE: CashScopeSelection = { registerId: '', userId: '', sessionId: '' };

export function parseScopeOptions(raw: unknown): CashScopeOptions | null {
  const o = raw as any;
  if (!o || o.multi !== true) return null;
  return {
    multi: true,
    elevated: !!o.elevated,
    user_id: String(o.user_id || ''),
    registers: Array.isArray(o.registers) ? o.registers : [],
    cashiers: Array.isArray(o.cashiers) ? o.cashiers : [],
    sessions: Array.isArray(o.sessions) ? o.sessions : [],
  };
}

export function sessionLabel(s: ScopeSession, withCashier: boolean) {
  const d = new Date(s.opened_at);
  const when = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' '
    + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const state = s.closed_at ? '' : ' (ouverte)';
  return withCashier && s.cashier_name ? `${when} · ${s.cashier_name}${state}` : `${when}${state}`;
}

export function scopeLabel(opts: CashScopeOptions, sel: CashScopeSelection): string {
  const parts: string[] = [];
  const reg = opts.registers.find(r => r.id === sel.registerId);
  if (reg) parts.push(`Caisse : ${registerText(reg.code, reg.name)}`);
  else if (!sel.registerId && opts.elevated) parts.push('Toutes les caisses');
  const cashier = opts.cashiers.find(c => c.id === sel.userId);
  if (cashier && opts.elevated) parts.push(`Caissier : ${cashier.name}`);
  const ses = opts.sessions.find(s => s.id === sel.sessionId);
  if (ses) parts.push(`Session : ${sessionLabel(ses, opts.elevated)}`);
  const filtered = !!(sel.registerId || sel.userId || sel.sessionId);
  parts.push(opts.elevated
    ? `Périmètre : ${filtered ? 'filtré' : 'sites supervisés, historique sans caisse attribuée inclus'}`
    : 'Périmètre : mes opérations');
  return parts.join(' · ');
}

function Field({ icon, value, onChange, children, active }: {
  icon: ReactNode; value: string; onChange: (v: string) => void; children: ReactNode; active: boolean;
}) {
  return (
    <label className={`relative flex items-center gap-1.5 text-[12px] font-medium transition-colors border-b pb-0.5 ${
      active ? 'text-neutral-900 border-neutral-900' : 'text-neutral-600 border-transparent hover:text-neutral-900 hover:border-neutral-300'
    }`}>
      <span className="text-neutral-400 shrink-0">{icon}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none bg-transparent pr-1 max-w-[150px] sm:max-w-[190px] truncate cursor-pointer focus:outline-none"
      >
        {children}
      </select>
    </label>
  );
}

export function CashScopeFilters({ options, value, onChange, showSession = true }: {
  options: CashScopeOptions; value: CashScopeSelection; onChange: (v: CashScopeSelection) => void;
  showSession?: boolean;
}) {
  const sessions = options.sessions.filter(s =>
    (!value.registerId || s.cash_register_id === value.registerId)
    && (!value.userId || s.user_id === value.userId));
  const hasFilter = !!(value.registerId || value.userId || value.sessionId);

  return (
    <>
      <Field icon={<Monitor className="w-3.5 h-3.5" />} active={!!value.registerId} value={value.registerId}
        onChange={v => onChange(v ? { ...value, registerId: v, sessionId: '' } : EMPTY_SCOPE)}>
        <option value="">Toutes les caisses</option>
        {options.registers.map(r => <option key={r.id} value={r.id}>{registerText(r.code, r.name)}</option>)}
      </Field>

      {options.elevated && (
        <Field icon={<User className="w-3.5 h-3.5" />} active={!!value.userId} value={value.userId}
          onChange={v => onChange({ ...value, userId: v, sessionId: '' })}>
          <option value="">Tous les caissiers</option>
          {options.cashiers.map(c => <option key={c.id} value={c.id}>{c.name || 'Sans nom'}</option>)}
        </Field>
      )}

      {showSession && (
        <Field icon={<Clock className="w-3.5 h-3.5" />} active={!!value.sessionId} value={value.sessionId}
          onChange={v => onChange({ ...value, sessionId: v })}>
          <option value="">Toutes les sessions</option>
          {sessions.map(s => <option key={s.id} value={s.id}>{sessionLabel(s, options.elevated)}</option>)}
        </Field>
      )}

      {hasFilter && (
        <button
          onClick={() => onChange(EMPTY_SCOPE)}
          title={options.elevated ? 'Rapport consolidé de toutes les caisses autorisées' : 'Toutes mes caisses'}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-neutral-600 hover:text-neutral-900 transition-colors"
        >
          <Layers className="w-3.5 h-3.5" /> Toutes les caisses
        </button>
      )}
    </>
  );
}
