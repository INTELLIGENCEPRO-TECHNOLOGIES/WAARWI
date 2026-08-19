import { useEffect, useState } from 'react';
import {
  ShoppingCart, Package, FileText, Users, Truck, Globe,
  BarChart3, TrendingUp, Shield, Zap, Wallet, Layers, Monitor, Receipt,
} from 'lucide-react';
import { supabase } from './supabase';

export type LoginModule = { icon: string; label: string; desc: string };

export type LoginConfig = {
  headline: string;
  headline_accent: string;
  subtitle: string;
  login_bg_url: string | null;
  modules: LoginModule[];
};

export const LOGIN_ICON_MAP: Record<string, any> = {
  ShoppingCart,
  Package,
  FileText,
  Users,
  Truck,
  Globe,
  BarChart3,
  TrendingUp,
  Shield,
  Zap,
  Wallet,
  Layers,
  Monitor,
  Receipt,
};

export const DEFAULT_LOGIN_MODULES: LoginModule[] = [
  { icon: 'ShoppingCart', label: 'Point de vente', desc: 'Caisse rapide et intuitive' },
  { icon: 'Package', label: 'Stock', desc: 'Maîtrisez vos stocks' },
  { icon: 'FileText', label: 'Facturation', desc: 'Devis et factures pro' },
  { icon: 'Users', label: 'Clients & Tiers', desc: 'CRM et créances' },
  { icon: 'Truck', label: 'Fournisseurs', desc: 'Commandes et dettes' },
  { icon: 'Globe', label: 'Boutique en ligne', desc: 'Vitrine et commandes web' },
  { icon: 'BarChart3', label: 'Comptabilité', desc: 'Suivi financier complet' },
  { icon: 'TrendingUp', label: 'Rapports', desc: 'Analyses et tableaux de bord' },
  { icon: 'Shield', label: 'Sécurité', desc: 'Rôles et permissions' },
];

const DEFAULTS: LoginConfig = {
  headline: 'Tout votre business,',
  headline_accent: 'simplement.',
  subtitle: 'Ventes, stock et équipe réunis dans un espace clair pour vous aider à rester concentré sur l\'essentiel.',
  login_bg_url: null,
  modules: DEFAULT_LOGIN_MODULES,
};

export function useLoginConfig() {
  const [config, setConfig] = useState<LoginConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('platform_login_config')
          .select('*')
          .eq('id', 'default')
          .maybeSingle();
        if (cancelled) return;
        if (data && !error) {
          setConfig({
            headline: data.headline || DEFAULTS.headline,
            headline_accent: data.headline_accent || DEFAULTS.headline_accent,
            subtitle: data.subtitle || DEFAULTS.subtitle,
            login_bg_url: data.login_bg_url || null,
            modules: (data.modules && data.modules.length > 0) ? data.modules : DEFAULTS.modules,
          });
        }
      } catch { /* use defaults */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return { config, loading };
}
