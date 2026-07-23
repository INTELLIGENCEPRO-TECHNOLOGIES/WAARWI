import { supabase } from './supabase';

export interface PlanLimits {
  sites: number;
  users: number;
  articles: number;
  max_clients: number;
  max_suppliers: number;
  max_invoices_month: number;
  monthly_sales: number;
  online_shop: boolean;
  accounting: boolean;
  supplier_orders: boolean;
  has_whatsapp: boolean;
  has_multi_store: boolean;
  has_advanced_reports: boolean;
  has_accounting_export: boolean;
}

const DEFAULT_LIMITS: PlanLimits = {
  sites: 1,
  users: 2,
  articles: 100,
  max_clients: 50,
  max_suppliers: 10,
  max_invoices_month: 200,
  monthly_sales: 200,
  online_shop: false,
  accounting: false,
  supplier_orders: false,
  has_whatsapp: false,
  has_multi_store: false,
  has_advanced_reports: false,
  has_accounting_export: false,
};

export async function getTenantEffectiveLimits(tenantId: string): Promise<PlanLimits> {
  const { data, error } = await supabase.rpc('get_tenant_effective_limits', { p_tenant_id: tenantId });
  if (error || !data) return DEFAULT_LIMITS;
  return { ...DEFAULT_LIMITS, ...(data as Record<string, unknown>) } as PlanLimits;
}

export function isUnlimited(value: number): boolean {
  return value === -1;
}

export function isWithinLimit(current: number, limit: number): boolean {
  if (limit === -1) return true;
  return current < limit;
}

export function formatLimit(limit: number): string {
  if (limit === -1) return 'Illimité';
  return String(limit);
}

export function generateFeatureText(limits: PlanLimits): string[] {
  const features: string[] = [];
  features.push(limits.articles === -1 ? 'Articles illimités' : `Catalogue jusqu'à ${limits.articles.toLocaleString('fr-FR')} articles`);
  features.push(limits.sites === -1 ? 'Magasins illimités' : `${limits.sites} magasin${limits.sites > 1 ? 's' : ''}`);
  features.push(limits.users === -1 ? 'Utilisateurs illimités' : `${limits.users} utilisateur${limits.users > 1 ? 's' : ''}`);
  if (limits.online_shop) features.push('Boutique en ligne');
  if (limits.supplier_orders) features.push('Achats');
  if (limits.accounting) features.push('Comptabilité SYSCOHADA');
  if (limits.has_advanced_reports) features.push('Rapports avancés');
  if (limits.has_whatsapp) features.push('Notifications WhatsApp');
  if (limits.has_accounting_export) features.push('Export comptable');
  return features;
}

export const LIMIT_LABELS: Record<string, string> = {
  sites: 'Magasins',
  users: 'Utilisateurs',
  articles: 'Articles',
  max_clients: 'Clients',
  max_suppliers: 'Fournisseurs',
  max_invoices_month: 'Factures / mois',
  monthly_sales: 'Ventes / mois',
};

export const MODULE_LABELS: Record<string, string> = {
  online_shop: 'Boutique en ligne',
  accounting: 'Comptabilité',
  supplier_orders: 'Achats',
  has_whatsapp: 'Notifications WhatsApp',
  has_multi_store: 'Multi-magasins',
  has_advanced_reports: 'Rapports avancés',
  has_accounting_export: 'Export comptable',
};
