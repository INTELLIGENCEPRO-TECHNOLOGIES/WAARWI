/*
# MC1-A - Privilege hardening before the multi-register model

## Plain-English summary
Closes the privilege holes found by the MC0 audit. Nothing about the data,
the business rules, the function bodies or the row level security policies
changes. Only "who may touch what" is tightened.

## 1. Tables (19 financial / stock / tiers tables)
cash_sessions, sales, sale_items, sale_payments, cash_movements,
cash_control_lines, cash_regularizations, sale_returns, sale_return_items,
customer_payments, customer_prepayments, supplier_payments, held_carts,
vaults, vault_movements, customers, suppliers, stock_levels, stock_movements
- PUBLIC and anon: every direct privilege removed. No public page reads these
  tables directly; the shop, public invoice, public supplier order and order
  tracking all go through SECURITY DEFINER functions owned by postgres.
- authenticated: TRUNCATE, TRIGGER, REFERENCES and MAINTAIN removed.
  SELECT / INSERT / UPDATE / DELETE are kept (still used by the app).
- service_role and postgres: unchanged.

## 2. Function EXECUTE rights
- Cash / payment / stock functions used by the signed-in app: EXECUTE removed
  from PUBLIC and anon, explicitly kept for authenticated and service_role.
- Functions not called by the app (only by other SECURITY DEFINER functions
  or by triggers): EXECUTE removed from PUBLIC, anon and authenticated.
  Trigger functions do not need EXECUTE at fire time.
- increment_session_theoretical: removed from PUBLIC and anon. It is still
  called directly by the billing screens, so authenticated is kept for now
  (documented blocker, to be removed in a later step).

## 3. search_path
SECURITY DEFINER functions without a pinned search_path get
`search_path = public, pg_temp` via ALTER FUNCTION (bodies untouched).

## 4. Not changed
No RLS policy, no FORCE RLS, no signature, no body, no data, no schema CREATE
grant (PUBLIC/anon/authenticated already lack CREATE on schema public).
*/

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cash_sessions','sales','sale_items','sale_payments','cash_movements',
    'cash_control_lines','cash_regularizations','sale_returns','sale_return_items',
    'customer_payments','customer_prepayments','supplier_payments','held_carts',
    'vaults','vault_movements','customers','suppliers','stock_levels','stock_movements'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', t);
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.%I FROM authenticated', t);
  END LOOP;
END $$;

-- Cash / payment / stock functions called by the signed-in app
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.create_pos_sale(jsonb,jsonb,uuid,uuid,uuid,numeric,text)',
    'public.create_pos_sale_lot(uuid,uuid,uuid,jsonb,jsonb,numeric,text,jsonb)',
    'public.create_credit_sale(uuid,jsonb,numeric,uuid,uuid,text)',
    'public.convert_quote_to_sale(uuid,uuid,uuid,jsonb)',
    'public.register_sale_payment(uuid,uuid,text,numeric,text,uuid)',
    'public.register_customer_payment(uuid,uuid,text,numeric,text,uuid,uuid)',
    'public.register_customer_balance_payment(uuid,uuid,text,numeric,text,uuid,text)',
    'public.register_supplier_payment(uuid,uuid,text,numeric,text,uuid,uuid,boolean)',
    'public.record_cash_movement(uuid,uuid,text,numeric,text,text,text,uuid,uuid,text,uuid)',
    'public.process_return_as_cash(uuid,uuid)',
    'public.process_sale_return(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)',
    'public.cancel_sale(uuid,uuid)',
    'public.cancel_sale(uuid,uuid,text,text,uuid)',
    'public.close_cash_session_v2(uuid,jsonb,text,numeric,text)',
    'public.transfer_vault_to_cash(uuid,uuid,numeric,text,text,text)',
    'public.get_session_financial_summary(uuid)',
    'public.get_cash_report(uuid,date,date)',
    'public.get_financial_summary(uuid,date,date)',
    'public.rpc_paginated_cash_sessions(uuid,uuid,integer,integer,text,timestamp with time zone,timestamp with time zone)',
    'public.insert_billing_sale_items(uuid,jsonb)',
    'public.update_sale_items_and_totals(uuid,uuid,jsonb,uuid,jsonb)',
    'public.reconcile_customer_balances(uuid)',
    'public.tenant_delete_article_safe(uuid)',
    'public.tenant_delete_customer_safe(uuid)',
    'public.tenant_delete_supplier_safe(uuid)',
    'public.adjust_stock_lot(uuid,uuid,numeric,text,date,numeric,text)',
    'public.adjust_stock_with_doc(uuid,uuid,numeric,text,text,uuid)',
    'public.deduct_stock_manual_lots(uuid,uuid,numeric,jsonb,text,text,uuid,text)',
    'public.reverse_stock_document(uuid)',
    'public.bulk_import_tenant_articles(jsonb,uuid)',
    'public.reset_stock_for_site(uuid,text)',
    'public.increment_session_theoretical(uuid,numeric)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- Internal-only functions (not called by the app)
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.refund_sale_return(uuid,uuid,numeric)',
    'public.deduct_stock_fefo(uuid,uuid,numeric,text,uuid,text)',
    'public.recompute_supplier_balance(uuid)',
    'public.reset_tenant_catalog(uuid)',
    'public.trigger_update_supplier_balance()',
    'public.trigger_update_old_supplier_balance()',
    'public.trg_apply_prepayments_on_sale()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- Pin search_path on SECURITY DEFINER functions that had none
ALTER FUNCTION public.increment_session_theoretical(uuid,numeric) SET search_path = public, pg_temp;
ALTER FUNCTION public.convert_quote_to_sale(uuid,uuid,uuid,jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.register_sale_payment(uuid,uuid,text,numeric,text,uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.register_customer_payment(uuid,uuid,text,numeric,text,uuid,uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.adjust_stock_with_doc(uuid,uuid,numeric,text,text,uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.bulk_import_tenant_articles(jsonb,uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.recompute_supplier_balance(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.reconcile_customer_balances(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.trigger_update_supplier_balance() SET search_path = public, pg_temp;
ALTER FUNCTION public.trigger_update_old_supplier_balance() SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_apply_prepayments_on_sale() SET search_path = public, pg_temp;
