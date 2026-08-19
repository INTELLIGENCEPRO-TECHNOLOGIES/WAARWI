/*
# Restrict financial engine functions to authenticated role only

Security hardening: revoke EXECUTE from anon and public roles on the 4 financial
engine functions. These functions already check current_tenant_id() internally and
raise an exception for unauthenticated calls, but defense-in-depth requires
preventing the anon role from invoking them at all.

1. Security Changes
   - REVOKE EXECUTE from anon and public on get_financial_summary
   - REVOKE EXECUTE from anon and public on get_sales_by_article
   - REVOKE EXECUTE from anon and public on get_cash_flow
   - REVOKE EXECUTE from anon and public on get_returns_detail
   - GRANT EXECUTE to authenticated only on all 4 functions
*/

REVOKE ALL ON FUNCTION get_financial_summary(uuid, date, date) FROM anon, public;
REVOKE ALL ON FUNCTION get_sales_by_article(uuid, date, date) FROM anon, public;
REVOKE ALL ON FUNCTION get_cash_flow(uuid, date, date) FROM anon, public;
REVOKE ALL ON FUNCTION get_returns_detail(uuid, date, date) FROM anon, public;

GRANT EXECUTE ON FUNCTION get_financial_summary(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION get_sales_by_article(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION get_cash_flow(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION get_returns_detail(uuid, date, date) TO authenticated;
