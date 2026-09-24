/*
# ZIP 26 - Performance Indexes for Server-Side Search

## Indexes Added
- supplier_orders: (tenant_id, created_at DESC) for pagination
- cash_sessions: (tenant_id, opened_at DESC) for pagination
- customers: (tenant_id, name) for alphabetical pagination + search
- suppliers: (tenant_id, name) for alphabetical pagination + search
- stock_documents: (tenant_id, site_id, created_at DESC) for site-scoped pagination
- stock_movements: pg_trgm on article name for text search (uses existing btree indexes)
- online_orders: (tenant_id, created_at DESC) already exists
- mt_operations: (tenant_id, operated_at DESC) already exists

## Notes
- Uses IF NOT EXISTS for idempotency
- pg_trgm GIN indexes for ILIKE performance on text search columns
*/

-- Enable pg_trgm if not already (needed for ILIKE indexes)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- supplier_orders: pagination index
CREATE INDEX IF NOT EXISTS idx_supplier_orders_tenant_created
  ON supplier_orders (tenant_id, created_at DESC);

-- supplier_orders: search on order_number
CREATE INDEX IF NOT EXISTS idx_supplier_orders_order_number_trgm
  ON supplier_orders USING gin (order_number gin_trgm_ops);

-- cash_sessions: pagination index  
CREATE INDEX IF NOT EXISTS idx_cash_sessions_tenant_opened
  ON cash_sessions (tenant_id, opened_at DESC);

-- cash_sessions: tenant + site for filtered queries
CREATE INDEX IF NOT EXISTS idx_cash_sessions_tenant_site
  ON cash_sessions (tenant_id, site_id, opened_at DESC);

-- customers: pagination + search
CREATE INDEX IF NOT EXISTS idx_customers_tenant_name
  ON customers (tenant_id, name);

CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON customers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm
  ON customers USING gin (phone gin_trgm_ops);

-- suppliers: pagination + search
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_name
  ON suppliers (tenant_id, name);

CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm
  ON suppliers USING gin (name gin_trgm_ops);

-- stock_documents: site-scoped pagination
CREATE INDEX IF NOT EXISTS idx_stockdoc_site_created
  ON stock_documents (site_id, created_at DESC);

-- stock_documents: search on doc_number  
CREATE INDEX IF NOT EXISTS idx_stockdoc_docnumber_trgm
  ON stock_documents USING gin (doc_number gin_trgm_ops);

-- online_orders: search on order_number + customer
CREATE INDEX IF NOT EXISTS idx_online_orders_ordernumber_trgm
  ON online_orders USING gin (order_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_online_orders_custname_trgm
  ON online_orders USING gin (customer_name gin_trgm_ops);

-- mt_operations: search on reference + client
CREATE INDEX IF NOT EXISTS idx_mt_operations_reference_trgm
  ON mt_operations USING gin (reference gin_trgm_ops) WHERE reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mt_operations_client_name_trgm
  ON mt_operations USING gin (client_name gin_trgm_ops) WHERE client_name IS NOT NULL;

-- mt_operations: service_point + operated_at for filtered pagination
CREATE INDEX IF NOT EXISTS idx_mt_operations_sp_operated
  ON mt_operations (service_point_id, operated_at DESC);
