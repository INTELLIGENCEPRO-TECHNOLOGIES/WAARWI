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
  enabled_modules?: string[];
  approval_status?: string;
  slogan?: string;
};

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
