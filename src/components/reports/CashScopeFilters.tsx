import { Monitor, User, Clock, Layers } from 'lucide-react';
import type { ReactNode } from 'react';
import { registerText } from '../../lib/cashSession';
import { SearchableSelect, type SelectOption } from '../SearchableSelect';

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
  return withCashier && s.cashier_name ? `${when} │ ${s.cashier_name}${state}` : `${when}${state}`;
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
  return parts.join(' │ ');
}

function Field({ icon, label, value, onChange, options }: {
  icon: ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
}) {
  return (
    <div className="flex min-w-0 max-w-full items-center gap-1.5">
      <span className="shrink-0 text-[var(--w-text-muted)]" aria-hidden="true">{icon}</span>
      <SearchableSelect ariaLabel={label} value={value} onChange={onChange} options={options}
        searchable={options.length > 8} clearable={false} wrapLabels className="min-w-0 max-w-60" />
    </div>
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
      <Field label="Caisse" icon={<Monitor className="w-3.5 h-3.5" />} value={value.registerId}
        onChange={v => onChange(v ? { ...value, registerId: v, sessionId: '' } : EMPTY_SCOPE)}
        options={[
          { value: '', label: 'Toutes les caisses' },
          ...options.registers.map(register => ({ value: register.id, label: registerText(register.code, register.name) })),
        ]} />

      {options.elevated && (
        <Field label="Caissier" icon={<User className="w-3.5 h-3.5" />} value={value.userId}
          onChange={v => onChange({ ...value, userId: v, sessionId: '' })}
          options={[
            { value: '', label: 'Tous les caissiers' },
            ...options.cashiers.map(cashier => ({ value: cashier.id, label: cashier.name || 'Sans nom' })),
          ]} />
      )}

      {showSession && (
        <Field label="Session de caisse" icon={<Clock className="w-3.5 h-3.5" />} value={value.sessionId}
          onChange={v => onChange({ ...value, sessionId: v })}
          options={[
            { value: '', label: 'Toutes les sessions' },
            ...sessions.map(session => ({ value: session.id, label: sessionLabel(session, options.elevated) })),
          ]} />
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
