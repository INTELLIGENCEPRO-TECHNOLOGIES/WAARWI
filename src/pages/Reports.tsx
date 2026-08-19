import { useEffect, useRef, useState } from 'react';
import {
  Loader2, Printer, Eye, BarChart3,
  Calendar, ChevronDown, Monitor, Store, Check, X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { formatDate } from '../lib/format';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import { BUSINESS_TYPE_LABELS } from '../lib/types';

// ── helpers ────────────────────────────────────────────────────────────────────

const fmtNum = (n: number) => n.toLocaleString('fr-FR');
const fmtMoney = (n: number) => (Number(n) || 0).toLocaleString('fr-FR');
const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (n: number, d: number) =>
  d === 0 ? '0 %' : `${Math.round((n / d) * 100)} %`;

type DateRange = { from: Date; to: Date };
function isoDate(d: Date) { return d.toISOString().split('T')[0]; }
function labelRange(r: DateRange) {
  return `${formatDate(r.from)} — ${formatDate(r.to)}`;
}

// ── A4 document engine ─────────────────────────────────────────────────────────

interface TenantMeta {
  name: string; legal_name?: string; ninea?: string; rccm?: string;
  address?: string; phone?: string; email?: string; website?: string;
  logo_url?: string; business_type?: string;
}

function a4Style(): string {
  return `
    @page { size: A4 portrait; margin: 16mm 18mm 20mm 18mm; }
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', 'Helvetica Neue', sans-serif;
      font-size: 8.5pt;
      color: #111827;
      line-height: 1.45;
      background: #fff;
    }
    .page { width: 100%; }
    .doc-header {
      display: flex; align-items: flex-start; gap: 14px;
      padding-bottom: 10px; border-bottom: 2.5px solid #1e3a5f; margin-bottom: 12px;
    }
    .logo-wrap img { max-width: 56px; max-height: 40px; object-fit: contain; display: block; }
    .company-block { flex: 1; }
    .company-name { font-size: 13pt; font-weight: 900; color: #1e3a5f; letter-spacing: -0.3px; line-height: 1.2; }
    .company-sub { font-size: 7pt; color: #6b7280; margin-top: 2px; line-height: 1.4; }
    .doc-meta { text-align: right; min-width: 130px; }
    .doc-title { font-size: 13pt; font-weight: 900; color: #1e3a5f; text-transform: uppercase; letter-spacing: 0.5px; }
    .doc-subtitle { font-size: 7pt; color: #6b7280; margin-top: 3px; }
    .doc-period { font-size: 7.5pt; color: #374151; font-weight: 700; margin-top: 3px; }
    .doc-site { font-size: 6.5pt; color: #9ca3af; margin-top: 2px; }
    .kpi-row { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
    .kpi-cell {
      flex: 1; min-width: 90px; border: 1px solid #e5e7eb;
      border-radius: 5px; padding: 7px 9px; background: #fafafa;
    }
    .kpi-cell.accent { background: #f0f7ff; border-color: #bfdbfe; }
    .kpi-cell.success { background: #f0fdf4; border-color: #bbf7d0; }
    .kpi-cell.danger  { background: #fff5f5; border-color: #fecaca; }
    .kpi-label { font-size: 6pt; text-transform: uppercase; letter-spacing: 0.6px; color: #9ca3af; font-weight: 700; margin-bottom: 3px; }
    .kpi-value { font-size: 10pt; font-weight: 900; color: #1e3a5f; line-height: 1.1; }
    .kpi-value.green { color: #065f46; }
    .kpi-value.red   { color: #991b1b; }
    .section-title {
      font-size: 7.5pt; font-weight: 900; text-transform: uppercase; letter-spacing: 0.7px;
      color: #374151; background: #f1f5f9; padding: 4px 8px;
      border-left: 3px solid #1e3a5f; margin: 12px 0 6px;
    }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    thead th {
      font-size: 6.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.4px;
      color: #374151; background: #f8fafc; padding: 5px 6px;
      border-bottom: 1.5px solid #cbd5e1; white-space: nowrap;
    }
    tbody td {
      font-size: 7.5pt; padding: 3.5px 6px; border-bottom: 0.5px solid #f1f5f9; vertical-align: middle;
    }
    tbody tr:nth-child(even) td { background: #fafafa; }
    tbody tr:last-child td { border-bottom: 1px solid #cbd5e1; }
    .num  { font-variant-numeric: tabular-nums; }
    .r    { text-align: right; }
    .c    { text-align: center; }
    .b    { font-weight: 700; }
    .muted { color: #9ca3af; font-size: 7pt; }
    .total-row td {
      font-weight: 800; font-size: 8pt; background: #eff6ff !important;
      border-top: 1.5px solid #1e3a5f;
    }
    .doc-footer {
      margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb;
      display: flex; justify-content: space-between; align-items: flex-end;
    }
    .footer-note { font-size: 6pt; color: #9ca3af; }
    .waarwi-brand { font-size: 5.5pt; color: #d1d5db; text-align: right; }
    .mc  { color: #065f46; font-weight: 700; }
    .mr  { color: #991b1b; font-weight: 700; }
  `;
}

function docHeader(
  tenant: TenantMeta, title: string, subtitle: string, period: string, siteName?: string
) {
  const activity = BUSINESS_TYPE_LABELS[tenant.business_type || 'generic'] || 'Commerce';
  const logo = tenant.logo_url
    ? `<div class="logo-wrap"><img src="${esc(tenant.logo_url)}" alt="" onerror="this.style.display='none'"/></div>`
    : '';
  const legal = tenant.legal_name && tenant.legal_name !== tenant.name
    ? `<div class="company-sub">${esc(tenant.legal_name)}</div>` : '';
  const meta = [
    tenant.address,
    tenant.phone ? `Tél: ${tenant.phone}` : '',
    tenant.email,
    tenant.ninea ? `NINEA: ${tenant.ninea}` : '',
    tenant.rccm ? `RCCM: ${tenant.rccm}` : '',
  ].filter(Boolean).join('  ·  ');

  const siteHtml = siteName
    ? `<div class="doc-site">Site : ${esc(siteName)}</div>`
    : `<div class="doc-site">Tous les magasins / sites</div>`;

  return `
    <div class="doc-header">
      ${logo}
      <div class="company-block">
        <div class="company-name">${esc(tenant.name)}</div>
        ${legal}
        <div class="company-sub">${esc(activity)}</div>
        ${meta ? `<div class="company-sub" style="margin-top:4px">${esc(meta)}</div>` : ''}
      </div>
      <div class="doc-meta">
        <div class="doc-title">${esc(title)}</div>
        <div class="doc-subtitle">${esc(subtitle)}</div>
        <div class="doc-period">${esc(period)}</div>
        ${siteHtml}
      </div>
    </div>`;
}

function docFooter(generatedAt: string): string {
  return `
    <div class="doc-footer">
      <div class="footer-note">Généré le ${esc(generatedAt)} · Document confidentiel</div>
      <div class="waarwi-brand">Propulsé par WAARWI — Plateforme Business 2.0 made in Sénégal</div>
    </div>`;
}

function printDoc(html: string): void {
  const w = window.open('', '_blank', 'width=960,height=720');
  if (!w) return;
  w.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>État</title>` +
    `<style>${a4Style()}</style></head><body><div class="page">${html}</div></body></html>`
  );
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 450);
}

// ── Data fetching ──────────────────────────────────────────────────────────────

async function fetchCashStats(
  tenantId: string, siteId: string | undefined, from: string, to: string
) {
  // 1. Central financial engine for KPIs
  const summaryP = supabase.rpc('get_financial_summary', {
    p_site_id: siteId || null, p_from: from, p_to: to,
  });

  // 2. Daily breakdown + payment methods (granular, not in RPC)
  let q = supabase
    .from('sales')
    .select('id, total, status, created_at, sale_items(unit_price, quantity, discount, purchase_cost, article_id, name:articles(name)), sale_payments(method_name, amount)')
    .eq('tenant_id', tenantId)
    .in('status', ['paid', 'partial', 'validated'])
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`)
    .order('created_at');
  if (siteId) q = q.eq('site_id', siteId);

  let rq = supabase
    .from('sale_returns')
    .select('id, total, created_at, refund_method, sale_return_items(article_id, quantity, unit_price, purchase_cost)')
    .eq('tenant_id', tenantId)
    .eq('status', 'approved')
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`);
  if (siteId) rq = rq.eq('site_id', siteId);

  const [summaryRes, salesRes, returnsRes] = await Promise.all([summaryP, q, rq]);
  if (summaryRes.error) throw summaryRes.error;
  if (salesRes.error) throw salesRes.error;

  const summary = summaryRes.data as any;
  const data = salesRes.data || [];
  const returns = returnsRes.data || [];

  const byDay = new Map<string, { revenue: number; txCount: number; cost: number; paid: number; credit: number }>();
  const byMethod = new Map<string, number>();
  const byArticle = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
  let totalPaid = 0, totalCredit = 0;

  for (const row of data) {
    const day = row.created_at.split('T')[0];
    const rev = row.total || 0;
    const rowCost = ((row.sale_items || []) as any[])
      .reduce((s: number, i: any) => s + ((i.purchase_cost || 0) * i.quantity), 0);
    const paidSum = ((row.sale_payments || []) as any[]).reduce((s: number, p: any) => s + (p.amount || 0), 0);
    const rowPaid = row.status === 'paid' ? rev : paidSum;
    const rowCredit = Math.max(0, rev - paidSum);
    totalPaid += rowPaid; totalCredit += rowCredit;

    const prev = byDay.get(day) || { revenue: 0, txCount: 0, cost: 0, paid: 0, credit: 0 };
    byDay.set(day, {
      revenue: prev.revenue + rev, txCount: prev.txCount + 1,
      cost: prev.cost + rowCost, paid: prev.paid + rowPaid, credit: prev.credit + rowCredit,
    });

    for (const p of ((row.sale_payments || []) as any[])) {
      const m = p.method_name || 'Autre';
      byMethod.set(m, (byMethod.get(m) || 0) + (p.amount || 0));
    }

    for (const item of ((row.sale_items || []) as any[])) {
      const artId = item.article_id || '__unknown__';
      const artName = (item.name as any)?.name || artId;
      const artRev = (item.unit_price * item.quantity) - (item.discount || 0);
      const artCost = (item.purchase_cost || 0) * item.quantity;
      const ap = byArticle.get(artId) || { name: artName, qty: 0, revenue: 0, cost: 0 };
      byArticle.set(artId, { name: artName, qty: ap.qty + item.quantity, revenue: ap.revenue + artRev, cost: ap.cost + artCost });
    }
  }

  for (const ret of returns) {
    const retTotal = Number(ret.total) || 0;
    const day = ret.created_at.split('T')[0];
    const retCost = ((ret.sale_return_items || []) as any[])
      .reduce((s: number, i: any) => s + ((i.purchase_cost || 0) * i.quantity), 0);
    totalPaid -= retTotal;

    const prev = byDay.get(day) || { revenue: 0, txCount: 0, cost: 0, paid: 0, credit: 0 };
    byDay.set(day, {
      revenue: prev.revenue - retTotal, txCount: prev.txCount,
      cost: prev.cost - retCost, paid: prev.paid - retTotal, credit: prev.credit,
    });

    const method = ret.refund_method === 'cash' ? 'Espèces' : ret.refund_method || 'Espèces';
    byMethod.set(method, (byMethod.get(method) || 0) - retTotal);

    for (const item of ((ret.sale_return_items || []) as any[])) {
      const artId = item.article_id || '__unknown__';
      const artRev = item.unit_price * item.quantity;
      const artCost = (item.purchase_cost || 0) * item.quantity;
      const ap = byArticle.get(artId);
      if (ap) {
        byArticle.set(artId, { name: ap.name, qty: ap.qty - item.quantity, revenue: ap.revenue - artRev, cost: ap.cost - artCost });
      }
    }
  }

  return {
    ventesValidees: Number(summary.ventes_validees) || 0,
    retours: Number(summary.retours) || 0,
    caNet: Number(summary.ca_net) || 0,
    cogsNet: Number(summary.cogs_net) || 0,
    margeBrute: Number(summary.marge_brute) || 0,
    tauxMarge: Number(summary.taux_marge) || 0,
    nbVentes: Number(summary.nb_ventes) || 0,
    nbRetours: Number(summary.nb_retours) || 0,
    nbAnnulations: Number(summary.nb_annulations) || 0,
    montantAnnule: Number(summary.montant_annule) || 0,
    totalPaid, totalCredit,
    byDay: Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, ...v })),
    byMethod: Array.from(byMethod.entries())
      .filter(([, amount]) => amount !== 0)
      .sort((a, b) => b[1] - a[1])
      .map(([method, amount]) => ({ method, amount })),
    byArticle: Array.from(byArticle.values())
      .filter(a => a.qty > 0 || a.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue),
  };
}

async function fetchArticleStats(
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

async function fetchCustomerStats(
  tenantId: string, siteId: string | undefined, from: string, to: string
) {
  let q = supabase
    .from('sales')
    .select('id, customer_id, customers(name), total, status, sale_items(unit_price, quantity, purchase_cost), sale_payments(amount)')
    .eq('tenant_id', tenantId)
    .neq('status', 'cancelled')
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`);
  if (siteId) q = q.eq('site_id', siteId);
  const { data, error } = await q;
  if (error) throw error;

  // Fetch approved returns
  let rq = supabase
    .from('sale_returns')
    .select('id, total, customer_id, sale_return_items(quantity, purchase_cost)')
    .eq('tenant_id', tenantId)
    .eq('status', 'approved')
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`);
  if (siteId) rq = rq.eq('site_id', siteId);
  const { data: returns } = await rq;

  const map = new Map<string, { name: string; txCount: number; revenue: number; paid: number; credit: number; cost: number }>();
  for (const row of (data || [])) {
    const key = row.customer_id || '__counter__';
    const name = row.customer_id ? ((row.customers as any)?.name || 'Client supprimé') : 'Comptoir';
    const rev = row.total || 0;
    const cost = ((row.sale_items || []) as any[]).reduce((s: number, i: any) => s + ((i.purchase_cost || 0) * i.quantity), 0);
    const paidSum = ((row.sale_payments || []) as any[]).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    const paid = row.status === 'paid' ? rev : Math.min(paidSum, rev);
    const credit = Math.max(0, rev - paid);
    const prev = map.get(key) || { name, txCount: 0, revenue: 0, paid: 0, credit: 0, cost: 0 };
    map.set(key, { name, txCount: prev.txCount + 1, revenue: prev.revenue + rev, paid: prev.paid + paid, credit: prev.credit + credit, cost: prev.cost + cost });
  }

  // Subtract returns per customer
  for (const ret of (returns || [])) {
    const key = ret.customer_id || '__counter__';
    const retTotal = Number(ret.total) || 0;
    const retCost = ((ret.sale_return_items || []) as any[])
      .reduce((s: number, i: any) => s + ((i.purchase_cost || 0) * i.quantity), 0);
    const prev = map.get(key);
    if (prev) {
      map.set(key, { ...prev, revenue: prev.revenue - retTotal, paid: prev.paid - retTotal, cost: prev.cost - retCost });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
}

async function fetchSupplierStats(tenantId: string, from: string, to: string) {
  const { data, error } = await supabase
    .from('supplier_orders')
    .select('id, supplier_id, suppliers(name), total, status, created_at, supplier_payments(amount)')
    .eq('tenant_id', tenantId)
    .neq('status', 'cancelled')
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`);
  if (error) throw error;

  const map = new Map<string, { name: string; orderCount: number; totalOrdered: number; totalPaid: number }>();
  for (const row of (data || [])) {
    const key = row.supplier_id;
    const name = (row.suppliers as any)?.name || 'Fournisseur inconnu';
    const ordered = row.total || 0;
    const paid = ((row.supplier_payments || []) as any[]).reduce((s: number, p: any) => s + (p.amount || 0), 0);
    const prev = map.get(key) || { name, orderCount: 0, totalOrdered: 0, totalPaid: 0 };
    map.set(key, { name, orderCount: prev.orderCount + 1, totalOrdered: prev.totalOrdered + ordered, totalPaid: prev.totalPaid + paid });
  }
  return Array.from(map.values()).sort((a, b) => b.totalOrdered - a.totalOrdered);
}

async function fetchExpenseStats(
  tenantId: string, siteId: string | undefined, from: string, to: string
) {
  // 1. Financial summary from the central engine (source of truth)
  const { data: summaryRaw, error: summaryErr } = await supabase.rpc('get_financial_summary', {
    p_site_id: siteId || null,
    p_from: from,
    p_to: to,
  });
  if (summaryErr) throw summaryErr;
  const summary = summaryRaw as any;

  // 2. Expense detail by category (kind='expense' only, never 'refund')
  let movQ = supabase
    .from('cash_movements')
    .select('amount, reason, note, created_at, expense_category_id, expense_categories(name)')
    .eq('tenant_id', tenantId)
    .eq('kind', 'expense')
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`)
    .order('created_at');
  if (siteId) movQ = movQ.eq('site_id', siteId);
  const { data: movData, error: movErr } = await movQ;
  if (movErr) throw movErr;

  const byCategory = new Map<string, { count: number; amount: number }>();
  const detail: { date: string; category: string; note: string; amount: number }[] = [];
  let detailTotal = 0;

  for (const m of (movData || []) as any[]) {
    const category = (m.expense_categories as any)?.name || m.reason || 'Non catégorisé';
    const amount = Number(m.amount) || 0;
    detailTotal += amount;
    const prev = byCategory.get(category) || { count: 0, amount: 0 };
    byCategory.set(category, { count: prev.count + 1, amount: prev.amount + amount });
    detail.push({
      date: m.created_at,
      category,
      note: [m.reason && m.reason !== category ? m.reason : '', m.note].filter(Boolean).join(' · '),
      amount,
    });
  }

  const ventesValidees = Number(summary.ventes_validees) || 0;
  const retours = Number(summary.retours) || 0;
  const caNet = Number(summary.ca_net) || 0;
  const cogsNet = Number(summary.cogs_net) || 0;
  const margeBrute = Number(summary.marge_brute) || 0;
  const tauxMarge = Number(summary.taux_marge) || 0;
  const chargesExploitation = Number(summary.charges_exploitation) || 0;
  const resultatExploitation = Number(summary.resultat_exploitation) || 0;

  return {
    ventesValidees, retours, caNet, cogsNet, margeBrute, tauxMarge,
    chargesExploitation, resultatExploitation,
    byCategory: Array.from(byCategory.entries())
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([category, v]) => ({ category, ...v })),
    detail,
  };
}

// ── Report HTML builders ───────────────────────────────────────────────────────

function buildCashReport(
  tenant: TenantMeta, range: DateRange,
  stats: Awaited<ReturnType<typeof fetchCashStats>>,
  showMargin: boolean, siteName?: string
): string {
  const {
    ventesValidees, retours, caNet, cogsNet, margeBrute, tauxMarge,
    nbVentes, nbRetours, nbAnnulations, montantAnnule,
    totalPaid, totalCredit, byDay, byMethod, byArticle,
  } = stats;
  const period = labelRange(range);
  const now = new Date().toLocaleString('fr-FR');

  const mHeader = showMargin ? '<th class="r">Marge (FCFA)</th>' : '';
  const mTotal = (v: number) => showMargin ? `<td class="r num ${v >= 0 ? 'mc' : 'mr'}">${fmtMoney(v)}</td>` : '';

  const dayRows = byDay.map((d, i) => {
    const m = d.revenue - d.cost;
    return `<tr>
      <td class="num c">${i + 1}</td>
      <td>${esc(formatDate(d.date))}</td>
      <td class="r num">${fmtNum(d.txCount)}</td>
      <td class="r num b">${fmtMoney(d.revenue)}</td>
      <td class="r num">${fmtMoney(d.paid)}</td>
      <td class="r num ${d.credit > 0 ? 'mr' : 'muted'}">${d.credit > 0 ? fmtMoney(d.credit) : '—'}</td>
      ${mTotal(m)}
    </tr>`;
  }).join('');

  const methodRows = byMethod.map(m => `<tr>
    <td class="b">${esc(m.method)}</td>
    <td class="r num b">${fmtMoney(m.amount)}</td>
    <td class="r num">${pct(m.amount, totalPaid)}</td>
  </tr>`).join('');

  const artRows = byArticle.slice(0, 50).map((a, i) => {
    const m = a.revenue - a.cost;
    const artMargin = showMargin
      ? `<td class="r num ${m >= 0 ? 'mc' : 'mr'}">${fmtMoney(m)}</td><td class="r num ${m >= 0 ? 'mc' : 'mr'}">${a.revenue > 0 ? Math.round((m / a.revenue) * 100) : 0} %</td>`
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

  const artMarginHeaders = showMargin ? '<th class="r">Marge (FCFA)</th><th class="r">Tx marge</th>' : '';
  const artTotalQty = byArticle.reduce((s, a) => s + a.qty, 0);
  const artTotalRev = byArticle.reduce((s, a) => s + a.revenue, 0);
  const artTotalCost = byArticle.reduce((s, a) => s + a.cost, 0);
  const artTotalMargin = artTotalRev - artTotalCost;
  const artTotalMarginCells = showMargin
    ? `<td class="r num ${artTotalMargin >= 0 ? 'mc' : 'mr'}">${fmtMoney(artTotalMargin)}</td><td></td>`
    : '';

  const kpiMarginCells = showMargin ? `
    <div class="kpi-cell success">
      <div class="kpi-label">Marge brute</div>
      <div class="kpi-value ${margeBrute >= 0 ? 'green' : 'red'}">${fmtMoney(margeBrute)} FCFA</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-label">Taux de marge</div>
      <div class="kpi-value ${margeBrute >= 0 ? 'green' : 'red'}">${tauxMarge} %</div>
    </div>` : '';

  const annulationRow = nbAnnulations > 0 ? `
    <div class="kpi-cell"><div class="kpi-label">Annulations</div><div class="kpi-value">${fmtNum(nbAnnulations)} (${fmtMoney(montantAnnule)} FCFA)</div></div>` : '';

  return `
    ${docHeader(tenant, 'Statistiques de Caisse', 'Activité · Rentabilité · Encaissements · Articles', period, siteName)}

    <div class="section-title">Activité commerciale</div>
    <div class="kpi-row">
      <div class="kpi-cell accent"><div class="kpi-label">Ventes validées</div><div class="kpi-value">${fmtMoney(ventesValidees)} FCFA</div></div>
      <div class="kpi-cell ${retours > 0 ? 'danger' : ''}"><div class="kpi-label">Retours / avoirs</div><div class="kpi-value ${retours > 0 ? 'red' : ''}">${retours > 0 ? '− ' : ''}${fmtMoney(retours)} FCFA</div></div>
      <div class="kpi-cell accent"><div class="kpi-label">CA net</div><div class="kpi-value">${fmtMoney(caNet)} FCFA</div></div>
      <div class="kpi-cell"><div class="kpi-label">Nb ventes</div><div class="kpi-value">${fmtNum(nbVentes)}</div></div>
      ${nbRetours > 0 ? `<div class="kpi-cell"><div class="kpi-label">Nb retours</div><div class="kpi-value">${fmtNum(nbRetours)}</div></div>` : ''}
      ${annulationRow}
    </div>

    ${showMargin ? `<div class="section-title">Rentabilité</div>
    <div class="kpi-row">
      <div class="kpi-cell"><div class="kpi-label">Coût des marchandises</div><div class="kpi-value">${fmtMoney(cogsNet)} FCFA</div></div>
      ${kpiMarginCells}
    </div>` : ''}

    <div class="section-title">Trésorerie</div>
    <div class="kpi-row">
      <div class="kpi-cell success"><div class="kpi-label">Encaissé</div><div class="kpi-value green">${fmtMoney(totalPaid)} FCFA</div></div>
      <div class="kpi-cell danger"><div class="kpi-label">Crédit impayé</div><div class="kpi-value red">${fmtMoney(totalCredit)} FCFA</div></div>
    </div>

    <div class="section-title">Évolution journalière</div>
    <table>
      <thead><tr><th class="c">#</th><th>Date</th><th class="r">Transactions</th><th class="r">CA (FCFA)</th><th class="r">Encaissé</th><th class="r">Crédit</th>${mHeader}</tr></thead>
      <tbody>
        ${dayRows}
        <tr class="total-row">
          <td></td><td class="b">TOTAL</td>
          <td class="r num">${fmtNum(nbVentes)}</td>
          <td class="r num">${fmtMoney(caNet)}</td>
          <td class="r num">${fmtMoney(totalPaid)}</td>
          <td class="r num">${fmtMoney(totalCredit)}</td>
          ${mTotal(margeBrute)}
        </tr>
      </tbody>
    </table>

    <div class="section-title">Répartition par mode de paiement</div>
    <table>
      <thead><tr><th>Mode de paiement</th><th class="r">Montant (FCFA)</th><th class="r">Part</th></tr></thead>
      <tbody>${methodRows}</tbody>
    </table>

    <div class="section-title">Articles vendus — Top ${Math.min(50, byArticle.length)}</div>
    <table>
      <thead><tr><th class="c">#</th><th>Article</th><th class="r">Qté</th><th class="r">CA (FCFA)</th><th class="r">Part CA</th>${artMarginHeaders}</tr></thead>
      <tbody>
        ${artRows}
        <tr class="total-row">
          <td></td><td class="b">TOTAL</td>
          <td class="r num">${fmtNum(artTotalQty)}</td>
          <td class="r num">${fmtMoney(artTotalRev)}</td>
          <td class="r">100 %</td>
          ${artTotalMarginCells}
        </tr>
      </tbody>
    </table>
    ${docFooter(now)}`;
}

function buildArticleReport(
  tenant: TenantMeta, range: DateRange,
  rows: Awaited<ReturnType<typeof fetchArticleStats>>,
  showMargin: boolean, siteName?: string
): string {
  const period = labelRange(range);
  const now = new Date().toLocaleString('fr-FR');
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalReturned = rows.reduce((s, r) => s + r.qtyReturned, 0);
  const margin = totalRevenue - totalCost;

  const mHeader = showMargin ? '<th class="r">Marge (FCFA)</th><th class="r">Tx marge</th>' : '';
  const mTotalCell = showMargin
    ? `<td class="r num ${margin >= 0 ? 'mc' : 'mr'}">${fmtMoney(margin)}</td><td></td>`
    : '';

  const tableRows = rows.map((r, i) => {
    const mCells = showMargin
      ? `<td class="r num ${r.margin >= 0 ? 'mc' : 'mr'}">${fmtMoney(r.margin)}</td><td class="r num ${r.margin >= 0 ? 'mc' : 'mr'}">${r.tauxMarge} %</td>`
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
    <div class="kpi-cell success">
      <div class="kpi-label">Marge brute</div>
      <div class="kpi-value ${margin >= 0 ? 'green' : 'red'}">${fmtMoney(margin)} FCFA</div>
    </div>` : '';

  return `
    ${docHeader(tenant, 'Statistiques Articles', 'CA net par article (remises globales ventilées)', period, siteName)}
    <div class="kpi-row">
      <div class="kpi-cell accent"><div class="kpi-label">CA net</div><div class="kpi-value">${fmtMoney(totalRevenue)} FCFA</div></div>
      <div class="kpi-cell"><div class="kpi-label">Références vendues</div><div class="kpi-value">${fmtNum(rows.length)}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Quantité vendue</div><div class="kpi-value">${fmtNum(totalQty)}</div></div>
      ${totalReturned > 0 ? `<div class="kpi-cell danger"><div class="kpi-label">Quantité retournée</div><div class="kpi-value red">${fmtNum(totalReturned)}</div></div>` : ''}
      ${kpiMarginCell}
    </div>
    <div class="section-title">Classement des articles — CA décroissant</div>
    <table>
      <thead><tr><th class="c">#</th><th>Article</th><th class="r">Qté vendue</th><th class="r">Qté retournée</th><th class="r">CA net (FCFA)</th><th class="r">Part CA</th>${mHeader}</tr></thead>
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

function buildCustomerReport(
  tenant: TenantMeta, range: DateRange,
  rows: Awaited<ReturnType<typeof fetchCustomerStats>>,
  showMargin: boolean, siteName?: string
): string {
  const period = labelRange(range);
  const now = new Date().toLocaleString('fr-FR');
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const margin = totalRevenue - totalCost;

  const mHeader = showMargin ? '<th class="r">Marge (FCFA)</th>' : '';
  const mTotalCell = showMargin ? `<td class="r num ${margin >= 0 ? 'mc' : 'mr'}">${fmtMoney(margin)}</td>` : '';

  const tableRows = rows.map((r, i) => {
    const m = r.revenue - r.cost;
    const mCell = showMargin ? `<td class="r num ${m >= 0 ? 'mc' : 'mr'}">${fmtMoney(m)}</td>` : '';
    return `<tr>
      <td class="num c">${i + 1}</td>
      <td class="b">${esc(r.name)}</td>
      <td class="r num">${fmtNum(r.txCount)}</td>
      <td class="r num b">${fmtMoney(r.revenue)}</td>
      <td class="r num">${pct(r.revenue, totalRevenue)}</td>
      <td class="r num ${r.credit > 0 ? 'mr' : 'muted'}">${r.credit > 0 ? fmtMoney(r.credit) : '—'}</td>
      ${mCell}
    </tr>`;
  }).join('');

  const kpiMarginCell = showMargin ? `
    <div class="kpi-cell success">
      <div class="kpi-label">Marge brute</div>
      <div class="kpi-value ${margin >= 0 ? 'green' : 'red'}">${fmtMoney(margin)} FCFA</div>
    </div>` : '';

  return `
    ${docHeader(tenant, 'Statistiques Clients', 'Portefeuille client — CA & crédits', period, siteName)}
    <div class="kpi-row">
      <div class="kpi-cell accent"><div class="kpi-label">CA net</div><div class="kpi-value">${fmtMoney(totalRevenue)} FCFA</div></div>
      <div class="kpi-cell"><div class="kpi-label">Clients actifs</div><div class="kpi-value">${fmtNum(rows.length)}</div></div>
      <div class="kpi-cell danger"><div class="kpi-label">Encours crédit</div><div class="kpi-value red">${fmtMoney(totalCredit)} FCFA</div></div>
      ${kpiMarginCell}
    </div>
    <div class="section-title">Classement clients — CA décroissant</div>
    <table>
      <thead><tr><th class="c">#</th><th>Client</th><th class="r">Transactions</th><th class="r">CA (FCFA)</th><th class="r">Part CA</th><th class="r">Crédit impayé</th>${mHeader}</tr></thead>
      <tbody>
        ${tableRows}
        <tr class="total-row">
          <td></td><td class="b">TOTAL</td>
          <td class="r num">${fmtNum(rows.reduce((s, r) => s + r.txCount, 0))}</td>
          <td class="r num">${fmtMoney(totalRevenue)}</td>
          <td class="r">100 %</td>
          <td class="r num">${fmtMoney(totalCredit)}</td>
          ${mTotalCell}
        </tr>
      </tbody>
    </table>
    ${docFooter(now)}`;
}

function buildSupplierReport(
  tenant: TenantMeta, range: DateRange,
  rows: Awaited<ReturnType<typeof fetchSupplierStats>>,
  siteName?: string
): string {
  const period = labelRange(range);
  const now = new Date().toLocaleString('fr-FR');
  const totalOrdered = rows.reduce((s, r) => s + r.totalOrdered, 0);
  const totalPaid = rows.reduce((s, r) => s + r.totalPaid, 0);
  const totalBalance = totalOrdered - totalPaid;

  const tableRows = rows.map((r, i) => {
    const balance = r.totalOrdered - r.totalPaid;
    return `<tr>
      <td class="num c">${i + 1}</td>
      <td class="b">${esc(r.name)}</td>
      <td class="r num">${fmtNum(r.orderCount)}</td>
      <td class="r num b">${fmtMoney(r.totalOrdered)}</td>
      <td class="r num">${pct(r.totalOrdered, totalOrdered)}</td>
      <td class="r num">${fmtMoney(r.totalPaid)}</td>
      <td class="r num ${balance > 0 ? 'mr' : 'muted'}">${balance > 0 ? fmtMoney(balance) : '—'}</td>
    </tr>`;
  }).join('');

  return `
    ${docHeader(tenant, 'Statistiques Fournisseurs', 'Achats & règlements fournisseurs', period, siteName)}
    <div class="kpi-row">
      <div class="kpi-cell accent"><div class="kpi-label">Total achats</div><div class="kpi-value">${fmtMoney(totalOrdered)} FCFA</div></div>
      <div class="kpi-cell success"><div class="kpi-label">Total réglé</div><div class="kpi-value green">${fmtMoney(totalPaid)} FCFA</div></div>
      <div class="kpi-cell danger"><div class="kpi-label">Solde dû</div><div class="kpi-value red">${fmtMoney(totalBalance)} FCFA</div></div>
      <div class="kpi-cell"><div class="kpi-label">Fournisseurs actifs</div><div class="kpi-value">${fmtNum(rows.length)}</div></div>
    </div>
    <div class="section-title">Classement fournisseurs — montant commandé décroissant</div>
    <table>
      <thead><tr><th class="c">#</th><th>Fournisseur</th><th class="r">Commandes</th><th class="r">Total commandé</th><th class="r">Part</th><th class="r">Total réglé</th><th class="r">Solde dû</th></tr></thead>
      <tbody>
        ${tableRows}
        <tr class="total-row">
          <td></td><td class="b">TOTAL</td>
          <td class="r num">${fmtNum(rows.reduce((s, r) => s + r.orderCount, 0))}</td>
          <td class="r num">${fmtMoney(totalOrdered)}</td>
          <td class="r">100 %</td>
          <td class="r num">${fmtMoney(totalPaid)}</td>
          <td class="r num ${totalBalance > 0 ? 'mr' : ''}">${totalBalance > 0 ? fmtMoney(totalBalance) : '—'}</td>
        </tr>
      </tbody>
    </table>
    ${docFooter(now)}`;
}

function buildExpenseReport(
  tenant: TenantMeta, range: DateRange,
  stats: Awaited<ReturnType<typeof fetchExpenseStats>>,
  siteName?: string
): string {
  const {
    ventesValidees, retours, caNet, cogsNet, margeBrute, tauxMarge,
    chargesExploitation, resultatExploitation, byCategory, detail,
  } = stats;
  const period = labelRange(range);
  const now = new Date().toLocaleString('fr-FR');

  const catRows = byCategory.map((c, i) => `<tr>
    <td class="num c">${i + 1}</td>
    <td class="b">${esc(c.category)}</td>
    <td class="r num">${fmtNum(c.count)}</td>
    <td class="r num b">${fmtMoney(c.amount)}</td>
    <td class="r num">${pct(c.amount, chargesExploitation)}</td>
  </tr>`).join('');

  const detailRows = detail.slice(0, 200).map((d, i) => `<tr>
    <td class="num c">${i + 1}</td>
    <td>${esc(new Date(d.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))}</td>
    <td class="b">${esc(d.category)}</td>
    <td class="muted">${esc(d.note || '—')}</td>
    <td class="r num b">${fmtMoney(d.amount)}</td>
  </tr>`).join('');

  return `
    ${docHeader(tenant, 'État des Dépenses', 'Activité commerciale · Rentabilité · Charges · Résultat', period, siteName)}

    <div class="section-title">Activité commerciale</div>
    <div class="kpi-row">
      <div class="kpi-cell accent"><div class="kpi-label">Ventes validées</div><div class="kpi-value">${fmtMoney(ventesValidees)} FCFA</div></div>
      <div class="kpi-cell ${retours > 0 ? 'danger' : ''}"><div class="kpi-label">Retours / avoirs</div><div class="kpi-value ${retours > 0 ? 'red' : ''}">${retours > 0 ? '− ' : ''}${fmtMoney(retours)} FCFA</div></div>
      <div class="kpi-cell accent"><div class="kpi-label">CA net</div><div class="kpi-value">${fmtMoney(caNet)} FCFA</div></div>
    </div>

    <div class="section-title">Rentabilité</div>
    <div class="kpi-row">
      <div class="kpi-cell"><div class="kpi-label">Coût des marchandises</div><div class="kpi-value">${fmtMoney(cogsNet)} FCFA</div></div>
      <div class="kpi-cell ${margeBrute >= 0 ? 'success' : 'danger'}"><div class="kpi-label">Marge brute</div><div class="kpi-value ${margeBrute >= 0 ? 'green' : 'red'}">${fmtMoney(margeBrute)} FCFA</div></div>
      <div class="kpi-cell"><div class="kpi-label">Taux de marge</div><div class="kpi-value">${tauxMarge} %</div></div>
    </div>

    <div class="section-title">Synthèse — Résultat d'exploitation</div>
    <table>
      <thead><tr><th>Élément</th><th class="r">Montant (FCFA)</th></tr></thead>
      <tbody>
        <tr><td>Ventes validées</td><td class="r num b">${fmtMoney(ventesValidees)}</td></tr>
        <tr><td>Retours / avoirs</td><td class="r num mr">− ${fmtMoney(retours)}</td></tr>
        <tr><td class="b">CA net</td><td class="r num b">${fmtMoney(caNet)}</td></tr>
        <tr><td>Coût des marchandises</td><td class="r num mr">− ${fmtMoney(cogsNet)}</td></tr>
        <tr><td class="b">Marge brute</td><td class="r num ${margeBrute >= 0 ? 'mc' : 'mr'}">${fmtMoney(margeBrute)}</td></tr>
        <tr><td>Charges d'exploitation</td><td class="r num mr">− ${fmtMoney(chargesExploitation)}</td></tr>
        <tr class="total-row"><td class="b">RÉSULTAT D'EXPLOITATION</td><td class="r num ${resultatExploitation >= 0 ? 'mc' : 'mr'}">${fmtMoney(resultatExploitation)}</td></tr>
      </tbody>
    </table>

    <div class="section-title">Charges d'exploitation par type</div>
    <table>
      <thead><tr><th class="c">#</th><th>Type de dépense</th><th class="r">Nombre</th><th class="r">Montant (FCFA)</th><th class="r">Part</th></tr></thead>
      <tbody>
        ${catRows || '<tr><td colspan="5" class="c muted">Aucune dépense sur la période</td></tr>'}
        ${byCategory.length ? `<tr class="total-row">
          <td></td><td class="b">TOTAL</td>
          <td class="r num">${fmtNum(byCategory.reduce((s, c) => s + c.count, 0))}</td>
          <td class="r num">${fmtMoney(chargesExploitation)}</td>
          <td class="r">100 %</td>
        </tr>` : ''}
      </tbody>
    </table>

    <div class="section-title">Détail des dépenses${detail.length > 200 ? ` — 200 premières sur ${detail.length}` : ''}</div>
    <table>
      <thead><tr><th class="c">#</th><th>Date</th><th>Type</th><th>Motif / note</th><th class="r">Montant (FCFA)</th></tr></thead>
      <tbody>
        ${detailRows || '<tr><td colspan="5" class="c muted">Aucune dépense sur la période</td></tr>'}
      </tbody>
    </table>
    ${docFooter(now)}`;
}

// ── Tiers Balance (clients & fournisseurs) ─────────────────────────────────────

type TiersBalanceRow = {
  id: string;
  name: string;
  outstanding: number;   // ventes/commandes impayées
  adjustments: number;   // ajustements de balance positionnés
  finalBalance: number;  // balance actuelle
};

async function fetchTiersBalanceStats(
  tenantId: string, _from: string, _to: string, siteId: string | null
): Promise<{ customers: TiersBalanceRow[]; suppliers: TiersBalanceRow[] }> {
  // ── Clients ──
  let custQ = supabase
    .from('customers')
    .select('id, name, balance')
    .eq('tenant_id', tenantId)
    .order('name');
  if (siteId) custQ = custQ.eq('site_id', siteId);
  const { data: customers, error: cErr } = await custQ;
  if (cErr) throw cErr;

  // Ventes impayées par client
  let salesQ = supabase
    .from('sales')
    .select('id, customer_id, total, status, sale_payments(amount)')
    .eq('tenant_id', tenantId)
    .neq('status', 'cancelled');
  if (siteId) salesQ = salesQ.eq('site_id', siteId);
  const { data: sales, error: sErr } = await salesQ;
  if (sErr) throw sErr;

  const custOutstanding = new Map<string, number>();
  for (const s of (sales || []) as any[]) {
    const paid = ((s.sale_payments || []) as any[]).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
    const due = (s.total || 0) - paid;
    if (due <= 0) continue;
    custOutstanding.set(s.customer_id, (custOutstanding.get(s.customer_id) || 0) + due);
  }

  // Ajustements de balance clients
  const { data: custAdj, error: caErr } = await supabase
    .from('balance_adjustments')
    .select('entity_id, amount')
    .eq('tenant_id', tenantId)
    .eq('entity_type', 'customer');
  if (caErr) throw caErr;
  const custAdjustments = new Map<string, number>();
  for (const a of (custAdj || []) as any[]) {
    custAdjustments.set(a.entity_id, (custAdjustments.get(a.entity_id) || 0) + (a.amount || 0));
  }

  const customerRows: TiersBalanceRow[] = (customers || []).map((c: any) => {
    const outstanding = custOutstanding.get(c.id) || 0;
    const adjustments = custAdjustments.get(c.id) || 0;
    return {
      id: c.id,
      name: c.name || 'Client inconnu',
      outstanding,
      adjustments,
      finalBalance: Number(c.balance) || 0,
    };
  }).sort((a, b) => b.finalBalance - a.finalBalance);

  // ── Fournisseurs ──
  let supQ = supabase
    .from('suppliers')
    .select('id, name, balance')
    .eq('tenant_id', tenantId)
    .order('name');
  if (siteId) supQ = supQ.eq('site_id', siteId);
  const { data: suppliers, error: supErr } = await supQ;
  if (supErr) throw supErr;

  // Commandes impayées par fournisseur
  let ordQ = supabase
    .from('supplier_orders')
    .select('id, supplier_id, total, status, supplier_payments(amount)')
    .eq('tenant_id', tenantId)
    .neq('status', 'cancelled')
    .neq('status', 'draft');
  if (siteId) ordQ = ordQ.eq('site_id', siteId);
  const { data: orders, error: oErr } = await ordQ;
  if (oErr) throw oErr;

  const supOutstanding = new Map<string, number>();
  for (const o of (orders || []) as any[]) {
    const paid = ((o.supplier_payments || []) as any[]).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
    const due = (o.total || 0) - paid;
    if (due <= 0) continue;
    supOutstanding.set(o.supplier_id, (supOutstanding.get(o.supplier_id) || 0) + due);
  }

  // Ajustements de balance fournisseurs
  const { data: supAdj, error: saErr } = await supabase
    .from('balance_adjustments')
    .select('entity_id, amount')
    .eq('tenant_id', tenantId)
    .eq('entity_type', 'supplier');
  if (saErr) throw saErr;
  const supAdjustments = new Map<string, number>();
  for (const a of (supAdj || []) as any[]) {
    supAdjustments.set(a.entity_id, (supAdjustments.get(a.entity_id) || 0) + (a.amount || 0));
  }

  const supplierRows: TiersBalanceRow[] = (suppliers || []).map((s: any) => {
    const outstanding = supOutstanding.get(s.id) || 0;
    const adjustments = supAdjustments.get(s.id) || 0;
    return {
      id: s.id,
      name: s.name || 'Fournisseur inconnu',
      outstanding,
      adjustments,
      finalBalance: Number(s.balance) || 0,
    };
  }).sort((a, b) => b.finalBalance - a.finalBalance);

  return { customers: customerRows, suppliers: supplierRows };
}

function buildTiersBalanceReport(
  tenant: TenantMeta, range: DateRange,
  stats: Awaited<ReturnType<typeof fetchTiersBalanceStats>>,
  siteName: string | undefined,
  hideZero: boolean,
): string {
  const period = labelRange(range);
  const now = new Date().toLocaleString('fr-FR');
  const { customers, suppliers } = stats;

  const totalCustBalance = customers.reduce((s, r) => s + r.finalBalance, 0);
  const totalSupBalance = suppliers.reduce((s, r) => s + r.finalBalance, 0);
  const netPosition = totalCustBalance - totalSupBalance;
  const nonZeroCount = customers.filter(r => r.finalBalance !== 0).length + suppliers.filter(r => r.finalBalance !== 0).length;

  const filterFn = (r: TiersBalanceRow) => !hideZero || r.finalBalance !== 0;
  const shownCustomers = customers.filter(filterFn);
  const shownSuppliers = suppliers.filter(filterFn);

  const custRows = shownCustomers.map((r, i) => `<tr>
    <td class="num c">${i + 1}</td>
    <td class="b">${esc(r.name)}</td>
    <td class="r num">${r.outstanding > 0 ? fmtMoney(r.outstanding) : '—'}</td>
    <td class="r num ${r.adjustments > 0 ? 'mc' : r.adjustments < 0 ? 'mr' : ''}">${r.adjustments !== 0 ? (r.adjustments > 0 ? '+ ' : '− ') + fmtMoney(Math.abs(r.adjustments)) : '—'}</td>
    <td class="r num b ${r.finalBalance > 0 ? 'mc' : r.finalBalance < 0 ? 'mr' : ''}">${r.finalBalance !== 0 ? fmtMoney(r.finalBalance) : '—'}</td>
  </tr>`).join('');

  const supRows = shownSuppliers.map((r, i) => `<tr>
    <td class="num c">${i + 1}</td>
    <td class="b">${esc(r.name)}</td>
    <td class="r num">${r.outstanding > 0 ? fmtMoney(r.outstanding) : '—'}</td>
    <td class="r num ${r.adjustments > 0 ? 'mc' : r.adjustments < 0 ? 'mr' : ''}">${r.adjustments !== 0 ? (r.adjustments > 0 ? '+ ' : '− ') + fmtMoney(Math.abs(r.adjustments)) : '—'}</td>
    <td class="r num b ${r.finalBalance > 0 ? 'mr' : r.finalBalance < 0 ? 'mc' : ''}">${r.finalBalance !== 0 ? fmtMoney(r.finalBalance) : '—'}</td>
  </tr>`).join('');

  return `
    ${docHeader(tenant, 'Balance des Tiers', 'État des créances et dettes clients & fournisseurs', period, siteName)}
    <div class="kpi-row">
      <div class="kpi-cell success"><div class="kpi-label">Total créances clients</div><div class="kpi-value green">${fmtMoney(totalCustBalance)} FCFA</div></div>
      <div class="kpi-cell danger"><div class="kpi-label">Total dettes fournisseurs</div><div class="kpi-value red">${fmtMoney(totalSupBalance)} FCFA</div></div>
      <div class="kpi-cell ${netPosition >= 0 ? 'success' : 'danger'}"><div class="kpi-label">Position nette</div><div class="kpi-value ${netPosition >= 0 ? 'green' : 'red'}">${fmtMoney(netPosition)} FCFA</div></div>
      <div class="kpi-cell"><div class="kpi-label">Tiers avec solde non nul</div><div class="kpi-value">${fmtNum(nonZeroCount)}</div></div>
    </div>

    <div class="section-title">Créances clients${hideZero ? ' — soldes non nuls uniquement' : ''}</div>
    <table>
      <thead><tr><th class="c">#</th><th>Client</th><th class="r">Ventes impayées</th><th class="r">Ajustements positionnés</th><th class="r">Balance finale</th></tr></thead>
      <tbody>
        ${custRows || '<tr><td colspan="5" class="c muted">Aucun client</td></tr>'}
        ${shownCustomers.length ? `<tr class="total-row">
          <td></td><td class="b">TOTAL</td>
          <td class="r num">${fmtMoney(shownCustomers.reduce((s, r) => s + r.outstanding, 0))}</td>
          <td class="r num">${fmtMoney(shownCustomers.reduce((s, r) => s + r.adjustments, 0))}</td>
          <td class="r num ${totalCustBalance >= 0 ? 'mc' : 'mr'}">${fmtMoney(totalCustBalance)}</td>
        </tr>` : ''}
      </tbody>
    </table>

    <div class="section-title">Dettes fournisseurs${hideZero ? ' — soldes non nuls uniquement' : ''}</div>
    <table>
      <thead><tr><th class="c">#</th><th>Fournisseur</th><th class="r">Commandes impayées</th><th class="r">Ajustements positionnés</th><th class="r">Balance finale</th></tr></thead>
      <tbody>
        ${supRows || '<tr><td colspan="5" class="c muted">Aucun fournisseur</td></tr>'}
        ${shownSuppliers.length ? `<tr class="total-row">
          <td></td><td class="b">TOTAL</td>
          <td class="r num">${fmtMoney(shownSuppliers.reduce((s, r) => s + r.outstanding, 0))}</td>
          <td class="r num">${fmtMoney(shownSuppliers.reduce((s, r) => s + r.adjustments, 0))}</td>
          <td class="r num ${totalSupBalance >= 0 ? 'mr' : 'mc'}">${fmtMoney(totalSupBalance)}</td>
        </tr>` : ''}
      </tbody>
    </table>

    <div class="section-title">Synthèse</div>
    <table>
      <thead><tr><th>Élément</th><th class="r">Montant (FCFA)</th></tr></thead>
      <tbody>
        <tr><td class="b">Total créances clients</td><td class="r num mc">${fmtMoney(totalCustBalance)}</td></tr>
        <tr><td class="b">Total dettes fournisseurs</td><td class="r num mr">${fmtMoney(totalSupBalance)}</td></tr>
        <tr class="total-row"><td class="b">POSITION NETTE (créances − dettes)</td><td class="r num ${netPosition >= 0 ? 'mc' : 'mr'}">${fmtMoney(netPosition)}</td></tr>
      </tbody>
    </table>
    ${docFooter(now)}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

type ReportType = 'cash' | 'articles' | 'customers' | 'suppliers' | 'expenses' | 'tiers_balance';

const REPORT_DEFS: {
  key: ReportType; label: string; sublabel: string; hasMargin: boolean; hasZeroToggle: boolean;
}[] = [
  { key: 'cash',          label: 'Caisse',           sublabel: "CA journalier, encaissements et modes de paiement", hasMargin: true,  hasZeroToggle: false },
  { key: 'articles',      label: 'Articles',         sublabel: "Classement des articles vendus par chiffre d'affaires", hasMargin: true,  hasZeroToggle: false },
  { key: 'customers',     label: 'Clients',          sublabel: "Portefeuille client, CA et encours de crédit",       hasMargin: true,  hasZeroToggle: false },
  { key: 'suppliers',     label: 'Fournisseurs',     sublabel: "Achats et règlements par fournisseur",               hasMargin: false, hasZeroToggle: false },
  { key: 'expenses',      label: 'Dépenses',        sublabel: "Dépenses par type et résultat d'exploitation",    hasMargin: false, hasZeroToggle: false },
  { key: 'tiers_balance', label: 'Balance des Tiers', sublabel: "Créances et dettes complètes — ventes, achats et soldes positionnés", hasMargin: false, hasZeroToggle: true },
];

function isMobile() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768;
}

export function Reports() {
  const { tenant, sites, currentSite, refresh } = useApp();
  const { error: toastError } = useToast();

  const [reportType, setReportType] = useState<ReportType>('cash');
  const [loading, setLoading] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [siteDropOpen, setSiteDropOpen] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState<string | 'all'>('all');
  const [savingMargin, setSavingMargin] = useState(false);
  const [hideZeroBalances, setHideZeroBalances] = useState(false);

  const [showMargin, setShowMargin] = useState<boolean>(() =>
    !!(tenant as any)?.settings?.show_margin_in_reports
  );

  const [range, setRange] = useState<DateRange>(() => {
    const now = new Date();
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  });

  // Preview scale for desktop
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [mobile, setMobile] = useState(isMobile);

  useEffect(() => {
    if (tenant) setShowMargin(!!(tenant as any)?.settings?.show_margin_in_reports);
  }, [tenant?.id]);

  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (!previewContainerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setPreviewScale(Math.min(1, (w - 32) / 793));
    });
    obs.observe(previewContainerRef.current);
    return () => obs.disconnect();
  }, [previewHtml]);

  const toggleMargin = async (val: boolean) => {
    setShowMargin(val);
    setPreviewHtml(null);
    if (!tenant) return;
    setSavingMargin(true);
    const current = (tenant as any)?.settings || {};
    await supabase.from('tenants').update({ settings: { ...current, show_margin_in_reports: val } }).eq('id', tenant.id);
    setSavingMargin(false);
    refresh();
  };

  const def = REPORT_DEFS.find(d => d.key === reportType)!

  const selectedSite = sites.find(s => s.id === selectedSiteId);
  const siteName = selectedSiteId === 'all' ? undefined : selectedSite?.name;
  const siteIdParam = selectedSiteId === 'all' ? undefined : selectedSiteId;

  const tenantMeta: TenantMeta = {
    name: tenant?.name || '',
    legal_name: (tenant as any)?.legal_name,
    ninea: (tenant as any)?.ninea,
    rccm: (tenant as any)?.rccm,
    address: (tenant as any)?.address,
    phone: (tenant as any)?.phone,
    email: (tenant as any)?.email,
    website: (tenant as any)?.website,
    logo_url: (tenant as any)?.logo_url,
    business_type: (tenant as any)?.business_type,
  };

  async function generate(action: 'preview' | 'print') {
    if (!tenant) return;
    if (action === 'preview' && mobile) return;
    setLoading(true);
    setPreviewHtml(null);
    try {
      const from = isoDate(range.from);
      const to = isoDate(range.to);
      let html = '';

      if (reportType === 'cash') {
        const stats = await fetchCashStats(tenant.id, siteIdParam, from, to);
        html = buildCashReport(tenantMeta, range, stats, showMargin, siteName);
      } else if (reportType === 'articles') {
        const rows = await fetchArticleStats(tenant.id, siteIdParam, from, to);
        html = buildArticleReport(tenantMeta, range, rows, showMargin, siteName);
      } else if (reportType === 'customers') {
        const rows = await fetchCustomerStats(tenant.id, siteIdParam, from, to);
        html = buildCustomerReport(tenantMeta, range, rows, showMargin, siteName);
      } else if (reportType === 'expenses') {
        const stats = await fetchExpenseStats(tenant.id, siteIdParam, from, to);
        html = buildExpenseReport(tenantMeta, range, stats, siteName);
      } else if (reportType === 'tiers_balance') {
        const stats = await fetchTiersBalanceStats(tenant.id, from, to, selectedSiteId === 'all' ? null : selectedSiteId);
        html = buildTiersBalanceReport(tenantMeta, range, stats, siteName, hideZeroBalances);
      } else {
        const rows = await fetchSupplierStats(tenant.id, from, to);
        html = buildSupplierReport(tenantMeta, range, rows, siteName);
      }

      if (action === 'print') printDoc(html);
      else setPreviewHtml(html);
    } catch (e: any) {
      toastError(e?.message || 'Erreur lors de la génération');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" style={{ minHeight: 'calc(100vh - 200px)' }}>

      {/* ── Header : titre + actions ── */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 -mt-3 sm:-mt-4 lg:-mt-6 pt-3 sm:pt-4 lg:pt-6 bg-slate-50 shrink-0">
        {/* Title row with bottom border */}
        <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
          <h1 className="text-sm font-bold tracking-tight text-slate-900">États & Rapports</h1>
          <div className="flex-1" />
          {/* Margin toggle — only for reports that support it */}
          {def.hasMargin && (
            <button
              onClick={() => toggleMargin(!showMargin)}
              disabled={savingMargin}
              className="shrink-0 flex items-center gap-2 text-[11px] font-semibold text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-40"
            >
              <span>Marges</span>
              <span className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${showMargin ? 'bg-neutral-900' : 'bg-neutral-200'}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${showMargin ? 'translate-x-4' : 'translate-x-0'}`} />
              </span>
            </button>
          )}
          {/* Aperçu — desktop only */}
          {!mobile && (
            <button
              onClick={() => generate('preview')}
              disabled={loading}
              className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-40"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">Aperçu</span>
            </button>
          )}
          {/* Imprimer */}
          <button
            onClick={() => generate('print')}
            disabled={loading}
            className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all active:scale-95 disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)' }}
            aria-label="Imprimer"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" /> : <Printer className="w-3.5 h-3.5 text-white" />}
          </button>
        </div>

        {/* Date + site row with bottom border */}
        <div className="flex items-center gap-2 py-2 border-b border-slate-200 flex-wrap">
          {/* Date picker */}
          <div className="relative">
            <button
              onClick={() => setPickerOpen(v => !v)}
              className="flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-semibold text-slate-500 hover:text-slate-700 transition-colors whitespace-nowrap"
            >
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>{labelRange(range)}</span>
              <ChevronDown className={`w-3 h-3 text-slate-400 shrink-0 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
            </button>
            <PremiumDateRangePicker
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              from={isoDate(range.from)}
              to={isoDate(range.to)}
              onApply={(from, to) => {
                setRange({ from: new Date(from), to: new Date(to) });
                setPickerOpen(false);
                setPreviewHtml(null);
              }}
            />
          </div>

          {/* Site selector */}
          {sites.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setSiteDropOpen(v => !v)}
                className="flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-semibold text-slate-500 hover:text-slate-700 transition-colors whitespace-nowrap"
              >
                <Store className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>{selectedSiteId === 'all' ? 'Tous les sites' : (selectedSite?.name || 'Site')}</span>
                <ChevronDown className={`w-3 h-3 text-slate-400 shrink-0 transition-transform ${siteDropOpen ? 'rotate-180' : ''}`} />
              </button>
              {siteDropOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setSiteDropOpen(false)} />
                  <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-slate-200 rounded-2xl shadow-xl py-1.5 min-w-[170px]">
                    <button
                      onClick={() => { setSelectedSiteId('all'); setSiteDropOpen(false); setPreviewHtml(null); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${selectedSiteId === 'all' ? 'text-brand-700 font-semibold bg-brand-50/70' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                      <span>Tous les sites</span>
                      {selectedSiteId === 'all' && <Check className="w-3 h-3 ml-auto text-brand-600" />}
                    </button>
                    {sites.map(s => (
                      <button key={s.id}
                        onClick={() => { setSelectedSiteId(s.id); setSiteDropOpen(false); setPreviewHtml(null); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${selectedSiteId === s.id ? 'text-brand-700 font-semibold bg-brand-50/70' : 'text-slate-600 hover:bg-slate-50'}`}
                      >
                        <span className="truncate">{s.name}</span>
                        {selectedSiteId === s.id && <Check className="w-3 h-3 ml-auto text-brand-600 shrink-0" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Zero-balance toggle — only for tiers_balance report */}
          {def.hasZeroToggle && (
            <button
              onClick={() => { setHideZeroBalances(v => !v); setPreviewHtml(null); }}
              className="shrink-0 flex items-center gap-2 text-[11px] font-semibold text-slate-500 hover:text-slate-700 transition-colors"
            >
              <span>Masquer à zéro</span>
              <span className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${hideZeroBalances ? 'bg-neutral-900' : 'bg-neutral-200'}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${hideZeroBalances ? 'translate-x-4' : 'translate-x-0'}`} />
              </span>
            </button>
          )}
        </div>

        {/* Report type tabs — flat text bullets */}
        <div className="flex items-center gap-3 py-2 overflow-x-auto no-scrollbar">
          {REPORT_DEFS.map(d => {
            const active = reportType === d.key;
            return (
              <button
                key={d.key}
                onClick={() => { setReportType(d.key); setPreviewHtml(null); }}
                className={`shrink-0 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                  active ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Contenu central ── */}
      <div className="flex-1 min-h-0 flex flex-col">

        {/* Mobile notice */}
        {mobile && (
          <div className="flex items-start gap-3 p-3.5 shrink-0">
            <Monitor className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-slate-700">Aperçu disponible sur ordinateur uniquement</p>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">Sur mobile, utilisez le bouton Imprimer pour générer votre document A4.</p>
            </div>
          </div>
        )}

        {/* Desktop preview */}
        {previewHtml && !mobile && (
          <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/60 shrink-0">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">Aperçu — {def.label}</span>
                <span className="hidden sm:inline text-xs text-slate-400">{labelRange(range)}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setPreviewHtml(null)} className="btn-icon" title="Fermer">
                  <X className="w-4 h-4" />
                </button>
                <button onClick={() => generate('print')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-colors"
                  style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)' }}>
                  <Printer className="w-3.5 h-3.5" />
                  Imprimer
                </button>
              </div>
            </div>
            <div ref={previewContainerRef} className="flex-1 min-h-0 overflow-y-auto bg-slate-100 p-4 sm:p-8">
              <div
                className="bg-white shadow-md rounded-lg origin-top-left"
                style={{
                  width: '793px',
                  minHeight: `${Math.round(1122 * previewScale)}px`,
                  padding: '68px',
                  transform: `scale(${previewScale})`,
                  transformOrigin: 'top left',
                }}
              >
                <style>{a4Style()}</style>
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="w-7 h-7 animate-spin text-slate-500" />
            <p className="text-sm font-medium">Génération en cours…</p>
          </div>
        )}

        {/* Empty state */}
        {!previewHtml && !loading && (
          <div className="flex-1 flex flex-col items-center justify-center gap-1.5 text-center">
            <p className="text-sm font-semibold text-slate-700">{def.label}</p>
            <p className="text-xs text-slate-400">{def.sublabel}</p>
            <p className="text-[10px] text-slate-400 mt-3">
              {mobile ? 'Appuyez sur le bouton Imprimer en haut.' : "Cliquez sur Aperçu ou Imprimer pour générer le document."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
