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

// ── 80mm Thermal Receipt Style ────────────────────────────────────────────────
// All text is pure black, no grey, no opacity, optimized for low-quality thermal printers
const ticketStyle = `
  @page { margin: 0; size: 80mm auto; }
  @media print {
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { margin: 0 !important; padding: 2mm !important; }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 13px;
    width: 72mm;
    padding: 3mm;
    color: #000000;
    line-height: 1.4;
    background: #fff;
  }
  .center { text-align: center; }
  .logo-wrap { display: flex; justify-content: center; margin-bottom: 6px; }
  .logo-wrap img { max-width: 48mm; max-height: 22mm; object-fit: contain; }
  .shop-name {
    text-align: center;
    font-weight: 900;
    font-size: 19px;
    letter-spacing: 0.3px;
    color: #000000;
  }
  .activity {
    text-align: center;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    margin-top: 2px;
    margin-bottom: 5px;
    font-weight: 700;
    color: #000000;
  }
  .meta {
    text-align: center;
    font-size: 11.5px;
    font-weight: 500;
    color: #000000;
  }
  .hr { border: 0; border-top: 1px dashed #000000; margin: 6px 0; }
  .hr-solid { border: 0; border-top: 2px solid #000000; margin: 6px 0; }
  .doc-label {
    text-align: center;
    font-weight: 900;
    font-size: 15px;
    letter-spacing: 1.5px;
    margin: 5px 0 2px;
    color: #000000;
    text-transform: uppercase;
  }
  .doc-num {
    text-align: center;
    font-size: 14px;
    font-weight: 800;
    color: #000000;
  }
  .doc-date {
    text-align: center;
    font-size: 11.5px;
    font-weight: 600;
    color: #000000;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    font-size: 11.5px;
    margin-top: 3px;
    font-weight: 600;
    color: #000000;
  }
  .section {
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin: 4px 0 2px;
    color: #000000;
  }
  .item { margin: 7px 0 5px; }
  .item-name {
    font-size: 13.5px;
    font-weight: 800;
    line-height: 1.3;
    word-wrap: break-word;
    color: #000000;
  }
  .item-ref {
    font-size: 10.5px;
    font-weight: 600;
    font-family: 'Courier New', monospace;
    margin-top: 1px;
    color: #000000;
  }
  .item-line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-top: 3px;
    font-size: 12px;
    gap: 4px;
    flex-wrap: wrap;
  }
  .item-qty { font-weight: 900; font-size: 13px; color: #000000; }
  .item-pu { font-weight: 600; font-size: 11.5px; color: #000000; }
  .item-total { font-weight: 900; font-size: 14px; white-space: nowrap; color: #000000; }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 12px;
    padding: 2px 0;
    gap: 4px;
    flex-wrap: wrap;
    color: #000000;
    font-weight: 600;
  }
  .row span { white-space: nowrap; }
  .row.total {
    font-size: 16px;
    font-weight: 900;
    padding: 7px 0;
    color: #000000;
    border-top: 1px solid #000000;
    border-bottom: 1px solid #000000;
    margin: 3px 0;
  }
  .row.payment { font-size: 12.5px; font-weight: 700; }
  .row.change { font-weight: 900; font-size: 14px; color: #000000; }
  .footer {
    text-align: center;
    font-size: 11.5px;
    margin-top: 8px;
    color: #000000;
    line-height: 1.6;
  }
  .footer .thanks {
    font-weight: 800;
    font-size: 13px;
    color: #000000;
  }
  .waarwi-footer {
    text-align: center;
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px dashed #000000;
    font-size: 9.5px;
    color: #000000;
    font-weight: 600;
    line-height: 1.5;
  }
  .waarwi-footer strong { color: #000000; font-weight: 900; letter-spacing: 0.5px; }
  .waarwi-footer .waarwi-tag { font-size: 8.5px; color: #000000; margin-top: 1px; }
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
        ${i.internal_ref ? `<div class="item-ref">Réf: ${esc(i.internal_ref)}</div>` : ''}
        ${i.oem_ref ? `<div class="item-ref">OEM: ${esc(i.oem_ref)}</div>` : ''}
        <div class="item-line">
          <span><span class="item-qty">${i.quantity}</span> <span class="item-pu">× ${fmtMoney(i.unit_price)} FCFA</span></span>
          <span class="item-total">${fmtMoney(lineTotal)} FCFA</span>
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
${sale.discount > 0 ? `<div class="row"><span>Remise</span><span>- ${fmtMoney(sale.discount)} FCFA</span></div>` : ''}
<div class="row total"><span>TOTAL</span><span>${fmtMoney(sale.total)} FCFA</span></div>
<hr class="hr" />
${sale.payments.map(p => `<div class="row payment"><span>${esc(p.method_name)}</span><span><strong>${fmtMoney(p.amount)} FCFA</strong></span></div>`).join('')}
${change > 0 ? `<div class="row change"><span>MONNAIE RENDUE</span><span>${fmtMoney(change)} FCFA</span></div>` : ''}
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
        <span><span class="item-qty">- ${i.quantity}</span> <span class="item-pu">× ${fmtMoney(i.unit_price)} FCFA</span></span>
        <span class="item-total">- ${fmtMoney(i.quantity * i.unit_price)} FCFA</span>
      </div>
    </div>`)
    .join('');

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Retour</title>
<style>${ticketStyle}</style></head><body>
${tenantHeader80(tenant)}
<hr class="hr-solid" />
<div class="doc-label">TICKET DE RETOUR</div>
${returnNumber ? `<div class="doc-num">N° ${esc(returnNumber)}</div>` : ''}
<div class="doc-date">Réf. vente : ${esc(refSaleNumber)}</div>
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
    return `<div class="row"><span>${esc(label)}${reason ? ' : ' + esc(reason.slice(0, 22)) : ''}</span><span>${sign}${fmtMoney(m.amount)} FCFA</span></div>`;
  }).join('')}
<div class="row"><span>Sous-total entrées</span><span>+ ${fmtMoney(mvIncome + mvPrepay)} FCFA</span></div>
<div class="row"><span>Sous-total sorties</span><span>- ${fmtMoney(mvExpense)} FCFA</span></div>
<hr class="hr" />
<div class="row total"><span>Net caisse</span><span>${fmtMoney(netTotal)} FCFA</span></div>
` : '';

  const controlsHtml = controls.length > 0 ? `
<hr class="hr" />
<div class="section">Contrôle de caisse</div>
<div class="row"><span>Fond d'ouverture</span><span>${fmtMoney(opts.openingAmount)} FCFA</span></div>
${controls.map(c => {
    const diff = Number(c.difference_amount ?? (c.counted_amount - c.theoretical_amount));
    return `<div style="margin-top:3px">
<div style="font-weight:800;font-size:12px;color:#000">${esc(c.method_name)}</div>
<div class="row"><span>  Théorique</span><span>${fmtMoney(c.theoretical_amount)} FCFA</span></div>
<div class="row"><span>  Compté</span><span>${fmtMoney(c.counted_amount)} FCFA</span></div>
<div class="row"><span>  Écart</span><span>${diff >= 0 ? '+' : ''}${fmtMoney(diff)} FCFA</span></div>
</div>`;
  }).join('')}
<hr class="hr" />
<div class="row total"><span>Écart total</span><span>${variance >= 0 ? '+' : ''}${fmtMoney(variance)} FCFA</span></div>
` : '';

  const regularizationsHtml = regularizations.length > 0 ? `
<hr class="hr" />
<div class="section">Régularisations</div>
${regularizations.map(r => `<div class="row"><span>${esc(r.reg_type)} : ${esc(r.reason)}</span><span>${fmtMoney(r.amount)} FCFA</span></div>`).join('')}
` : '';

  const topArticlesHtml = topArticles.length > 0 ? `
<hr class="hr" />
<div class="section">Top articles</div>
${topArticles.map(a => `<div class="row"><span>${esc(a.name.slice(0, 24))}</span><span>x${a.qty} · ${fmtMoney(a.total)}</span></div>`).join('')}
` : '';

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>X de Caisse</title>
<style>${ticketStyle}</style></head><body>
${tenantHeader80(opts.tenant)}
<hr class="hr-solid" />
<div class="doc-label">X DE CAISSE</div>
<div class="doc-date">Session : ${esc(opts.sessionId.slice(0, 8).toUpperCase())}</div>
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
    : '<div style="font-size:11.5px;font-weight:600;color:#000">Aucun encaissement</div>'}
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

// ── A4 Document Style ─────────────────────────────────────────────────────────
// Pure black text, no grey, no opacity, professional corporate layout
const a4Style = `
  @page { margin: 14mm 14mm 18mm 14mm; size: A4; }
  @media print {
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html, body { margin: 0 !important; }
    .no-break { page-break-inside: avoid; }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 11.5px;
    color: #000000;
    display: flex;
    flex-direction: column;
    background: #ffffff;
    line-height: 1.45;
  }
  .page-content { flex: 1 1 auto; }
  .page-bottom { margin-top: 14px; }

  /* Header */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 2.5px solid #000000;
  }
  .brand { display: flex; gap: 14px; align-items: flex-start; }
  .brand img { max-width: 76px; max-height: 76px; object-fit: contain; }
  .brand-text h1 {
    font-size: 21px;
    font-weight: 900;
    color: #000000;
    line-height: 1.1;
  }
  .brand-text .activity {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: #000000;
    margin-top: 4px;
    font-weight: 700;
  }
  .brand-text p {
    font-size: 11px;
    color: #000000;
    margin-top: 2px;
    font-weight: 500;
  }

  /* Document meta (right side of header) */
  .doc-meta { text-align: right; min-width: 180px; }
  .doc-meta .tag {
    display: inline-block;
    padding: 5px 12px;
    background: #000000;
    color: #ffffff;
    border-radius: 3px;
    font-size: 10px;
    letter-spacing: 2px;
    font-weight: 800;
    text-transform: uppercase;
  }
  .doc-meta h2 {
    font-size: 21px;
    font-weight: 900;
    margin-top: 10px;
    color: #000000;
    font-variant-numeric: tabular-nums;
  }
  .doc-meta p {
    font-size: 11px;
    color: #000000;
    margin-top: 3px;
    font-weight: 600;
  }
  .status-badge {
    display: inline-block;
    padding: 5px 14px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 1px;
    text-transform: uppercase;
    margin-top: 10px;
    border: 2px solid #000000;
    color: #000000;
    background: #ffffff;
  }
  .status-paid { border-color: #000000; }
  .status-partial { border-color: #000000; }
  .status-unpaid { border-color: #000000; }

  /* Parties (emitter / recipient) */
  .parties {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 22px;
  }
  .party {
    border: 1.5px solid #000000;
    border-radius: 4px;
    padding: 12px 14px;
  }
  .party h3 {
    font-size: 9.5px;
    font-weight: 800;
    text-transform: uppercase;
    color: #000000;
    margin-bottom: 7px;
    letter-spacing: 1.5px;
    border-bottom: 1px solid #000000;
    padding-bottom: 5px;
  }
  .party p {
    font-size: 11.5px;
    margin-bottom: 2px;
    color: #000000;
    font-weight: 500;
  }
  .party p strong { font-weight: 800; }

  /* Items table */
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 18px;
    table-layout: fixed;
  }
  thead tr { background: #000000; color: #ffffff; }
  th {
    padding: 9px 10px;
    text-align: left;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #ffffff;
  }
  th.right { text-align: right; }
  th.center { text-align: center; }
  th:nth-child(1) { width: 40%; }
  th:nth-child(2) { width: 10%; }
  th:nth-child(3) { width: 25%; }
  th:nth-child(4) { width: 25%; }
  td {
    padding: 9px 10px;
    font-size: 11px;
    border-bottom: 1px solid #000000;
    vertical-align: top;
    color: #000000;
    font-weight: 500;
  }
  tbody tr:nth-child(even) td { background: #f5f5f5; }
  td.right { text-align: right; }
  td.center { text-align: center; font-weight: 700; }
  td.bold { font-weight: 800; color: #000000; }
  .item-ref {
    font-size: 10px;
    font-weight: 600;
    font-family: 'Courier New', monospace;
    margin-top: 2px;
    color: #000000;
  }

  /* Financial summary */
  .financial-summary { display: flex; justify-content: flex-end; margin-top: 12px; }
  .financial-box {
    width: 340px;
    border: 2px solid #000000;
    border-radius: 4px;
    overflow: hidden;
  }
  .fin-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 9px 14px;
    font-size: 12px;
    font-weight: 600;
    border-bottom: 1px solid #000000;
    gap: 8px;
    flex-wrap: wrap;
    color: #000000;
  }
  .fin-row:last-child { border-bottom: none; }
  .fin-row span { white-space: nowrap; }
  .fin-row.subtotal { background: #f5f5f5; }
  .fin-row.discount { background: #f5f5f5; font-weight: 700; }
  .fin-row.grand {
    background: #000000;
    color: #ffffff;
    font-size: 15px;
    font-weight: 900;
    padding: 12px 16px;
  }
  .fin-row.grand span { color: #ffffff !important; }
  .fin-row.paid-row { background: #f5f5f5; font-weight: 700; }
  .fin-row.due-row { background: #e8e8e8; font-weight: 900; font-size: 13px; }

  /* Payment details */
  .payments-section { margin-top: 16px; }
  .payments-section h3 {
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    color: #000000;
    margin-bottom: 7px;
    letter-spacing: 1px;
    border-bottom: 1px solid #000000;
    padding-bottom: 5px;
  }
  .p-row {
    display: flex;
    justify-content: space-between;
    font-size: 11.5px;
    font-weight: 600;
    padding: 4px 0;
    color: #000000;
    border-bottom: 1px dashed #000000;
  }
  .p-row:last-child { border-bottom: none; }
  .p-row strong { font-weight: 800; }

  /* Footer */
  .footer {
    padding-top: 12px;
    border-top: 1.5px solid #000000;
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    font-weight: 600;
    color: #000000;
    margin-top: 20px;
  }
  .footer-note {
    margin-top: 10px;
    font-size: 11px;
    color: #000000;
    font-style: italic;
    font-weight: 600;
  }
  .waarwi-brand-footer {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px dashed #000000;
    text-align: center;
    font-size: 9.5px;
    color: #000000;
    font-weight: 600;
    letter-spacing: 0.3px;
  }
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
          ${i.internal_ref ? `<div class="item-ref">Réf : ${esc(i.internal_ref)}</div>` : ''}
          ${i.oem_ref ? `<div class="item-ref">OEM : ${esc(i.oem_ref)}</div>` : ''}
        </td>
        <td class="center">${i.quantity}</td>
        <td class="right">${fmtMoney(i.unit_price)} FCFA</td>
        <td class="right bold">${fmtMoney(lineTotal)} FCFA</td>
      </tr>`;
    })
    .join('');

  // Payment status
  const paidAmount = typeof opts.paid === 'number' ? opts.paid : (opts.payments || []).reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, opts.total - paidAmount);
  const isInvoiceType = ['FACTURE', 'BON DE COMMANDE'].includes(opts.docLabel);
  let statusBadge = '';
  if (isInvoiceType) {
    if (paidAmount >= opts.total) {
      statusBadge = '<span class="status-badge status-paid">PAYÉE</span>';
    } else if (paidAmount > 0) {
      statusBadge = '<span class="status-badge status-partial">PARTIELLEMENT PAYÉE</span>';
    } else {
      statusBadge = '<span class="status-badge status-unpaid">NON PAYÉE</span>';
    }
  }

  // Financial summary rows
  let financialRows = `
    <div class="fin-row subtotal"><span>Sous-total</span><span>${fmtMoney(opts.subtotal)} FCFA</span></div>
    ${opts.discount && opts.discount > 0 ? `<div class="fin-row discount"><span>Remise</span><span>- ${fmtMoney(opts.discount)} FCFA</span></div>` : ''}
    <div class="fin-row grand"><span>TOTAL TTC</span><span>${fmtMoney(opts.total)} FCFA</span></div>
  `;
  if (isInvoiceType) {
    financialRows += `
      <div class="fin-row paid-row"><span>Montant réglé</span><span>${fmtMoney(paidAmount)} FCFA</span></div>
      <div class="fin-row due-row"><span>Reste à payer</span><span>${fmtMoney(remaining)} FCFA</span></div>
    `;
  }

  // Payments detail
  const paymentsHtml = opts.payments && opts.payments.length
    ? `<div class="payments-section">
        <h3>Détail des règlements</h3>
        ${opts.payments.map(p => `<div class="p-row"><span>${esc(p.method_name)}</span><span><strong>${fmtMoney(p.amount)} FCFA</strong></span></div>`).join('')}
      </div>`
    : '';

  const extraMeta = (opts.extraMeta || [])
    .map(m => `<p>${esc(m.label)} : ${esc(m.value)}</p>`)
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
      ${t.phone ? `<p>Tél : ${esc(t.phone)}</p>` : ''}
      ${t.email ? `<p>${esc(t.email)}</p>` : ''}
      ${t.website ? `<p>${esc(t.website)}</p>` : ''}
      ${t.ninea ? `<p>NINEA : ${esc(t.ninea)}</p>` : ''}
      ${t.rccm ? `<p>RCCM : ${esc(t.rccm)}</p>` : ''}
    </div>
  </div>
  <div class="doc-meta">
    <span class="tag">${esc(opts.docLabel)}</span>
    <h2>N° ${esc(opts.docNumber)}</h2>
    <p>Date : ${esc(opts.docDate)}</p>
    ${opts.cashier ? `<p>Émis par : ${esc(opts.cashier)}</p>` : ''}
    ${extraMeta}
    ${statusBadge}
  </div>
</div>

<div class="parties">
  <div class="party">
    <h3>Émetteur</h3>
    <p><strong>${esc(t.legal_name || t.name)}</strong></p>
    ${t.address ? `<p>${esc(t.address)}</p>` : ''}
    ${t.phone ? `<p>${esc(t.phone)}</p>` : ''}
    ${t.ninea ? `<p>NINEA : ${esc(t.ninea)}</p>` : ''}
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
    <th>Désignation</th>
    <th class="center">Qté</th>
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
  <span>${esc(t.name)}${t.ninea ? ` — NINEA : ${esc(t.ninea)}` : ''}</span>
  <span>Imprimé le ${new Date().toLocaleString('fr-FR')}</span>
</div>
${waarwiFooterA4()}
</div>
</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}
