import type { ShopTenant, ShopSettings } from '../../lib/shopTypes';
import type { ShopThemeConfig } from '../../lib/shopThemes';

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
}: Props) {
  const coverImage = settings?.cover_image_url;

  if (!coverImage) {
    return (
      <section className="w-full h-32 sm:h-44 bg-neutral-900" />
    );
  }

  return (
    <section className="relative w-full h-32 sm:h-44 overflow-hidden bg-neutral-900">
      <img
        src={coverImage}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          objectPosition: `${settings?.cover_focal_x ?? 50}% ${settings?.cover_focal_y ?? 50}%`,
        }}
      />
    </section>
  );
}
