/*
  # Realtime: add online_order_status_history

  1. Changes
    - Adds online_order_status_history to the supabase_realtime publication so that
      the public order tracking page (ShopTrackOrder) receives instant INSERT
      notifications whenever a shop worker updates the order status, without
      requiring page refresh.

  2. Security
    - No RLS change. Publication membership is independent of RLS and the client
      still goes through RLS when subscribing to postgres_changes events.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'online_order_status_history'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.online_order_status_history;
  END IF;
END $$;
