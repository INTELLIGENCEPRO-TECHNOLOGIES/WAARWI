import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useApp } from '../context/AppContext';

export const PERMISSION_KEYS = [
  // Page access
  'access_pos',
  'access_billing',
  'access_articles',
  'access_tiers',
  'access_dashboard',
  'access_reports',
  'access_master_catalog',
  'access_stock',
  'access_sales',
  'access_supplier_orders',
  'access_online_orders',
  'access_accounting',
  'access_cash_history',
  // Financial visibility
  'view_purchase_prices',
  'view_margins',
  'view_stock_levels',
  'view_sales_history',
  'view_accounting',
  'view_dashboard_stats',
  'view_cash_sessions',
  // Stock & Articles
  'manage_stock',
  'manage_articles',
  'manage_categories',
  // Sales & Documents
  'create_quotes',
  'edit_invoices',
  'delete_invoices',
  'edit_quotes',
  'delete_quotes',
  'edit_supplier_orders',
  'delete_supplier_orders',
  'apply_discounts',
  'sell_below_min_price',
  // POS & Cash
  'manage_cash_sessions',
  'pos_close_session',
  'pos_open_session',
  'pos_returns',
  'pos_cancel_sale',
  'pos_reprint',
  'pos_cash_movement',
  'pos_view_x_report',
  'pos_view_z_report',
  // Orders & Customers
  'manage_online_orders',
  'manage_supplier_orders',
  'manage_customers',
  // Administration
  'export_data',
  'manage_settings',
  'manage_users',
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

export type PermissionMap = Record<PermissionKey, boolean>;

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  access_pos: 'Acceder a la caisse (POS)',
  access_billing: 'Acceder a la facturation',
  access_articles: 'Acceder aux articles',
  access_tiers: 'Acceder a la gestion des tiers',
  access_dashboard: 'Acceder au tableau de bord',
  access_reports: 'Acceder aux rapports et etats',
  access_master_catalog: 'Acceder au catalogue maitre',
  access_stock: 'Acceder a la gestion du stock',
  access_sales: 'Acceder au journal des ventes',
  access_supplier_orders: 'Acceder aux commandes fournisseurs',
  access_online_orders: 'Acceder aux commandes en ligne',
  access_accounting: 'Acceder a la comptabilite',
  access_cash_history: 'Acceder a l\'historique de caisse',
  view_purchase_prices: "Voir les prix d'achat",
  view_margins: 'Voir les marges',
  view_stock_levels: 'Voir les niveaux de stock',
  view_sales_history: "Voir l'historique des ventes",
  view_accounting: 'Voir les ecritures comptables',
  view_dashboard_stats: 'Voir les statistiques du tableau de bord',
  view_cash_sessions: 'Voir les sessions de caisse',
  manage_stock: 'Gerer le stock (mouvements, ajustements)',
  manage_articles: 'Creer / modifier les articles',
  manage_categories: 'Gerer les categories',
  create_quotes: 'Creer des devis',
  edit_invoices: 'Modifier les factures',
  delete_invoices: 'Supprimer les factures',
  edit_quotes: 'Modifier les devis',
  delete_quotes: 'Supprimer les devis',
  edit_supplier_orders: 'Modifier les commandes fournisseurs',
  delete_supplier_orders: 'Supprimer les commandes fournisseurs',
  apply_discounts: 'Appliquer des remises',
  sell_below_min_price: 'Vendre sous le prix minimum',
  manage_cash_sessions: 'Gerer les sessions de caisse',
  pos_close_session: 'Cloturer une session de caisse',
  pos_open_session: 'Ouvrir une session de caisse',
  pos_returns: 'Effectuer des retours produits',
  pos_cancel_sale: 'Annuler une vente',
  pos_reprint: 'Reimprimer un ticket',
  pos_cash_movement: 'Enregistrer mouvements de caisse (entree/sortie)',
  pos_view_x_report: 'Voir le rapport X (en cours)',
  pos_view_z_report: 'Voir le rapport Z (cloture)',
  manage_online_orders: 'Gerer les commandes en ligne',
  manage_supplier_orders: 'Gerer les commandes fournisseurs',
  manage_customers: 'Gerer les clients et fournisseurs',
  export_data: 'Exporter les donnees',
  manage_settings: 'Acceder aux parametres',
  manage_users: 'Gerer les utilisateurs et permissions',
};

export const PERMISSION_CATEGORIES: { label: string; keys: PermissionKey[] }[] = [
  {
    label: 'Acces aux pages',
    keys: [
      'access_pos', 'access_billing', 'access_articles', 'access_tiers',
      'access_dashboard', 'access_reports', 'access_master_catalog',
      'access_stock', 'access_sales', 'access_supplier_orders',
      'access_online_orders', 'access_accounting', 'access_cash_history',
    ],
  },
  {
    label: 'Donnees financieres',
    keys: ['view_purchase_prices', 'view_margins', 'view_dashboard_stats', 'view_accounting', 'view_stock_levels', 'view_sales_history', 'view_cash_sessions'],
  },
  {
    label: 'Stock & Articles',
    keys: ['manage_stock', 'manage_articles', 'manage_categories'],
  },
  {
    label: 'Documents & Ventes',
    keys: ['create_quotes', 'edit_invoices', 'delete_invoices', 'edit_quotes', 'delete_quotes', 'edit_supplier_orders', 'delete_supplier_orders', 'apply_discounts', 'sell_below_min_price'],
  },
  {
    label: 'Caisse (POS)',
    keys: ['manage_cash_sessions', 'pos_open_session', 'pos_close_session', 'pos_returns', 'pos_cancel_sale', 'pos_reprint', 'pos_cash_movement', 'pos_view_x_report', 'pos_view_z_report'],
  },
  {
    label: 'Commandes & Tiers',
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
          if (k in data.permissions) {
            map[k] = data.permissions[k] === true;
          }
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
