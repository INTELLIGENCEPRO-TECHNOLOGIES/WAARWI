import { supabase } from './supabase';

export const ACCOUNT_STATEMENT_PAGE_SIZE = 50;

export type StatementAccount = { code: string; name: string; account_type: string; is_active: boolean };

export type AccountStatementLine = {
  line_id: string;
  entry_id: string;
  entry_date: string;
  entry_number: string;
  journal_type: string;
  reference: string | null;
  description: string;
  source_type: string | null;
  source_id: string | null;
  status: string;
  label: string | null;
  debit: number;
  credit: number;
  running_balance: number;
  match_group_id: string | null;
  match_code: string | null;
};

export type AccountStatement = {
  opening_mode?: 'fiscal' | 'continuous' | 'provisional';
  account: StatementAccount;
  opening_balance: number;
  total_debit: number;
  total_credit: number;
  closing_balance: number;
  row_count: number;
  rows: AccountStatementLine[];
};

type AccountStatementRequest = { code: string; from: string; to: string; offset: number };

export async function readAccountingAccountStatement(
  tenantId: string,
  request: AccountStatementRequest,
  signal?: AbortSignal,
): Promise<AccountStatement> {
  const query = supabase.rpc('accounting_account_statement', {
    p_tenant_id: tenantId,
    p_account_code: request.code,
    p_date_from: request.from,
    p_date_to: request.to,
    p_offset: request.offset,
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  if (!data) throw new Error('Relevé comptable indisponible.');
  return data as AccountStatement;
}
