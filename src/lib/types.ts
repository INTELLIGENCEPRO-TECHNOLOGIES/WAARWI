export type Tenant = {
  id: string;
  name: string;
  legal_name: string;
  ninea: string;
  rccm: string;
  address: string;
  phone: string;
  email: string;
  logo_url: string;
  primary_color: string;
  currency: string;
  status: string;
  plan: string;
  public_slug: string | null;
  business_type?: string;
  business_activity_type_id?: string | null;
  business_activity_type_name?: string | null;
  ticket_header_config?: TicketHeaderItem[] | null;
  a4_header_config?: A4HeaderConfig | null;
  enabled_modules?: string[];
  approval_status?: string;
  slogan?: string;
  website?: string;
};

export type TicketHeaderFieldKey =
  | 'logo'
  | 'name'
  | 'legal_name'
  | 'activity'
  | 'address'
  | 'phone'
  | 'email'
  | 'website'
  | 'ninea'
  | 'rccm';

export type TicketHeaderSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type TicketHeaderItem = {
  key: TicketHeaderFieldKey;
  show: boolean;
  size: TicketHeaderSize;
  breakAfter: boolean;
};

export const DEFAULT_TICKET_HEADER_CONFIG: TicketHeaderItem[] = [
  { key: 'logo',       show: true, size: 'lg', breakAfter: false },
  { key: 'name',       show: true, size: 'xl', breakAfter: false },
  { key: 'legal_name', show: true, size: 'sm', breakAfter: false },
  { key: 'activity',   show: true, size: 'sm', breakAfter: false },
  { key: 'address',    show: true, size: 'sm', breakAfter: false },
  { key: 'phone',      show: true, size: 'sm', breakAfter: false },
  { key: 'email',      show: true, size: 'sm', breakAfter: false },
  { key: 'website',    show: true, size: 'sm', breakAfter: false },
  { key: 'ninea',      show: true, size: 'sm', breakAfter: false },
  { key: 'rccm',       show: true, size: 'sm', breakAfter: false },
];

export const TICKET_HEADER_FIELD_LABELS: Record<TicketHeaderFieldKey, string> = {
  logo:       'Logo',
  name:       "Nom de l'entreprise",
  legal_name: 'Raison sociale',
  activity:   "Type d'activité",
  address:    'Adresse',
  phone:      'Téléphone',
  email:      'Email',
  website:    'Site web',
  ninea:      'NINEA',
  rccm:       'RCCM',
};

export function mergeTicketHeaderConfig(stored: TicketHeaderItem[] | null | undefined): TicketHeaderItem[] {
  const defaults = DEFAULT_TICKET_HEADER_CONFIG;
  if (!Array.isArray(stored) || stored.length === 0) return defaults.map(d => ({ ...d }));
  const known = new Set(defaults.map(d => d.key));
  const ordered = stored.filter(s => s && known.has(s.key as TicketHeaderFieldKey)).map(s => ({
    key: s.key as TicketHeaderFieldKey,
    show: typeof s.show === 'boolean' ? s.show : true,
    size: (['xs','sm','md','lg','xl'] as TicketHeaderSize[]).includes(s.size as TicketHeaderSize) ? (s.size as TicketHeaderSize) : 'sm',
    breakAfter: typeof s.breakAfter === 'boolean' ? s.breakAfter : false,
  }));
  const present = new Set(ordered.map(s => s.key));
  defaults.forEach(d => { if (!present.has(d.key)) ordered.push({ ...d, show: false }); });
  return ordered;
}

// ── A4 header layout config (separate from 80mm ticket config) ───────────────
export type A4LogoPosition = 'above' | 'left' | 'right';

export type A4HeaderConfig = {
  logo_position: A4LogoPosition;
  logo_size: TicketHeaderSize;
};

export const DEFAULT_A4_HEADER_CONFIG: A4HeaderConfig = {
  logo_position: 'above',
  logo_size: 'md',
};

export function mergeA4HeaderConfig(stored: A4HeaderConfig | null | undefined): A4HeaderConfig {
  if (!stored) return { ...DEFAULT_A4_HEADER_CONFIG };
  const positions: A4LogoPosition[] = ['above', 'left', 'right'];
  const sizes: TicketHeaderSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];
  return {
    logo_position: positions.includes(stored.logo_position) ? stored.logo_position : 'above',
    logo_size: sizes.includes(stored.logo_size) ? stored.logo_size : 'md',
  };
}

export const BUSINESS_TYPE_LABELS: Record<string, string> = {
  auto_parts: 'Pièces automobiles',
  fashion: 'Mode & Textile',
  electronics: 'Électronique',
  grocery: 'Alimentation',
  services: 'Services',
  generic: 'Commerce général',
};

export function isAutoParts(t?: { business_type?: string } | null) {
  return (t?.business_type || 'auto_parts') === 'auto_parts';
}

export type Profile = {
  id: string;
  tenant_id: string | null;
  full_name: string;
  email: string;
  role: string;
  auto_print_ticket?: boolean;
  auto_print_invoice?: boolean;
};

export type Site = {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  address: string;
  phone: string;
  is_warehouse: boolean;
  is_active: boolean;
  parent_site_id: string | null;
  ticket_header_config?: TicketHeaderItem[] | null;
  a4_header_config?: A4HeaderConfig | null;
};

export type Category = {
  id: string;
  tenant_id: string;
  parent_id: string | null;
  name: string;
  code: string;
  is_active: boolean;
};

export type VehicleBrand = {
  id: string;
  tenant_id: string;
  name: string;
  is_active: boolean;
};

export type Article = {
  id: string;
  tenant_id: string;
  internal_ref: string;
  name: string;
  description: string;
  category_id: string | null;
  brand: string;
  oem_ref: string;
  supplier_ref: string;
  barcode: string;
  supplier_id: string | null;
  condition: string;
  unit: string;
  purchase_price: number;
  sale_price: number;
  min_price: number;
  wholesale_price: number;
  vat_rate: number;
  stock_min: number;
  stock_max: number;
  location: string;
  image_url: string;
  is_active: boolean;
  ipm_eligible: boolean;
};

export type StockLevel = {
  id: string;
  article_id: string;
  site_id: string;
  quantity: number;
  reserved: number;
};

export type PaymentMethod = {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  payment_type: string;
  is_active: boolean;
  sort_order: number;
};

export type Customer = {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  customer_type: string;
  balance: number;
  credit_limit: number;
  credit_blocked: boolean;
};

export type CashSession = {
  id: string;
  tenant_id: string;
  site_id: string;
  user_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  closing_amount: number;
  theoretical_amount: number;
  variance: number;
  status: string;
};

export type CartItem = {
  article_id: string;
  name: string;
  internal_ref: string;
  oem_ref?: string;
  quantity: number;
  unit_price: number;
  discount: number;
  stock_available: number;
  purchase_cost: number;
  tier_name?: string;
  ipm_eligible?: boolean;
};

export type SalePayment = {
  payment_method_id: string | null;
  method_name: string;
  amount: number;
  reference: string;
};

export type ShopSettings = {
  id: string;
  tenant_id: string;
  is_active: boolean;
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
  created_at: string;
  updated_at: string;
};

export type OnlineOrder = {
  id: string;
  tenant_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_whatsapp: string;
  customer_email: string;
  customer_address: string;
  customer_note: string;
  customer_id: string | null;
  delivery_mode: string;
  delivery_address: string;
  delivery_fee: number;
  payment_mode: string;
  payment_status: string;
  subtotal: number;
  total: number;
  status: string;
  internal_note: string;
  sale_id: string | null;
  created_at: string;
  updated_at: string;
};

export type OnlineOrderItem = {
  id: string;
  tenant_id: string;
  order_id: string;
  article_id: string | null;
  article_name: string;
  internal_ref: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  created_at: string;
};

export type OnlineOrderStatusHistory = {
  id: string;
  tenant_id: string;
  order_id: string;
  old_status: string;
  new_status: string;
  changed_by: string | null;
  note: string;
  created_at: string;
};
