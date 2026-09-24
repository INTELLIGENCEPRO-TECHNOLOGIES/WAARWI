/*
# RS1 Section G — Repair ADAMA CISSÉ data (corrected IDs)

## Summary
Removes ghost sale_payments, ghost cash_movements, and ghost balance_adjustments
created by the buggy register_customer_payment FIFO path. Recalculates affected
sales' paid amounts and statuses. Creates one legitimate customer_payment record
for the 70k that was originally intended as a balance report payment.

## Affected records (all verified by exact ID)
- 11 ghost sale_payments
- 11 ghost FIFO cash_movements + 2 ghost balance cash_movements
- 2 ghost balance_adjustments
- 5 affected sales: V-00056 through V-00060
*/

DO $$
DECLARE
  v_tenant uuid := '31f9910a-5e94-4dc1-8ab5-c204bbcdb7db';
  v_customer uuid := 'e1e9fadc-3b3b-4542-bd83-3cb81ce711ef';
  v_session uuid := 'de5213f4-b07f-46ba-a350-a21cb0635e3c';
  v_carryover uuid := 'fe43e147-294e-4be6-9c13-f252b45cf831';
  v_site uuid := '91fcc3e8-f5bd-4fc8-8899-25bed82a44ee';
  v_admin uuid := '65a0b438-957b-4556-a296-00a851716220';

  v_ghost_sp_ids uuid[] := ARRAY[
    'f8f06009-7cdb-45b5-a146-815be0b1280b',
    'd5aad06e-a9dd-4c9e-b728-e5b7b365572b',
    '1fd74a43-99cb-47f9-9980-617eac69b5cb',
    '32a76fff-938c-48cd-afa8-be3f2dce5a65',
    'd9edfff2-8f3f-4d6b-baca-4f11b36b6cef',
    '9c4aa9b8-5964-4c3b-940c-9045f9bbce34',
    'b0aec42a-5be1-4786-b0ad-2fa77dd80089',
    '3fb30591-fd6b-479c-baa1-cf5fe792b91a',
    '623ba4c3-f3df-4bd1-aaf2-6d00d39c935f',
    '634a6bf2-3282-4a68-a0be-adad259f8723',
    'beffc8a3-de31-4555-aab2-668d1530457b'
  ];

  v_ghost_cm_fifo_ids uuid[] := ARRAY[
    '7376226d-03ab-428a-ad06-fddffdbf39bc',
    '065e67fd-a40c-40de-b5a6-5d6485eaea37',
    'eed075f3-2c11-4741-9cd7-86a3a8793a17',
    'b4f6c650-30dc-4daf-a7cc-eeb2216f4103',
    '0377e96f-3dc9-4cd1-9ae6-45969fb5b28e',
    'e3993ab3-a342-4fab-9f78-09d2a4220bf1',
    '11479d40-f1b9-47c3-a248-3b070468d185',
    '3cf88bd8-c0ab-4afe-9319-5707e88e537c',
    '3646eb9b-d37b-4349-a0d7-af880e179c0e',
    '94fd8f9e-a298-4a2e-a08c-d2752187d621',
    '35f9411b-5aee-4901-aa73-6ee114db62de'
  ];

  v_ghost_cm_balance_ids uuid[] := ARRAY[
    '08fd2aaa-c18d-4ef2-84bb-5b4ccc6a7c1f',
    '0a822ad6-7dd3-4623-9087-cd05fe59aac4'
  ];

  v_ghost_ba_ids uuid[] := ARRAY[
    'd6921d37-37ab-464f-a360-1f9f6cc3a0ea',
    '05bf93d8-b233-46d1-a19e-9625ab879350'
  ];

  v_deleted int;
  v_sale_id uuid;
  v_new_paid numeric;
  v_new_status text;
  v_sale_total numeric;
BEGIN
  -- Step 1: Delete ghost sale_payments
  DELETE FROM sale_payments WHERE id = ANY(v_ghost_sp_ids) AND tenant_id = v_tenant;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 11 THEN
    RAISE EXCEPTION 'Expected 11 ghost sale_payments deleted, got %', v_deleted;
  END IF;

  -- Step 2: Delete ghost FIFO cash_movements
  DELETE FROM cash_movements WHERE id = ANY(v_ghost_cm_fifo_ids) AND tenant_id = v_tenant;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 11 THEN
    RAISE EXCEPTION 'Expected 11 ghost FIFO cash_movements deleted, got %', v_deleted;
  END IF;

  -- Step 3: Delete ghost balance_adjustments
  DELETE FROM balance_adjustments WHERE id = ANY(v_ghost_ba_ids) AND tenant_id = v_tenant;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 2 THEN
    RAISE EXCEPTION 'Expected 2 ghost balance_adjustments deleted, got %', v_deleted;
  END IF;

  -- Step 4: Delete ghost "Règlement solde client" cash_movements
  DELETE FROM cash_movements WHERE id = ANY(v_ghost_cm_balance_ids) AND tenant_id = v_tenant;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 2 THEN
    RAISE EXCEPTION 'Expected 2 ghost balance cash_movements deleted, got %', v_deleted;
  END IF;

  -- Step 5: Recalculate paid/status for 5 affected sales
  FOR v_sale_id, v_sale_total IN
    SELECT s.id, s.total FROM sales s
    WHERE s.sale_number IN ('V-00056','V-00057','V-00058','V-00059','V-00060')
      AND s.tenant_id = v_tenant
      AND s.customer_id = v_customer
  LOOP
    SELECT COALESCE(SUM(sp.amount), 0) INTO v_new_paid
    FROM sale_payments sp WHERE sp.sale_id = v_sale_id;

    v_new_status := CASE
      WHEN v_new_paid <= 0 THEN 'validated'
      WHEN v_new_paid >= v_sale_total THEN 'paid'
      ELSE 'partial'
    END;

    UPDATE sales SET paid = v_new_paid, status = v_new_status
    WHERE id = v_sale_id AND tenant_id = v_tenant;
  END LOOP;

  -- Step 6: Fix carryover amount_used to 135000 (fully consumed)
  UPDATE balance_adjustments
    SET amount_used = 135000
    WHERE id = v_carryover AND tenant_id = v_tenant;

  -- Step 7: Fix cash session theoretical_amount
  -- Remove: 470k (FIFO) + 70k (balance ghosts) = 540k
  -- Add back: 70k for the legitimate customer_payment
  -- Net: -470k
  UPDATE cash_sessions
    SET theoretical_amount = theoretical_amount - 470000
    WHERE id = v_session AND tenant_id = v_tenant;

  -- Step 8: Create legitimate customer_payment for 70k
  INSERT INTO customer_payments (
    tenant_id, customer_id, amount, method, method_name,
    payment_method_id, reference, cash_session_id,
    site_id, user_id, status
  )
  SELECT
    v_tenant, v_customer, 70000, 'Espèces', 'Espèces',
    pm.id, 'Correction RS1 · Règlement solde ADAMA CISSE', v_session,
    v_site, v_admin, 'confirmed'
  FROM payment_methods pm
  WHERE pm.tenant_id = v_tenant AND pm.name = 'Espèces'
  LIMIT 1;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'Failed to create legitimate customer_payment';
  END IF;

END $$;
