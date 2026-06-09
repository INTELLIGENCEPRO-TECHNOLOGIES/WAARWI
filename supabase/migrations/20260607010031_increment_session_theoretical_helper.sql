
CREATE OR REPLACE FUNCTION increment_session_theoretical(
  p_session_id uuid,
  p_amount numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE cash_sessions
  SET theoretical_amount = COALESCE(theoretical_amount, 0) + p_amount
  WHERE id = p_session_id;
END;
$$;
