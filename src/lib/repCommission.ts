export type CommissionType = 'pct_ca' | 'fixe' | 'pct_marge';
export type CommissionBase = 'ht' | 'ttc' | 'net' | 'marge';

export type RepCommissionSettings = {
  enabled: boolean;
  commission_type: CommissionType;
  commission_base: CommissionBase;
  rate: number;
  fixed_amount: number;
};

export type SalesRepresentative = {
  id: string;
  code: string;
  first_name: string;
  last_name: string;
  status: 'actif' | 'inactif';
  commission_override: boolean;
  commission_type: CommissionType | null;
  commission_base: CommissionBase | null;
  commission_rate: number | null;
  commission_fixed: number | null;
};

export type RepCommissionSnapshot = {
  type: CommissionType;
  base: CommissionBase;
  rate: number;
  fixed_amount: number;
  base_amount: number;
  amount: number;
  computed_at: string;
};

export const DEFAULT_REP_SETTINGS: RepCommissionSettings = {
  enabled: false,
  commission_type: 'pct_ca',
  commission_base: 'ttc',
  rate: 0,
  fixed_amount: 0,
};

export const COMMISSION_TYPE_LABELS: Record<CommissionType, string> = {
  pct_ca: 'Pourcentage du chiffre d\'affaires',
  fixe: 'Montant fixe par vente',
  pct_marge: 'Pourcentage de la marge',
};

export const COMMISSION_BASE_LABELS: Record<CommissionBase, string> = {
  ht: 'Montant HT',
  ttc: 'Montant TTC',
  net: 'Montant net après remise',
  marge: 'Marge',
};

export function repDisplayName(r: Pick<SalesRepresentative, 'code' | 'first_name' | 'last_name'>): string {
  return `${r.code} — ${r.first_name} ${r.last_name}`;
}

export function effectiveRule(rep: SalesRepresentative | null, settings: RepCommissionSettings): RepCommissionSettings {
  if (rep?.commission_override && rep.commission_type) {
    return {
      enabled: settings.enabled,
      commission_type: rep.commission_type,
      commission_base: rep.commission_base || settings.commission_base,
      rate: Number(rep.commission_rate || 0),
      fixed_amount: Number(rep.commission_fixed || 0),
    };
  }
  return settings;
}

export function computeRepCommission(
  rep: SalesRepresentative | null,
  settings: RepCommissionSettings,
  amounts: { subtotal: number; net: number; margin: number },
): RepCommissionSnapshot | null {
  if (!rep || !settings.enabled) return null;
  const rule = effectiveRule(rep, settings);
  let baseAmount: number;
  switch (rule.commission_base) {
    case 'marge': baseAmount = amounts.margin; break;
    case 'net': baseAmount = amounts.net; break;
    default: baseAmount = amounts.subtotal;
  }
  let amount = 0;
  if (rule.commission_type === 'fixe') {
    amount = Number(rule.fixed_amount || 0);
  } else if (rule.commission_type === 'pct_marge') {
    amount = amounts.margin * Number(rule.rate || 0) / 100;
  } else {
    amount = baseAmount * Number(rule.rate || 0) / 100;
  }
  return {
    type: rule.commission_type,
    base: rule.commission_base,
    rate: Number(rule.rate || 0),
    fixed_amount: Number(rule.fixed_amount || 0),
    base_amount: Math.round(baseAmount * 100) / 100,
    amount: Math.round(Math.max(0, amount) * 100) / 100,
    computed_at: new Date().toISOString(),
  };
}

export function nextRepCode(existing: { code: string }[]): string {
  let max = 0;
  for (const r of existing) {
    const m = /^REP-(\d+)$/i.exec((r.code || '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `REP-${String(max + 1).padStart(3, '0')}`;
}
