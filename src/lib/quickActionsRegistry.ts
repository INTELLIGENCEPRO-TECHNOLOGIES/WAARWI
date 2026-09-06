import {
  ShoppingCart, FileText, FilePlus, RotateCcw, CreditCard, Receipt,
  UserPlus, Wallet, HandCoins, Search as SearchIcon, FileStack,
  Truck, ClipboardList, DollarSign,
  PackagePlus, PackageMinus, ArrowRightLeft, ClipboardCheck, History,
  Play, Banknote, CircleDollarSign,
} from 'lucide-react';
import type { PermissionKey } from './permissions';

export type QuickActionCategory =
  | 'vente'
  | 'client'
  | 'achat'
  | 'stock'
  | 'caisse';

export type QuickActionNavTarget =
  | 'directPos'
  | 'newInvoice'
  | 'newQuote'
  | 'newReturn'
  | 'newAvoir'
  | 'reprintSale'
  | 'newCustomer'
  | 'customerPayment'
  | 'customerPrepayment'
  | 'customerLookup'
  | 'customerDocuments'
  | 'newSupplier'
  | 'newOrder'
  | 'supplierPayment'
  | 'supplierDocuments'
  | 'newArticle'
  | 'stockIn'
  | 'stockOut'
  | 'stockTransfer'
  | 'stockInventory'
  | 'stockMovements'
  | 'openCashSession'
  | 'cashMovement'
  | 'newExpense'
  | 'vaultDeposit';

export interface QuickAction {
  id: string;
  label: string;
  category: QuickActionCategory;
  icon: any;
  route: string;
  navTarget: QuickActionNavTarget;
  permissions: PermissionKey[];
  module?: string;
  keywords: string[];
  defaultVisible: boolean;
  defaultFavorite: boolean;
  favoriteOrder: number;
}

export const QUICK_ACTION_CATEGORIES: { key: QuickActionCategory; label: string }[] = [
  { key: 'vente', label: 'Vente' },
  { key: 'client', label: 'Client' },
  { key: 'achat', label: 'Achat & Fournisseur' },
  { key: 'stock', label: 'Stock' },
  { key: 'caisse', label: 'Caisse & Finance' },
];

export const QUICK_ACTIONS: QuickAction[] = [
  // ── Vente ──
  {
    id: 'pos_sale',
    label: 'Vente caisse',
    category: 'vente',
    icon: ShoppingCart,
    route: 'pos',
    navTarget: 'directPos',
    permissions: ['access_pos'],
    module: 'pos',
    keywords: ['vente', 'caisse', 'pos', 'ticket', 'encaisser'],
    defaultVisible: true,
    defaultFavorite: true,
    favoriteOrder: 0,
  },
  {
    id: 'new_invoice',
    label: 'Nouvelle facture',
    category: 'vente',
    icon: FilePlus,
    route: 'billing',
    navTarget: 'newInvoice',
    permissions: ['access_billing'],
    module: 'billing',
    keywords: ['facture', 'facturer', 'invoice', 'vente'],
    defaultVisible: true,
    defaultFavorite: true,
    favoriteOrder: 1,
  },
  {
    id: 'new_quote',
    label: 'Nouveau devis',
    category: 'vente',
    icon: FileText,
    route: 'billing',
    navTarget: 'newQuote',
    permissions: ['access_billing'],
    module: 'billing',
    keywords: ['devis', 'proforma', 'quote', 'estimation'],
    defaultVisible: true,
    defaultFavorite: true,
    favoriteOrder: 2,
  },
  {
    id: 'new_return',
    label: 'Retour client',
    category: 'vente',
    icon: RotateCcw,
    route: 'billing',
    navTarget: 'newReturn',
    permissions: ['access_billing'],
    module: 'billing',
    keywords: ['retour', 'return', 'rembourser', 'remboursement'],
    defaultVisible: true,
    defaultFavorite: false,
    favoriteOrder: 99,
  },
  {
    id: 'new_avoir',
    label: 'Nouvel avoir',
    category: 'vente',
    icon: CreditCard,
    route: 'billing',
    navTarget: 'newAvoir',
    permissions: ['access_billing'],
    module: 'billing',
    keywords: ['avoir', 'crédit', 'credit note'],
    defaultVisible: true,
    defaultFavorite: false,
    favoriteOrder: 99,
  },
  {
    id: 'reprint_sale',
    label: 'Réimprimer un document',
    category: 'vente',
    icon: Receipt,
    route: 'sales',
    navTarget: 'reprintSale',
    permissions: ['access_sales'],
    module: 'sales',
    keywords: ['réimprimer', 'imprimer', 'ticket', 'reprint', 'document'],
    defaultVisible: true,
    defaultFavorite: false,
    favoriteOrder: 99,
  },

  // ── Client ──
  {
    id: 'new_customer',
    label: 'Nouveau client',
    category: 'client',
    icon: UserPlus,
    route: 'tiers',
    navTarget: 'newCustomer',
    permissions: ['access_tiers', 'manage_customers'],
    module: 'tiers',
    keywords: ['client', 'nouveau', 'créer', 'customer', 'ajouter'],
    defaultVisible: true,
    defaultFavorite: true,
    favoriteOrder: 3,
  },
  {
    id: 'customer_payment',
    label: 'Règlement client',
    category: 'client',
    icon: Wallet,
    route: 'tiers',
    navTarget: 'customerPayment',
    permissions: ['access_tiers'],
    module: 'tiers',
    keywords: ['encaisser', 'règlement', 'paiement', 'client', 'payment', 'recouvrement'],
    defaultVisible: true,
    defaultFavorite: true,
    favoriteOrder: 4,
  },
  {
    id: 'customer_prepayment',
    label: 'Acompte client',
    category: 'client',
    icon: HandCoins,
    route: 'tiers',
    navTarget: 'customerPrepayment',
    permissions: ['access_tiers'],
    module: 'tiers',
    keywords: ['acompte', 'avance', 'prepayment', 'prépaiement'],
    defaultVisible: true,
    defaultFavorite: false,
    favoriteOrder: 99,
  },
  {
    id: 'customer_lookup',
    label: 'Consulter un compte client',
    category: 'client',
    icon: SearchIcon,
    route: 'tiers',
    navTarget: 'customerLookup',
    permissions: ['access_tiers'],
    module: 'tiers',
    keywords: ['interroger', 'consulter', 'compte', 'solde', 'balance', 'client'],
    defaultVisible: true,
    defaultFavorite: false,
    favoriteOrder: 99,
  },
  {
    id: 'customer_documents',
    label: 'Documents du client',
    category: 'client',
    icon: FileStack,
    route: 'tiers',
    navTarget: 'customerDocuments',
    permissions: ['access_tiers'],
    module: 'tiers',
    keywords: ['documents', 'factures', 'historique', 'client'],
    defaultVisible: true,
    defaultFavorite: false,
    favoriteOrder: 99,
  },

  // ── Achat & Fournisseur ──
  {
    id: 'new_supplier',
    label: 'Nouveau fournisseur',
    category: 'achat',
    icon: Truck,
    route: 'tiers',
    navTarget: 'newSupplier',
    permissions: ['access_tiers', 'manage_customers'],
    module: 'tiers',
    keywords: ['fournisseur', 'nouveau', 'créer', 'supplier'],
    defaultVisible: true,
    defaultFavorite: false,
    favoriteOrder: 99,
  },
  {
    id: 'new_supplier_order',
    label: 'Nouvelle commande fournisseur',
    category: 'achat',
    icon: ClipboardList,
    route: 'supplier_orders',
    navTarget: 'newOrder',
    permissions: ['access_supplier_orders', 'manage_supplier_orders'],
    module: 'supplier_orders',
    keywords: ['commande', 'achat', 'approvisionner', 'fournisseur', 'order'],
    defaultVisible: true,
    defaultFavorite: true,
    favoriteOrder: 5,
  },
  {
    id: 'supplier_payment',
    label: 'Règlement fournisseur',
    category: 'achat',
    icon: DollarSign,
    route: 'tiers',
    navTarget: 'supplierPayment',
    permissions: ['access_tiers'],
    module: 'tiers',
    keywords: ['payer', 'règlement', 'fournisseur', 'payment'],
    defaultVisible: true,
    defaultFavorite: false,
    favoriteOrder: 99,
  },

  // ── Stock ──
  {
    id: 'new_article',
    label: 'Nouvel article',
    category: 'stock',
    icon: PackagePlus,
    route: 'articles',
    navTarget: 'newArticle',
    permissions: ['access_articles', 'manage_articles'],
    module: 'articles',
    keywords: ['article', 'produit', 'nouveau', 'créer', 'product'],
    defaultVisible: true,
    defaultFavorite: true,
    favoriteOrder: 6,
  },
  {
    id: 'stock_in',
    label: 'Entrée de stock',
    category: 'stock',
    icon: PackagePlus,
    route: 'stock',
    navTarget: 'stockIn',
    permissions: ['access_stock', 'manage_stock'],
    module: 'stock',
    keywords: ['entrée', 'stock', 'réception', 'ajouter', 'entry'],
    defaultVisible: true,
    defaultFavorite: true,
    favoriteOrder: 7,
  },
  {
    id: 'stock_out',
    label: 'Sortie de stock',
    category: 'stock',
    icon: PackageMinus,
    route: 'stock',
    navTarget: 'stockOut',
    permissions: ['access_stock', 'manage_stock'],
    module: 'stock',
    keywords: ['sortie', 'stock', 'retrait', 'exit'],
    defaultVisible: true,
    defaultFavorite: false,
    favoriteOrder: 99,
  },
  {
    id: 'stock_transfer',
    label: 'Transfert de stock',
    category: 'stock',
    icon: ArrowRightLeft,
    route: 'stock',
    navTarget: 'stockTransfer',
    permissions: ['access_stock', 'manage_stock'],
    module: 'stock',
    keywords: ['transfert', 'transférer', 'transfer', 'magasin', 'dépôt'],
    defaultVisible: true,
    defaultFavorite: false,
    favoriteOrder: 99,
  },
  {
    id: 'stock_inventory',
    label: 'Inventaire',
    category: 'stock',
    icon: ClipboardCheck,
    route: 'stock',
    navTarget: 'stockInventory',
    permissions: ['access_stock', 'manage_stock'],
    module: 'stock',
    keywords: ['inventaire', 'inventory', 'comptage', 'recompter'],
    defaultVisible: true,
    defaultFavorite: false,
    favoriteOrder: 99,
  },
  {
    id: 'stock_movements',
    label: 'Mouvements de stock',
    category: 'stock',
    icon: History,
    route: 'stock',
    navTarget: 'stockMovements',
    permissions: ['access_stock'],
    module: 'stock',
    keywords: ['mouvements', 'historique', 'journal', 'stock'],
    defaultVisible: true,
    defaultFavorite: false,
    favoriteOrder: 99,
  },

  // ── Caisse & Finance ──
  {
    id: 'open_cash_session',
    label: 'Ouvrir la caisse',
    category: 'caisse',
    icon: Play,
    route: 'pos',
    navTarget: 'openCashSession',
    permissions: ['access_pos', 'pos_open_session'],
    module: 'pos',
    keywords: ['ouvrir', 'caisse', 'session', 'démarrer'],
    defaultVisible: true,
    defaultFavorite: false,
    favoriteOrder: 99,
  },
  {
    id: 'cash_movement',
    label: 'Mouvement de caisse',
    category: 'caisse',
    icon: Banknote,
    route: 'pos',
    navTarget: 'cashMovement',
    permissions: ['access_pos', 'pos_cash_movement'],
    module: 'pos',
    keywords: ['mouvement', 'caisse', 'espèces', 'retrait', 'dépôt'],
    defaultVisible: true,
    defaultFavorite: false,
    favoriteOrder: 99,
  },
  {
    id: 'new_expense',
    label: 'Enregistrer une dépense',
    category: 'caisse',
    icon: CircleDollarSign,
    route: 'pos',
    navTarget: 'newExpense',
    permissions: ['access_pos', 'pos_cash_movement'],
    module: 'pos',
    keywords: ['dépense', 'charge', 'frais', 'expense'],
    defaultVisible: true,
    defaultFavorite: false,
    favoriteOrder: 99,
  },
];

export function getDefaultFavoriteIds(): string[] {
  return QUICK_ACTIONS
    .filter(a => a.defaultFavorite)
    .sort((a, b) => a.favoriteOrder - b.favoriteOrder)
    .map(a => a.id);
}
