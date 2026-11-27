type InvoiceAmounts = {
  total: number;
  paid: number;
  ipm_patient_total?: number | null;
};

export function invoicePatientDue(invoice: InvoiceAmounts): number {
  return Math.max(0, Number(invoice.ipm_patient_total ?? invoice.total) - Number(invoice.paid ?? 0));
}

export function invoiceIpmShare(invoice: InvoiceAmounts): number | null {
  return invoice.ipm_patient_total == null ? null : Number(invoice.total) - Number(invoice.ipm_patient_total);
}
