import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type TenantBranding = {
  id: string;
  name: string;
  legal_name: string;
  logo_url: string | null;
  primary_color: string;
  business_type: string | null;
  approval_status: string | null;
  phone: string | null;
  address: string | null;
  tagline: string | null;
};

const APP_ROOT_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
]);

/** Returns the hostname unless we are on the default app root (main marketing site). */
function resolveBrandingHost(): string | null {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname.toLowerCase();
  if (APP_ROOT_HOSTS.has(host)) return null;
  // Ignore bare bolt/netlify/vercel preview hosts (main app domain, no tenant branding).
  if (/\.(webcontainer-api\.io|stackblitz\.io|bolt\.new)$/.test(host)) return null;
  return host;
}

export function useTenantBranding() {
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const host = resolveBrandingHost();
    if (!host) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc('public_tenant_branding', { p_domain: host });
      if (cancelled) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setBranding(row as TenantBranding);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return { branding, loading };
}
