/*
# Restore SECURITY DEFINER on financial allocation functions and lock down credit_allocations

## Problem
`_apply_avoirs_internal` and `apply_customer_prepayments` are SECURITY INVOKER.
When called from other INVOKER functions (e.g. `record_cash_movement`), they run as
`authenticated`, which:
  - cannot EXECUTE `_allocate_negative_adjustments_to_invoices` (DEFINER, restricted)
  - previously could not INSERT into `credit_allocations` (missing policy/privilege — patched
    earlier with an INSERT policy + GRANT INSERT as workarounds)

The proper fix is to make these two internal allocation functions SECURITY DEFINER so they
always run as the owner (`postgres`) and bypass RLS, exactly like the other financial engine
callers (`create_credit_sale`, `approve_return_as_avoir`, etc.).

## Changes

### 1. Restore SECURITY DEFINER + search_path on the two functions
  - `apply_customer_prepayments(uuid)` → SECURITY DEFINER, SET search_path TO public
  - `_apply_avoirs_internal(uuid, uuid)` → SECURITY DEFINER, SET search_path TO public

### 2. Tighten EXECUTE privileges
  - `apply_customer_prepayments`: REVOKE from PUBLIC and anon, GRANT only to authenticated
  - `_apply_avoirs_internal`: REVOKE from PUBLIC, anon, and authenticated (internal only)
  - `_allocate_negative_adjustments_to_invoices`: explicit REVOKE from PUBLIC, anon, authenticated
    (already restricted, belt-and-suspenders)

### 3. Remove workaround INSERT access on credit_allocations
  - DROP the `insert_credit_allocations` RLS policy
  - REVOKE INSERT, UPDATE, DELETE from PUBLIC, anon, and authenticated
  - Keep RLS enabled and the existing SELECT policy intact

### Security notes
  - No function bodies are modified — only ALTER FUNCTION metadata and privilege commands.
  - No data is modified.
  - The two DEFINER functions validate tenant context internally (current_tenant_id() / p_tenant_id).
  - Direct INSERT/UPDATE/DELETE on credit_allocations is no longer possible for any API role.
*/

-- ============================================================
-- 1. Restore SECURITY DEFINER + search_path
-- ============================================================
ALTER FUNCTION public.apply_customer_prepayments(uuid)
  SECURITY DEFINER
  SET search_path TO public;

ALTER FUNCTION public._apply_avoirs_internal(uuid, uuid)
  SECURITY DEFINER
  SET search_path TO public;

-- ============================================================
-- 2. Tighten EXECUTE privileges
-- ============================================================

-- apply_customer_prepayments: only authenticated may call it
REVOKE ALL ON FUNCTION public.apply_customer_prepayments(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_customer_prepayments(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_customer_prepayments(uuid) TO authenticated;

-- _apply_avoirs_internal: internal only (called by DEFINER callers)
REVOKE ALL ON FUNCTION public._apply_avoirs_internal(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._apply_avoirs_internal(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._apply_avoirs_internal(uuid, uuid) FROM authenticated;

-- _allocate_negative_adjustments_to_invoices: belt-and-suspenders
REVOKE ALL ON FUNCTION public._allocate_negative_adjustments_to_invoices(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._allocate_negative_adjustments_to_invoices(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._allocate_negative_adjustments_to_invoices(uuid, uuid) FROM authenticated;

-- ============================================================
-- 3. Remove workaround INSERT access on credit_allocations
-- ============================================================

-- Drop the INSERT policy added as a workaround
DROP POLICY IF EXISTS "insert_credit_allocations" ON public.credit_allocations;

-- Revoke write privileges (keep SELECT for authenticated via the existing RLS policy)
REVOKE INSERT, UPDATE, DELETE ON public.credit_allocations FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.credit_allocations FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.credit_allocations FROM authenticated;
