-- Return workflow improvements:
-- 1. Add refund_cash_session_id to track which session processed a cash refund
-- 2. Add refunded_at timestamp when a return is processed (cash or avoir)
-- 3. Add a view to compute already-returned quantities per sale item
-- 4. Add a function to process return as cash refund from billing
-- 5. Add a function to approve return as avoir (credit note)

-- Add columns to sale_returns for workflow
ALTER TABLE sale_returns
  ADD COLUMN IF NOT EXISTS refund_cash_session_id uuid REFERENCES cash_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- View: returned quantities per sale_item
-- Used to enforce "cannot return more than purchased minus already returned"
CREATE OR REPLACE VIEW sale_item_returned_quantities AS
  SELECT
    sri.article_id,
    sr.sale_id,
    SUM(sri.quantity) AS total_returned
  FROM sale_return_items sri
  JOIN sale_returns sr ON sr.id = sri.return_id
  WHERE sr.status IN ('approved', 'pending')
    AND sr.tenant_id = sr.tenant_id  -- always true, just to keep tenant_id in scope
  GROUP BY sri.article_id, sr.sale_id;

-- Function: process return as cash refund
-- Creates a cash movement to record the refund, marks the return as approved
CREATE OR REPLACE FUNCTION process_return_as_cash(
  p_return_id uuid,
  p_session_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_ret record;
  v_session record;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

  SELECT * INTO v_ret FROM sale_returns
  WHERE id = p_return_id AND tenant_id = v_tenant_id;
  IF v_ret.id IS NULL THEN RAISE EXCEPTION 'Retour introuvable'; END IF;
  IF v_ret.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Ce retour ne peut pas être remboursé (statut: %)', v_ret.status;
  END IF;

  -- Try to find open session if not provided
  IF p_session_id IS NULL AND v_ret.site_id IS NOT NULL THEN
    SELECT id INTO p_session_id FROM cash_sessions
    WHERE tenant_id = v_tenant_id AND site_id = v_ret.site_id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  END IF;

  -- Record cash movement (expense = cash out) if session is available
  IF p_session_id IS NOT NULL THEN
    SELECT * INTO v_session FROM cash_sessions WHERE id = p_session_id AND tenant_id = v_tenant_id;
    IF v_session.id IS NOT NULL THEN
      INSERT INTO cash_movements (
        tenant_id, site_id, cash_session_id, kind, amount, reason, reference
      ) VALUES (
        v_tenant_id, v_ret.site_id, p_session_id, 'expense',
        v_ret.total,
        'Remboursement retour ' || v_ret.return_number,
        v_ret.return_number
      );
      -- Decrease theoretical amount on the session
      UPDATE cash_sessions
      SET theoretical_amount = GREATEST(0, COALESCE(theoretical_amount, 0) - v_ret.total)
      WHERE id = p_session_id;
    END IF;
  END IF;

  -- Mark return as approved/refunded
  UPDATE sale_returns
  SET status = 'approved',
      refund_method = 'cash',
      refund_cash_session_id = p_session_id,
      refunded_at = now()
  WHERE id = p_return_id;

  RETURN jsonb_build_object('success', true, 'amount', v_ret.total);
END;
$$;

-- Function: approve return as avoir (credit note)
-- Just marks the return as approved with refund_method='avoir'
CREATE OR REPLACE FUNCTION approve_return_as_avoir(
  p_return_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_ret record;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

  SELECT * INTO v_ret FROM sale_returns
  WHERE id = p_return_id AND tenant_id = v_tenant_id;
  IF v_ret.id IS NULL THEN RAISE EXCEPTION 'Retour introuvable'; END IF;
  IF v_ret.status NOT IN ('pending') THEN
    RAISE EXCEPTION 'Seuls les retours en attente peuvent être convertis en avoir';
  END IF;

  -- Generate avoir number if needed (convert RET- to AVR-)
  -- Just update refund_method and status; keep the return_number or it was already AVR-
  UPDATE sale_returns
  SET status = 'approved',
      refund_method = 'avoir',
      refunded_at = now()
  WHERE id = p_return_id;

  RETURN jsonb_build_object('success', true, 'credit_balance', v_ret.total);
END;
$$;

-- Function: get already-returned quantities for a sale
-- Returns a map of article_id → total_returned for approved/pending returns on a given sale
CREATE OR REPLACE FUNCTION get_sale_returned_quantities(p_sale_id uuid)
RETURNS TABLE(article_id uuid, total_returned numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sri.article_id, SUM(sri.quantity) AS total_returned
  FROM sale_return_items sri
  JOIN sale_returns sr ON sr.id = sri.return_id
  WHERE sr.sale_id = p_sale_id
    AND sr.status IN ('approved', 'pending')
  GROUP BY sri.article_id;
$$;