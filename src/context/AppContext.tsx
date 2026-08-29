import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile, Tenant, Site, Category, VehicleBrand } from '../lib/types';

export type RefData = {
  categories: Category[];
  brands: VehicleBrand[];
  models: { id: string; name: string; brand_id: string; tenant_id: string }[];
  paymentMethods: { id: string; name: string; is_active: boolean; sort_order: number; tenant_id: string; payment_type: string }[];
  loadedAt: number;
};

type AppState = {
  loading: boolean;
  user: { id: string; email: string } | null;
  profile: Profile | null;
  tenant: Tenant | null;
  sites: Site[];
  depots: Site[];
  currentSite: Site | null;
  setCurrentSite: (site: Site) => void;
  /** Marks a site as the persistent default for this user (saved to DB, cross-device) */
  setDefaultSite: (site: Site) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string, companyName: string, businessType: string, activityTypeId?: string | null, extra?: { city?: string; whatsapp_phone?: string; responsible_title?: string; selected_plan?: string; billing_cycle?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  dataTick: number;
  onDataChange: (tables: string[], cb: () => void) => () => void;
  posCartCount: number;
  posCartOpen: boolean;
  setPosCart: (count: number, open: boolean) => void;
  refData: RefData | null;
};

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AppState['user']>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [depots, setDepots] = useState<Site[]>([]);
  const [currentSite, setCurrentSite] = useState<Site | null>(null);
  const [dataTick, setDataTick] = useState(0);
  const [posCartCount, setPosCartCount] = useState(0);
  const [posCartOpen, setPosCartOpenState] = useState(false);
  const listenersRef = useRef<{ tables: Set<string>; cb: () => void }[]>([]);
  const [refData, setRefData] = useState<RefData | null>(null);
  const refDataTidRef = useRef<string | null>(null);
  const loadSession = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      setUser(null); setProfile(null); setTenant(null); setSites([]); setDepots([]); setCurrentSite(null);
      setLoading(false);
      return;
    }
    setUser({ id: session.user.id, email: session.user.email || '' });

    const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    setProfile(prof || null);

    if (prof?.tenant_id) {
      const [{ data: ten }, { data: s }] = await Promise.all([
        supabase.from('tenants').select('*').eq('id', prof.tenant_id).maybeSingle(),
        supabase.from('sites').select('id, name, code, address, phone, is_active, is_warehouse, tenant_id, parent_site_id, logo_url, legal_name, ninea, rccm, email, website, ticket_header_config').eq('tenant_id', prof.tenant_id).eq('is_active', true).order('name'),
      ]);
      let tenantWithActivity: Tenant | null = ten || null;
      if (ten?.business_activity_type_id) {
        const { data: act } = await supabase
          .from('business_activity_types')
          .select('name')
          .eq('id', ten.business_activity_type_id)
          .maybeSingle();
        tenantWithActivity = { ...ten, business_activity_type_name: act?.name || null } as Tenant;
      }
      setTenant(tenantWithActivity);
      const allSites = s || [];
      const assignedIds: string[] | null = (prof as any).assigned_site_ids;
      const filtered = (assignedIds && assignedIds.length > 0)
        ? allSites.filter(x => assignedIds.includes(x.id) || (x.is_warehouse && x.parent_site_id && assignedIds.includes(x.parent_site_id)))
        : allSites;
      const storeList = filtered.filter(x => !x.is_warehouse);
      const depotList = filtered.filter(x => x.is_warehouse);
      setSites(storeList);
      setDepots(depotList);

      // Priority: DB default_site_id > localStorage fallback > first store > first depot (legacy fallback)
      const defaultId: string | null = (prof as any).default_site_id || null;
      const storedId = localStorage.getItem('currentSiteId');
      const found =
        (defaultId && storeList.find(x => x.id === defaultId)) ||
        (storedId && storeList.find(x => x.id === storedId)) ||
        storeList[0] ||
        depotList[0] ||
        null;
      setCurrentSite(found);
      if (found) localStorage.setItem('currentSiteId', found.id);

      // Track tenant activity
      supabase.rpc('touch_tenant_activity').then(() => {});
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSession();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, _session) => {
      (async () => { await loadSession(); })();
    });
    return () => sub.subscription.unsubscribe();
  }, [loadSession]);

  // ── Realtime: one channel per tenant ──────────────────────────────────────
  useEffect(() => {
    const tid = profile?.tenant_id;
    if (!tid) return;
    const tables = [
      'articles','part_categories','stock_levels','stock_movements','stock_lots',
      'vehicle_brands','vehicle_models','article_compatibilities',
      'payment_methods','cash_sessions','cash_movements','sales','sale_items','sale_payments',
      'quotes','quote_items','sale_returns','sale_return_items',
      'customers','suppliers','supplier_orders','supplier_order_items','supplier_payments',
      'online_orders','online_order_items','shop_settings','tenants','sites','profiles','tenant_messages',
      'journal_entries',
    ];
    const dispatch = (table: string) => {
      setDataTick(t => t + 1);
      if (REF_TABLES.includes(table)) refDirtyRef.current = true;
      listenersRef.current.forEach(l => {
        if (l.tables.has(table) || l.tables.has('*')) {
          try { l.cb(); } catch (_e) { /* ignore */ }
        }
      });
    };
    const channel = supabase.channel(`tenant:${tid}`);
    tables.forEach(table => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => dispatch(table));
    });
    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        setTimeout(() => { setDataTick(t => t + 1); }, 2000);
      }
    });
    return () => { supabase.removeChannel(channel); };
  }, [profile?.tenant_id]);

  // ── Visibility change: refresh data when app returns to foreground ────────
  useEffect(() => {
    const tid = profile?.tenant_id;
    if (!tid) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setDataTick(t => t + 1);
        listenersRef.current.forEach(l => { try { l.cb(); } catch (_e) { /* ignore */ } });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [profile?.tenant_id]);

  // Refresh tenant/profile/sites on dataTick (debounced)
  useEffect(() => {
    if (!profile?.tenant_id || dataTick === 0) return;
    const tid = profile.tenant_id;
    const pid = profile.id;
    const timer = setTimeout(async () => {
      const [{ data: ten }, { data: s }, { data: prof }] = await Promise.all([
        supabase.from('tenants').select('*').eq('id', tid).maybeSingle(),
        supabase.from('sites').select('id, name, code, address, phone, is_active, is_warehouse, tenant_id, parent_site_id, logo_url, legal_name, ninea, rccm, email, website, ticket_header_config').eq('tenant_id', tid).eq('is_active', true).order('name'),
        supabase.from('profiles').select('*').eq('id', pid).maybeSingle(),
      ]);
      if (ten) {
        let tenantWithActivity: Tenant = ten as Tenant;
        if (ten.business_activity_type_id) {
          const { data: act } = await supabase
            .from('business_activity_types')
            .select('name')
            .eq('id', ten.business_activity_type_id)
            .maybeSingle();
          tenantWithActivity = { ...ten, business_activity_type_name: act?.name || null } as Tenant;
        }
        setTenant(tenantWithActivity);
      }
      if (s && prof) {
        const assignedIds: string[] | null = (prof as any).assigned_site_ids;
        const filtered = (assignedIds && assignedIds.length > 0)
          ? s.filter(x => assignedIds.includes(x.id) || (x.is_warehouse && x.parent_site_id && assignedIds.includes(x.parent_site_id)))
          : s;
        const storeList = filtered.filter(x => !x.is_warehouse);
        const depotList = filtered.filter(x => x.is_warehouse);
        setSites(storeList);
        setDepots(depotList);
        // Never silently switch site: only update if prev no longer exists in the full list
        setCurrentSite(prev => {
          if (!prev) return storeList[0] || depotList[0] || null;
          const allAvailable = [...storeList, ...depotList];
          const stillExists = allAvailable.find(x => x.id === prev.id);
          return stillExists || storeList[0] || depotList[0] || null;
        });
      } else if (s) {
        const storeList = s.filter(x => !x.is_warehouse);
        const depotList = s.filter(x => x.is_warehouse);
        setSites(storeList);
        setDepots(depotList);
        setCurrentSite(prev => {
          if (!prev) return storeList[0] || depotList[0] || null;
          const allAvailable = [...storeList, ...depotList];
          const stillExists = allAvailable.find(x => x.id === prev.id);
          return stillExists || storeList[0] || depotList[0] || null;
        });
      }
      if (prof) setProfile(prof);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataTick]);

  const onDataChange = useCallback((tables: string[], cb: () => void) => {
    const entry = { tables: new Set(tables), cb };
    listenersRef.current.push(entry);
    return () => { listenersRef.current = listenersRef.current.filter(l => l !== entry); };
  }, []);

  // Reference data cache: categories, brands, models, payment methods
  const REF_TABLES = ['part_categories', 'vehicle_brands', 'vehicle_models', 'payment_methods'];
  const refDirtyRef = useRef(false);
  const loadRefData = useCallback(async (tid: string) => {
    const [{ data: cats }, { data: brands }, { data: models }, { data: pm }] = await Promise.all([
      supabase.from('part_categories').select('id, name, parent_id, tenant_id, track_stock').eq('tenant_id', tid).eq('is_active', true).order('name'),
      supabase.from('vehicle_brands').select('id, name, tenant_id').eq('tenant_id', tid).eq('is_active', true).order('name'),
      supabase.from('vehicle_models').select('id, name, brand_id, tenant_id').eq('tenant_id', tid).order('name'),
      supabase.from('payment_methods').select('id, name, is_active, sort_order, tenant_id, payment_type').eq('tenant_id', tid).eq('is_active', true).order('sort_order'),
    ]);
    setRefData({
      categories: (cats || []) as Category[],
      brands: (brands || []) as VehicleBrand[],
      models: models || [],
      paymentMethods: pm || [],
      loadedAt: Date.now(),
    });
    refDirtyRef.current = false;
  }, []);

  useEffect(() => {
    const tid = profile?.tenant_id;
    if (!tid) { setRefData(null); return; }
    if (refDataTidRef.current !== tid) {
      refDataTidRef.current = tid;
      loadRefData(tid);
    }
  }, [profile?.tenant_id, loadRefData]);

  // Invalidate refData when ref tables change via realtime
  useEffect(() => {
    if (!profile?.tenant_id || dataTick === 0 || !refDirtyRef.current) return;
    const timer = setTimeout(() => { loadRefData(profile.tenant_id!); }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataTick]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string, fullName: string, companyName: string, businessType: string, activityTypeId?: string | null, extra?: { city?: string; whatsapp_phone?: string; responsible_title?: string; selected_plan?: string; billing_cycle?: string }) => {
    let { data, error } = await supabase.auth.signUp({ email, password });
    if (error && error.message?.toLowerCase().includes('already registered')) {
      const signInRes = await supabase.auth.signInWithPassword({ email, password });
      if (signInRes.error) throw signInRes.error;
      data = signInRes.data as any;
    } else if (error) {
      throw error;
    }
    if (!data.user) throw new Error('Inscription impossible');
    const { error: rpcErr } = await supabase.rpc('provision_tenant', {
      p_company_name: companyName,
      p_user_full_name: fullName,
      p_business_type: businessType,
      p_activity_type_id: activityTypeId || null,
      p_city: extra?.city || '',
      p_whatsapp_phone: extra?.whatsapp_phone || '',
      p_responsible_title: extra?.responsible_title || '',
      p_selected_plan: extra?.selected_plan || 'trial',
      p_billing_cycle: extra?.billing_cycle || 'monthly',
    });
    if (rpcErr) throw rpcErr;

    // Notify admin of new signup (fire-and-forget)
    const { data: prof } = await supabase.from('profiles').select('tenant_id').eq('id', data.user.id).maybeSingle();
    if (prof?.tenant_id) {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-notification-email`;
      const { data: sess } = await supabase.auth.getSession();
      fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${sess.session?.access_token || ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'new_signup', tenant_id: prof.tenant_id }),
      }).catch(() => {});
    }

    await loadSession();
  };

  const signOut = async () => {
    try {
      setUser(null); setProfile(null); setTenant(null); setSites([]); setDepots([]); setCurrentSite(null);
      try { localStorage.removeItem('currentSiteId'); } catch {}
      await Promise.race([
        supabase.auth.signOut({ scope: 'local' }),
        new Promise(resolve => setTimeout(resolve, 1500)),
      ]);
    } catch {
      // ignore
    } finally {
      try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('sb-') || k.includes('supabase.auth'))) keys.push(k);
        }
        keys.forEach(k => localStorage.removeItem(k));
      } catch {}
      try { sessionStorage.clear(); } catch {}
      window.location.replace('/');
    }
  };

  const prevSiteRef = useRef<string | null>(null);
  useEffect(() => {
    const newId = currentSite?.id || null;
    const prevId = prevSiteRef.current;
    if (prevId && newId && prevId !== newId && profile?.tenant_id && user?.id) {
      supabase.from('site_change_log').insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        previous_site_id: prevId,
        new_site_id: newId,
        trigger: 'dataTick_fallback',
      }).then(() => {});
    }
    prevSiteRef.current = newId;
  }, [currentSite?.id]);

  const handleSetCurrentSite = (site: Site) => {
    const prevId = currentSite?.id || null;
    setCurrentSite(site);
    localStorage.setItem('currentSiteId', site.id);
    if (prevId && prevId !== site.id && profile?.tenant_id && user?.id) {
      supabase.from('site_change_log').insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        previous_site_id: prevId,
        new_site_id: site.id,
        trigger: 'user_explicit',
      }).then(() => {});
    }
  };

  const handleSetDefaultSite = async (site: Site) => {
    setCurrentSite(site);
    localStorage.setItem('currentSiteId', site.id);
    if (profile?.id) {
      await supabase
        .from('profiles')
        .update({ default_site_id: site.id } as any)
        .eq('id', profile.id);
      setProfile(prev => prev ? { ...prev, default_site_id: site.id } as any : prev);
    }
  };

  const setPosCart = useCallback((count: number, open: boolean) => {
    setPosCartCount(count);
    setPosCartOpenState(open);
  }, []);

  return (
    <Ctx.Provider value={{
      loading, user, profile, tenant, sites, depots, currentSite,
      setCurrentSite: handleSetCurrentSite,
      setDefaultSite: handleSetDefaultSite,
      signIn, signUp, signOut, refresh: loadSession,
      dataTick, onDataChange,
      posCartCount, posCartOpen, setPosCart,
      refData,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used within AppProvider');
  return v;
}
