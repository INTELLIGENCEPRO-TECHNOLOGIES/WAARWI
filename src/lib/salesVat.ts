export type VatAmounts = {
  vat_net_amount?: number | null;
  vat_amount?: number | null;
};

export function formatVatAmount(amount: number | null | undefined): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(amount ?? 0)) + ' FCFA';
}
