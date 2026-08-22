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
}: Props) {
  const tenantEmail = tenant.email || '';
  const tenantWebsite = tenant.website || '';
  const address = settings?.address || tenant.address || '';
  const socialLinks = settings?.social_links || {};
  const showBadge = settings?.show_waarwi_badge !== false;

  return (
    <footer className="mt-16 border-t border-neutral-200 bg-white">
      <div className="px-4 sm:px-6 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              {shopLogo ? (
                <img src={shopLogo} alt={shopName} className="h-8 object-contain shrink-0" />
              ) : (
                <GlobeIcon className="w-5 h-5 text-neutral-400 shrink-0" />
              )}
              <div className="text-sm font-bold text-neutral-900 uppercase tracking-wide">
                {shopName}
              </div>
            </div>
            {settings?.footer_text && (
              <p className="text-sm leading-relaxed text-neutral-500">
                {settings.footer_text}
              </p>
            )}
          </div>

          {/* Contact */}
          <div className="space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-3">
              Contact
            </div>
            {shopPhone && (
              <a href={`tel:${shopPhone}`} className="flex items-center gap-2.5 text-sm text-neutral-700 hover:text-neutral-900 transition-colors">
                <Phone className="w-4 h-4 shrink-0 text-neutral-400" /> {shopPhone}
              </a>
            )}
            {shopWhatsApp && (
              <a href={`https://wa.me/${shopWhatsApp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2.5 text-sm text-neutral-700 hover:text-emerald-600 transition-colors">
                <MessageCircle className="w-4 h-4 shrink-0 text-emerald-500" /> {shopWhatsApp}
              </a>
            )}
            {tenantEmail && (
              <a href={`mailto:${tenantEmail}`} className="flex items-center gap-2.5 text-sm text-neutral-700 hover:text-neutral-900 transition-colors">
                <Mail className="w-4 h-4 shrink-0 text-neutral-400" /> {tenantEmail}
              </a>
            )}
            {tenantWebsite && (
              <a href={tenantWebsite.startsWith('http') ? tenantWebsite : `https://${tenantWebsite}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2.5 text-sm text-neutral-700 hover:text-neutral-900 transition-colors">
                <GlobeIcon className="w-4 h-4 shrink-0 text-neutral-400" /> {tenantWebsite.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>

          {/* Address & Social */}
          <div className="space-y-3">
            {address && (
              <>
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-3">
                  Adresse
                </div>
                <div className="flex items-start gap-2.5 text-sm text-neutral-600 leading-relaxed">
                  <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-neutral-400" />
                  <span>{address}</span>
                </div>
              </>
            )}
            {Object.keys(socialLinks).length > 0 && (
              <div className="pt-2 flex items-center gap-2 flex-wrap">
                {Object.entries(socialLinks).filter(([,v]) => v).map(([key, url]) => (
                  <a
                    key={key}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium capitalize px-3 py-1.5 border border-neutral-200 text-neutral-500 hover:text-neutral-900 hover:border-neutral-300 transition-colors"
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
        <div className="border-t border-neutral-100">
          <div className="px-4 sm:px-6 py-8">
            <div className="max-w-lg mx-auto text-center space-y-3">
              <p className="text-sm font-medium text-neutral-700">
                Cette boutique est propulsee par <span className="font-bold">Waarwi</span>
              </p>
              <p className="text-xs leading-relaxed text-neutral-400">
                Creez votre propre boutique et gerez vos ventes, stocks et clients depuis une seule plateforme.
              </p>
              <a
                href="https://waarwi.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition-all"
              >
                Decouvrir Waarwi
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}
