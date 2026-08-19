/*
# Phase 9: Revoke anon EXECUTE on SECURITY DEFINER functions

## Summary
All SECURITY DEFINER functions in this app require authentication.
While they already check current_tenant_id() IS NOT NULL internally,
having anon EXECUTE privilege is unnecessary attack surface.
This migration restricts EXECUTE to authenticated only.

## Functions affected
  - process_sale_return
  - refund_sale_return
  - process_return_as_cash
  - create_pos_sale_lot
  - create_credit_sale

## Security
  - Revokes default PUBLIC execute (which anon inherits)
  - Grants explicit EXECUTE TO authenticated
  - record_cash_movement is SECURITY INVOKER so not affected
  - Financial read RPCs are SECURITY INVOKER so not affected
*/

-- Revoke from PUBLIC (stops anon from inheriting)
REVOKE EXECUTE ON FUNCTION process_sale_return FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refund_sale_return FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION process_return_as_cash FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_pos_sale_lot FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_credit_sale FROM PUBLIC;

-- Grant to authenticated only
GRANT EXECUTE ON FUNCTION process_sale_return TO authenticated;
GRANT EXECUTE ON FUNCTION refund_sale_return TO authenticated;
GRANT EXECUTE ON FUNCTION process_return_as_cash TO authenticated;
GRANT EXECUTE ON FUNCTION create_pos_sale_lot TO authenticated;
GRANT EXECUTE ON FUNCTION create_credit_sale TO authenticated;
