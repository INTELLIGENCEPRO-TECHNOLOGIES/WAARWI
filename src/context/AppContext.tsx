import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { includesChanges, subscribeToDataChanges } from '../lib/realtime';
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
  /** Per-browser preferred default for this user+tenant (localStorage). Not written to DB. */
  setDefaultSite: (site: Site) => Promise<void>;
  /** Per-browser default site id (null when the user has never picked one on this browser). */
  localDefaultSiteId: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  onDataChange: (tables: readonly string[], cb: () => void) => () => void;
  posCartCount: number;
  posCartOpen: boolean;
  setPosCart: (count: number, open: boolean) => void;
  refData: RefData | null;
  isOwner: boolean;
};

const REF_TABLES = ['part_categories', 'vehicle_brands', 'vehicle_models', 'payment_methods'];
const CORE_TABLES = ['tenants', 'profiles', 'sites', 'business_activity_types'];

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AppState['user']>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [depots, setDepots] = useState<Site[]>([]);
  const [currentSite, setCurrentSite] = useState<Site | null>(null);
  const [localDefaultSiteId, setLocalDefaultSiteId] = useState<string | null>(null);
  const lastLostSiteAlertRef = useRef<string | null>(null);
  const [coreTick, setCoreTick] = useState(0);
  const [refTick, setRefTick] = useState(0);
  const [posCartCount, setPosCartCount] = useState(0);
  const [posCartOpen, setPosCartOpenState] = useState(false);
  const listenersRef = useRef<{ tables: readonly string[]; cb: () => void }[]>([]);
  const [refData, setRefData] = useState<RefData | null>(null);
  const refDataTidRef = useRef<string | null>(null);
  const refRequest = useRef(0);
  const activeSiteKey = (uid: string, tid: string) => `activeSiteId:${uid}:${tid}`;
  const defaultSiteKey = (uid: string, tid: string) => `defaultSiteId:${uid}:${tid}`;
  const readTabActive = (uid: string, tid: string): string | null => {
    try { return sessionStorage.getItem(activeSiteKey(uid, tid)); } catch { return null; }
  };
  const readLocalDefault = (uid: string, tid: string): string | null => {
    try { return localStorage.getItem(defaultSiteKey(uid, tid)); } catch { return null; }
  };

  const loadSession = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      setUser(null); setProfile(null); setTenant(null); setSites([]); setDepots([]); setCurrentSite(null);
      setLocalDefaultSiteId(null);
      lastLostSiteAlertRef.current = null;
      setLoading(false);
      return;
    }
    setUser({ id: session.user.id, email: session.user.email || '' });

    const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    setProfile(prof || null);

    if (prof?.tenant_id) {
      const [{ data: ten }, { data: s }] = await Promise.all([
        supabase.from('tenants').select('*').eq('id', prof.tenant_id).maybeSingle(),
        supabase.from('sites').select('id, name, code, address, phone, is_active, is_warehouse, tenant_id, parent_site_id, logo_url, legal_name, ninea, rccm, email, website, ticket_header_config, a4_header_config, allow_negative_stock').eq('tenant_id', prof.tenant_id).eq('is_active', true).order('name'),
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
      const mode: string = (prof as any).site_access_mode || 'selected';
      const assignedIds: string[] | null = (prof as any).assigned_site_ids;
      const filtered = mode === 'all'
        ? allSites
        : (assignedIds && assignedIds.length > 0)
          ? allSites.filter(x => assignedIds.includes(x.id) || (x.is_warehouse && x.parent_site_id && assignedIds.includes(x.parent_site_id)))
          : [];
      const storeList = filtered.filter(x => !x.is_warehouse);
      const depotList = filtered.filter(x => x.is_warehouse);
      setSites(storeList);
      setDepots(depotList);

      const uid = session.user.id;
      const tid = prof.tenant_id;
      const allAvailable = [...storeList, ...depotList];
      const tabActiveId = readTabActive(uid, tid);
      const localDefault = readLocalDefault(uid, tid);
      setLocalDefaultSiteId(localDefault);
      const dbDefaultId: string | null = (prof as any).default_site_id || null;

      setCurrentSite(prev => {
        if (prev) {
          const fresh = allAvailable.find(x => x.id === prev.id);
          if (fresh) return fresh;
        }
        const picked =
          (tabActiveId && allAvailable.find(x => x.id === tabActiveId)) ||
          (localDefault && allAvailable.find(x => x.id === localDefault)) ||
          (dbDefaultId && allAvailable.find(x => x.id === dbDefaultId)) ||
          storeList[0] ||
          depotList[0] ||
          null;
        if (picked) {
          try { sessionStorage.setItem(activeSiteKey(uid, tid), picked.id); } catch {}
        }
        return picked || null;
      });
      try { localStorage.removeItem('currentSiteId'); } catch {}

      // Track tenant activity
      supabase.rpc('touch_tenant_activity').then(() => {});
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSession();
    const { data: sub } = supabase.auth.onAuthStateChange(event => {
      if (event === 'INITIAL_SESSION') return;
      (async () => { await loadSession(); })();
    });
    return () => sub.subscription.unsubscribe();
  }, [loadSession]);

  const tenantId = profile?.tenant_id;
  const profileId = profile?.id;
  const platform = profile?.role === 'super_admin';

  useEffect(() => {
    if (!profileId || (!tenantId && !platform)) return;
    const topics = ['waarwi:shared'];
    if (tenantId) topics.push(`waarwi:tenant:${tenantId}`);
    if (platform) topics.push('waarwi:platform');

    return subscribeToDataChanges(topics, changes => {
      if (includesChanges(changes, CORE_TABLES)) setCoreTick(tick => tick + 1);
      if (includesChanges(changes, REF_TABLES)) setRefTick(tick => tick + 1);
      listenersRef.current.forEach(listener => {
        if (listener.tables.includes('*') || includesChanges(changes, listener.tables)) {
          try { listener.cb(); } catch { /* other screens still need the update */ }
        }
      });
    });
  }, [profileId, tenantId, platform]);

  const approvalStatus = tenant?.approval_status;
  useEffect(() => {
    if (!tenantId || (approvalStatus !== 'pending' && approvalStatus !== 'rejected')) return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (!active || checking || document.hidden || !navigator.onLine) return;
      checking = true;
      try {
        const { data } = await supabase.from('tenants').select('approval_status').eq('id', tenantId).maybeSingle();
        if (active && data?.approval_status && data.approval_status !== approvalStatus) setCoreTick(tick => tick + 1);
      } finally {
        checking = false;
      }
    };
    // A limited fallback for the waiting screen, including the join window.
    const interval = window.setInterval(() => void check(), 12000);
    void check();
    return () => { active = false; window.clearInterval(interval); };
  }, [tenantId, approvalStatus]);

  // Refresh scoped identity and site data only when these records change.
  useEffect(() => {
    if (!tenantId || !profileId || coreTick === 0) return;
    let current = true;
    const tid = tenantId;
    const pid = profileId;
    const timer = setTimeout(async () => {
      const [{ data: ten }, { data: s }, { data: prof }] = await Promise.all([
        supabase.from('tenants').select('*').eq('id', tid).maybeSingle(),
        supabase.from('sites').select('id, name, code, address, phone, is_active, is_warehouse, tenant_id, parent_site_id, logo_url, legal_name, ninea, rccm, email, website, ticket_header_config, a4_header_config, allow_negative_stock').eq('tenant_id', tid).eq('is_active', true).order('name'),
        supabase.from('profiles').select('*').eq('id', pid).maybeSingle(),
      ]);
      if (!current) return;
      if (prof?.tenant_id && prof.tenant_id !== tid) { void loadSession(); return; }
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
        if (!current) return;
        setTenant(previous => JSON.stringify(previous) === JSON.stringify(tenantWithActivity) ? previous : tenantWithActivity);
      }
      if (s && prof) {
        const mode: string = (prof as any).site_access_mode || 'selected';
        const assignedIds: string[] | null = (prof as any).assigned_site_ids;
        const filtered = mode === 'all'
          ? s
          : (assignedIds && assignedIds.length > 0)
            ? s.filter(x => assignedIds.includes(x.id) || (x.is_warehouse && x.parent_site_id && assignedIds.includes(x.parent_site_id)))
            : [];
        const storeList = filtered.filter(x => !x.is_warehouse);
        const depotList = filtered.filter(x => x.is_warehouse);
        setSites(storeList);
        setDepots(depotList);
        setCurrentSite(prev => {
          if (!prev) return storeList[0] || depotList[0] || null;
          const allAvailable = [...storeList, ...depotList];
          const fresh = allAvailable.find(x => x.id === prev.id);
          if (fresh) return fresh;
          if (lastLostSiteAlertRef.current !== prev.id) {
            lastLostSiteAlertRef.current = prev.id;
            const name = prev.name;
            setTimeout(() => {
              try { window.alert(`Le magasin "${name}" n'est plus accessible. Veuillez sélectionner un autre magasin.`); } catch {}
            }, 0);
          }
          if (user?.id) {
            try { sessionStorage.removeItem(activeSiteKey(user.id, tid)); } catch {}
          }
          return null;
        });
      } else if (s) {
        const storeList = s.filter(x => !x.is_warehouse);
        const depotList = s.filter(x => x.is_warehouse);
        setSites(storeList);
        setDepots(depotList);
        setCurrentSite(prev => {
          if (!prev) return storeList[0] || depotList[0] || null;
          const allAvailable = [...storeList, ...depotList];
          const fresh = allAvailable.find(x => x.id === prev.id);
          if (fresh) return fresh;
          if (lastLostSiteAlertRef.current !== prev.id) {
            lastLostSiteAlertRef.current = prev.id;
            const name = prev.name;
            setTimeout(() => {
              try { window.alert(`Le magasin "${name}" n'est plus accessible. Veuillez sélectionner un autre magasin.`); } catch {}
            }, 0);
          }
          if (user?.id) {
            try { sessionStorage.removeItem(activeSiteKey(user.id, tid)); } catch {}
          }
          return null;
        });
      }
      if (prof) setProfile(previous => JSON.stringify(previous) === JSON.stringify(prof) ? previous : prof);
    }, 80);
    return () => { current = false; clearTimeout(timer); };
  }, [coreTick, profileId, tenantId, user?.id, loadSession]);

  const onDataChange = useCallback((tables: readonly string[], cb: () => void) => {
    const entry = { tables, cb };
    listenersRef.current.push(entry);
    return () => { listenersRef.current = listenersRef.current.filter(l => l !== entry); };
  }, []);

  // Reference data cache: categories, brands, models, payment methods
  const loadRefData = useCallback(async (tid: string) => {
    const request = ++refRequest.current;
    const [{ data: cats }, { data: brands }, { data: models }, { data: pm }] = await Promise.all([
      supabase.from('part_categories').select('id, name, code, parent_id, tenant_id, is_active, track_stock').eq('tenant_id', tid).eq('is_active', true).order('name'),
      supabase.from('vehicle_brands').select('id, name, tenant_id').eq('tenant_id', tid).eq('is_active', true).order('name'),
      supabase.from('vehicle_models').select('id, name, brand_id, tenant_id').eq('tenant_id', tid).order('name'),
      supabase.from('payment_methods').select('id, name, is_active, sort_order, tenant_id, payment_type').eq('tenant_id', tid).eq('is_active', true).order('sort_order'),
    ]);
    if (refDataTidRef.current !== tid || request !== refRequest.current) return;
    setRefData({
      categories: (cats || []) as Category[],
      brands: (brands || []) as VehicleBrand[],
      models: models || [],
      paymentMethods: pm || [],
      loadedAt: Date.now(),
    });
  }, []);

  useEffect(() => {
    refDataTidRef.current = tenantId || null;
    if (!tenantId) { setRefData(null); return; }
    void loadRefData(tenantId);
  }, [tenantId, refTick, loadRefData]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
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
    lastLostSiteAlertRef.current = null;
    if (user?.id && profile?.tenant_id) {
      try { sessionStorage.setItem(activeSiteKey(user.id, profile.tenant_id), site.id); } catch {}
    }
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
    lastLostSiteAlertRef.current = null;
    setLocalDefaultSiteId(site.id);
    if (user?.id && profile?.tenant_id) {
      try {
        sessionStorage.setItem(activeSiteKey(user.id, profile.tenant_id), site.id);
        localStorage.setItem(defaultSiteKey(user.id, profile.tenant_id), site.id);
      } catch {}
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
      localDefaultSiteId,
      signIn, signOut, refresh: loadSession,
      onDataChange,
      posCartCount, posCartOpen, setPosCart,
      refData,
      isOwner: !!(user && tenant && (tenant as any).owner_user_id === user.id),
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
