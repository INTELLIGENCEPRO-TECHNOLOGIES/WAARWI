/*
# Add missing tables to Supabase Realtime publication

1. Changes:
   - Add `stock_lots` to realtime publication
   - Add `cash_movements` to realtime publication
   - Add `journal_entries` to realtime publication
   - Add `customer_prepayments` to realtime publication

2. Purpose:
   - Enables real-time synchronization across multiple users for stock lot tracking,
     cash movements, accounting entries, and customer prepayments
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'stock_lots') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE stock_lots;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'cash_movements') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE cash_movements;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'journal_entries') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE journal_entries;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'customer_prepayments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE customer_prepayments;
  END IF;
END $$;
