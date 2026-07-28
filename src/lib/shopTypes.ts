export type ShopTenant = {
  id: string;
  name: string;
  legal_name?: string;
  logo_url: string;
  phone: string;
  email?: string;
  address?: string;
  website?: string;
  currency: string;
  business_type?: string;
};

export type ShopSettings = {
  shop_name: string;
  tagline: string;
  logo_url: string;
  phone: string;
  whatsapp: string;
  address: string;
  welcome_msg: string;
  footer_text: string;
  delivery_modes: string[];
  payment_modes: string[];
  primary_color: string;
  // New appearance fields
  theme: ShopThemeId;
  secondary_color: string;
  cover_image_url: string;
  cover_image_alt: string;
  cover_focal_x: number;
  cover_focal_y: number;
  cover_overlay: 'light' | 'dark' | 'none';
  cover_overlay_intensity: number;
  show_references: boolean;
  show_stock: boolean;
  low_stock_threshold: number;
  show_perks: boolean;
  card_density: 'compact' | 'comfortable' | 'spacious';
  section_order: string[];
  appearance_config: Record<string, unknown>;
};

export type ShopArticle = {
  id: string;
  name: string;
  internal_ref: string;
  oem_ref: string;
  brand: string;
  category_id: string | null;
  sale_price: number;
  image_url: string | null;
  description: string;
  unit: string;
  condition: string;
  stock_qty: number;
  compatibilities: Compat[];
};

export type Compat = {
  brand_name: string;
  model_name: string;
  year_start: number;
  year_end: number;
};

export type Category = { id: string; name: string; parent_id: string | null };
export type VehicleBrand = { id: string; name: string };
export type VehicleModel = { id: string; name: string; brand_id: string };

export type CartItem = {
  article: ShopArticle;
  qty: number;
  unit_price: number;
};

export type CheckoutForm = {
  customer_name: string;
  customer_phone: string;
  customer_whatsapp: string;
  customer_email: string;
  customer_address: string;
  customer_note: string;
  delivery_mode: 'retrait' | 'livraison';
  delivery_address: string;
  payment_mode: string;
};

export type OrderConfirmation = {
  order_number: string;
  total: number;
  items: CartItem[];
  customer_name: string;
  delivery_mode: string;
  payment_mode: string;
};

export type ShopThemeId = 'premium_minimal' | 'marketplace' | 'immersive';

export type CardDensity = 'compact' | 'comfortable' | 'spacious';

export type StockBadge = {
  label: string;
  cls: string;
  dot: string;
};

export function stockBadge(qty: number, lowThreshold = 3): StockBadge {
  if (qty === 0)
    return {
      label: 'Rupture',
      cls: 'bg-red-50 text-red-700 border border-red-100',
      dot: 'bg-red-500',
    };
  if (qty <= lowThreshold)
    return {
      label: 'Stock faible',
      cls: 'bg-amber-50 text-amber-700 border border-amber-100',
      dot: 'bg-amber-500',
    };
  return {
    label: 'Disponible',
    cls: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
    dot: 'bg-emerald-500',
  };
}

export const DELIVERY_LABELS: Record<string, string> = {
  retrait: 'Retrait en magasin',
  livraison: 'Livraison à domicile',
};

export const PAYMENT_LABELS: Record<string, string> = {
  livraison: 'Paiement à la livraison',
  retrait: 'Paiement au retrait',
  wave: 'Wave',
  orange_money: 'Orange Money',
  free_money: 'Free Money',
};

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  shop_name: '',
  tagline: '',
  logo_url: '',
  phone: '',
  whatsapp: '',
  address: '',
  welcome_msg: '',
  footer_text: '',
  delivery_modes: ['retrait', 'livraison'],
  payment_modes: ['livraison', 'retrait'],
  primary_color: '#0f766e',
  theme: 'premium_minimal',
  secondary_color: '#0f172a',
  cover_image_url: '',
  cover_image_alt: '',
  cover_focal_x: 50,
  cover_focal_y: 50,
  cover_overlay: 'dark',
  cover_overlay_intensity: 40,
  show_references: true,
  show_stock: true,
  low_stock_threshold: 3,
  show_perks: true,
  card_density: 'comfortable',
  section_order: ['hero', 'categories', 'products', 'perks', 'footer'],
  appearance_config: {},
};
