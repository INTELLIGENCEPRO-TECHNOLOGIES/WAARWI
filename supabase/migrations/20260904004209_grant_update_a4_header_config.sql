-- Grant UPDATE on the new a4_header_config column to authenticated role
GRANT UPDATE (a4_header_config) ON tenants TO authenticated;
GRANT UPDATE (a4_header_config) ON sites TO authenticated;
