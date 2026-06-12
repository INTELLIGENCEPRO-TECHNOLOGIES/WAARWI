/*
# Enable realtime for additional tables

Adds cash_movements, stock_lots, and journal_entries to the supabase_realtime publication
so that Realtime subscriptions fire for changes on these tables.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'cash_movements') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE cash_movements;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'stock_lots') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE stock_lots;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'journal_entries') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE journal_entries;
  END IF;
END $$;