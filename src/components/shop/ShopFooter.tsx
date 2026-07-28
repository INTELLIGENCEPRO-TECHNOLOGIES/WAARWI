import {
  Phone,
  MessageCircle,
  Mail,
  MapPin,
  Globe as GlobeIcon,
  ExternalLink,
} from 'lucide-react';
import type { ShopTenant, ShopSettings } from '../../lib/shopTypes';
import type { ShopThemeConfig } from '../../lib/shopThemes';

type Props = {
  tenant: ShopTenant;
  settings: ShopSettings | null;
  shopName: string;
  shopPhone: string;
  shopWhatsApp: string;
  shopLogo: string;
  theme: ShopThemeConfig;
};

export function ShopFooter({
  tenant,
  settings,
  shopName,
  shopPhone,
  shopWhatsApp,
  shopLogo,
  theme,
}: Props) {
  const tenantEmail = tenant.email || '';
  const tenantWebsite = tenant.website || '';
  const address = settings?.address || tenant.address || '';
  const socialLinks = settings?.social_links || {};
  const showBadge = settings?.show_waarwi_badge !== false;
  return (
    <footer className={`mt-16 ${theme.footerClassName}`}>
      {/* Contact info section */}
      <div className="shop-fluid py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              {shopLogo ? (
                <img src={shopLogo} alt={shopName} className="w-10 h-10 object-contain shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-slate-200 flex items-center justify-center shrink-0">
                  <GlobeIcon className="w-5 h-5 text-slate-500" />
                </div>
              )}
              <div className="text-base font-bold text-slate-900">
                {shopName}
              </div>
            </div>
            {settings?.footer_text && (
              <p className="text-sm leading-relaxed text-slate-500">
                {settings.footer_text}
              </p>
            )}
          </div>

          {/* Contact */}
          <div className="space-y-3">
            <div className={`text-xs font-bold uppercase tracking-wider mb-3 text-slate-400`}>
              Contact
            </div>
            {shopPhone && (
              <a href={`tel:${shopPhone}`} className={`flex items-center gap-2.5 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors`}>
                <Phone className="w-4 h-4 shrink-0 opacity-60" /> {shopPhone}
              </a>
            )}
            {shopWhatsApp && (
              <a href={`https://wa.me/${shopWhatsApp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                className={`flex items-center gap-2.5 text-sm font-medium text-slate-700 hover:text-emerald-600 transition-colors`}>
                <MessageCircle className="w-4 h-4 shrink-0 text-emerald-500" /> {shopWhatsApp}
              </a>
            )}
            {tenantEmail && (
              <a href={`mailto:${tenantEmail}`} className={`flex items-center gap-2.5 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors`}>
                <Mail className="w-4 h-4 shrink-0 opacity-60" /> {tenantEmail}
              </a>
            )}
            {tenantWebsite && (
              <a href={tenantWebsite.startsWith('http') ? tenantWebsite : `https://${tenantWebsite}`} target="_blank" rel="noopener noreferrer"
                className={`flex items-center gap-2.5 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors`}>
                <GlobeIcon className="w-4 h-4 shrink-0 opacity-60" /> {tenantWebsite.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>

          {/* Address & Social */}
          <div className="space-y-3">
            {address && (
              <>
                <div className={`text-xs font-bold uppercase tracking-wider mb-3 text-slate-400`}>
                  Adresse
                </div>
                <div className={`flex items-start gap-2.5 text-sm font-medium leading-relaxed text-slate-600`}>
                  <MapPin className="w-4 h-4 shrink-0 mt-0.5 opacity-60" />
                  <span>{address}</span>
                </div>
              </>
            )}
            {Object.keys(socialLinks).length > 0 && (
              <div className="pt-2 flex items-center gap-3 flex-wrap">
                {Object.entries(socialLinks).filter(([,v]) => v).map(([key, url]) => (
                  <a
                    key={key}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-xs font-semibold capitalize px-3 py-1.5 rounded-full border transition-colors border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300`}
                  >
                    {key}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Waarwi badge */}
      {showBadge && (
        <div className={`border-t border-slate-200`}>
          <div className="shop-fluid py-8">
            <div className="max-w-lg mx-auto text-center space-y-3">
              <p className={`text-sm font-semibold text-slate-700`}>
                Cette boutique est propulsée par <span className="font-bold">Waarwi</span>
              </p>
              <p className={`text-xs leading-relaxed text-slate-500`}>
                Créez votre propre boutique et gérez vos ventes, stocks et clients depuis une seule plateforme.
              </p>
              <a
                href="https://waarwi.com"
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold border transition-all hover:shadow-sm border-slate-300 text-slate-700 hover:bg-slate-50`}
              >
                Découvrir Waarwi
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}
