export type PurchaseInvoiceLine = {netMinor:number;vatBps:number;deductibleBps:number};
export type PurchaseInvoiceTotals = {netMinor:number;vatMinor:number;deductibleVatMinor:number;nonDeductibleVatMinor:number;grossMinor:number;expenseMinor:number};
export type PurchaseInvoiceCalculation = PurchaseInvoiceTotals & {lines:PurchaseInvoiceTotals[]};
export function calculatePurchaseInvoice(lines:PurchaseInvoiceLine[]):PurchaseInvoiceCalculation;
export function reconcilePurchaseInvoice(lines:PurchaseInvoiceLine[], declared:Pick<PurchaseInvoiceTotals,'netMinor'|'vatMinor'|'grossMinor'>):PurchaseInvoiceCalculation;
