/*
  # Allow anonymous SELECT on business_activity_types

  1. Security
    - Add SELECT policy for anon role on business_activity_types
    - This is needed so the public signup page can display available activity types
    - Only active types are exposed (is_active = true)
*/

CREATE POLICY "Activity types readable by anon for signup"
  ON public.business_activity_types FOR SELECT
  TO anon
  USING (is_active = true);
