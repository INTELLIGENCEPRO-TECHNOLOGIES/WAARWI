import { BUSINESS_TYPE_LABELS } from './types';

export type PrintTenant = {
  name: string;
  legal_name?: string;
  ninea?: string;
  rccm?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logo_url?: string;
  business_type?: string;
};

const WAARWI_FOOTER = 'Propulsée par WAARWI — Plateforme Business 2.0 made in Sénégal';

export type PrintItem = {
  name: string;
  internal_ref?: string | null;
  oem_ref?: string | null;
  quantity: number;
  unit_price: number;
  discount?: number;
};

export type PrintPayment = { method_name: string; amount: number };

export type PrintCustomer = { name: string; phone?: string | null; address?: string | null } | null;

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const fmtMoney = (n: number) => (Number(n) || 0).toLocaleString('fr-FR');

const activityLabel = (t: PrintTenant) =>
  BUSINESS_TYPE_LABELS[t.business_type || 'auto_parts'] || 'Commerce';

function tenantHeader80(t: PrintTenant) {
  const activity = activityLabel(t);
  const logo = t.logo_url
    ? `<div class="logo-wrap"><img src="${esc(t.logo_url)}" alt="" onerror="this.style.display='none'"/></div>`
    : '';
  return `
    ${logo}
    <div class="shop-name">${esc(t.name)}</div>
    <div class="activity">${esc(activity)}</div>
    ${t.address ? `<div class="meta">${esc(t.address)}</div>` : ''}
    ${t.phone ? `<div class="meta">Tél: ${esc(t.phone)}</div>` : ''}
    ${t.email ? `<div class="meta">${esc(t.email)}</div>` : ''}
    ${t.website ? `<div class="meta">${esc(t.website)}</div>` : ''}
    ${t.ninea ? `<div class="meta">NINEA: ${esc(t.ninea)}</div>` : ''}
    ${t.rccm ? `<div class="meta">RCCM: ${esc(t.rccm)}</div>` : ''}
  `;
}

function waarwiFooter80() {
  return `<div class="waarwi-footer">Propulsée par <strong>WAARWI</strong><div class="waarwi-tag">Plateforme Business 2.0 made in Sénégal</div></div>`;
}

function waarwiFooterA4() {
  return `<div class="waarwi-brand-footer">${esc(WAARWI_FOOTER)}</div>`;
}

const ticketStyle = `
  @page { margin: 0; size: 80mm auto; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; width: 72mm; padding: 4mm; color: #000; line-height: 1.35; }
  .center { text-align: center; }
  .logo-wrap { display: flex; justify-content: center; margin-bottom: 6px; }
  .logo-wrap img { max-width: 48mm; max-height: 22mm; object-fit: contain; }
  .shop-name { text-align: center; font-weight: 900; font-size: 18px; letter-spacing: 0.3px; }
  .activity { text-align: center; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; margin-bottom: 4px; font-weight: 600; }
  .meta { text-align: center; font-size: 11px; }
  .hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  .hr-solid { border: 0; border-top: 1.5px solid #000; margin: 6px 0; }
  .doc-label { text-align: center; font-weight: 900; font-size: 14px; letter-spacing: 1.5px; margin: 4px 0 2px; }
  .doc-num { text-align: center; font-size: 13px; font-weight: 700; }
  .doc-date { text-align: center; font-size: 11px; color: #333; }
  .info-row { display: flex; justify-content: space-between; font-size: 11px; margin-top: 2px; }
  .item { margin: 6px 0 4px; }
  .item-name { font-size: 13px; font-weight: 700; line-height: 1.3; word-wrap: break-word; }
  .item-ref { font-size: 10px; color: #555; font-family: 'Courier New', monospace; margin-top: 1px; }
  .item-line { display: flex; justify-content: space-between; align-items: baseline; margin-top: 3px; font-size: 11px; gap: 4px; flex-wrap: wrap; }
  .item-qty { font-weight: 900; font-size: 13px; }
  .item-pu { color: #333; font-size: 11px; }
  .item-total { font-weight: 900; font-size: 13px; white-space: nowrap; }
  .row { display: flex; justify-content: space-between; align-items: baseline; font-size: 11px; padding: 2px 0; gap: 4px; flex-wrap: wrap; }
  .row span { white-space: nowrap; }
  .row.total { font-size: 14px; font-weight: 900; padding: 6px 0; }
  .row.payment { font-size: 12px; }
  .row.change { font-weight: 900; font-size: 13px; }
  .footer { text-align: center; font-size: 10px; margin-top: 8px; color: #333; line-height: 1.5; }
  .footer .thanks { font-weight: 700; font-size: 12px; color: #000; }
  .waarwi-footer { text-align: center; margin-top: 8px; padding-top: 6px; border-top: 1px dashed #999; font-size: 9px; color: #555; line-height: 1.4; }
  .waarwi-footer strong { color: #0f172a; letter-spacing: 0.5px; }
  .waarwi-footer .waarwi-tag { font-size: 8px; color: #777; margin-top: 1px; }
`;

export function printTicket80(
  sale: {
    sale_number: string;
    created_at: string;
    total: number;
    discount: number;
    items: PrintItem[];
    payments: PrintPayment[];
    customer?: PrintCustomer;
  },
  tenant: PrintTenant,
  cashier: string
) {
  const totalPaid = sale.payments.reduce((s, p) => s + p.amount, 0);
  const change = Math.max(0, totalPaid - sale.total);
  const subtotal = sale.items.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
  const w = window.open('', '_blank', 'width=340,height=640');
  if (!w) return;
  const itemsHtml = sale.items
    .map(i => {
      const lineTotal = i.quantity * i.unit_price - (i.discount || 0);
      return `<div class="item">
        <div class="item-name">${esc(i.name)}</div>
        ${i.internal_ref ? `<div class="item-ref">${esc(i.internal_ref)}</div>` : ''}
        ${i.oem_ref ? `<div class="item-ref">OEM: ${esc(i.oem_ref)}</div>` : ''}
        <div class="item-line">
          <span><span class="item-qty">${i.quantity}</span> <span class="item-pu">× ${fmtMoney(i.unit_price)}</span></span>
          <span class="item-total">${fmtMoney(lineTotal)}</span>
        </div>
      </div>`;
    })
    .join('');

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket ${esc(sale.sale_number)}</title>
<style>${ticketStyle}</style></head><body>
${tenantHeader80(tenant)}
<hr class="hr-solid" />
<div class="doc-label">TICKET DE CAISSE</div>
<div class="doc-num">N° ${esc(sale.sale_number)}</div>
<div class="doc-date">${new Date(sale.created_at).toLocaleString('fr-FR')}</div>
<div class="info-row"><span>Caissier</span><span>${esc(cashier)}</span></div>
${sale.customer ? `<div class="info-row"><span>Client</span><span>${esc(sale.customer.name)}</span></div>` : ''}
<hr class="hr" />
${itemsHtml}
<hr class="hr" />
<div class="row"><span>Sous-total</span><span>${fmtMoney(subtotal)} FCFA</span></div>
${sale.discount > 0 ? `<div class="row"><span>Remise</span><span>-${fmtMoney(sale.discount)} FCFA</span></div>` : ''}
<hr class="hr-solid" />
<div class="row total"><span>TOTAL</span><span>${fmtMoney(sale.total)} FCFA</span></div>
<hr class="hr" />
${sale.payments.map(p => `<div class="row payment"><span>${esc(p.method_name)}</span><span><strong>${fmtMoney(p.amount)} FCFA</strong></span></div>`).join('')}
${change > 0 ? `<div class="row change"><span>MONNAIE</span><span>${fmtMoney(change)} FCFA</span></div>` : ''}
<hr class="hr" />
<div class="footer">
  <div class="thanks">Merci de votre confiance !</div>
  <div>À bientôt</div>
</div>
${waarwiFooter80()}
</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

export function printReturnTicket80(
  refSaleNumber: string,
  items: { name: string; quantity: number; unit_price: number }[],
  total: number,
  tenant: PrintTenant,
  cashier: string,
  returnNumber?: string
) {
  const w = window.open('', '_blank', 'width=340,height=560');
  if (!w) return;
  const itemsHtml = items
    .map(i => `<div class="item">
      <div class="item-name">${esc(i.name)}</div>
      <div class="item-line">
        <span><span class="item-qty">-${i.quantity}</span> <span class="item-pu">× ${fmtMoney(i.unit_price)}</span></span>
        <span class="item-total">-${fmtMoney(i.quantity * i.unit_price)}</span>
      </div>
    </div>`)
    .join('');

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Retour</title>
<style>${ticketStyle}</style></head><body>
${tenantHeader80(tenant)}
<hr class="hr-solid" />
<div class="doc-label">TICKET DE RETOUR</div>
${returnNumber ? `<div class="doc-num">N° ${esc(returnNumber)}</div>` : ''}
<div class="doc-date">Réf. vente: ${esc(refSaleNumber)}</div>
<div class="doc-date">${new Date().toLocaleString('fr-FR')}</div>
<div class="info-row"><span>Caissier</span><span>${esc(cashier)}</span></div>
<hr class="hr" />
${itemsHtml}
<hr class="hr-solid" />
<div class="row total"><span>AVOIR</span><span>${fmtMoney(total)} FCFA</span></div>
<hr class="hr" />
<div class="footer"><div class="thanks">Avoir à valoir sur prochain achat</div></div>
${waarwiFooter80()}
</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

// ── X de Caisse / Session report (80mm) ─────────────────────────────────────

export type XReportControl = {
  method_name: string;
  theoretical_amount: number;
  counted_amount: number;
  difference_amount?: number;
};

export type XReportMovement = {
  kind: 'expense' | 'income' | 'customer_prepayment';
  amount: number;
  reason: string;
  customer_name: string | null;
};

export type XReportRegularization = {
  reg_type: string;
  amount: number;
  reason: string;
};

export function printXReport80(opts: {
  tenant: PrintTenant;
  cashier: string;
  siteName: string;
  sessionId: string;
  openedAt: string;
  closedAt?: string | null;
  openingAmount: number;
  salesCount: number;
  salesTotal: number;
  byMethod: { method_name: string; amount: number }[];
  movements?: XReportMovement[];
  controls?: XReportControl[];
  regularizations?: XReportRegularization[];
  topArticles?: { name: string; qty: number; total: number }[];
}) {
  const w = window.open('', '_blank', 'width=320,height=800');
  if (!w) return;

  const movements = opts.movements || [];
  const controls = opts.controls || [];
  const regularizations = opts.regularizations || [];
  const topArticles = opts.topArticles || [];

  const mvExpense = movements.filter(m => m.kind === 'expense').reduce((s, m) => s + m.amount, 0);
  const mvIncome = movements.filter(m => m.kind === 'income').reduce((s, m) => s + m.amount, 0);
  const mvPrepay = movements.filter(m => m.kind === 'customer_prepayment').reduce((s, m) => s + m.amount, 0);
  const netTotal = opts.salesTotal + mvIncome + mvPrepay - mvExpense;
  const variance = controls.length > 0
    ? controls.reduce((s, c) => s + Number(c.difference_amount ?? (c.counted_amount - c.theoretical_amount)), 0)
    : 0;

  const movementsHtml = movements.length > 0 ? `
<hr class="hr" />
<div class="section">Mouvements de caisse</div>
${movements.map(m => {
    const label = m.kind === 'expense' ? 'Dépense' : m.kind === 'customer_prepayment' ? 'Acompte' : 'Entrée';
    const sign = m.kind === 'expense' ? '-' : '+';
    const reason = [m.customer_name, m.reason].filter(Boolean).join(' · ');
    return `<div class="row"><span>${esc(label)}${reason ? ': ' + esc(reason.slice(0, 22)) : ''}</span><span>${sign}${fmtMoney(m.amount)}</span></div>`;
  }).join('')}
<div class="row"><span>  Sous-total entrées</span><span>+${fmtMoney(mvIncome + mvPrepay)}</span></div>
<div class="row"><span>  Sous-total sorties</span><span>-${fmtMoney(mvExpense)}</span></div>
<hr class="hr" />
<div class="row total"><span>Net caisse</span><span>${fmtMoney(netTotal)} FCFA</span></div>
` : '';

  const controlsHtml = controls.length > 0 ? `
<hr class="hr" />
<div class="section">Contrôle de caisse</div>
<div class="row"><span>Fond d'ouverture</span><span>${fmtMoney(opts.openingAmount)} FCFA</span></div>
${controls.map(c => {
    const diff = Number(c.difference_amount ?? (c.counted_amount - c.theoretical_amount));
    return `<div style="margin-top:2px">
<div>${esc(c.method_name)}</div>
<div class="row"><span>  Théorique</span><span>${fmtMoney(c.theoretical_amount)}</span></div>
<div class="row"><span>  Compté</span><span>${fmtMoney(c.counted_amount)}</span></div>
<div class="row"><span>  Écart</span><span>${diff >= 0 ? '+' : ''}${fmtMoney(diff)}</span></div>
</div>`;
  }).join('')}
<hr class="hr" />
<div class="row"><span><strong>Écart total</strong></span><span><strong>${variance >= 0 ? '+' : ''}${fmtMoney(variance)} FCFA</strong></span></div>
` : '';

  const regularizationsHtml = regularizations.length > 0 ? `
<hr class="hr" />
<div class="section">Régularisations</div>
${regularizations.map(r => `<div class="row"><span>${esc(r.reg_type)}: ${esc(r.reason)}</span><span>${fmtMoney(r.amount)} FCFA</span></div>`).join('')}
` : '';

  const topArticlesHtml = topArticles.length > 0 ? `
<hr class="hr" />
<div class="section">Top articles</div>
${topArticles.map(a => `<div class="row"><span>${esc(a.name.slice(0, 24))}</span><span>x${a.qty} ${fmtMoney(a.total)}</span></div>`).join('')}
` : '';

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>X de Caisse</title>
<style>${ticketStyle}</style></head><body>
${tenantHeader80(opts.tenant)}
<hr class="hr-solid" />
<div class="doc-label">X DE CAISSE</div>
<div class="doc-date">Session: ${esc(opts.sessionId.slice(0, 8).toUpperCase())}</div>
<div class="info-row"><span>Point de vente</span><span>${esc(opts.siteName)}</span></div>
<div class="info-row"><span>Caissier</span><span>${esc(opts.cashier)}</span></div>
<div class="info-row"><span>Ouverture</span><span>${new Date(opts.openedAt).toLocaleString('fr-FR')}</span></div>
${opts.closedAt ? `<div class="info-row"><span>Clôture</span><span>${new Date(opts.closedAt).toLocaleString('fr-FR')}</span></div>` : ''}
<div class="info-row"><span>Impression</span><span>${new Date().toLocaleString('fr-FR')}</span></div>
<hr class="hr" />
<div class="section">Résumé ventes</div>
<div class="row"><span>Nombre de ventes</span><span>${opts.salesCount}</span></div>
<div class="row total"><span>CA Total</span><span>${fmtMoney(opts.salesTotal)} FCFA</span></div>
<hr class="hr" />
<div class="section">Encaissements par mode</div>
${opts.byMethod.length > 0
    ? opts.byMethod.map(m => `<div class="row"><span>${esc(m.method_name)}</span><span>${fmtMoney(m.amount)} FCFA</span></div>`).join('')
    : '<div>Aucun encaissement</div>'}
${movementsHtml}
${controlsHtml}
${regularizationsHtml}
${topArticlesHtml}
<hr class="hr" />
<div class="footer">
  <div class="thanks">— Fin du rapport —</div>
</div>
${waarwiFooter80()}
</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

// ── A4 document (invoice / quote) ────────────────────────────────────────────
const a4Style = `
  @page { margin: 14mm; size: A4; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #0f172a; display: flex; flex-direction: column; min-height: 100vh; }
  .page-content { flex: 1 1 auto; }
  .page-bottom { margin-top: auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 28px; padding-bottom: 18px; border-bottom: 2px solid #0f172a; }
  .brand { display: flex; gap: 14px; align-items: flex-start; }
  .brand img { max-width: 80px; max-height: 80px; object-fit: contain; }
  .brand-text h1 { font-size: 22px; font-weight: 800; color: #0f172a; line-height: 1.1; }
  .brand-text .activity { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #475569; margin-top: 4px; font-weight: 600; }
  .brand-text p { font-size: 11px; color: #475569; margin-top: 2px; }
  .doc-meta { text-align: right; min-width: 180px; }
  .doc-meta .tag { display: inline-block; padding: 4px 10px; background: #0f172a; color: white; border-radius: 4px; font-size: 10px; letter-spacing: 1.5px; font-weight: 700; text-transform: uppercase; }
  .doc-meta h2 { font-size: 20px; font-weight: 800; margin-top: 10px; color: #0f172a; }
  .doc-meta p { font-size: 11px; color: #475569; margin-top: 2px; }
  .status-badge { display: inline-block; padding: 5px 14px; border-radius: 4px; font-size: 11px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; margin-top: 8px; }
  .status-paid { background: #dcfce7; color: #166534; border: 1.5px solid #22c55e; }
  .status-partial { background: #fef3c7; color: #92400e; border: 1.5px solid #f59e0b; }
  .status-unpaid { background: #fee2e2; color: #991b1b; border: 1.5px solid #ef4444; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 22px; }
  .party { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
  .party h3 { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 8px; letter-spacing: 1.5px; }
  .party p { font-size: 12px; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 18px; table-layout: fixed; }
  thead tr { background: #0f172a; color: white; }
  th { padding: 10px 10px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; }
  th.right { text-align: right; }
  th.center { text-align: center; }
  th:nth-child(1) { width: 40%; }
  th:nth-child(2) { width: 10%; }
  th:nth-child(3) { width: 25%; }
  th:nth-child(4) { width: 25%; }
  td { padding: 10px 10px; font-size: 11px; border-bottom: 1px solid #e2e8f0; vertical-align: top; white-space: nowrap; overflow: visible; }
  td.right { text-align: right; }
  td.center { text-align: center; font-weight: 700; }
  td.bold { font-weight: 700; }
  .item-ref { font-size: 10px; color: #94a3b8; font-family: 'Courier New', monospace; margin-top: 2px; }
  .financial-summary { display: flex; justify-content: flex-end; margin-top: 12px; }
  .financial-box { width: 340px; border: 1.5px solid #0f172a; border-radius: 8px; overflow: hidden; }
  .fin-row { display: flex; justify-content: space-between; align-items: baseline; padding: 10px 16px; font-size: 12px; border-bottom: 1px solid #e2e8f0; gap: 8px; flex-wrap: wrap; }
  .fin-row:last-child { border-bottom: none; }
  .fin-row span { white-space: nowrap; }
  .fin-row.subtotal { background: #f8fafc; }
  .fin-row.discount { background: #f8fafc; color: #dc2626; }
  .fin-row.grand { background: #0f172a; color: white; font-size: 14px; font-weight: 800; padding: 12px 16px; }
  .fin-row.paid-row { background: #f0fdf4; font-weight: 700; }
  .fin-row.due-row { background: #fef2f2; font-weight: 800; color: #991b1b; }
  .payments-section { margin-top: 16px; }
  .payments-section h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #475569; margin-bottom: 8px; letter-spacing: 1px; }
  .p-row { display: flex; justify-content: space-between; font-size: 12px; padding: 4px 0; }
  .footer { padding-top: 14px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-top: 20px; }
  .waarwi-brand-footer { margin-top: 10px; padding-top: 10px; border-top: 1px dashed #cbd5e1; text-align: center; font-size: 10px; color: #64748b; letter-spacing: 0.3px; }
  .footer-note { margin-top: 10px; font-size: 11px; color: #475569; font-style: italic; }
`;

export function printDocumentA4(opts: {
  tenant: PrintTenant;
  docLabel: string;
  docNumber: string;
  docDate: string;
  footerNote?: string;
  customer?: PrintCustomer;
  extraMeta?: { label: string; value: string }[];
  items: PrintItem[];
  subtotal: number;
  discount?: number;
  total: number;
  payments?: PrintPayment[];
  paid?: number;
  cashier?: string;
}) {
  const w = window.open('', '_blank', 'width=840,height=1180');
  if (!w) return;
  const t = opts.tenant;
  const activity = activityLabel(t);

  const logoImg = t.logo_url
    ? `<img src="${esc(t.logo_url)}" alt="" onerror="this.style.display='none'"/>`
    : '';

  const itemsHtml = opts.items
    .map(i => {
      const lineTotal = i.quantity * i.unit_price - (i.discount || 0);
      return `<tr>
        <td>
          <div class="bold">${esc(i.name)}</div>
          ${i.internal_ref ? `<div class="item-ref">${esc(i.internal_ref)}</div>` : ''}
          ${i.oem_ref ? `<div class="item-ref">OEM: ${esc(i.oem_ref)}</div>` : ''}
        </td>
        <td class="center">${i.quantity}</td>
        <td class="right">${fmtMoney(i.unit_price)} FCFA</td>
        <td class="right bold">${fmtMoney(lineTotal)} FCFA</td>
      </tr>`;
    })
    .join('');

  // Payment status determination
  const paidAmount = typeof opts.paid === 'number' ? opts.paid : (opts.payments || []).reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, opts.total - paidAmount);
  const isInvoiceType = ['FACTURE', 'BON DE COMMANDE'].includes(opts.docLabel);
  let statusBadge = '';
  if (isInvoiceType) {
    if (paidAmount >= opts.total) {
      statusBadge = '<span class="status-badge status-paid">PAY\u00C9E</span>';
    } else if (paidAmount > 0) {
      statusBadge = '<span class="status-badge status-partial">PARTIELLEMENT PAY\u00C9E</span>';
    } else {
      statusBadge = '<span class="status-badge status-unpaid">NON PAY\u00C9E</span>';
    }
  }

  // Financial summary rows
  let financialRows = `
    <div class="fin-row subtotal"><span>Sous-total</span><span>${fmtMoney(opts.subtotal)} FCFA</span></div>
    ${opts.discount && opts.discount > 0 ? `<div class="fin-row discount"><span>Remise</span><span>-${fmtMoney(opts.discount)} FCFA</span></div>` : ''}
    <div class="fin-row grand"><span>TOTAL TTC</span><span>${fmtMoney(opts.total)} FCFA</span></div>
  `;
  if (isInvoiceType) {
    financialRows += `
      <div class="fin-row paid-row"><span>Montant r\u00E9gl\u00E9</span><span>${fmtMoney(paidAmount)} FCFA</span></div>
      <div class="fin-row due-row"><span>Reste \u00E0 payer</span><span>${fmtMoney(remaining)} FCFA</span></div>
    `;
  }

  // Payments detail
  const paymentsHtml = opts.payments && opts.payments.length
    ? `<div class="payments-section">
        <h3>D\u00E9tail des r\u00E8glements</h3>
        ${opts.payments.map(p => `<div class="p-row"><span>${esc(p.method_name)}</span><span><strong>${fmtMoney(p.amount)} FCFA</strong></span></div>`).join('')}
      </div>`
    : '';

  const extraMeta = (opts.extraMeta || [])
    .map(m => `<p>${esc(m.label)}: ${esc(m.value)}</p>`)
    .join('');

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(opts.docLabel)} ${esc(opts.docNumber)}</title>
<style>${a4Style}</style></head><body>
<div class="page-content">
<div class="header">
  <div class="brand">
    ${logoImg}
    <div class="brand-text">
      <h1>${esc(t.name)}</h1>
      <div class="activity">${esc(activity)}</div>
      ${t.address ? `<p>${esc(t.address)}</p>` : ''}
      ${t.phone ? `<p>T\u00E9l: ${esc(t.phone)}</p>` : ''}
      ${t.email ? `<p>${esc(t.email)}</p>` : ''}
      ${t.website ? `<p>${esc(t.website)}</p>` : ''}
      ${t.ninea ? `<p>NINEA: ${esc(t.ninea)}</p>` : ''}
      ${t.rccm ? `<p>RCCM: ${esc(t.rccm)}</p>` : ''}
    </div>
  </div>
  <div class="doc-meta">
    <span class="tag">${esc(opts.docLabel)}</span>
    <h2>N\u00B0 ${esc(opts.docNumber)}</h2>
    <p>Date: ${esc(opts.docDate)}</p>
    ${opts.cashier ? `<p>\u00C9mis par: ${esc(opts.cashier)}</p>` : ''}
    ${extraMeta}
    ${statusBadge}
  </div>
</div>

<div class="parties">
  <div class="party">
    <h3>\u00C9metteur</h3>
    <p><strong>${esc(t.legal_name || t.name)}</strong></p>
    ${t.address ? `<p>${esc(t.address)}</p>` : ''}
    ${t.phone ? `<p>${esc(t.phone)}</p>` : ''}
    ${t.ninea ? `<p>NINEA: ${esc(t.ninea)}</p>` : ''}
  </div>
  <div class="party">
    <h3>Destinataire</h3>
    ${opts.customer
      ? `<p><strong>${esc(opts.customer.name)}</strong></p>${opts.customer.phone ? `<p>${esc(opts.customer.phone)}</p>` : ''}${opts.customer.address ? `<p>${esc(opts.customer.address)}</p>` : ''}`
      : '<p><em>Client comptoir</em></p>'}
  </div>
</div>

<table>
  <thead><tr>
    <th>D\u00E9signation</th>
    <th class="center">Qt\u00E9</th>
    <th class="right">Prix unitaire</th>
    <th class="right">Montant</th>
  </tr></thead>
  <tbody>${itemsHtml}</tbody>
</table>
</div>

<div class="page-bottom">
<div class="financial-summary">
  <div class="financial-box">
    ${financialRows}
  </div>
</div>

${paymentsHtml}

${opts.footerNote ? `<div class="footer-note">${esc(opts.footerNote)}</div>` : ''}

<div class="footer">
  <span>${esc(t.name)}${t.ninea ? ` \u2014 NINEA: ${esc(t.ninea)}` : ''}</span>
  <span>Imprim\u00E9 le ${new Date().toLocaleString('fr-FR')}</span>
</div>
${waarwiFooterA4()}
</div>
</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}
