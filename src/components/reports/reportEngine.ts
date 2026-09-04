import { supabase } from '../../lib/supabase';
import { formatDate } from '../../lib/format';
import { BUSINESS_TYPE_LABELS } from '../../lib/types';
import { renderA4Header, a4HeaderCss, buildPrintTenant } from '../../lib/print';

// ── formatters ───────────────────────────────────────────────────────────────

export const fmtNum = (n: number) => n.toLocaleString('fr-FR');
export const fmtMoney = (n: number) => (Number(n) || 0).toLocaleString('fr-FR');
export const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const pct = (n: number, d: number) =>
  d === 0 ? '—' : `${Math.round((n / d) * 100)} %`;
export const fmtRate = (v: number | null | undefined) =>
  v == null ? '—' : `${v} %`;

export type DateRange = { from: Date; to: Date };
export function isoDate(d: Date) { return d.toISOString().split('T')[0]; }
export function labelRange(r: DateRange) {
  return `${formatDate(r.from)} — ${formatDate(r.to)}`;
}

export interface TenantMeta {
  name: string; legal_name?: string; ninea?: string; rccm?: string;
  address?: string; phone?: string; email?: string; website?: string;
  logo_url?: string; business_type?: string;
}

// ── A4 document engine (strictly monochrome) ─────────────────────────────────

export function a4Style(): string {
  return `
    @page { size: A4 portrait; margin: 16mm 18mm 20mm 18mm; }
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', 'Arial', 'Helvetica Neue', sans-serif;
      font-size: 8.5pt;
      color: #111111;
      line-height: 1.5;
      background: #ffffff;
    }
    .page { width: 100%; }
    ${a4HeaderCss}
    .amount-note { font-size: 6.5pt; color: #9ca3af; margin: 0 0 10px; }
    .kpi-row {
      display: flex; margin: 0 0 14px;
      border-top: 1px solid #111111; border-bottom: 1px solid #e5e7eb;
      flex-wrap: wrap;
    }
    .kpi-cell {
      flex: 1; min-width: 96px; padding: 7px 10px; border-left: 1px solid #e5e7eb;
      background: none;
    }
    .kpi-cell:first-child { border-left: none; }
    .kpi-cell.accent, .kpi-cell.success, .kpi-cell.danger { background: none; border-color: #e5e7eb; }
    .kpi-label { font-size: 6.5pt; letter-spacing: 0.2px; color: #6b7280; font-weight: 600; margin-bottom: 3px; text-transform: none; }
    .kpi-value { font-size: 10pt; font-weight: 700; color: #111111; line-height: 1.15; }
    .kpi-value.green, .kpi-value.red { color: #111111; }
    .section-title {
      font-size: 8pt; font-weight: 700; text-transform: none; letter-spacing: 0.2px;
      color: #111111; background: none; padding: 0 0 3px;
      border: none; border-bottom: 1px solid #111111; margin: 16px 0 8px;
    }
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    thead th {
      font-size: 6.5pt; font-weight: 700; text-transform: none; letter-spacing: 0.2px;
      color: #6b7280; background: none; padding: 5px 6px;
      border-bottom: 1px solid #111111; white-space: nowrap;
    }
    tbody td {
      font-size: 7.5pt; padding: 4px 6px; border-bottom: 0.5px solid #eeeeee; vertical-align: middle; color: #111111;
    }
    tbody tr:nth-child(even) td { background: none; }
    tbody tr:last-child td { border-bottom: 0.5px solid #eeeeee; }
    .num  { font-variant-numeric: tabular-nums; }
    .r    { text-align: right; }
    .c    { text-align: center; }
    .b    { font-weight: 700; }
    .muted { color: #9ca3af; font-size: 7pt; }
    .total-row td {
      font-weight: 700; font-size: 8pt; background: none !important;
      border-top: 1px solid #111111; border-bottom: none;
    }
    .doc-footer {
      margin-top: 18px; padding-top: 8px; border-top: 1px solid #e5e7eb;
      display: flex; justify-content: space-between; align-items: flex-end;
    }
    .footer-note { font-size: 6.5pt; color: #9ca3af; }
    .waarwi-brand { font-size: 6pt; color: #9ca3af; text-align: right; }
    .mc  { color: #111111; font-weight: 600; }
    .mr  { color: #111111; font-weight: 600; }
    .notice-warn {
      margin: 8px 0 2px; padding: 6px 0 6px 10px; border-radius: 0;
      background: none; border: none; border-left: 2px solid #111111; color: #374151;
      font-size: 7.5pt; font-weight: 500; line-height: 1.45;
    }
  `;
}

const AMOUNT_NOTE = `<div class="amount-note">Montants en FCFA</div>`;

export function docHeader(
  tenant: TenantMeta, title: string, subtitle: string, period: string, siteName?: string
) {
  const printTenant = buildPrintTenant(tenant);
  return renderA4Header({
    tenant: printTenant,
    docTitle: title,
    docDate: period,
    siteName: siteName || undefined,
    subtitle: subtitle || undefined,
  });
}

export function docFooter(generatedAt: string): string {
  return `
    <div class="doc-footer">
      <div class="footer-note">Généré le ${esc(generatedAt)} · Document confidentiel</div>
      <div class="waarwi-brand">Propulsé par WAARWI — Plateforme Business 2.0 made in Sénégal</div>
    </div>`;
}

export function printDoc(html: string): void {
  const w = window.open('', '_blank', 'width=960,height=720');
  if (!w) return;
  w.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>État</title>` +
    `<style>${a4Style()}</style></head><body><div class="page">${html}</div></body></html>`
  );
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 450);
}

// ── Data fetching ────────────────────────────────────────────────────────────

export async function fetchCashStats(
  _tenantId: string, siteId: string | undefined, from: string, to: string
) {
  const { data, error } = await supabase.rpc('get_cash_report', {
    p_site_id: siteId || null, p_from: from, p_to: to,
  });
  if (error) throw error;
  const r = (data || {}) as any;
  const num = (v: any) => Number(v) || 0;
  return {
    ventesValidees: num(r.ventes_validees),
    retours: num(r.retours),
    caNet: num(r.ca_net),
    cogsNet: num(r.cogs_net),
    margeBrute: num(r.marge_brute),
    tauxMarge: r.taux_marque == null ? null : Number(r.taux_marque),
    nbVentes: num(r.nb_ventes),
    nbRetours: num(r.nb_retours),
    nbAnnulations: num(r.nb_annulations),
    montantAnnule: num(r.montant_annule),
    nbLignesSansCout: num(r.nb_lignes_sans_cout),
    fondsOuverture: num(r.fonds_ouverture),
    reglementsClients: num(r.reglements_clients),
    autresEntrees: num(r.autres_entrees),
    transfertsDepuisCoffre: num(r.transferts_depuis_coffre),
    versementsAuCoffre: num(r.versements_au_coffre),
    encaissementsReels: num(r.encaissements_reels),
    reglementsFournisseurs: num(r.reglements_fournisseurs),
    depensesPayees: num(r.depenses_payees),
    remboursementsClients: num(r.remboursements_clients),
    autresSorties: num(r.autres_sorties),
    totalEntrees: num(r.total_entrees),
    totalSorties: num(r.total_sorties),
    soldeTheorique: num(r.solde_theorique),
    parMode: ((r.par_mode || []) as any[]).map((m) => ({
      method: String(m.method), entrees: num(m.entrees), sorties: num(m.sorties), net: num(m.net),
    })),
    parJour: ((r.par_jour || []) as any[]).map((d) => ({
      date: String(d.date), entrees: num(d.entrees), sorties: num(d.sorties), solde: num(d.solde),
    })),
    articles: ((r.articles || []) as any[]).map((a) => ({
      name: String(a.name), qty: num(a.qty), revenue: num(a.revenue), cost: num(a.cost),
    })),
  };
}

export async function fetchArticleStats(
  _tenantId: string, siteId: string | undefined, from: string, to: string
) {
  const { data, error } = await supabase.rpc('get_sales_by_article', {
    p_site_id: siteId || null, p_from: from, p_to: to,
  });
  if (error) throw error;

  return ((data || []) as any[]).map((r: any) => ({
    name: r.article_name || r.article_id,
    qty: Number(r.quantite_vendue) || 0,
    qtyReturned: Number(r.quantite_retournee) || 0,
    revenue: Number(r.ca) || 0,
    cost: Number(r.cout) || 0,
    margin: Number(r.marge) || 0,
    tauxMarge: Number(r.taux_marge) || 0,
  }));
}

export type CustomerStatRow = {
  customerId: string | null; name: string; isShared: boolean; status: string;
  nbVentes: number; caHt: number; remises: number; retours: number; caNet: number;
  cost: number; marge: number; encaissements: number;
  soldeAnterieur: number; soldeADate: number; montantDu: number; creditDisponible: number;
};
export type CustomerStats = { asOf: string; rows: CustomerStatRow[]; totals: Record<string, number> };

export async function fetchCustomerStats(
  _tenantId: string, siteId: string | undefined, from: string, to: string
): Promise<CustomerStats> {
  const { data, error } = await supabase.rpc('get_customers_report', {
    p_site_id: siteId || null, p_from: from, p_to: to,
  });
  if (error) throw error;
  const p = (data || {}) as any;
  const num = (v: any) => Number(v) || 0;
  return {
    asOf: String(p.asOf || to),
    rows: ((p.rows || []) as any[]).map((r) => ({
      customerId: r.customer_id ?? null,
      name: String(r.name ?? 'Client inconnu'),
      isShared: !!r.is_shared,
      status: String(r.status || 'active'),
      nbVentes: num(r.nb_ventes),
      caHt: num(r.ca_ht),
      remises: num(r.remises),
      retours: num(r.retours),
      caNet: num(r.ca_net),
      cost: num(r.cost),
      marge: num(r.marge),
      encaissements: num(r.encaissements),
      soldeAnterieur: num(r.solde_anterieur),
      soldeADate: num(r.solde_a_date),
      montantDu: num(r.montant_du),
      creditDisponible: num(r.credit_disponible),
    })),
    totals: (p.totals || {}) as Record<string, number>,
  };
}

export type SupplierStatRow = {
  supplierId: string; name: string; isShared: boolean; status: string;
  nbCommandes: number; totalAchats: number; reglements: number; avances: number;
  detteAnterieure: number; detteADate: number;
};
export type SupplierStats = { asOf: string; rows: SupplierStatRow[]; totals: Record<string, number> };

export async function fetchSupplierStats(
  _tenantId: string, siteId: string | undefined, from: string, to: string
): Promise<SupplierStats> {
  const { data, error } = await supabase.rpc('get_suppliers_report', {
    p_site_id: siteId || null, p_from: from, p_to: to,
  });
  if (error) throw error;
  const p = (data || {}) as any;
  const num = (v: any) => Number(v) || 0;
  return {
    asOf: String(p.asOf || to),
    rows: ((p.rows || []) as any[]).map((r) => ({
      supplierId: String(r.supplier_id),
      name: String(r.name ?? 'Fournisseur inconnu'),
      isShared: !!r.is_shared,
      status: String(r.status || 'active'),
      nbCommandes: num(r.nb_commandes),
      totalAchats: num(r.total_achats),
      reglements: num(r.reglements),
      avances: num(r.avances),
      detteAnterieure: num(r.dette_anterieure),
      detteADate: num(r.dette_a_date),
    })),
    totals: (p.totals || {}) as Record<string, number>,
  };
}

export async function fetchExpenseStats(
  _tenantId: string, siteId: string | undefined, from: string, to: string
) {
  const [expRes, sumRes] = await Promise.all([
    supabase.rpc('get_expenses_report', {
      p_site_id: siteId || null, p_from: from, p_to: to, p_limit: 500, p_offset: 0,
    }),
    supabase.rpc('get_financial_summary', {
      p_site_id: siteId || null, p_from: from, p_to: to,
    }),
  ]);
  if (expRes.error) throw expRes.error;
  if (sumRes.error) throw sumRes.error;
  const e = (expRes.data || {}) as any;
  const s = (sumRes.data || {}) as any;
  const num = (v: any) => Number(v) || 0;

  return {
    ventesValidees: num(s.ventes_validees),
    retours: num(s.retours),
    caNet: num(s.ca_net),
    cogsNet: num(s.cogs_net),
    margeBrute: num(s.marge_brute),
    tauxMarge: s.taux_marque == null ? null : Number(s.taux_marque),
    chargesExploitation: num(s.charges_exploitation),
    resultatExploitation: num(s.resultat_exploitation),
    nbLignesSansCout: num(s.nb_lignes_sans_cout),
    expensesTotal: num(e.total),
    expensesCount: num(e.count),
    byCategory: ((e.par_categorie || []) as any[]).map((c) => ({
      category: String(c.category), count: num(c.count), amount: num(c.amount),
    })),
    byMode: ((e.par_mode || []) as any[]).map((m) => ({
      method: String(m.method ?? m.mode ?? ''), count: num(m.count), amount: num(m.amount),
    })),
    detail: ((e.detail || []) as any[]).map((d) => ({
      date: String(d.date),
      category: String(d.category),
      method: String(d.method),
      site: String(d.site),
      note: String(d.label || ''),
      amount: num(d.amount_paid),
    })),
  };
}

export type TiersRow = { id: string; name: string; net: number; due: number; credit: number };
export type TiersStats = { asOf: string; customers: TiersRow[]; suppliers: TiersRow[]; totals: any };

export async function fetchTiersBalanceStats(
  _tenantId: string, _from: string, to: string, siteId: string | null
): Promise<TiersStats> {
  const { data, error } = await supabase.rpc('get_tiers_balance', { p_site_id: siteId, p_as_of: to });
  if (error) throw error;
  const p = (data || {}) as any;
  const num = (v: any) => Number(v) || 0;
  const mapC = (r: any): TiersRow => ({ id: String(r.id), name: String(r.name ?? 'Inconnu'), net: num(r.net), due: num(r.due), credit: num(r.credit) });
  const mapS = (r: any): TiersRow => ({ id: String(r.id), name: String(r.name ?? 'Inconnu'), net: num(r.net), due: num(r.due), credit: num(r.advance) });
  return {
    asOf: String(p.asOf || to),
    customers: ((p.customers || []) as any[]).map(mapC),
    suppliers: ((p.suppliers || []) as any[]).map(mapS),
    totals: p.totals || {},
  };
}

export type CashStats = Awaited<ReturnType<typeof fetchCashStats>>;
export type ArticleStatRow = Awaited<ReturnType<typeof fetchArticleStats>>[number];
export type ExpenseStats = Awaited<ReturnType<typeof fetchExpenseStats>>;

export type ReportType = 'cash' | 'articles' | 'customers' | 'suppliers' | 'expenses' | 'tiers_balance';

export type ReportData =
  | { type: 'cash'; stats: CashStats }
  | { type: 'articles'; rows: ArticleStatRow[] }
  | { type: 'customers'; stats: CustomerStats }
  | { type: 'suppliers'; stats: SupplierStats }
  | { type: 'expenses'; stats: ExpenseStats }
  | { type: 'tiers_balance'; stats: TiersStats };

// ── Report HTML builders (A4) ────────────────────────────────────────────────

export function buildCashReport(
  tenant: TenantMeta, range: DateRange, stats: CashStats,
  showMargin: boolean, siteName?: string
): string {
  const {
    ventesValidees, retours, caNet, cogsNet, margeBrute, tauxMarge,
    nbVentes, nbRetours, nbAnnulations, montantAnnule, nbLignesSansCout,
    fondsOuverture, reglementsClients, autresEntrees, transfertsDepuisCoffre, versementsAuCoffre,
    reglementsFournisseurs, depensesPayees, remboursementsClients, autresSorties,
    totalEntrees, totalSorties, soldeTheorique, parMode, parJour, articles,
  } = stats;
  const period = labelRange(range);
  const now = new Date().toLocaleString('fr-FR');

  const dayRows = parJour.map((d, i) => `<tr>
    <td class="num c">${i + 1}</td>
    <td>${esc(formatDate(d.date))}</td>
    <td class="r num mc">${d.entrees > 0 ? '+ ' + fmtMoney(d.entrees) : '—'}</td>
    <td class="r num ${d.sorties > 0 ? 'mr' : 'muted'}">${d.sorties > 0 ? '− ' + fmtMoney(d.sorties) : '—'}</td>
    <td class="r num b">${fmtMoney(d.solde)}</td>
  </tr>`).join('');

  const modeRows = parMode.map((m) => `<tr>
    <td class="b">${esc(m.method)}</td>
    <td class="r num mc">${m.entrees > 0 ? '+ ' + fmtMoney(m.entrees) : '—'}</td>
    <td class="r num ${m.sorties > 0 ? 'mr' : 'muted'}">${m.sorties > 0 ? '− ' + fmtMoney(m.sorties) : '—'}</td>
    <td class="r num b">${fmtMoney(m.net)}</td>
  </tr>`).join('');

  const artRows = articles.slice(0, 50).map((a, i) => {
    const m = a.revenue - a.cost;
    const artMargin = showMargin
      ? `<td class="r num">${fmtMoney(m)}</td><td class="r num">${a.revenue > 0 ? Math.round((m / a.revenue) * 100) : 0} %</td>`
      : '';
    return `<tr>
      <td class="num c">${i + 1}</td>
      <td>${esc(a.name)}</td>
      <td class="r num">${fmtNum(a.qty)}</td>
      <td class="r num b">${fmtMoney(a.revenue)}</td>
      <td class="r num">${pct(a.revenue, caNet)}</td>
      ${artMargin}
    </tr>`;
  }).join('');

  const artMarginHeaders = showMargin ? '<th class="r">Marge</th><th class="r">Tx marge</th>' : '';
  const artTotalQty = articles.reduce((s, a) => s + a.qty, 0);
  const artTotalRev = articles.reduce((s, a) => s + a.revenue, 0);
  const artTotalCost = articles.reduce((s, a) => s + a.cost, 0);
  const artTotalMargin = artTotalRev - artTotalCost;
  const artTotalMarginCells = showMargin
    ? `<td class="r num">${fmtMoney(artTotalMargin)}</td><td></td>`
    : '';

  const kpiMarginCells = showMargin ? `
    <div class="kpi-cell">
      <div class="kpi-label">Marge brute</div>
      <div class="kpi-value">${fmtMoney(margeBrute)}</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-label">Taux de marge</div>
      <div class="kpi-value">${fmtRate(tauxMarge)}</div>
    </div>` : '';

  const annulationRow = nbAnnulations > 0 ? `
    <div class="kpi-cell"><div class="kpi-label">Annulations</div><div class="kpi-value">${fmtNum(nbAnnulations)} (${fmtMoney(montantAnnule)})</div></div>` : '';

  return `
    ${docHeader(tenant, 'Rapport de Caisse', 'Flux de trésorerie réels · Activité · Rentabilité', period, siteName)}

    <div class="section-title">Trésorerie réelle</div>
    <div class="kpi-row">
      <div class="kpi-cell"><div class="kpi-label">Solde initial</div><div class="kpi-value">${fmtMoney(fondsOuverture)}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Entrées réelles</div><div class="kpi-value">+ ${fmtMoney(totalEntrees)}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Sorties réelles</div><div class="kpi-value">− ${fmtMoney(totalSorties)}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Solde théorique</div><div class="kpi-value">${fmtMoney(soldeTheorique)}</div></div>
    </div>
    <table>
      <thead><tr><th>Mouvement de caisse</th><th class="r">Montant</th></tr></thead>
      <tbody>
        <tr><td>Fonds d'ouverture</td><td class="r num b">${fmtMoney(fondsOuverture)}</td></tr>
        <tr><td>Règlements clients encaissés</td><td class="r num mc">+ ${fmtMoney(reglementsClients)}</td></tr>
        <tr><td>Autres entrées</td><td class="r num mc">+ ${fmtMoney(autresEntrees)}</td></tr>
        ${transfertsDepuisCoffre > 0 ? `<tr><td>Transferts reçus du coffre</td><td class="r num mc">+ ${fmtMoney(transfertsDepuisCoffre)}</td></tr>` : ''}
        <tr><td class="b">Total des entrées</td><td class="r num b mc">+ ${fmtMoney(totalEntrees)}</td></tr>
        <tr><td>Règlements fournisseurs décaissés</td><td class="r num mr">− ${fmtMoney(reglementsFournisseurs)}</td></tr>
        <tr><td>Dépenses payées</td><td class="r num mr">− ${fmtMoney(depensesPayees)}</td></tr>
        <tr><td>Remboursements clients décaissés</td><td class="r num mr">− ${fmtMoney(remboursementsClients)}</td></tr>
        <tr><td>Autres sorties</td><td class="r num mr">− ${fmtMoney(autresSorties)}</td></tr>
        ${versementsAuCoffre > 0 ? `<tr><td>Versements au coffre</td><td class="r num mr">− ${fmtMoney(versementsAuCoffre)}</td></tr>` : ''}
        <tr><td class="b">Total des sorties</td><td class="r num b mr">− ${fmtMoney(totalSorties)}</td></tr>
        <tr class="total-row"><td class="b">SOLDE THÉORIQUE DE CAISSE</td><td class="r num">${fmtMoney(soldeTheorique)}</td></tr>
      </tbody>
    </table>

    <div class="section-title">Activité commerciale</div>
    <div class="kpi-row">
      <div class="kpi-cell"><div class="kpi-label">Ventes validées</div><div class="kpi-value">${fmtMoney(ventesValidees)}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Retours / avoirs</div><div class="kpi-value">${retours > 0 ? '− ' : ''}${fmtMoney(retours)}</div></div>
      <div class="kpi-cell"><div class="kpi-label">CA net</div><div class="kpi-value">${fmtMoney(caNet)}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Nb ventes</div><div class="kpi-value">${fmtNum(nbVentes)}</div></div>
      ${nbRetours > 0 ? `<div class="kpi-cell"><div class="kpi-label">Nb retours</div><div class="kpi-value">${fmtNum(nbRetours)}</div></div>` : ''}
      ${annulationRow}
    </div>

    ${showMargin ? `<div class="section-title">Rentabilité</div>
    <div class="kpi-row">
      <div class="kpi-cell"><div class="kpi-label">Coût des marchandises</div><div class="kpi-value">${fmtMoney(cogsNet)}</div></div>
      ${kpiMarginCells}
    </div>
    ${nbLignesSansCout > 0 ? `<div class="notice-warn">Marge non fiabilisée : ${fmtNum(nbLignesSansCout)} ligne(s) sans coût historique. Le taux de marge est probablement surévalué tant que ces coûts d'achat ne sont pas renseignés.</div>` : ''}` : ''}

    <div class="section-title">Évolution journalière de la caisse</div>
    <table>
      <thead><tr><th class="c">#</th><th>Date</th><th class="r">Entrées</th><th class="r">Sorties</th><th class="r">Solde du jour</th></tr></thead>
      <tbody>
        ${dayRows || '<tr><td colspan="5" class="c muted">Aucun mouvement sur la période</td></tr>'}
        ${parJour.length ? `<tr class="total-row">
          <td></td><td class="b">TOTAL</td>
          <td class="r num">+ ${fmtMoney(totalEntrees)}</td>
          <td class="r num">− ${fmtMoney(totalSorties)}</td>
          <td class="r num">${fmtMoney(totalEntrees - totalSorties)}</td>
        </tr>` : ''}
      </tbody>
    </table>

    <div class="section-title">Ventilation par mode de règlement</div>
    <table>
      <thead><tr><th>Mode de règlement</th><th class="r">Entrées</th><th class="r">Sorties</th><th class="r">Net</th></tr></thead>
      <tbody>${modeRows || '<tr><td colspan="4" class="c muted">Aucun mouvement</td></tr>'}</tbody>
    </table>

    <div class="section-title">Articles vendus — Top ${Math.min(50, articles.length)}</div>
    <table>
      <thead><tr><th class="c">#</th><th>Article</th><th class="r">Qté</th><th class="r">CA</th><th class="r">Part CA</th>${artMarginHeaders}</tr></thead>
      <tbody>
        ${artRows || '<tr><td colspan="5" class="c muted">Aucune vente</td></tr>'}
        ${articles.length ? `<tr class="total-row">
          <td></td><td class="b">TOTAL</td>
          <td class="r num">${fmtNum(artTotalQty)}</td>
          <td class="r num">${fmtMoney(artTotalRev)}</td>
          <td class="r">100 %</td>
          ${artTotalMarginCells}
        </tr>` : ''}
      </tbody>
    </table>
    ${docFooter(now)}`;
}

export function buildArticleReport(
  tenant: TenantMeta, range: DateRange, rows: ArticleStatRow[],
  showMargin: boolean, siteName?: string
): string {
  const period = labelRange(range);
  const now = new Date().toLocaleString('fr-FR');
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalReturned = rows.reduce((s, r) => s + r.qtyReturned, 0);
  const margin = totalRevenue - totalCost;

  const mHeader = showMargin ? '<th class="r">Marge</th><th class="r">Tx marge</th>' : '';
  const mTotalCell = showMargin
    ? `<td class="r num">${fmtMoney(margin)}</td><td></td>`
    : '';

  const tableRows = rows.map((r, i) => {
    const mCells = showMargin
      ? `<td class="r num">${fmtMoney(r.margin)}</td><td class="r num">${r.tauxMarge} %</td>`
      : '';
    return `<tr>
      <td class="num c">${i + 1}</td>
      <td>${esc(r.name)}</td>
      <td class="r num">${fmtNum(r.qty)}</td>
      ${r.qtyReturned > 0 ? `<td class="r num mr">${fmtNum(r.qtyReturned)}</td>` : '<td class="r muted">—</td>'}
      <td class="r num b">${fmtMoney(r.revenue)}</td>
      <td class="r num">${pct(r.revenue, totalRevenue)}</td>
      ${mCells}
    </tr>`;
  }).join('');

  const kpiMarginCell = showMargin ? `
    <div class="kpi-cell">
      <div class="kpi-label">Marge brute</div>
      <div class="kpi-value">${fmtMoney(margin)}</div>
    </div>` : '';

  return `
    ${docHeader(tenant, 'Rapport Articles', 'CA net par article (remises globales ventilées)', period, siteName)}
    <div class="kpi-row">
      <div class="kpi-cell"><div class="kpi-label">CA net</div><div class="kpi-value">${fmtMoney(totalRevenue)}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Quantité vendue</div><div class="kpi-value">${fmtNum(totalQty)}</div></div>
      ${showMargin
        ? kpiMarginCell + `<div class="kpi-cell"><div class="kpi-label">Références vendues</div><div class="kpi-value">${fmtNum(rows.length)}</div></div>`
        : `<div class="kpi-cell"><div class="kpi-label">Références vendues</div><div class="kpi-value">${fmtNum(rows.length)}</div></div>
           ${totalReturned > 0 ? `<div class="kpi-cell"><div class="kpi-label">Quantité retournée</div><div class="kpi-value">${fmtNum(totalReturned)}</div></div>` : ''}`}
    </div>
    <div class="section-title">Classement des articles — CA décroissant</div>
    <table>
      <thead><tr><th class="c">#</th><th>Article</th><th class="r">Qté vendue</th><th class="r">Qté retournée</th><th class="r">CA net</th><th class="r">Part CA</th>${mHeader}</tr></thead>
      <tbody>
        ${tableRows}
        <tr class="total-row">
          <td></td><td class="b">TOTAL</td>
          <td class="r num">${fmtNum(totalQty)}</td>
          <td class="r num">${totalReturned > 0 ? fmtNum(totalReturned) : '—'}</td>
          <td class="r num">${fmtMoney(totalRevenue)}</td>
          <td class="r">100 %</td>
          ${mTotalCell}
        </tr>
      </tbody>
    </table>
    ${docFooter(now)}`;
}

export function buildCustomerReport(
  tenant: TenantMeta, range: DateRange, stats: CustomerStats,
  showMargin: boolean, siteName?: string
): string {
  const period = labelRange(range);
  const now = new Date().toLocaleString('fr-FR');
  const { rows, totals, asOf } = stats;
  const tn = (k: string) => Number(totals?.[k]) || 0;
  const asOfLabel = formatDate(asOf);

  const activity = rows.filter((r) => r.nbVentes > 0 || r.retours > 0);
  const withSituation = rows.filter((r) => r.montantDu > 0 || r.creditDisponible > 0);

  const mHeader = showMargin ? '<th class="r">Marge</th>' : '';
  const actRows = activity.map((r, i) => {
    const mCell = showMargin ? `<td class="r num">${fmtMoney(r.marge)}</td>` : '';
    return `<tr>
      <td class="num c">${i + 1}</td>
      <td class="b">${esc(r.name)}</td>
      <td class="r num">${fmtNum(r.nbVentes)}</td>
      <td class="r num">${fmtMoney(r.caHt)}</td>
      <td class="r num ${r.remises > 0 ? 'mr' : 'muted'}">${r.remises > 0 ? fmtMoney(r.remises) : '—'}</td>
      <td class="r num ${r.retours > 0 ? 'mr' : 'muted'}">${r.retours > 0 ? fmtMoney(r.retours) : '—'}</td>
      <td class="r num b">${fmtMoney(r.caNet)}</td>
      ${mCell}
    </tr>`;
  }).join('');

  const sitRows = withSituation.map((r, i) => `<tr>
    <td class="num c">${i + 1}</td>
    <td class="b">${esc(r.name)}${r.status === 'prior_only' ? ' <span class="muted">— Solde antérieur — aucune activité sur la période</span>' : ''}</td>
    <td class="r num">${r.encaissements > 0 ? fmtMoney(r.encaissements) : '—'}</td>
    <td class="r num">${fmtMoney(r.soldeAnterieur)}</td>
    <td class="r num b">${r.montantDu > 0 ? fmtMoney(r.montantDu) : '—'}</td>
    <td class="r num ${r.creditDisponible > 0 ? '' : 'muted'}">${r.creditDisponible > 0 ? fmtMoney(r.creditDisponible) : '—'}</td>
    <td class="r num b">${r.soldeADate !== 0 ? fmtMoney(r.soldeADate) : '—'}</td>
  </tr>`).join('');

  const kpiMarginCell = showMargin ? `
    <div class="kpi-cell">
      <div class="kpi-label">Marge brute</div>
      <div class="kpi-value">${fmtMoney(tn('marge'))}</div>
    </div>` : '';

  return `
    ${docHeader(tenant, 'Rapport Clients', 'Activité de la période · Situation financière', period, siteName)}
    <div class="kpi-row">
      <div class="kpi-cell"><div class="kpi-label">CA net période</div><div class="kpi-value">${fmtMoney(tn('ca_net'))}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Encaissements période</div><div class="kpi-value">${fmtMoney(tn('encaissements'))}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Total dû au ${esc(asOfLabel)}</div><div class="kpi-value">${fmtMoney(tn('montant_du'))}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Crédit disponible</div><div class="kpi-value">${fmtMoney(tn('credit_disponible'))}</div></div>
      ${kpiMarginCell}
    </div>

    <div class="section-title">Activité de la période — CA net décroissant</div>
    <table>
      <thead><tr><th class="c">#</th><th>Client</th><th class="r">Nb ventes</th><th class="r">CA HT</th><th class="r">Remises</th><th class="r">Retours</th><th class="r">CA net</th>${mHeader}</tr></thead>
      <tbody>
        ${actRows || '<tr><td colspan="7" class="c muted">Aucune activité sur la période</td></tr>'}
        ${activity.length ? `<tr class="total-row">
          <td></td><td class="b">TOTAL</td>
          <td class="r num">${fmtNum(activity.reduce((s, r) => s + r.nbVentes, 0))}</td>
          <td class="r num">${fmtMoney(tn('ca_ht'))}</td>
          <td class="r num">${fmtMoney(tn('remises'))}</td>
          <td class="r num">${fmtMoney(tn('retours'))}</td>
          <td class="r num">${fmtMoney(tn('ca_net'))}</td>
          ${showMargin ? `<td class="r num">${fmtMoney(tn('marge'))}</td>` : ''}
        </tr>` : ''}
      </tbody>
    </table>

    <div class="section-title">Situation financière au ${esc(asOfLabel)}</div>
    <table>
      <thead><tr><th class="c">#</th><th>Client</th><th class="r">Encaissements</th><th class="r">Solde antérieur</th><th class="r">Montant dû</th><th class="r">Crédit dispo.</th><th class="r">Solde à date</th></tr></thead>
      <tbody>
        ${sitRows || '<tr><td colspan="7" class="c muted">Aucun solde</td></tr>'}
        ${withSituation.length ? `<tr class="total-row">
          <td></td><td class="b">TOTAL</td>
          <td class="r num">${fmtMoney(tn('encaissements'))}</td>
          <td></td>
          <td class="r num">${fmtMoney(tn('montant_du'))}</td>
          <td class="r num">${fmtMoney(tn('credit_disponible'))}</td>
          <td></td>
        </tr>` : ''}
      </tbody>
    </table>
    ${docFooter(now)}`;
}

export function buildSupplierReport(
  tenant: TenantMeta, range: DateRange, stats: SupplierStats, siteName?: string
): string {
  const period = labelRange(range);
  const now = new Date().toLocaleString('fr-FR');
  const { rows, totals, asOf } = stats;
  const tn = (k: string) => Number(totals?.[k]) || 0;
  const asOfLabel = formatDate(asOf);

  const tableRows = rows.map((r, i) => `<tr>
    <td class="num c">${i + 1}</td>
    <td class="b">${esc(r.name)}${r.status === 'prior_only' ? ' <span class="muted">— dette antérieure, aucun achat sur la période</span>' : ''}</td>
    <td class="r num">${fmtNum(r.nbCommandes)}</td>
    <td class="r num b">${fmtMoney(r.totalAchats)}</td>
    <td class="r num">${r.reglements > 0 ? fmtMoney(r.reglements) : '—'}</td>
    <td class="r num ${r.avances > 0 ? '' : 'muted'}">${r.avances > 0 ? fmtMoney(r.avances) : '—'}</td>
    <td class="r num">${fmtMoney(r.detteAnterieure)}</td>
    <td class="r num b">${r.detteADate > 0 ? fmtMoney(r.detteADate) : '—'}</td>
  </tr>`).join('');

  return `
    ${docHeader(tenant, 'Rapport Fournisseurs', 'Achats · Règlements · Dette', period, siteName)}
    <div class="kpi-row">
      <div class="kpi-cell"><div class="kpi-label">Achats de la période</div><div class="kpi-value">${fmtMoney(tn('total_achats'))}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Règlements</div><div class="kpi-value">${fmtMoney(tn('reglements'))}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Dette antérieure</div><div class="kpi-value">${fmtMoney(tn('dette_anterieure'))}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Dette au ${esc(asOfLabel)}</div><div class="kpi-value">${fmtMoney(tn('dette_a_date'))}</div></div>
    </div>
    <div class="section-title">Fournisseurs — achats & dette au ${esc(asOfLabel)}</div>
    <table>
      <thead><tr><th class="c">#</th><th>Fournisseur</th><th class="r">Commandes</th><th class="r">Achats période</th><th class="r">Règlements</th><th class="r">Avances</th><th class="r">Dette antérieure</th><th class="r">Dette à date</th></tr></thead>
      <tbody>
        ${tableRows || '<tr><td colspan="8" class="c muted">Aucun fournisseur</td></tr>'}
        ${rows.length ? `<tr class="total-row">
          <td></td><td class="b">TOTAL</td>
          <td class="r num">${fmtNum(rows.reduce((s, r) => s + r.nbCommandes, 0))}</td>
          <td class="r num">${fmtMoney(tn('total_achats'))}</td>
          <td class="r num">${fmtMoney(tn('reglements'))}</td>
          <td class="r num">${fmtMoney(tn('avances'))}</td>
          <td></td>
          <td class="r num">${fmtMoney(tn('dette_a_date'))}</td>
        </tr>` : ''}
      </tbody>
    </table>
    ${docFooter(now)}`;
}

export function buildExpenseReport(
  tenant: TenantMeta, range: DateRange, stats: ExpenseStats, siteName?: string
): string {
  const {
    ventesValidees, retours, caNet, cogsNet, margeBrute, tauxMarge,
    chargesExploitation, resultatExploitation, nbLignesSansCout,
    expensesTotal, expensesCount, byCategory, byMode, detail,
  } = stats;
  const period = labelRange(range);
  const now = new Date().toLocaleString('fr-FR');
  const topCategory = byCategory.slice().sort((a, b) => b.amount - a.amount)[0];

  const catRows = byCategory.map((c, i) => `<tr>
    <td class="num c">${i + 1}</td>
    <td class="b">${esc(c.category)}</td>
    <td class="r num">${fmtNum(c.count)}</td>
    <td class="r num b">${fmtMoney(c.amount)}</td>
    <td class="r num">${pct(c.amount, expensesTotal)}</td>
  </tr>`).join('');

  const modeRows = byMode.map((m) => `<tr>
    <td class="b">${esc(m.method)}</td>
    <td class="r num">${fmtNum(m.count)}</td>
    <td class="r num b">${fmtMoney(m.amount)}</td>
    <td class="r num">${pct(m.amount, expensesTotal)}</td>
  </tr>`).join('');

  const detailRows = detail.slice(0, 200).map((d, i) => `<tr>
    <td class="num c">${i + 1}</td>
    <td>${esc(new Date(d.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))}</td>
    <td class="b">${esc(d.category)}</td>
    <td>${esc(d.method)}</td>
    <td class="muted">${esc(d.note || '—')}</td>
    <td class="r num b">${fmtMoney(d.amount)}</td>
  </tr>`).join('');

  return `
    ${docHeader(tenant, 'Rapport des Dépenses', "Charges d'exploitation · Résultat", period, siteName)}

    <div class="kpi-row">
      <div class="kpi-cell"><div class="kpi-label">Dépenses validées</div><div class="kpi-value">${fmtMoney(expensesTotal)}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Nombre de dépenses</div><div class="kpi-value">${fmtNum(expensesCount)}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Catégorie principale</div><div class="kpi-value">${topCategory ? esc(topCategory.category) : '—'}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Résultat d'exploitation</div><div class="kpi-value">${fmtMoney(resultatExploitation)}</div></div>
    </div>

    <div class="section-title">Synthèse — Résultat d'exploitation</div>
    <table>
      <thead><tr><th>Élément</th><th class="r">Montant</th></tr></thead>
      <tbody>
        <tr><td>Ventes validées</td><td class="r num b">${fmtMoney(ventesValidees)}</td></tr>
        <tr><td>Retours / avoirs</td><td class="r num mr">− ${fmtMoney(retours)}</td></tr>
        <tr><td class="b">CA net</td><td class="r num b">${fmtMoney(caNet)}</td></tr>
        <tr><td>Coût des marchandises</td><td class="r num mr">− ${fmtMoney(cogsNet)}</td></tr>
        <tr><td class="b">Marge brute</td><td class="r num">${fmtMoney(margeBrute)}</td></tr>
        <tr><td>Charges d'exploitation</td><td class="r num mr">− ${fmtMoney(chargesExploitation)}</td></tr>
        <tr class="total-row"><td class="b">RÉSULTAT D'EXPLOITATION</td><td class="r num">${fmtMoney(resultatExploitation)}</td></tr>
      </tbody>
    </table>
    ${nbLignesSansCout > 0 ? `<div class="notice-warn">Marge non fiabilisée : ${fmtNum(nbLignesSansCout)} ligne(s) sans coût historique. Le taux de marge (${fmtRate(tauxMarge)}) est probablement surévalué tant que ces coûts d'achat ne sont pas renseignés.</div>` : ''}

    <div class="section-title">Dépenses d'exploitation par catégorie</div>
    <table>
      <thead><tr><th class="c">#</th><th>Catégorie</th><th class="r">Nombre</th><th class="r">Montant</th><th class="r">Part</th></tr></thead>
      <tbody>
        ${catRows || '<tr><td colspan="5" class="c muted">Aucune dépense sur la période</td></tr>'}
        ${byCategory.length ? `<tr class="total-row">
          <td></td><td class="b">TOTAL</td>
          <td class="r num">${fmtNum(byCategory.reduce((s, c) => s + c.count, 0))}</td>
          <td class="r num">${fmtMoney(expensesTotal)}</td>
          <td class="r">100 %</td>
        </tr>` : ''}
      </tbody>
    </table>

    ${byMode.length ? `<div class="section-title">Dépenses par mode de règlement</div>
    <table>
      <thead><tr><th>Mode de règlement</th><th class="r">Nombre</th><th class="r">Montant</th><th class="r">Part</th></tr></thead>
      <tbody>${modeRows}</tbody>
    </table>` : ''}

    <div class="section-title">Détail des dépenses${detail.length > 200 ? ` — 200 premières sur ${detail.length}` : ''}</div>
    <table>
      <thead><tr><th class="c">#</th><th>Date</th><th>Catégorie</th><th>Mode</th><th>Motif / note</th><th class="r">Montant</th></tr></thead>
      <tbody>
        ${detailRows || '<tr><td colspan="6" class="c muted">Aucune dépense sur la période</td></tr>'}
      </tbody>
    </table>
    ${docFooter(now)}`;
}

export function buildTiersBalanceReport(
  tenant: TenantMeta, _range: DateRange, stats: TiersStats,
  siteName: string | undefined, hideZero: boolean,
): string {
  const now = new Date().toLocaleString('fr-FR');
  const { customers, suppliers, totals, asOf } = stats;
  const asOfLabel = formatDate(asOf);

  const custDue = Number(totals?.customers?.due) || 0;
  const custCredit = Number(totals?.customers?.credit) || 0;
  const supDue = Number(totals?.suppliers?.due) || 0;
  const supAdvance = Number(totals?.suppliers?.advance) || 0;
  const netPosition = custDue - supDue;
  const nonZeroCount = customers.length + suppliers.length;

  const filterFn = (r: TiersRow) => !hideZero || r.net !== 0;
  const shownCustomers = customers.filter(filterFn);
  const shownSuppliers = suppliers.filter(filterFn);

  const custRows = shownCustomers.map((r, i) => `<tr>
    <td class="num c">${i + 1}</td>
    <td class="b">${esc(r.name)}</td>
    <td class="r num b">${r.due > 0 ? fmtMoney(r.due) : '—'}</td>
    <td class="r num ${r.credit > 0 ? '' : 'muted'}">${r.credit > 0 ? fmtMoney(r.credit) : '—'}</td>
  </tr>`).join('');

  const supRows = shownSuppliers.map((r, i) => `<tr>
    <td class="num c">${i + 1}</td>
    <td class="b">${esc(r.name)}</td>
    <td class="r num b">${r.due > 0 ? fmtMoney(r.due) : '—'}</td>
    <td class="r num ${r.credit > 0 ? '' : 'muted'}">${r.credit > 0 ? fmtMoney(r.credit) : '—'}</td>
  </tr>`).join('');

  return `
    ${docHeader(tenant, 'Balance des Tiers', `Situation au ${asOfLabel}`, `Situation au ${asOfLabel}`, siteName)}
    <div class="kpi-row">
      <div class="kpi-cell"><div class="kpi-label">Créances clients</div><div class="kpi-value">${fmtMoney(custDue)}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Crédits clients</div><div class="kpi-value">${fmtMoney(custCredit)}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Dettes fournisseurs</div><div class="kpi-value">${fmtMoney(supDue)}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Position nette</div><div class="kpi-value">${fmtMoney(netPosition)}</div></div>
    </div>

    <div class="section-title">Créances clients — Situation au ${esc(asOfLabel)}${hideZero ? ' (soldes non nuls)' : ''}</div>
    <table>
      <thead><tr><th class="c">#</th><th>Client</th><th class="r">Montant dû</th><th class="r">Crédit / avoir</th></tr></thead>
      <tbody>
        ${custRows || '<tr><td colspan="4" class="c muted">Aucun client avec solde</td></tr>'}
        ${shownCustomers.length ? `<tr class="total-row"><td></td><td class="b">TOTAL</td><td class="r num">${fmtMoney(custDue)}</td><td class="r num">${fmtMoney(custCredit)}</td></tr>` : ''}
      </tbody>
    </table>

    <div class="section-title">Dettes fournisseurs — Situation au ${esc(asOfLabel)}${hideZero ? ' (soldes non nuls)' : ''}</div>
    <table>
      <thead><tr><th class="c">#</th><th>Fournisseur</th><th class="r">Dette</th><th class="r">Avance</th></tr></thead>
      <tbody>
        ${supRows || '<tr><td colspan="4" class="c muted">Aucun fournisseur avec solde</td></tr>'}
        ${shownSuppliers.length ? `<tr class="total-row"><td></td><td class="b">TOTAL</td><td class="r num">${fmtMoney(supDue)}</td><td class="r num">${fmtMoney(supAdvance)}</td></tr>` : ''}
      </tbody>
    </table>

    <div class="section-title">Synthèse — ${fmtNum(nonZeroCount)} tiers</div>
    <table>
      <thead><tr><th>Élément</th><th class="r">Montant</th></tr></thead>
      <tbody>
        <tr><td class="b">Total créances clients</td><td class="r num">${fmtMoney(custDue)}</td></tr>
        <tr><td class="b">Total dettes fournisseurs</td><td class="r num">${fmtMoney(supDue)}</td></tr>
        <tr class="total-row"><td class="b">POSITION NETTE (créances − dettes)</td><td class="r num">${fmtMoney(netPosition)}</td></tr>
      </tbody>
    </table>
    ${docFooter(now)}`;
}

export function buildReportHtml(
  data: ReportData, tenant: TenantMeta, range: DateRange,
  showMargin: boolean, siteName: string | undefined, hideZero: boolean,
): string {
  switch (data.type) {
    case 'cash': return buildCashReport(tenant, range, data.stats, showMargin, siteName);
    case 'articles': return buildArticleReport(tenant, range, data.rows, showMargin, siteName);
    case 'customers': return buildCustomerReport(tenant, range, data.stats, showMargin, siteName);
    case 'suppliers': return buildSupplierReport(tenant, range, data.stats, siteName);
    case 'expenses': return buildExpenseReport(tenant, range, data.stats, siteName);
    case 'tiers_balance': return buildTiersBalanceReport(tenant, range, data.stats, siteName, hideZero);
  }
}
