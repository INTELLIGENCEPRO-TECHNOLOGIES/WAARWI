import { useEffect, useState } from 'react';
import { ArrowLeft, Mail, Phone, Clock, MessageCircle } from 'lucide-react';
import { supabase } from './lib/supabase';
import { renderMarkdown } from './lib/markdown';

type LegalDoc = 'mentions-legales' | 'confidentialite' | 'cgu';

const DOC_META: Record<LegalDoc, { title: string; field: 'legal_mentions' | 'privacy_policy' | 'terms_of_service' }> = {
  'mentions-legales': { title: 'Mentions légales', field: 'legal_mentions' },
  'confidentialite': { title: 'Politique de confidentialité', field: 'privacy_policy' },
  'cgu': { title: "Conditions générales d'utilisation", field: 'terms_of_service' },
};

type LegalConfig = {
  legal_mentions?: string;
  privacy_policy?: string;
  terms_of_service?: string;
  contact_email?: string;
  contact_hours?: string;
  whatsapp_url?: string;
  phone_display?: string;
  phone_tel?: string;
};

export function LegalPage({ doc, onBack }: { doc: LegalDoc; onBack: () => void }) {
  const meta = DOC_META[doc];
  const [content, setContent] = useState('');
  const [cfg, setCfg] = useState<LegalConfig>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = `${meta.title} | Waarwi`;
    let metaRobots = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    if (metaRobots) metaRobots.content = 'index, follow';
    let metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (metaDesc) metaDesc.content = `${meta.title} — Waarwi, gestion commerciale pour les commercants senegalais.`;
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (canonical) canonical.href = `https://waarwi.com/${doc}`;
    return () => {
      document.title = 'Waarwi \u2502 Gestion commerciale tout-en-un pour les commer\u00e7ants s\u00e9n\u00e9galais';
      if (canonical) canonical.href = 'https://waarwi.com/';
    };
  }, [doc, meta.title]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('landing_config')
        .select('legal_mentions, privacy_policy, terms_of_service, contact_email, contact_hours, whatsapp_url, phone_display, phone_tel')
        .eq('id', 'default')
        .maybeSingle();
      if (!active) return;
      if (data) {
        setCfg(data as LegalConfig);
        setContent((data as any)[meta.field] || '');
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [meta.field]);

  const goBack = (e: React.MouseEvent) => { e.preventDefault(); onBack(); };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <img src="/newlogo.png" alt="Waarwi" className="w-16 h-16 object-contain" />
          <div className="w-6 h-6 border-2 border-slate-200 border-t-teal-700 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const contactEmail = cfg.contact_email?.trim() || '';
  const contactHours = cfg.contact_hours?.trim() || '';
  const whatsappUrl = cfg.whatsapp_url?.trim() || 'https://wa.me/221775254101';
  const phoneDisplay = cfg.phone_display?.trim() || '77 525 41 01';
  const phoneTel = cfg.phone_tel?.trim() || '+221775254101';

  return (
    <div className="min-h-screen bg-white text-slate-900" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-3xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between">
          <a href="/" onClick={goBack} className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
            <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Retour à l'accueil</span>
          </a>
          <a href="/" onClick={goBack} className="flex items-center" aria-label="Waarwi — accueil">
            <img src="/newlogo.png" alt="Waarwi" className="h-9 md:h-10 w-auto object-contain" />
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 md:px-8 py-12 md:py-20">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700 mb-3">Informations légales</p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 leading-tight mb-10">
          {meta.title}
        </h1>
        {content.trim() ? (
          <div
            className="legal-prose"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        ) : (
          <p className="text-slate-500">Ce document n'est pas encore disponible. Pour toute question, contactez-nous ci-dessous.</p>
        )}

        <div className="mt-16 pt-8 border-t border-slate-100">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400 mb-4">Contact</h2>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-6 text-sm text-slate-600">
            <a href={`tel:${phoneTel}`} className="inline-flex items-center gap-2 hover:text-slate-900 transition-colors">
              <Phone className="w-4 h-4 text-teal-600" /> {phoneDisplay}
            </a>
            {contactEmail && (
              <a href={`mailto:${contactEmail}`} className="inline-flex items-center gap-2 hover:text-slate-900 transition-colors">
                <Mail className="w-4 h-4 text-teal-600" /> {contactEmail}
              </a>
            )}
            {contactHours && (
              <span className="inline-flex items-center gap-2">
                <Clock className="w-4 h-4 text-teal-600" /> {contactHours}
              </span>
            )}
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:text-slate-900 transition-colors">
              <MessageCircle className="w-4 h-4 text-teal-600" /> WhatsApp
            </a>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-100 bg-white">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <a href="/" onClick={goBack} className="flex items-center">
              <img src="/newlogo.png" alt="Waarwi" className="h-8 w-auto object-contain" />
            </a>
            <p className="text-xs text-slate-400">&copy; {new Date().getFullYear()} WAARWI · INTELLIGENCEPRO TECHNOLOGIES</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function resolveLegalPath(pathname: string): LegalDoc | null {
  const p = pathname.replace(/\/+$/, '');
  if (p === '/mentions-legales') return 'mentions-legales';
  if (p === '/confidentialite') return 'confidentialite';
  if (p === '/cgu') return 'cgu';
  return null;
}


