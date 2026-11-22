-- All self-service registrations now use register_waarwi_company.
-- Keep the provisioning implementation for the registration function and service role.
revoke execute on function public.provision_tenant(text, text, text, uuid, text, text, text, text, text) from authenticated;
revoke execute on function public.provision_tenant(text, text, text, uuid) from authenticated;
revoke execute on function public.provision_tenant(text, text, text) from authenticated;
revoke execute on function public.provision_tenant(text, text) from authenticated;
