/*
# Drop duplicate create_credit_sale overload

## Problem
Two overloads of `create_credit_sale` exist with different parameter orders,
causing PostgreSQL ambiguity errors when calling with named parameters.

## Changes
- Drops the OLD overload (p_site_id, p_cash_session_id, p_customer_id, p_items, p_discount, p_note)
- Keeps the NEW overload that includes prepayment auto-apply logic
  (p_customer_id, p_items, p_discount, p_site_id, p_cash_session_id, p_note)
*/

DROP FUNCTION IF EXISTS public.create_credit_sale(uuid, uuid, uuid, jsonb, numeric, text);
