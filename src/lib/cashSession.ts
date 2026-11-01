import { supabase } from './supabase';

export const OPEN_YOUR_REGISTER_MSG = "Ouvrez votre caisse avant d'enregistrer cet encaissement.";

export interface OperationalCashSession {
  id: string;
  site_id: string;
  user_id: string | null;
  cash_register_id: string | null;
  opening_amount: number | null;
  theoretical_amount: number | null;
  opened_at: string;
  register_code?: string;
  register_name?: string;
}

export interface OperationalCashContext {
  multiEnabled: boolean;
  session: OperationalCashSession | null;
  error?: string;
}

export const UNASSIGNED_REGISTER_LABEL = 'Historique sans caisse attribuée';

const normalizeRegisterText = (v: string) => v.replace(/[\s_\-.]+/g, ' ').trim().toLowerCase();

export function registerLabel(code?: string | null, name?: string | null): { primary: string; secondary: string | null } {
  const c = (code || '').replace(/\s+/g, ' ').trim();
  const n = (name || '').replace(/\s+/g, ' ').trim();
  if (!n) return { primary: c || 'Caisse', secondary: null };
  if (!c || normalizeRegisterText(c) === normalizeRegisterText(n)) return { primary: n, secondary: null };
  return { primary: n, secondary: c };
}

export function registerText(code?: string | null, name?: string | null): string {
  const { primary, secondary } = registerLabel(code, name);
  return secondary ? `${primary} (${secondary})` : primary;
}

export interface PosRegisterOption {
  id: string;
  code: string;
  name: string;
  is_default: boolean;
  status: 'free' | 'mine' | 'busy';
  operator_name: string | null;
}

export interface PosCashContext {
  multi_enabled: boolean;
  is_elevated?: boolean;
  can_open?: boolean;
  registers?: PosRegisterOption[];
  my_session?: (OperationalCashSession & { status: string }) | null;
  other_session?: { site_id: string; site_name: string; register_code: string; register_name: string } | null;
}

export function newIdempotencyKey(): string {
  return crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Mode désactivé : session ouverte du magasin (comportement historique). Mode activé : uniquement la session personnelle.
export async function getOperationalCashContext(siteId: string): Promise<OperationalCashContext> {
  const { data, error } = await supabase.rpc('my_operational_cash_session', { p_site_id: siteId });
  if (error || !data || typeof data !== 'object') {
    return { multiEnabled: false, session: null, error: error?.message || 'Impossible de vérifier la caisse ouverte' };
  }
  const d = data as { multi_enabled?: boolean; session?: OperationalCashSession | null };
  return {
    multiEnabled: !!d.multi_enabled,
    session: d.session && typeof d.session.id === 'string' ? d.session : null,
  };
}

export function missingSessionMessage(ctx: OperationalCashContext, historical: string): string {
  if (ctx.error) return ctx.error;
  return ctx.multiEnabled ? OPEN_YOUR_REGISTER_MSG : historical;
}
