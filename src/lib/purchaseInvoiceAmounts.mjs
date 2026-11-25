/** Purchase invoice calculator. All amounts are integer hundredths of FCFA.
 * Rates are explicit, in basis points (18% = 1800). Never infer a tax rate
 * or deductibility from an article's current sales VAT or catalogue price.
 * Inputs represent invoice line totals after all commercial discounts.
 * This module does not post entries or determine legal VAT eligibility.
 */
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const SCALE = 10000n;
function integer(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label} invalide.`);
  }
  return BigInt(value);
}
function safe(value) {
  if (value > MAX) throw new RangeError('Montant de facture trop élevé.');
  return Number(value);
}
const roundRate = (amount, rate) => (amount * rate + SCALE / 2n) / SCALE;

/**
 * @param {{netMinor: number, vatBps: number, deductibleBps: number}[]} lines
 * @returns {{lines: {netMinor:number, vatMinor:number, deductibleVatMinor:number, nonDeductibleVatMinor:number, grossMinor:number, expenseMinor:number}[], netMinor:number, vatMinor:number, deductibleVatMinor:number, nonDeductibleVatMinor:number, grossMinor:number, expenseMinor:number}}
 */
export function calculatePurchaseInvoice(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw new RangeError('La facture doit contenir au moins une ligne.');
  let net = 0n, vat = 0n, deductible = 0n;
  const results = lines.map((line) => {
    const n = integer(line?.netMinor, 'Montant HT');
    const rate = integer(line?.vatBps, 'Taux de TVA', 10000);
    const fraction = integer(line?.deductibleBps, 'Part de TVA déductible', 10000);
    const tax = roundRate(n, rate);
    const recoverable = roundRate(tax, fraction);
    net += n;
    vat += tax;
    deductible += recoverable;
    return { netMinor: safe(n), vatMinor: safe(tax), deductibleVatMinor: safe(recoverable), nonDeductibleVatMinor: safe(tax - recoverable), grossMinor: safe(n + tax), expenseMinor: safe(n + tax - recoverable) };
  });
  if (net === 0n) throw new RangeError('Le montant HT total doit être positif.');
  return { lines: results, netMinor: safe(net), vatMinor: safe(vat), deductibleVatMinor: safe(deductible), nonDeductibleVatMinor: safe(vat - deductible), grossMinor: safe(net + vat), expenseMinor: safe(net + vat - deductible) };
}

/** Exact comparison with supplier invoice totals. No silent adjustment. */
export function reconcilePurchaseInvoice(lines, declared) {
  const computed = calculatePurchaseInvoice(lines);
  for (const [field, label] of [['netMinor', 'HT'], ['vatMinor', 'TVA'], ['grossMinor', 'TTC']]) {
    integer(declared?.[field], `Montant ${label} déclaré`);
    if (computed[field] !== declared[field]) {
      throw new RangeError(`Le montant ${label} calculé ne correspond pas à la facture fournisseur.`);
    }
  }
  return computed;
}
