-- Add money_transfer permission to all existing admin role_permissions
UPDATE role_permissions
SET permissions = permissions || jsonb_build_object('access_money_transfer', true)
WHERE role IN ('admin', 'super_admin')
  AND NOT (permissions ? 'access_money_transfer');
