import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTemplateLine, resolveEntryTemplate, templateMinor, validateTemplateShape } from '../src/lib/accountingEntryTemplates.ts';

const fixedDebit = { account_code: '5210000', label: 'Dépôt', debit: 1500, credit: 0 };
const fixedCredit = { account_code: '7010000', label: 'Dépôt', debit: 0, credit: 1500 };
const accounts = new Set([fixedDebit.account_code, fixedCredit.account_code]);
const line = (values) => normalizeTemplateLine({ ...fixedDebit, ...values });

test('importe les anciennes lignes fixes sans changer leurs montants', () => {
  const rules = [fixedDebit, fixedCredit].map(normalizeTemplateLine);
  assert.equal(validateTemplateShape(rules, accounts), '');
  const result = resolveEntryTemplate(rules, {});
  assert.equal(result.issue, '');
  assert.deepEqual(result.postingLines, [fixedDebit, fixedCredit]);
});

test('répète les valeurs précédentes et calcule le crédit exact avec une décimale française', () => {
  const rules = [
    line({ account_rule: 'input', label_rule: 'input', amount_rule: 'input' }),
    line({ account_rule: 'repeat', label_rule: 'repeat', amount_rule: 'repeat' }),
    line({ account_code: '7010000', label_rule: 'repeat', amount_rule: 'balance', amount_side: 'auto' }),
  ];
  const values = { 0: { account: '5210000', label: 'Test', amount: '12000,17' } };
  assert.equal(validateTemplateShape(rules, accounts), '');
  const result = resolveEntryTemplate(rules, values);
  assert.equal(result.issue, '');
  assert.equal(result.totalDebit, 24000.34);
  assert.equal(result.totalCredit, 24000.34);
  assert.deepEqual(result.postingLines, [
    { account_code: '5210000', label: 'Test', debit: 12000.17, credit: 0 },
    { account_code: '5210000', label: 'Test', debit: 12000.17, credit: 0 },
    { account_code: '7010000', label: 'Test', debit: 0, credit: 24000.34 },
  ]);
});

test('calcule un débit automatique et signale la contrepartie forcée du mauvais côté', () => {
  const credit = normalizeTemplateLine(fixedCredit);
  const balance = line({ amount_rule: 'balance', amount_side: 'auto' });
  assert.equal(resolveEntryTemplate([credit, balance], {}).postingLines[1].debit, 1500);
  assert.match(resolveEntryTemplate([credit, { ...balance, amount_side: 'credit' }], {}).issue, /au débit/);
});

test('omet la contrepartie nulle et exige les montants variables et des comptes actifs', () => {
  const debit = line({ amount_rule: 'input' });
  const credit = normalizeTemplateLine(fixedCredit);
  const nullableBalance = line({ amount_rule: 'balance', amount_side: 'auto' });
  assert.match(resolveEntryTemplate([debit, credit, nullableBalance], {}).issue, /montant positif/);
  assert.equal(resolveEntryTemplate([debit, credit, nullableBalance], { 0: { amount: '1500' } }).postingLines.length, 2);
  assert.match(validateTemplateShape([line({ account_code: '0000000' }), credit], accounts), /compte actif/);
});

test('refuse une première répétition ou une répétition dépendant de l’équilibrage', () => {
  const credit = normalizeTemplateLine(fixedCredit);
  const balance = line({ amount_rule: 'balance', amount_side: 'auto' });
  assert.match(validateTemplateShape([line({ amount_rule: 'repeat' }), credit], accounts), /première ligne/);
  assert.match(validateTemplateShape([balance, line({ amount_rule: 'repeat' }), credit], accounts), /ligne d’équilibrage/);
});

test('convertit les centimes sans imprécision au plafond des montants', () => {
  assert.equal(templateMinor('9007199254740,89'), 900719925474089);
  assert.equal(templateMinor('25,01'), 2501);
  for (const value of ['', '1e3', '-20', '3,002', '12345678912345']) assert.ok(Number.isNaN(templateMinor(value)));
});
