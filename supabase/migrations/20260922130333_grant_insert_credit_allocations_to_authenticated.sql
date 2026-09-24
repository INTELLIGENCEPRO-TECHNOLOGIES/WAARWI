/*
# Grant INSERT on credit_allocations to authenticated role

## Summary
The _apply_avoirs_internal and apply_customer_prepayments functions run as
SECURITY INVOKER (authenticated role) and need to INSERT into credit_allocations.
The table was missing INSERT privilege for the authenticated role, causing
"permission denied" errors during credit sales and prepayment application.

## Security Changes
- GRANT INSERT on credit_allocations TO authenticated
*/

GRANT INSERT ON public.credit_allocations TO authenticated;
