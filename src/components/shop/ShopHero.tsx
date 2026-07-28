import type { ShopTenant, ShopSettings } from '../../lib/shopTypes';
import type { ShopThemeConfig } from '../../lib/shopThemes';
import { Store } from 'lucide-react';

type Props = {
  tenant: ShopTenant;
  settings: ShopSettings | null;
  shopName: string;
  theme: ShopThemeConfig;
  onScrollToProducts?: () => void;
};

export function ShopHero({
  tenant,
  settings,
  shopName,
  theme,
}: Props) {
  const isImmersive = theme.id === 'immersive';
  const shopLogo = settings?.logo_url || tenant.logo_url || '';

  return (
    <section className="relative overflow-hidden shop-container">
      {/* Background */}
      {isImmersive && settings?.cover_image_url ? (
        <>
          <div
            className="absolute inset-0 shop-hero-cover"
            style={{
              backgroundImage: `url(${settings.cover_image_url})`,
              backgroundPosition: `${settings.cover_focal_x}% ${settings.cover_focal_y}%`,
            }}
            aria-hidden
          />
          {settings.cover_overlay !== 'none' && (
            <div
              className="absolute inset-0"
              style={{
                background:
                  settings.cover_overlay === 'dark'
                    ? `linear-gradient(180deg, rgba(0,0,0,${(settings.cover_overlay_intensity || 40) / 100}) 0%, rgba(0,0,0,${(settings.cover_overlay_intensity || 40) / 200}) 50%, rgba(0,0,0,${(settings.cover_overlay_intensity || 40) / 100}) 100%)`
                    : `linear-gradient(180deg, rgba(255,255,255,${(settings.cover_overlay_intensity || 40) / 100}) 0%, rgba(255,255,255,${(settings.cover_overlay_intensity || 40) / 200}) 50%, rgba(255,255,255,${(settings.cover_overlay_intensity || 40) / 100}) 100%)`,
              }}
              aria-hidden
            />
          )}
        </>
      ) : (
        <>
          <div className={`absolute inset-0 ${theme.heroClassName}`} aria-hidden />
          {theme.heroOverlayClassName && (
            <div
              className={`absolute inset-0 ${theme.heroOverlayClassName}`}
              aria-hidden
            />
          )}
        </>
      )}

      {/* Logo only - centered */}
      <div className="relative flex items-center justify-center py-10 sm:py-14">
        {shopLogo ? (
          <img
            src={shopLogo}
            alt={shopName}
            className="w-28 h-28 sm:w-36 sm:h-36 object-contain drop-shadow-lg"
          />
        ) : (
          <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-2xl bg-white/90 backdrop-blur flex items-center justify-center shadow-lg">
            <Store className="w-14 h-14 sm:w-18 sm:h-18 text-slate-700" />
          </div>
        )}
      </div>
    </section>
  );
}
