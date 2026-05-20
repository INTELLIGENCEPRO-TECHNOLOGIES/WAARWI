/*
  # Drop duplicate create_pos_sale function

  1. Problem
    - Two versions of `create_pos_sale` exist with the same parameter names but in different order
    - This causes "Could not choose the best candidate function" errors when calling with named parameters

  2. Fix
    - Drop the older version (p_site_id, p_cash_session_id, p_customer_id, p_items, p_payments, p_discount, p_note)
    - Keep the newer version (p_items, p_payments, p_site_id, p_cash_session_id, p_customer_id, p_discount, p_note)
*/

DROP FUNCTION IF EXISTS public.create_pos_sale(uuid, uuid, uuid, jsonb, jsonb, numeric, text);
