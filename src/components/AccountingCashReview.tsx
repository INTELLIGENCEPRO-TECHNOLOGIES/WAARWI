import { useState } from 'react';
import { cashMovementLabel, type CashMovementKind } from '../lib/cashMovements';
import { formatCurrency, formatDate } from '../lib/format';
import { supabase } from '../lib/supabase';
import { SearchableSelect } from './SearchableSelect';
import { AccountingCashDocument } from './AccountingCashDocument';

const PAGE_SIZE = 25;
type Cursor = { time: string; id: string } | null;
type Decision = { amount: number; date: string } & (
  | { action: 'link'; entry_id: string; entry_number: string }
  | { action: 'post'; journal: string; debit_account: string; credit_account: string }
  | { action: 'post_payment'; source_type: 'payment' | 'customer_payment'; source_id: string }
  | { action: 'review' | 'excluded'; reason: string }
);
type Movement = { id: string; created_at: string; kind: CashMovementKind; label: string; decision: Decision };
type Application = { success: boolean; outcome?: 'link' | 'post' | 'post_payment' | 'already_accounted'; error?: string };
type Vault = { id: string; name: string; site_name: string; account_code: string | null; is_active: boolean };
type VaultAccounts = { vaults: Vault[]; accounts: { code: string; name: string }[] };

function summarize(decision: Decision) {
  switch (decision.action) {
    case 'link':
      return `Écriture ${decision.entry_number} déjà au journal`;
    case 'post':
      return `${decision.journal} · Débit ${decision.debit_account} · Crédit ${decision.credit_account}`;
    case 'post_payment':
      return 'Règlement identifié. Son écriture sera créée dans le journal du mode de paiement.';
    default:
      return decision.reason;
  }
}

export function AccountingCashReview({ tenantId, onPosted }: { tenantId: string; onPosted: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today.slice(0, 4) + '-01-01');
  const [dateTo, setDateTo] = useState(today);
  const [rows, setRows] = useState<Movement[] | null>(null);
  const [cursorTrail, setCursorTrail] = useState<Cursor[]>([null]);
  const [hasMore, setHasMore] = useState(false);
  const [running, setRunning] = useState(false);
  const [documentSaving, setDocumentSaving] = useState(false);
  const busy = running || documentSaving;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [vaultAccounts, setVaultAccounts] = useState<VaultAccounts | null>(null);
  const [vaultId, setVaultId] = useState('');
  const [accountCode, setAccountCode] = useState('');

  const fetchPage = async (trail: Cursor[]) => {
    const cursor = trail[trail.length - 1];
    const { data, error: fetchError } = await supabase.rpc('review_cash_accounting', {
      p_tenant_id: tenantId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_after_time: cursor?.time ?? null,
      p_after_id: cursor?.id ?? null,
    });
    if (fetchError) throw fetchError;
    const page = (data ?? []) as Movement[];
    setRows(page.slice(0, PAGE_SIZE));
    setHasMore(page.length > PAGE_SIZE);
    setCursorTrail(trail);
  };

  const run = async (operation: () => Promise<void>) => {
    setRunning(true);
    setError('');
    setNotice('');
    setConfirmId('');
    try {
      await operation();
    } catch (failure) {
      setError(failure && typeof failure === 'object' && 'message' in failure
        ? String(failure.message) : 'L’opération a échoué. Réessayez.');
    } finally {
      setRunning(false);
    }
  };

  const apply = (movements: Movement[]) => run(async () => {
    const { data, error: applyError } = await supabase.rpc('apply_cash_accounting', {
      p_tenant_id: tenantId,
      p_movements: movements.map(({ id, decision }) => ({ id, decision })),
    });
    if (applyError) throw applyError;
    const results = (data ?? []) as Application[];
    const applied = results.filter(result => result.success);
    const failures = results.filter(result => !result.success);
    const posted = applied.some(result => result.outcome === 'post' || result.outcome === 'post_payment');
    const label = posted ? 'comptabilisé' : 'rapproché';
    if (applied.length) {
      setNotice(applied.length === 1 ? `1 mouvement ${label}.` : `${applied.length} mouvements ${label}s.`);
    }
    if (failures.length) setError(failures[0].error ?? 'Certains mouvements restent à vérifier.');
    if (posted || applied.some(result => result.outcome === 'already_accounted')) onPosted();
    await fetchPage(cursorTrail);
  });

  const loadVaults = () => run(async () => {
    const { data, error: fetchError } = await supabase.rpc('get_accounting_vault_accounts', { p_tenant_id: tenantId });
    if (fetchError) throw fetchError;
    setVaultAccounts(data as VaultAccounts);
  });
  const selectedVault = vaultAccounts?.vaults.find(vault => vault.id === vaultId);
  const selectVault = (selected: string) => {
    setVaultId(selected);
    setAccountCode(vaultAccounts?.vaults.find(vault => vault.id === selected)?.account_code ?? '');
  };
  const saveVault = () => run(async () => {
    if (!selectedVault) return;
    const { error: saveError } = await supabase.rpc('save_accounting_vault_account', {
      p_tenant_id: tenantId, p_vault_id: selectedVault.id,
      p_account_code: accountCode, p_previous_account_code: selectedVault.account_code,
    });
    if (saveError) throw saveError;
    setVaultAccounts(current => current && ({
      ...current,
      vaults: current.vaults.map(vault => vault.id === selectedVault.id ? { ...vault, account_code: accountCode } : vault),
    }));
    setNotice('Compte du coffre enregistré.');
    if (rows) await fetchPage(cursorTrail);
  });

  const linkable = rows?.filter(row => row.decision.action === 'link') ?? [];
  const datesValid = Boolean(dateFrom && dateTo && dateFrom <= dateTo);
  const lastRow = rows?.[rows.length - 1];

  return (
    <section aria-label="Rapprochement de la caisse" className="acc-section-block space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-900">Mouvements de caisse</h2>
        <button type="button" className="btn btn-secondary" disabled={busy} aria-expanded={vaultAccounts !== null}
          onClick={() => { if (vaultAccounts) setVaultAccounts(null); else void loadVaults(); }}>
          Comptes des coffres
        </button>
      </div>

      {vaultAccounts && (
        <div className="border-b border-neutral-200 pb-4">
          {vaultAccounts.vaults.length === 0 ? <p className="text-sm text-neutral-500">Aucun coffre à configurer.</p> : (
            <div className="acc-fields acc-fields-with-action">
              <SearchableSelect label="Coffre" variant="underline" value={vaultId} onChange={selectVault} disabled={busy}
                options={vaultAccounts.vaults.map(vault => ({
                  value: vault.id, label: `${vault.site_name} · ${vault.name}`,
                  sublabel: [vault.account_code || 'Compte à renseigner', !vault.is_active && 'Inactif'].filter(Boolean).join(' · '),
                }))} />
              <SearchableSelect label="Compte de trésorerie" variant="underline" value={accountCode} onChange={setAccountCode}
                disabled={!selectedVault || busy} options={vaultAccounts.accounts.map(account => ({
                  value: account.code, label: `${account.code} · ${account.name}`,
                }))} />
              <button type="button" className="btn btn-secondary" onClick={() => void saveVault()}
                disabled={busy || !selectedVault || !accountCode || accountCode === selectedVault.account_code}>
                Enregistrer
              </button>
            </div>
          )}
        </div>
      )}

      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void run(() => fetchPage([null])); }}>
        <label className="min-w-0 flex-1 text-xs text-neutral-600 sm:flex-none">
          Du
          <input type="date" className="input mt-1" value={dateFrom} max={dateTo} required disabled={busy}
            onChange={event => { setDateFrom(event.target.value); setRows(null); setConfirmId(''); }} />
        </label>
        <label className="min-w-0 flex-1 text-xs text-neutral-600 sm:flex-none">
          Au
          <input type="date" className="input mt-1" value={dateTo} min={dateFrom} required disabled={busy}
            onChange={event => { setDateTo(event.target.value); setRows(null); setConfirmId(''); }} />
        </label>
        <button type="submit" className="btn btn-secondary" disabled={busy || !datesValid}>Contrôler la période</button>
      </form>

      {busy && <p role="status" className="text-sm text-neutral-500">Traitement en cours…</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-neutral-700">{notice}</p>}
      {rows?.length === 0 && <p className="text-sm text-neutral-500">Aucun mouvement à traiter sur cette page.</p>}

      {linkable.length > 0 && (
        <button type="button" className="btn btn-secondary" disabled={busy}
          onClick={() => void apply(linkable)}>
          Rapprocher les écritures existantes ({linkable.length})
        </button>
      )}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-neutral-200 border-t border-neutral-200">
          {rows.map(row => (
            <li key={row.id} className="acc-cash-row">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-neutral-900">{row.label}</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {formatDate(row.decision.date)} · {cashMovementLabel(row.kind)}
                </p>
                <p className="mt-1 break-words text-xs text-neutral-600">{summarize(row.decision)}</p>
              </div>
              <p className="whitespace-nowrap text-right text-sm font-medium tabular-nums">{formatCurrency(Number(row.decision.amount))}</p>
              {(row.decision.action === 'post' || row.decision.action === 'post_payment') && (
                <div className="acc-cash-row-actions">
                  {confirmId === row.id ? (
                    <>
                      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirmId('')}>Annuler</button>
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void apply([row])}>Confirmer l’écriture</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirmId(row.id)}>Comptabiliser</button>
                  )}
                </div>
              )}
              {row.decision.action === 'review'
                && (row.kind === 'customer_prepayment' || row.kind === 'customer_withdrawal' || row.kind === 'refund') && (
                confirmId === row.id ? (
                  <div className="col-span-full">
                    <AccountingCashDocument key={row.id} tenantId={tenantId} movementId={row.id}
                      onClose={() => setConfirmId('')} onSavingChange={setDocumentSaving}
                      onPosted={() => void run(async () => {
                        setNotice('Écriture comptabilisée et rattachée au mouvement.');
                        onPosted();
                        await fetchPage(cursorTrail);
                      })} />
                  </div>
                ) : (
                  <button type="button" className="btn-secondary acc-cash-row-actions justify-self-start"
                    disabled={busy} onClick={() => setConfirmId(row.id)}>Vérifier la pièce</button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {rows && (cursorTrail.length > 1 || hasMore) && (
        <nav className="acc-pagination" aria-label="Pages des mouvements de caisse">
          <button type="button" className="btn btn-secondary" disabled={busy || cursorTrail.length < 2}
            onClick={() => void run(() => fetchPage(cursorTrail.slice(0, -1)))}>Précédente</button>
          <button type="button" className="btn btn-secondary" disabled={busy || !hasMore || !lastRow}
            onClick={() => { if (lastRow) void run(() => fetchPage([...cursorTrail, { time: lastRow.created_at, id: lastRow.id }])); }}>Suivante</button>
        </nav>
      )}
    </section>
  );
}
