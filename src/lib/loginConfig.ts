import { useEffect, useState } from 'react';
import {
  ShoppingCart, Package, FileText, Users, Truck, Globe,
  BarChart3, TrendingUp, Shield, Zap, Wallet, Layers, Monitor, Receipt,
} from 'lucide-react';
import { supabase } from './supabase';

export type LoginModule = { icon: string; label: string; desc: string };

export type TextAccent = {
  text: string;
  effect: 'underline' | 'paint' | 'splash' | 'brush' | 'highlight' | 'circle' | 'starburst' | 'marker' | 'wavyUnderline' | 'shortUnderline' | 'paintStroke' | 'strikethrough' | 'glow' | 'boxed';
  color: string;
};

export type LoginConfig = {
  headline: string;
  headline_accent: string;
  subtitle: string;
  eyebrow: string;
  text_accents: TextAccent[];
  carousel_interval_ms: number;
  login_title: string;
  login_subtitle: string;
  login_bg_url: string | null;
  modules: LoginModule[];
  footer_links: { label: string; url: string }[];
  footer_copyright: string;
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
  eyebrow: 'LA PLATEFORME QUI AVANCE AVEC VOUS',
  text_accents: [],
  carousel_interval_ms: 4000,
  login_title: 'Accédez à votre espace',
  login_subtitle: 'Connectez-vous pour gérer votre activité.',
  login_bg_url: null,
  modules: DEFAULT_LOGIN_MODULES,
  footer_links: [],
  footer_copyright: '',
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
            eyebrow: data.eyebrow || DEFAULTS.eyebrow,
            text_accents: (data.text_accents && Array.isArray(data.text_accents)) ? data.text_accents : [],
            carousel_interval_ms: data.carousel_interval_ms || DEFAULTS.carousel_interval_ms,
            login_title: data.login_title || DEFAULTS.login_title,
            login_subtitle: data.login_subtitle || DEFAULTS.login_subtitle,
            login_bg_url: data.login_bg_url || null,
            modules: (data.modules && data.modules.length > 0) ? data.modules : DEFAULTS.modules,
            footer_links: (data.footer_links && Array.isArray(data.footer_links)) ? data.footer_links : [],
            footer_copyright: data.footer_copyright || '',
          });
        }
      } catch { /* use defaults */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return { config, loading };
}
