-- Fix RLS on mt_expense_categories / mt_expenses / mt_customers / mt_customer_ledger
-- to use current_tenant_id() helper like other mt_* tables (not current_setting(...)).

-- mt_expense_categories
DROP POLICY IF EXISTS "select_mt_expense_categories" ON mt_expense_categories;
DROP POLICY IF EXISTS "insert_mt_expense_categories" ON mt_expense_categories;
DROP POLICY IF EXISTS "update_mt_expense_categories" ON mt_expense_categories;
DROP POLICY IF EXISTS "delete_mt_expense_categories" ON mt_expense_categories;
CREATE POLICY "select_mt_expense_categories" ON mt_expense_categories FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_mt_expense_categories" ON mt_expense_categories FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_mt_expense_categories" ON mt_expense_categories FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_mt_expense_categories" ON mt_expense_categories FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- mt_expenses
DROP POLICY IF EXISTS "select_mt_expenses" ON mt_expenses;
DROP POLICY IF EXISTS "insert_mt_expenses" ON mt_expenses;
DROP POLICY IF EXISTS "update_mt_expenses" ON mt_expenses;
DROP POLICY IF EXISTS "delete_mt_expenses" ON mt_expenses;
CREATE POLICY "select_mt_expenses" ON mt_expenses FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_mt_expenses" ON mt_expenses FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_mt_expenses" ON mt_expenses FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_mt_expenses" ON mt_expenses FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- mt_customers
DROP POLICY IF EXISTS "select_mt_customers" ON mt_customers;
DROP POLICY IF EXISTS "insert_mt_customers" ON mt_customers;
DROP POLICY IF EXISTS "update_mt_customers" ON mt_customers;
DROP POLICY IF EXISTS "delete_mt_customers" ON mt_customers;
CREATE POLICY "select_mt_customers" ON mt_customers FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_mt_customers" ON mt_customers FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_mt_customers" ON mt_customers FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_mt_customers" ON mt_customers FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- mt_customer_ledger
DROP POLICY IF EXISTS "select_mt_customer_ledger" ON mt_customer_ledger;
DROP POLICY IF EXISTS "insert_mt_customer_ledger" ON mt_customer_ledger;
DROP POLICY IF EXISTS "update_mt_customer_ledger" ON mt_customer_ledger;
DROP POLICY IF EXISTS "delete_mt_customer_ledger" ON mt_customer_ledger;
CREATE POLICY "select_mt_customer_ledger" ON mt_customer_ledger FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_mt_customer_ledger" ON mt_customer_ledger FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_mt_customer_ledger" ON mt_customer_ledger FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_mt_customer_ledger" ON mt_customer_ledger FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());
