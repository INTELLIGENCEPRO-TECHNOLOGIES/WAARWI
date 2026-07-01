-- Ajout des permissions transfert d'argent dans les role_permissions existants pour admin
-- Le système utilise un JSONB plat dans la colonne `permissions` de role_permissions
-- Les nouvelles clés seront gérées côté application (permissions.ts)
-- On ajoute directement les permissions dans les rôles admin/manager existants

UPDATE role_permissions
SET permissions = permissions || jsonb_build_object(
  'mt_client_deposit_create', true,
  'mt_client_withdrawal_create', true,
  'mt_client_operation_view_own', true,
  'mt_client_operation_view_all', true,
  'mt_client_operation_cancel_own', true,
  'mt_client_operation_cancel_any', true,
  'mt_balance_view_basic', true,
  'mt_balance_view_detailed', true,
  'mt_balance_view_all_services', true,
  'mt_balance_initialize', true,
  'mt_balance_adjust', true,
  'mt_wholesaler_view', true,
  'mt_wholesaler_manage', true,
  'mt_wholesaler_operation_view', true,
  'mt_wholesaler_operation_create', true,
  'mt_wholesaler_operation_cancel', true,
  'mt_report_view_site', true,
  'mt_report_view_grossiste', true,
  'mt_report_export', true,
  'mt_settings_manage', true,
  'mt_services_manage', true
)
WHERE role IN ('admin', 'super_admin');

-- Permissions pour manager/superviseur
UPDATE role_permissions
SET permissions = permissions || jsonb_build_object(
  'mt_client_deposit_create', true,
  'mt_client_withdrawal_create', true,
  'mt_client_operation_view_own', true,
  'mt_client_operation_view_all', true,
  'mt_client_operation_cancel_own', true,
  'mt_client_operation_cancel_any', true,
  'mt_balance_view_basic', true,
  'mt_balance_view_detailed', true,
  'mt_balance_view_all_services', true,
  'mt_balance_initialize', false,
  'mt_balance_adjust', false,
  'mt_wholesaler_view', true,
  'mt_wholesaler_manage', false,
  'mt_wholesaler_operation_view', true,
  'mt_wholesaler_operation_create', true,
  'mt_wholesaler_operation_cancel', true,
  'mt_report_view_site', true,
  'mt_report_view_grossiste', true,
  'mt_report_export', true,
  'mt_settings_manage', false,
  'mt_services_manage', false
)
WHERE role = 'manager';

-- Permissions pour caissier/opératrice : opérations clients uniquement, PAS de grossistes
UPDATE role_permissions
SET permissions = permissions || jsonb_build_object(
  'mt_client_deposit_create', true,
  'mt_client_withdrawal_create', true,
  'mt_client_operation_view_own', true,
  'mt_client_operation_view_all', false,
  'mt_client_operation_cancel_own', true,
  'mt_client_operation_cancel_any', false,
  'mt_balance_view_basic', true,
  'mt_balance_view_detailed', false,
  'mt_balance_view_all_services', false,
  'mt_balance_initialize', false,
  'mt_balance_adjust', false,
  'mt_wholesaler_view', false,
  'mt_wholesaler_manage', false,
  'mt_wholesaler_operation_view', false,
  'mt_wholesaler_operation_create', false,
  'mt_wholesaler_operation_cancel', false,
  'mt_report_view_site', false,
  'mt_report_view_grossiste', false,
  'mt_report_export', false,
  'mt_settings_manage', false,
  'mt_services_manage', false
)
WHERE role = 'cashier';

-- Permissions pour viewer : lecture seule basique
UPDATE role_permissions
SET permissions = permissions || jsonb_build_object(
  'mt_client_deposit_create', false,
  'mt_client_withdrawal_create', false,
  'mt_client_operation_view_own', true,
  'mt_client_operation_view_all', false,
  'mt_client_operation_cancel_own', false,
  'mt_client_operation_cancel_any', false,
  'mt_balance_view_basic', true,
  'mt_balance_view_detailed', false,
  'mt_balance_view_all_services', false,
  'mt_balance_initialize', false,
  'mt_balance_adjust', false,
  'mt_wholesaler_view', false,
  'mt_wholesaler_manage', false,
  'mt_wholesaler_operation_view', false,
  'mt_wholesaler_operation_create', false,
  'mt_wholesaler_operation_cancel', false,
  'mt_report_view_site', false,
  'mt_report_view_grossiste', false,
  'mt_report_export', false,
  'mt_settings_manage', false,
  'mt_services_manage', false
)
WHERE role = 'viewer';