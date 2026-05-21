import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useApp } from '../context/AppContext';

export const PERMISSION_KEYS = [
  'view_purchase_prices',
  'view_margins',
  'view_stock_levels',
  'manage_stock',
  'view_sales_history',
  'view_accounting',
  'manage_articles',
  'manage_categories',
  'manage_customers',
  'manage_cash_sessions',
  'view_cash_sessions',
  'apply_discounts',
  'sell_below_min_price',
  'create_quotes',
  'manage_online_orders',
  'manage_supplier_orders',
  'view_dashboard_stats',
  'export_data',
  'manage_settings',
  'manage_users',
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

export type PermissionMap = Record<PermissionKey, boolean>;

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  view_purchase_prices: "Voir les prix d'achat",
  view_margins: 'Voir les marges',
  view_stock_levels: 'Voir les niveaux de stock',
  manage_stock: 'Gérer le stock (mouvements, ajustements)',
  view_sales_history: "Voir l'historique des ventes",
  view_accounting: 'Accéder à la comptabilité',
  manage_articles: 'Créer / modifier les articles',
  manage_categories: 'Gérer les catégories',
  manage_customers: 'Gérer les clients et fournisseurs',
  manage_cash_sessions: 'Ouvrir / fermer les sessions de caisse',
  view_cash_sessions: 'Voir les sessions de caisse',
  apply_discounts: 'Appliquer des remises',
  sell_below_min_price: 'Vendre sous le prix minimum',
  create_quotes: 'Créer des devis',
  manage_online_orders: 'Gérer les commandes en ligne',
  manage_supplier_orders: 'Gérer les commandes fournisseurs',
  view_dashboard_stats: 'Voir les statistiques du tableau de bord',
  export_data: 'Exporter les données',
  manage_settings: 'Accéder aux paramètres',
  manage_users: 'Gérer les utilisateurs et permissions',
};

export const PERMISSION_CATEGORIES: { label: string; keys: PermissionKey[] }[] = [
  {
    label: 'Données financières',
    keys: ['view_purchase_prices', 'view_margins', 'view_dashboard_stats', 'view_accounting'],
  },
  {
    label: 'Stock & Articles',
    keys: ['view_stock_levels', 'manage_stock', 'manage_articles', 'manage_categories'],
  },
  {
    label: 'Ventes & Caisse',
    keys: ['view_sales_history', 'manage_cash_sessions', 'view_cash_sessions', 'apply_discounts', 'sell_below_min_price', 'create_quotes'],
  },
  {
    label: 'Commandes',
    keys: ['manage_online_orders', 'manage_supplier_orders', 'manage_customers'],
  },
  {
    label: 'Administration',
    keys: ['export_data', 'manage_settings', 'manage_users'],
  },
];

const ALL_TRUE: PermissionMap = PERMISSION_KEYS.reduce((acc, k) => ({ ...acc, [k]: true }), {} as PermissionMap);

export function usePermissions(): { permissions: PermissionMap; loading: boolean; can: (key: PermissionKey) => boolean } {
  const { profile, dataTick } = useApp();
  const [permissions, setPermissions] = useState<PermissionMap>(ALL_TRUE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.tenant_id || !profile?.role) {
      setPermissions(ALL_TRUE);
      setLoading(false);
      return;
    }

    if (profile.role === 'admin' || profile.role === 'super_admin') {
      setPermissions(ALL_TRUE);
      setLoading(false);
      return;
    }

    (async () => {
      const { data } = await supabase
        .from('role_permissions')
        .select('permissions')
        .eq('tenant_id', profile.tenant_id)
        .eq('role', profile.role)
        .maybeSingle();

      if (data?.permissions) {
        const map = { ...ALL_TRUE };
        for (const k of PERMISSION_KEYS) {
          map[k] = data.permissions[k] === true;
        }
        setPermissions(map);
      } else {
        setPermissions(ALL_TRUE);
      }
      setLoading(false);
    })();
  }, [profile?.tenant_id, profile?.role, dataTick]);

  const can = (key: PermissionKey): boolean => {
    if (!profile) return false;
    if (profile.role === 'admin' || profile.role === 'super_admin') return true;
    return permissions[key] === true;
  };

  return { permissions, loading, can };
}
