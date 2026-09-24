-- Indexes for duplicate-check queries in import_to_master_catalog RPC
-- Without these, each row check does a full sequential scan of the catalog
CREATE INDEX IF NOT EXISTS idx_mci_lookup_ref_brand
  ON master_catalog_items (master_catalog_id, lower(manufacturer_ref), lower(brand));

CREATE INDEX IF NOT EXISTS idx_mci_lookup_designation_brand
  ON master_catalog_items (master_catalog_id, lower(designation), lower(brand));

-- Index for category name lookups (both root and subcategory)
CREATE INDEX IF NOT EXISTS idx_mcc_lookup_name_parent
  ON master_catalog_categories (master_catalog_id, lower(name), parent_id);
