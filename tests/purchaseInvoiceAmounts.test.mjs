import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePurchaseInvoice as calc, reconcilePurchaseInvoice as reconcile } from '../src/lib/purchaseInvoiceAmounts.mjs';
const line = (netMinor, vatBps = 1800, deductibleBps = 10000) => ({ netMinor, vatBps, deductibleBps });
test('100 000 FCFA HT, TVA 18 %, déduction intégrale', () => {
  const x = calc([line(10000000)]);
  assert.equal(x.vatMinor, 1800000);
  assert.equal(x.grossMinor, 11800000);
  assert.equal(x.expenseMinor, 10000000);
  assert.equal(x.expenseMinor + x.deductibleVatMinor, x.grossMinor);
});
test('facture sans TVA', () => {
  const x = calc([line(10000000, 0, 0)]);
  assert.equal(x.vatMinor, 0); assert.equal(x.grossMinor, 10000000);
});
test('TVA partiellement ou non récupérable', () => {
  const x = calc([line(10000000, 1800, 5000), line(10000000, 1800, 0)]);
  assert.equal(x.deductibleVatMinor, 900000);
  assert.equal(x.nonDeductibleVatMinor, 2700000);
  assert.equal(x.expenseMinor + x.deductibleVatMinor, x.grossMinor);
});
test('taux mixtes et arrondi par ligne', () => {
  const x = calc([line(3), line(3), line(100, 0, 0)]);
  assert.equal(x.vatMinor, 2); assert.equal(x.grossMinor, 108);
});
test('refuse une facture incohérente ou non justifiée par les lignes', () => {
  assert.throws(() => reconcile([line(100)], {netMinor:100,vatMinor:17,grossMinor:117}), /TVA/);
  assert.equal(reconcile([line(100)], {netMinor:100,vatMinor:18,grossMinor:118}).grossMinor, 118);
});
test('refuse les valeurs négatives, non finies, imprécises et les taux manquants', () => {
  for (const n of [-1, NaN, Infinity, 1.1, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => calc([line(n)]));
  for (const r of [-1, 10001, NaN, 1.5]) assert.throws(() => calc([line(100,r)]));
  assert.throws(() => calc([{netMinor:100}]));
  assert.throws(() => calc([line(100,1800,10001)]));
  assert.throws(() => calc([])); assert.throws(() => calc([line(0)]));
});
test('refuse tout dépassement de la précision monétaire entière', () => {
  assert.throws(() => calc([line(Number.MAX_SAFE_INTEGER)]));
  assert.throws(() => calc([line(Number.MAX_SAFE_INTEGER,0),line(1,0)]));
});
test('invariant comptable sur une série de montants et taux', () => {
  for (const n of [1,3,11,99,100,12345,10000000]) for (const r of [0,1000,1800,10000]) for (const d of [0,3333,5000,10000]) {
    const x=calc([line(n,r,d)]);
    assert.equal(x.netMinor+x.vatMinor,x.grossMinor);
    assert.equal(x.deductibleVatMinor+x.nonDeductibleVatMinor,x.vatMinor);
    assert.equal(x.expenseMinor+x.deductibleVatMinor,x.grossMinor);
  }
});

test('limite serveur de 500 lignes et rejet des lignes manquantes', () => {
  assert.equal(calc(Array.from({length:500}, () => line(100))).netMinor, 50000);
  assert.throws(() => calc(Array.from({length:501}, () => line(100))));
  assert.throws(() => calc([line(100), , line(100)]));
});
