/*
# Phase 9: Revoke anon EXECUTE on SECURITY DEFINER functions

## Summary
Restricts EXECUTE on sensitive SECURITY DEFINER functions to authenticated role only.
Uses explicit function signatures to ensure the revoke applies correctly.

## Functions affected
  - process_sale_return(uuid, uuid, uuid, jsonb, text, boolean, boolean, text)
  - refund_sale_return(uuid, uuid, numeric)
  - process_return_as_cash(uuid, uuid)
  - create_pos_sale_lot(uuid, uuid, uuid, jsonb, jsonb, numeric, text, jsonb)
  - create_credit_sale(uuid, uuid, uuid, jsonb, numeric, text)

## Security
  - Revokes PUBLIC and anon execute
  - Grants explicit EXECUTE TO authenticated only
*/

REVOKE ALL ON FUNCTION process_sale_return(uuid, uuid, uuid, jsonb, text, boolean, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION refund_sale_return(uuid, uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION process_return_as_cash(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION create_pos_sale_lot(uuid, uuid, uuid, jsonb, jsonb, numeric, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION create_credit_sale(uuid, uuid, uuid, jsonb, numeric, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION process_sale_return(uuid, uuid, uuid, jsonb, text, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION refund_sale_return(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION process_return_as_cash(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION create_pos_sale_lot(uuid, uuid, uuid, jsonb, jsonb, numeric, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_credit_sale(uuid, uuid, uuid, jsonb, numeric, text) TO authenticated;
