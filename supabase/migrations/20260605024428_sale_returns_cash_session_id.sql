-- Add cash_session_id to sale_returns so returns can be listed with session tickets
ALTER TABLE public.sale_returns ADD COLUMN IF NOT EXISTS cash_session_id uuid REFERENCES public.cash_sessions(id);
