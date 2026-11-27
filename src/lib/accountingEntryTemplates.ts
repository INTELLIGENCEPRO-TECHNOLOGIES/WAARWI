export type ValueRule = 'fixed' | 'input' | 'repeat';
export type AmountRule = ValueRule | 'balance';
export type AmountSide = 'debit' | 'credit' | 'auto';
export type TemplateLine = { account_code: string; label: string; debit: number; credit: number };
export type RuleLine = TemplateLine & {
  account_rule: ValueRule;
  label_rule: ValueRule;
  amount_rule: AmountRule;
  amount_side: AmountSide;
};

export type EntryTemplate = {
  id: string;
  name: string;
  journal_code: string | null;
  description: string;
  lines: (TemplateLine & Partial<RuleLine>)[];
  revision: number;
  next_due_on: string | null;
};

export type EntryTemplateSource = { journal: string; description: string; lines: TemplateLine[] };
type LineInput = { account?: string; label?: string; amount?: string };
export type TemplateInputs = Record<number, LineInput>;
const MAX_TOTAL_CENTS = 9007199254740900;

export function defaultTemplateLine(side: AmountSide): RuleLine {
  return {
    account_code: '', label: '', debit: 0, credit: 0,
    account_rule: 'fixed', label_rule: 'input', amount_rule: side === 'auto' ? 'balance' : 'input', amount_side: side,
  };
}

export function normalizeTemplateLine(line: EntryTemplate['lines'][number]): RuleLine {
  return {
    ...line,
    account_rule: line.account_rule ?? 'fixed',
    label_rule: line.label_rule ?? 'fixed',
    amount_rule: line.amount_rule ?? 'fixed',
    amount_side: line.amount_side ?? (Number(line.credit) > 0 ? 'credit' : 'debit'),
  };
}

/** Use integer hundredths to keep totals stable when decimal amounts are present. */
export function templateMinor(value: string | number) {
  const number = String(value).trim().replace(',', '.');
  const [whole, fraction = ''] = number.split('.');
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(number)) return NaN;
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function validateTemplateShape(lines: RuleLine[], accounts: ReadonlySet<string>) {
  if (lines.length < 2 || lines.length > 500) return 'Ajoutez entre 2 et 500 lignes.';
  let totalDebit = 0;
  let totalCredit = 0;
  let balanceCount = 0;
  for (const [index, line] of lines.entries()) {
    if (index === 0 && [line.account_rule, line.label_rule, line.amount_rule].includes('repeat')) {
      return 'La première ligne ne peut pas répéter une valeur.';
    }
    if (line.account_rule === 'fixed' && !accounts.has(line.account_code.trim())) {
      return `Choisissez un compte actif à la ligne ${index + 1}.`;
    }
    if (line.amount_rule === 'balance') balanceCount++;
    if (line.amount_rule === 'repeat' && lines[index - 1]?.amount_rule === 'balance') {
      return `La ligne ${index + 1} ne peut pas répéter le montant de la ligne d’équilibrage.`;
    }
    if (line.amount_rule !== 'fixed') continue;
    const amount = templateMinor(line.amount_side === 'debit' ? line.debit : line.credit);
    if (!Number.isSafeInteger(amount) || amount <= 0) return `Renseignez un montant fixe positif à la ligne ${index + 1}.`;
    if (line.amount_side === 'debit') totalDebit += amount;
    else totalCredit += amount;
  }
  if (balanceCount > 1) return 'Le modèle accepte une seule ligne d’équilibrage.';
  if (!(lines.some(line => line.amount_side !== 'credit') && lines.some(line => line.amount_side !== 'debit'))) {
    return 'Prévoyez au moins une ligne au débit et une au crédit.';
  }
  if (Math.max(totalDebit, totalCredit) > MAX_TOTAL_CENTS) return 'Les montants fixes dépassent le plafond autorisé.';
  if (lines.every(line => line.amount_rule === 'fixed') && totalDebit !== totalCredit) {
    return 'Les montants fixes doivent être équilibrés. Ajustez-les ou configurez une ligne d’équilibrage.';
  }
  return '';
}

export function resolveEntryTemplate(lines: RuleLine[], values: TemplateInputs) {
  let balanceIndex = -1;
  let issue = '';
  let totalDebit = 0;
  let totalCredit = 0;
  const records: TemplateLine[] = [];

  for (const [index, line] of lines.entries()) {
    const previous = records[index - 1];
    const input = values[index] ?? {};
    const account_code = line.account_rule === 'repeat' ? previous?.account_code ?? ''
      : line.account_rule === 'input' ? input.account?.trim() ?? '' : line.account_code;
    const label = line.label_rule === 'repeat' ? previous?.label ?? ''
      : line.label_rule === 'input' ? input.label?.trim() ?? '' : line.label;
    if (!account_code) issue ||= `Renseignez le compte de la ligne ${index + 1}.`;

    if (line.amount_rule === 'balance') {
      if (balanceIndex >= 0) issue ||= 'Le modèle accepte une seule ligne d’équilibrage.';
      balanceIndex = index;
      records.push({ account_code, label, debit: 0, credit: 0 });
      continue;
    }
    const cents = line.amount_rule === 'repeat' ? templateMinor(previous ? previous.debit || previous.credit : 0)
      : line.amount_rule === 'input' ? templateMinor(input.amount ?? '')
      : templateMinor(line.amount_side === 'debit' ? line.debit : line.credit);
    const validAmount = Number.isSafeInteger(cents) && cents > 0;
    if (!validAmount) issue ||= `Renseignez un montant positif à la ligne ${index + 1}.`;
    const debit = line.amount_side === 'debit' && validAmount ? cents : 0;
    const credit = line.amount_side === 'credit' && validAmount ? cents : 0;
    totalDebit += debit;
    totalCredit += credit;
    records.push({ account_code, label, debit: debit / 100, credit: credit / 100 });
  }

  if (Math.max(totalDebit, totalCredit) > MAX_TOTAL_CENTS) issue ||= 'Les totaux dépassent le plafond autorisé.';
  if (!issue && balanceIndex >= 0) {
    const difference = totalDebit - totalCredit;
    const side = lines[balanceIndex].amount_side;
    if ((difference < 0 && side === 'credit') || (difference > 0 && side === 'debit')) {
      issue = `Le solde à reporter est au ${difference < 0 ? 'débit' : 'crédit'}. Vérifiez les montants ou le sens de l’équilibrage.`;
    } else if (difference < 0) {
      records[balanceIndex].debit = -difference / 100;
      totalDebit -= difference;
    } else if (difference > 0) {
      records[balanceIndex].credit = difference / 100;
      totalCredit += difference;
    }
  }
  if (!issue && (totalDebit === 0 || totalDebit !== totalCredit)) issue = 'Le total débit doit être égal au total crédit.';
  const postingLines = records.filter(line => line.debit > 0 || line.credit > 0);
  if (!issue && postingLines.length < 2) issue = 'Une écriture comporte au moins deux lignes renseignées.';
  return { records, postingLines, totalDebit: totalDebit / 100, totalCredit: totalCredit / 100, issue };
}

export function templateError(error: unknown, fallback: string) {
  return error != null && typeof error === 'object' && 'message' in error ? String(error.message) : fallback;
}
