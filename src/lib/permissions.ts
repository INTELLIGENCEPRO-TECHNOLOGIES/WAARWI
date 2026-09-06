import { useEffect, useState, useCallback } from 'react';
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
  'access_money_transfer',
  // Coffre
  'access_vault',
  'view_vault',
  'vault_receive_from_cash',
  'vault_transfer_to_cash',
  'vault_pay_supplier',
  'vault_adjust',
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
  'pos_customer_withdrawal',
  'pos_customer_loan',
  'pos_view_x_report',
  'pos_view_z_report',
  'pos_view_session_summary',
  'pos_view_session_stats',
  // Orders & Customers
  'manage_online_orders',
  'manage_supplier_orders',
  'manage_customers',
  'delete_customers',
  // Administration
  'export_data',
  'manage_settings',
  'manage_users',
  // Transfert d'argent - Opérations clients
  'mt_client_deposit_create',
  'mt_client_withdrawal_create',
  'mt_client_operation_view_own',
  'mt_client_operation_view_all',
  'mt_client_operation_cancel_own',
  'mt_client_operation_cancel_any',
  // Transfert d'argent - Soldes
  'mt_balance_view_basic',
  'mt_balance_view_detailed',
  'mt_balance_view_all_services',
  'mt_balance_initialize',
  'mt_balance_adjust',
  // Transfert d'argent - Grossistes
  'mt_wholesaler_view',
  'mt_wholesaler_manage',
  'mt_wholesaler_operation_view',
  'mt_wholesaler_operation_create',
  'mt_wholesaler_operation_cancel',
  // Transfert d'argent - Rapports & Config
  'mt_report_view_site',
  'mt_report_view_grossiste',
  'mt_report_export',
  'mt_settings_manage',
  'mt_services_manage',
  // Commercial - Représentants
  'rep_view',
  'rep_manage',
  'rep_stats_view',
  'rep_commission_view',
  'rep_settings_edit',
  'rep_export',
  // Backup & Restore
  'backup_create',
  'backup_restore',
  'backup_reset_operations',
  'backup_import',
  'backup_download',
  'backup_delete',
  'backup_manage_schedule',
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

export type PermissionMap = Record<PermissionKey, boolean>;

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  access_pos: 'Accéder à la caisse (POS)',
  access_billing: 'Accéder à la facturation',
  access_articles: 'Accéder aux articles',
  access_tiers: 'Accéder à la gestion des tiers',
  access_dashboard: 'Accéder au tableau de bord',
  access_reports: 'Accéder aux rapports et états',
  access_master_catalog: 'Accéder au catalogue maître',
  access_stock: 'Accéder à la gestion du stock',
  access_sales: 'Accéder au journal des ventes',
  access_supplier_orders: 'Accéder aux achats',
  access_online_orders: 'Accéder aux commandes en ligne',
  access_accounting: 'Accéder à la comptabilité',
  access_cash_history: 'Accéder à l\'historique de caisse',
  access_money_transfer: 'Accéder au module Transfert d\'argent',
  access_vault: 'Accéder au coffre',
  view_vault: 'Voir le solde et les mouvements du coffre',
  vault_receive_from_cash: 'Verser des espèces de la caisse au coffre',
  vault_transfer_to_cash: 'Transférer du coffre vers la caisse',
  vault_pay_supplier: 'Régler un fournisseur depuis le coffre',
  vault_adjust: 'Initialiser et ajuster le coffre',
  view_purchase_prices: 'Voir les prix d\'achat',
  view_margins: 'Voir les marges',
  view_stock_levels: 'Voir les niveaux de stock',
  view_sales_history: 'Voir l\'historique des ventes',
  view_accounting: 'Voir les écritures comptables',
  view_dashboard_stats: 'Voir les statistiques du tableau de bord',
  view_cash_sessions: 'Voir les sessions de caisse',
  manage_stock: 'Gérer le stock (mouvements, ajustements)',
  manage_articles: 'Créer / modifier les articles',
  manage_categories: 'Gérer les catégories',
  create_quotes: 'Créer des devis',
  edit_invoices: 'Modifier les factures',
  delete_invoices: 'Supprimer les factures',
  edit_quotes: 'Modifier les devis',
  delete_quotes: 'Supprimer les devis',
  edit_supplier_orders: 'Modifier les achats',
  delete_supplier_orders: 'Supprimer les achats',
  apply_discounts: 'Appliquer des remises',
  sell_below_min_price: 'Vendre sous le prix minimum',
  manage_cash_sessions: 'Gérer les sessions de caisse',
  pos_close_session: 'Clôturer une session de caisse',
  pos_open_session: 'Ouvrir une session de caisse',
  pos_returns: 'Effectuer des retours produits',
  pos_cancel_sale: 'Annuler une vente',
  pos_reprint: 'Réimprimer un ticket',
  pos_cash_movement: 'Enregistrer mouvements de caisse (entrée/sortie)',
  pos_customer_withdrawal: 'Effectuer un retrait sur acompte client',
  pos_customer_loan: 'Accorder un prêt client (créance sans acompte)',
  pos_view_x_report: 'Voir le rapport X (en cours)',
  pos_view_z_report: 'Voir le rapport Z (clôture)',
  pos_view_session_summary: 'Voir le résumé de session (écran de reprise)',
  pos_view_session_stats: 'Voir les statistiques de session (caisse & tickets)',
  manage_online_orders: 'Gérer les commandes en ligne',
  manage_supplier_orders: 'Gérer les achats',
  manage_customers: 'Gérer les clients et fournisseurs',
  delete_customers: 'Supprimer ou désactiver les clients et fournisseurs',
  export_data: 'Exporter les données',
  manage_settings: 'Accéder aux paramètres',
  manage_users: 'Gérer les utilisateurs et permissions',
  mt_client_deposit_create: 'Créer un dépôt client',
  mt_client_withdrawal_create: 'Créer un retrait client',
  mt_client_operation_view_own: 'Voir ses propres opérations',
  mt_client_operation_view_all: 'Voir toutes les opérations client',
  mt_client_operation_cancel_own: 'Annuler ses propres opérations',
  mt_client_operation_cancel_any: 'Annuler toute opération client',
  mt_balance_view_basic: 'Voir les soldes nécessaires (cash et service)',
  mt_balance_view_detailed: 'Voir les soldes détaillés par service',
  mt_balance_view_all_services: 'Voir tous les soldes électroniques',
  mt_balance_initialize: 'Initialiser les soldes de départ',
  mt_balance_adjust: 'Ajuster manuellement un solde',
  mt_wholesaler_view: 'Voir les grossistes',
  mt_wholesaler_manage: 'Gérer les grossistes (créer, modifier, supprimer)',
  mt_wholesaler_operation_view: 'Voir les opérations grossiste',
  mt_wholesaler_operation_create: 'Créer une recharge ou déchargement grossiste',
  mt_wholesaler_operation_cancel: 'Annuler une opération grossiste',
  mt_report_view_site: 'Voir les rapports du point de service',
  mt_report_view_grossiste: 'Voir les rapports grossiste',
  mt_report_export: 'Exporter les rapports transfert d\'argent',
  mt_settings_manage: 'Gérer les paramètres du module transfert',
  mt_services_manage: 'Gérer les services (Wave, Orange Money, etc.)',
  rep_view: 'Voir la liste des représentants',
  rep_manage: 'Créer / modifier / activer / désactiver les représentants',
  rep_stats_view: 'Voir les statistiques par représentant',
  rep_commission_view: 'Voir les montants de commission',
  rep_settings_edit: 'Modifier les paramètres de commission',
  rep_export: 'Imprimer / exporter les rapports représentants',
  backup_create: 'Créer une sauvegarde manuelle',
  backup_restore: 'Restaurer une sauvegarde',
  backup_reset_operations: 'Réinitialiser les opérations',
  backup_import: 'Importer une sauvegarde depuis un fichier',
  backup_download: 'Télécharger une sauvegarde',
  backup_delete: 'Supprimer une sauvegarde',
  backup_manage_schedule: 'Gérer la planification des sauvegardes automatiques',
};

export const PERMISSION_CATEGORIES: { label: string; keys: PermissionKey[] }[] = [
  {
    label: 'Accès aux pages',
    keys: [
      'access_pos', 'access_billing', 'access_articles', 'access_tiers',
      'access_dashboard', 'access_reports', 'access_master_catalog',
      'access_stock', 'access_sales', 'access_supplier_orders',
      'access_online_orders', 'access_accounting', 'access_cash_history',
      'access_money_transfer',
    ],
  },
  {
    label: 'Données financières',
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
    keys: ['manage_cash_sessions', 'pos_open_session', 'pos_close_session', 'pos_returns', 'pos_cancel_sale', 'pos_reprint', 'pos_cash_movement', 'pos_customer_withdrawal', 'pos_customer_loan', 'pos_view_x_report', 'pos_view_z_report', 'pos_view_session_summary', 'pos_view_session_stats'],
  },
  {
    label: 'Coffre',
    keys: ['access_vault', 'view_vault', 'vault_receive_from_cash', 'vault_transfer_to_cash', 'vault_pay_supplier', 'vault_adjust'],
  },
  {
    label: 'Commandes & Tiers',
    keys: ['manage_online_orders', 'manage_supplier_orders', 'manage_customers', 'delete_customers'],
  },
  {
    label: 'Transfert d\'argent - Opérations clients',
    keys: ['mt_client_deposit_create', 'mt_client_withdrawal_create', 'mt_client_operation_view_own', 'mt_client_operation_view_all', 'mt_client_operation_cancel_own', 'mt_client_operation_cancel_any'],
  },
  {
    label: 'Transfert d\'argent - Soldes',
    keys: ['mt_balance_view_basic', 'mt_balance_view_detailed', 'mt_balance_view_all_services', 'mt_balance_initialize', 'mt_balance_adjust'],
  },
  {
    label: 'Transfert d\'argent - Grossistes',
    keys: ['mt_wholesaler_view', 'mt_wholesaler_manage', 'mt_wholesaler_operation_view', 'mt_wholesaler_operation_create', 'mt_wholesaler_operation_cancel'],
  },
  {
    label: 'Transfert d\'argent - Rapports & Configuration',
    keys: ['mt_report_view_site', 'mt_report_view_grossiste', 'mt_report_export', 'mt_settings_manage', 'mt_services_manage'],
  },
  {
    label: 'Commercial - Représentants',
    keys: ['rep_view', 'rep_manage', 'rep_stats_view', 'rep_commission_view', 'rep_settings_edit', 'rep_export'],
  },
  {
    label: 'Administration',
    keys: ['export_data', 'manage_settings', 'manage_users'],
  },
  {
    label: 'Sauvegarde & Restauration',
    keys: ['backup_create', 'backup_restore', 'backup_reset_operations', 'backup_import', 'backup_download', 'backup_delete', 'backup_manage_schedule'],
  },
];

const ALL_TRUE: PermissionMap = PERMISSION_KEYS.reduce((acc, k) => ({ ...acc, [k]: true }), {} as PermissionMap);
const ALL_FALSE: PermissionMap = PERMISSION_KEYS.reduce((acc, k) => ({ ...acc, [k]: false }), {} as PermissionMap);

const OWNER_ONLY_KEYS: Set<PermissionKey> = new Set([
  'backup_create', 'backup_restore', 'backup_reset_operations',
  'backup_import', 'backup_download', 'backup_delete', 'backup_manage_schedule',
]);

export function usePermissions(): { permissions: PermissionMap; loading: boolean; can: (key: PermissionKey) => boolean } {
  const { profile, dataTick, isOwner } = useApp();
  const [permissions, setPermissions] = useState<PermissionMap>(ALL_FALSE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.tenant_id || !profile?.role) {
      setPermissions(ALL_FALSE);
      setLoading(false);
      return;
    }

    if (profile.role === 'super_admin') {
      setPermissions(ALL_TRUE);
      setLoading(false);
      return;
    }

    if (profile.role === 'admin') {
      if (isOwner) {
        setPermissions(ALL_TRUE);
      } else {
        const map = { ...ALL_TRUE };
        for (const k of OWNER_ONLY_KEYS) map[k] = false;
        setPermissions(map);
      }
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
        const map = { ...ALL_FALSE };
        for (const k of PERMISSION_KEYS) {
          if (k in data.permissions) {
            map[k] = data.permissions[k] === true;
          }
        }
        for (const k of OWNER_ONLY_KEYS) map[k] = false;
        setPermissions(map);
      } else {
        setPermissions(ALL_FALSE);
      }
      setLoading(false);
    })();
  }, [profile?.tenant_id, profile?.role, dataTick, isOwner]);

  const can = useCallback((key: PermissionKey): boolean => {
    if (!profile) return false;
    if (profile.role === 'super_admin') return true;
    if (profile.role === 'admin') {
      if (OWNER_ONLY_KEYS.has(key)) return isOwner;
      return true;
    }
    return permissions[key] === true;
  }, [profile, permissions, isOwner]);

  return { permissions, loading, can };
}
