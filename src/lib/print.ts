import { BUSINESS_TYPE_LABELS, mergeTicketHeaderConfig } from './types';
import type { TicketHeaderItem, TicketHeaderSize } from './types';

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
  activity_name?: string | null;
  header_config?: TicketHeaderItem[] | null;
};

// Build a fully-populated PrintTenant from any tenant-like object.
// Use this everywhere a print function is called so headers
// (logo, NINEA, RCCM, legal name, contact info, activity, custom layout) are never truncated.
export function buildPrintTenant(t: any): PrintTenant {
  return {
    name: t?.name || '',
    legal_name: t?.legal_name,
    ninea: t?.ninea,
    rccm: t?.rccm,
    address: t?.address,
    phone: t?.phone,
    email: t?.email,
    website: t?.website,
    logo_url: t?.logo_url,
    business_type: t?.business_type,
    activity_name: t?.business_activity_type_name ?? null,
    header_config: t?.ticket_header_config ?? null,
  };
}

// Build a PrintTenant with site-level overrides (multi-store support).
// Site-specific values take priority over tenant values when set.
export function buildPrintTenantForSite(t: any, site: any): PrintTenant {
  const base = buildPrintTenant(t);
  if (!site) return base;
  return {
    ...base,
    name: site.name || base.name,
    legal_name: site.legal_name || base.legal_name,
    ninea: site.ninea || base.ninea,
    rccm: site.rccm || base.rccm,
    address: site.address || base.address,
    phone: site.phone || base.phone,
    email: site.email || base.email,
    website: site.website || base.website,
    logo_url: site.logo_url || base.logo_url,
    header_config: site.ticket_header_config ?? base.header_config,
  };
}

const WAARWI_FOOTER = 'Propulsée par WAARWI — Plateforme Business 2.0 made in Sénégal';

export type PrintItem = {
  name: string;
  supplier_ref?: string | null;
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

export function computeWarrantyExpiry(saleDate: string, warranty: string | null): string {
  if (!warranty) return '';
  const lower = warranty.toLowerCase().trim();
  const numMatch = lower.match(/^(\d+)/);
  if (!numMatch) return '';
  const num = parseInt(numMatch[1], 10);
  let days = num * 30;
  if (lower.includes('an') || lower.includes('year')) days = num * 365;
  else if (lower.includes('mois') || lower.includes('month')) days = num * 30;
  else if (lower.includes('jour') || lower.includes('day')) days = num;
  else if (lower.includes('semaine') || lower.includes('week')) days = num * 7;
  const end = new Date(saleDate);
  end.setDate(end.getDate() + days);
  return end.toLocaleDateString('fr-FR');
}

const activityLabel = (t: PrintTenant) => {
  // Priority: explicit activity name from business_activity_types (set in Platform Admin),
  // then mapped business_type label, then fallback.
  if (t.activity_name && String(t.activity_name).trim()) return String(t.activity_name).trim();
  if (t.business_type && BUSINESS_TYPE_LABELS[t.business_type]) return BUSINESS_TYPE_LABELS[t.business_type];
  return 'Commerce';
};

// ── Header field rendering (size + line-break configurable) ──────────────────
// Sizes are mapped per medium (80mm thermal vs A4 document).
const HEADER_SIZES_80: Record<TicketHeaderSize, { fs: number; fw: number }> = {
  xs: { fs: 9.5,  fw: 500 },
  sm: { fs: 11.5, fw: 500 },
  md: { fs: 13,   fw: 600 },
  lg: { fs: 16,   fw: 700 },
  xl: { fs: 19,   fw: 900 },
};

const HEADER_SIZES_A4: Record<TicketHeaderSize, { fs: number; fw: number }> = {
  xs: { fs: 9,    fw: 500 },
  sm: { fs: 10.5, fw: 500 },
  md: { fs: 12,   fw: 600 },
  lg: { fs: 14,   fw: 700 },
  xl: { fs: 18,   fw: 800 },
};

function headerFieldValue(t: PrintTenant, key: string): string {
  switch (key) {
    case 'name':       return t.name || '';
    case 'legal_name': return t.legal_name || '';
    case 'activity':   return activityLabel(t);
    case 'address':    return t.address || '';
    case 'phone':      return t.phone ? `Tél: ${t.phone}` : '';
    case 'email':      return t.email || '';
    case 'website':    return t.website || '';
    case 'ninea':      return t.ninea ? `NINEA: ${t.ninea}` : '';
    case 'rccm':       return t.rccm ? `RCCM: ${t.rccm}` : '';
    default:           return '';
  }
}

function tenantHeader80(t: PrintTenant) {
  const config = mergeTicketHeaderConfig(t.header_config);
  const parts: string[] = [];
  for (const item of config) {
    if (!item.show) continue;
    if (item.key === 'logo') {
      if (!t.logo_url) continue;
      const px = item.size === 'xl' ? 28 : item.size === 'lg' ? 22 : item.size === 'md' ? 18 : item.size === 'sm' ? 14 : 10;
      parts.push(`<div class="logo-wrap" style="margin-bottom:${item.breakAfter ? 10 : 6}px;"><img src="${esc(t.logo_url)}" alt="" style="max-height:${px}mm;max-width:60mm;object-fit:contain;" onerror="this.style.display='none'"/></div>`);
      continue;
    }
    const value = headerFieldValue(t, item.key);
    if (!value) continue;
    const sz = HEADER_SIZES_80[item.size] || HEADER_SIZES_80.sm;
    const cls = item.key === 'name' ? 'shop-name' : item.key === 'activity' ? 'activity' : 'meta';
    const extraStyle = item.key === 'legal_name' ? 'font-weight:700;' : '';
    const breakStyle = item.breakAfter ? 'margin-bottom:6px;' : '';
    parts.push(`<div class="${cls}" style="font-size:${sz.fs}px;font-weight:${sz.fw};${extraStyle}${breakStyle}">${esc(value)}</div>`);
  }
  return parts.join('');
}

function tenantHeaderA4Lines(t: PrintTenant) {
  const config = mergeTicketHeaderConfig(t.header_config);
  const parts: string[] = [];
  for (const item of config) {
    if (item.key === 'logo') continue;
    if (!item.show) continue;
    const value = headerFieldValue(t, item.key);
    if (!value) continue;
    const sz = HEADER_SIZES_A4[item.size] || HEADER_SIZES_A4.sm;
    const cls = item.key === 'name' ? 'h1' : item.key === 'activity' ? 'activity' : 'p';
    const extraStyle = item.key === 'legal_name' ? 'font-weight:700;' : '';
    const breakStyle = item.breakAfter ? 'margin-bottom:6px;' : '';
    if (cls === 'h1') {
      parts.push(`<h1 style="font-size:${sz.fs}px;font-weight:${sz.fw};line-height:1.1;${breakStyle}">${esc(value)}</h1>`);
    } else if (cls === 'activity') {
      parts.push(`<div class="activity" style="font-size:${sz.fs}px;font-weight:${sz.fw};${breakStyle}">${esc(value)}</div>`);
    } else {
      parts.push(`<p style="font-size:${sz.fs}px;font-weight:${sz.fw};${extraStyle}${breakStyle}">${esc(value)}</p>`);
    }
  }
  return parts.join('');
}

function tenantLogoA4(t: PrintTenant) {
  const config = mergeTicketHeaderConfig(t.header_config);
  const item = config.find(c => c.key === 'logo');
  if (!item || !item.show || !t.logo_url) return '';
  const px = item.size === 'xl' ? 96 : item.size === 'lg' ? 76 : item.size === 'md' ? 60 : item.size === 'sm' ? 46 : 32;
  return `<img src="${esc(t.logo_url)}" alt="" style="max-width:${px}px;max-height:${px}px;object-fit:contain;" onerror="this.style.display='none'"/>`;
}

function waarwiFooter80() {
  return `<div class="waarwi-footer">Propulsée par <strong>WAARWI</strong><div class="waarwi-tag">Plateforme Business 2.0 made in Sénégal</div></div>`;
}

function waarwiFooterA4() {
  return `<div class="waarwi-brand-footer">${esc(WAARWI_FOOTER)}</div>`;
}

// ── Hidden iframe printing ────────────────────────────────────────────────────
// Renders the HTML inside an offscreen iframe and triggers print.
// Only the browser's print dialog is shown; the auxiliary window/page is hidden.
function printHtml(html: string, delayMs = 300) {
  if (typeof document === 'undefined') return;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => {
      try { iframe.parentNode?.removeChild(iframe); } catch { /* ignore */ }
    }, 1000);
  };

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) { cleanup(); return; }
  doc.open();
  doc.write(html);
  doc.close();

  const trigger = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch { /* ignore */ }
    try {
      if (iframe.contentWindow) iframe.contentWindow.onafterprint = cleanup;
    } catch { /* ignore */ }
    setTimeout(cleanup, 60_000);
  };

  const win = iframe.contentWindow;
  if (win && win.document.readyState !== 'complete') {
    win.addEventListener('load', () => setTimeout(trigger, delayMs), { once: true });
    setTimeout(trigger, delayMs + 800);
  } else {
    setTimeout(trigger, delayMs);
  }
}

// ── 80mm Thermal Receipt Style ────────────────────────────────────────────────
// All text is pure black, no grey, no opacity, optimized for low-quality thermal printers
const ticketStyle = `
  @page { margin: 0; size: 80mm auto; }
  @media print {
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html, body { margin: 0 !important; }
    body { padding: 1.5mm 2mm !important; width: 80mm !important; }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 13px;
    width: 80mm;
    padding: 1.5mm 2mm;
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
    docHeader?: { delivery_date?: string | null; reference?: string | null; warranty?: string | null; imei?: string | null; representative?: string | null } | null;
  },
  tenant: PrintTenant,
  cashier: string
) {
  const totalPaid = sale.payments.reduce((s, p) => s + p.amount, 0);
  const change = Math.max(0, totalPaid - sale.total);
  const subtotal = sale.items.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
  const itemsHtml = sale.items
    .map(i => {
      const lineTotal = i.quantity * i.unit_price - (i.discount || 0);
      return `<div class="item">
        <div class="item-name">${esc(i.name)}</div>
        ${i.supplier_ref ? `<div class="item-ref">Réf: ${esc(i.supplier_ref)}</div>` : ''}
        ${i.oem_ref ? `<div class="item-ref">OEM: ${esc(i.oem_ref)}</div>` : ''}
        <div class="item-line">
          <span><span class="item-qty">${i.quantity}</span> <span class="item-pu">× ${fmtMoney(i.unit_price)} FCFA</span></span>
          <span class="item-total">${fmtMoney(lineTotal)} FCFA</span>
        </div>
      </div>`;
    })
    .join('');

  const docHeaderRows = [
    ...(sale.docHeader?.reference ? [`<div class="info-row"><span>Réf.</span><span>${esc(sale.docHeader.reference)}</span></div>`] : []),
    ...(sale.docHeader?.delivery_date ? [`<div class="info-row"><span>Livraison</span><span>${new Date(sale.docHeader.delivery_date).toLocaleDateString('fr-FR')}</span></div>`] : []),
    ...(sale.docHeader?.imei ? [`<div class="info-row"><span>IMEI</span><span>${esc(sale.docHeader.imei)}</span></div>`] : []),
    ...(sale.docHeader?.warranty ? [`<div class="info-row"><span>Garantie</span><span>${esc(sale.docHeader.warranty)}</span></div>`] : []),
    ...(sale.docHeader?.warranty ? [`<div class="info-row"><span>Expire le</span><span>${computeWarrantyExpiry(sale.created_at, sale.docHeader.warranty)}</span></div>`] : []),
    ...(sale.docHeader?.representative ? [`<div class="info-row"><span>Représentant</span><span>${esc(sale.docHeader.representative)}</span></div>`] : []),
  ].join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket ${esc(sale.sale_number)}</title>
<style>${ticketStyle}</style></head><body>
${tenantHeader80(tenant)}
<hr class="hr-solid" />
<div class="doc-label">TICKET DE CAISSE</div>
<div class="doc-num">N° ${esc(sale.sale_number)}</div>
<div class="doc-date">${new Date(sale.created_at).toLocaleString('fr-FR')}</div>
<div class="info-row"><span>Caissier</span><span>${esc(cashier)}</span></div>
${sale.customer ? `<div class="info-row"><span>Client</span><span>${esc(sale.customer.name)}</span></div>` : ''}
${docHeaderRows}
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
</body></html>`;
  printHtml(html);
}

export function printReturnTicket80(
  refSaleNumber: string,
  items: { name: string; quantity: number; unit_price: number }[],
  total: number,
  tenant: PrintTenant,
  cashier: string,
  returnNumber?: string
) {
  const itemsHtml = items
    .map(i => `<div class="item">
      <div class="item-name">${esc(i.name)}</div>
      <div class="item-line">
        <span><span class="item-qty">- ${i.quantity}</span> <span class="item-pu">× ${fmtMoney(i.unit_price)} FCFA</span></span>
        <span class="item-total">- ${fmtMoney(i.quantity * i.unit_price)} FCFA</span>
      </div>
    </div>`)
    .join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Retour</title>
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
<div class="row total"><span>REMBOURSEMENT</span><span>- ${fmtMoney(total)} FCFA</span></div>
<hr class="hr" />
<div class="footer"><div class="thanks">Montant déduit de la caisse</div></div>
${waarwiFooter80()}
</body></html>`;
  printHtml(html);
}

// ── 80mm Direct cash receipt ──────────────────────────────────────────────────
export function printEncaissementTicket80(opts: {
  receiptNumber: string;
  amount: number;
  method: string;
  label?: string;
  reference?: string;
  customerName?: string | null;
  createdAt?: string;
  tenant: PrintTenant;
  cashier: string;
}) {
  const date = opts.createdAt ? new Date(opts.createdAt) : new Date();

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recu ${esc(opts.receiptNumber)}</title>
<style>${ticketStyle}</style></head><body>
${tenantHeader80(opts.tenant)}
<hr class="hr-solid" />
<div class="doc-label">RECU D'ENCAISSEMENT</div>
<div class="doc-num">N° ${esc(opts.receiptNumber)}</div>
<div class="doc-date">${date.toLocaleString('fr-FR')}</div>
<div class="info-row"><span>Caissier</span><span>${esc(opts.cashier)}</span></div>
${opts.customerName ? `<div class="info-row"><span>Client</span><span>${esc(opts.customerName)}</span></div>` : ''}
<hr class="hr" />
${opts.label ? `<div class="section">Motif</div><div class="item-name" style="font-weight:700;font-size:12.5px;margin-bottom:4px;">${esc(opts.label)}</div>` : ''}
${opts.reference ? `<div class="info-row"><span>Référence</span><span>${esc(opts.reference)}</span></div>` : ''}
<hr class="hr" />
<div class="row payment"><span>Mode</span><span>${esc(opts.method)}</span></div>
<div class="row total"><span>MONTANT REÇU</span><span>${fmtMoney(opts.amount)} FCFA</span></div>
<hr class="hr" />
<div class="footer">
  <div class="thanks">Merci de votre règlement</div>
  <div>Conservez ce reçu</div>
</div>
${waarwiFooter80()}
</body></html>`;
  printHtml(html);
}

// ── 80mm Cash expense (decaissement) receipt ──────────────────────────────────
export function printDecaissementTicket80(opts: {
  receiptNumber: string;
  amount: number;
  method: string;
  label?: string;
  reference?: string;
  beneficiary?: string | null;
  createdAt?: string;
  tenant: PrintTenant;
  cashier: string;
}) {
  const date = opts.createdAt ? new Date(opts.createdAt) : new Date();

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recu ${esc(opts.receiptNumber)}</title>
<style>${ticketStyle}</style></head><body>
${tenantHeader80(opts.tenant)}
<hr class="hr-solid" />
<div class="doc-label">BON DE DECAISSEMENT</div>
<div class="doc-num">N° ${esc(opts.receiptNumber)}</div>
<div class="doc-date">${date.toLocaleString('fr-FR')}</div>
<div class="info-row"><span>Caissier</span><span>${esc(opts.cashier)}</span></div>
${opts.beneficiary ? `<div class="info-row"><span>Bénéficiaire</span><span>${esc(opts.beneficiary)}</span></div>` : ''}
<hr class="hr" />
${opts.label ? `<div class="section">Motif</div><div class="item-name" style="font-weight:700;font-size:12.5px;margin-bottom:4px;">${esc(opts.label)}</div>` : ''}
${opts.reference ? `<div class="info-row"><span>Référence</span><span>${esc(opts.reference)}</span></div>` : ''}
<hr class="hr" />
<div class="row payment"><span>Mode</span><span>${esc(opts.method)}</span></div>
<div class="row total"><span>MONTANT VERSÉ</span><span>- ${fmtMoney(opts.amount)} FCFA</span></div>
<hr class="hr" />
<div class="footer">
  <div class="thanks">Montant déduit de la caisse</div>
  <div>Conservez ce reçu</div>
</div>
${waarwiFooter80()}
</body></html>`;
  printHtml(html);
}



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

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>X de Caisse</title>
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
<div class="row total"><span>Total encaissé</span><span>${fmtMoney(opts.salesTotal)} FCFA</span></div>
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
</body></html>`;
  printHtml(html);
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
  .page-bottom { margin-top: 14px; page-break-inside: avoid; break-inside: avoid; }

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
    background: #e8e8e8;
    color: #000000;
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
  thead tr { background: #e8e8e8; color: #000000; }
  th {
    padding: 9px 10px;
    text-align: left;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #000000;
  }
  th.right { text-align: right; }
  th.center { text-align: center; }
  th:nth-child(1) { width: 55%; }
  th:nth-child(2) { width: 8%; }
  th:nth-child(3) { width: 18%; }
  th:nth-child(4) { width: 19%; }
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
    background: #e8e8e8;
    color: #000000;
    font-size: 15px;
    font-weight: 900;
    padding: 12px 16px;
  }
  .fin-row.grand span { color: #000000 !important; }
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
  docCreatedAt?: string;
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
  issuedBy?: string;
  docHeader?: { delivery_date?: string | null; reference?: string | null; warranty?: string | null; imei?: string | null; representative?: string | null } | null;
}) {
  const t = opts.tenant;

  const logoImg = tenantLogoA4(t);
  const headerLines = tenantHeaderA4Lines(t);

  const itemsHtml = opts.items
    .map(i => {
      const lineTotal = i.quantity * i.unit_price - (i.discount || 0);
      return `<tr>
        <td>
          <div class="bold">${esc(i.name)}</div>
          ${i.supplier_ref ? `<div class="item-ref">Réf : ${esc(i.supplier_ref)}</div>` : ''}
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
    ${opts.discount && opts.discount > 0 ? `<div class="fin-row discount"><span>Remise</span><span>- ${fmtMoney(opts.discount)} FCFA</span></div>` : ''}
    <div class="fin-row grand"><span>TOTAL TTC</span><span>${fmtMoney(opts.total)} FCFA</span></div>
  `;
  if (isInvoiceType) {
    financialRows += `
      <div class="fin-row paid-row"><span>Règlement</span><span>${fmtMoney(paidAmount)} FCFA</span></div>
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

  const extraMeta = [
    ...(opts.extraMeta || []),
    ...(opts.docHeader?.reference ? [{ label: 'Reference', value: opts.docHeader.reference }] : []),
    ...(opts.docHeader?.delivery_date ? [{ label: 'Date de livraison', value: new Date(opts.docHeader.delivery_date).toLocaleDateString('fr-FR') }] : []),
    ...(opts.docHeader?.warranty ? [{ label: 'Garantie', value: opts.docHeader.warranty }] : []),
    ...(opts.docHeader?.warranty && opts.docCreatedAt ? [{ label: 'Expiration garantie', value: computeWarrantyExpiry(opts.docCreatedAt, opts.docHeader.warranty) }] : []),
    ...(opts.docHeader?.imei ? [{ label: 'IMEI / Téléphone', value: opts.docHeader.imei }] : []),
    ...(opts.docHeader?.representative ? [{ label: 'Représentant', value: opts.docHeader.representative }] : []),
  ].map(m => `<p>${esc(m.label)} : ${esc(m.value)}</p>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(opts.docLabel)} ${esc(opts.docNumber)}</title>
<style>${a4Style}</style></head><body>
<div class="page-content">
<div class="header">
  <div class="brand">
    ${logoImg}
    <div class="brand-text">
      ${headerLines}
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
    <h3>Facturé par</h3>
    <p><strong>${esc(opts.issuedBy || t.legal_name || t.name)}</strong></p>
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
</body></html>`;
  printHtml(html, 400);
}

// ── Stock Movement Print (A4) ─────────────────────────────────────────────────
export type StockMovementPrintItem = {
  ref: string;
  name: string;
  quantity: number;
  note?: string;
};

export type StockMovementPrintOpts = {
  tenant: PrintTenant;
  movementType: string;
  movementLabel: string;
  reference: string;
  date: string;
  user: string;
  siteOrigin?: string;
  siteDestination?: string;
  items: StockMovementPrintItem[];
  observation?: string;
  siteName?: string;
};

const MOVEMENT_TYPE_TITLES: Record<string, string> = {
  adjustment_in: 'BON D\'ENTRÉE DE STOCK',
  adjustment_out: 'BON DE SORTIE DE STOCK',
  transfer_in: 'BON DE TRANSFERT',
  transfer_out: 'BON DE TRANSFERT',
  transfer: 'BON DE TRANSFERT',
  inventory: 'FICHE D\'INVENTAIRE',
  bulk_in: 'BON D\'ENTRÉE EN MASSE',
  bulk_out: 'BON DE SORTIE EN MASSE',
  bulk_transfer: 'BON DE TRANSFERT EN MASSE',
  bulk_inventory: 'FICHE D\'INVENTAIRE EN MASSE',
};

export function printStockMovementA4(opts: StockMovementPrintOpts) {
  const t = opts.tenant;
  const title = MOVEMENT_TYPE_TITLES[opts.movementType] || 'BON DE MOUVEMENT DE STOCK';
  const totalQty = opts.items.reduce((s, i) => s + Math.abs(i.quantity), 0);

  const rowsHtml = opts.items.map((item, i) => `
    <tr>
      <td style="text-align:center;font-weight:600;color:#64748b;">${i + 1}</td>
      <td style="font-family:'Courier New',monospace;font-size:9pt;font-weight:600;">${esc(item.ref)}</td>
      <td style="font-weight:600;">${esc(item.name)}</td>
      <td style="text-align:center;font-weight:700;font-variant-numeric:tabular-nums;">${Math.abs(item.quantity)}</td>
      <td style="font-size:9pt;color:#64748b;">${esc(item.note || '')}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)} - ${esc(opts.reference)}</title>
<style>
  @page { size: A4; margin: 15mm 12mm; }
  @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1e293b; font-size: 10pt; line-height: 1.5; background: #fff; }
  .doc { max-width: 186mm; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 6mm; margin-bottom: 5mm; border-bottom: 2px solid #0f766e; }
  .header .left { }
  .header .logo { max-height: 16mm; max-width: 40mm; object-fit: contain; margin-bottom: 2mm; display: block; }
  .header .company { font-size: 14pt; font-weight: 800; color: #0f172a; }
  .header .info { font-size: 8.5pt; color: #475569; margin-top: 1mm; }
  .header .right { text-align: right; }
  .header .ref { font-family: 'Courier New', monospace; font-size: 11pt; font-weight: 800; color: #0f766e; }
  .header .date { font-size: 9pt; color: #475569; margin-top: 1mm; }
  .title { text-align: center; font-size: 14pt; font-weight: 800; letter-spacing: 1px; color: #0f766e; margin: 5mm 0 3mm; text-transform: uppercase; }
  .meta-bar { display: flex; gap: 4mm; flex-wrap: wrap; margin-bottom: 5mm; padding: 3mm 4mm; border: 1px solid #e2e8f0; border-radius: 2mm; background: #f8fafc; }
  .meta-bar .cell { flex: 1; min-width: 35mm; }
  .meta-bar .cell .lbl { font-size: 7.5pt; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.8px; }
  .meta-bar .cell .val { font-size: 10pt; font-weight: 700; color: #0f172a; margin-top: 0.5mm; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
  thead tr { background: #f1f5f9; }
  thead th { text-align: left; font-size: 8pt; padding: 2.5mm 3mm; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #475569; border-bottom: 1.5px solid #cbd5e1; }
  thead th.center { text-align: center; }
  tbody tr { border-bottom: 1px solid #e2e8f0; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tbody td { padding: 2.5mm 3mm; font-size: 9.5pt; vertical-align: top; }
  .total-row { background: #f1f5f9 !important; border-top: 1.5px solid #cbd5e1; }
  .total-row td { font-weight: 800; font-size: 10pt; padding: 3mm; }
  .observation { margin: 5mm 0; padding: 3mm 4mm; border: 1px solid #e2e8f0; border-radius: 2mm; background: #f8fafc; }
  .observation .lbl { font-size: 8pt; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 1mm; }
  .observation .txt { font-size: 9.5pt; color: #1e293b; }
  .signatures { display: flex; justify-content: space-between; margin-top: 12mm; padding-top: 5mm; }
  .sig-block { width: 55mm; text-align: center; }
  .sig-block .line { height: 15mm; border-bottom: 1px solid #94a3b8; }
  .sig-block .cap { margin-top: 2mm; font-size: 8pt; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.8px; }
  .footer-brand { margin-top: 8mm; padding-top: 3mm; border-top: 1px dashed #cbd5e1; text-align: center; font-size: 8pt; color: #94a3b8; }
</style></head><body>
<div class="doc">
  <div class="header">
    <div class="left">
      ${t.logo_url ? `<img class="logo" src="${esc(t.logo_url)}" onerror="this.style.display='none'"/>` : ''}
      <div class="company">${esc(t.name)}</div>
      ${t.legal_name ? `<div class="info" style="font-weight:700">${esc(t.legal_name)}</div>` : ''}
      <div class="info" style="text-transform:uppercase;letter-spacing:0.6px;font-weight:700">${esc(activityLabel(t))}</div>
      ${t.address ? `<div class="info">${esc(t.address)}</div>` : ''}
      ${t.phone ? `<div class="info">Tél : ${esc(t.phone)}</div>` : ''}
      ${t.email ? `<div class="info">${esc(t.email)}</div>` : ''}
      ${t.website ? `<div class="info">${esc(t.website)}</div>` : ''}
      ${t.ninea ? `<div class="info">NINEA : ${esc(t.ninea)}</div>` : ''}
      ${t.rccm ? `<div class="info">RCCM : ${esc(t.rccm)}</div>` : ''}
    </div>
    <div class="right">
      <div class="ref">${esc(opts.reference)}</div>
      <div class="date">${esc(opts.date)}</div>
    </div>
  </div>

  <div class="title">${esc(title)}</div>

  <div class="meta-bar">
    ${opts.siteName ? `<div class="cell"><div class="lbl">Dépôt</div><div class="val">${esc(opts.siteName)}</div></div>` : ''}
    ${opts.siteOrigin ? `<div class="cell"><div class="lbl">Origine</div><div class="val">${esc(opts.siteOrigin)}</div></div>` : ''}
    ${opts.siteDestination ? `<div class="cell"><div class="lbl">Destination</div><div class="val">${esc(opts.siteDestination)}</div></div>` : ''}
    <div class="cell"><div class="lbl">Opérateur</div><div class="val">${esc(opts.user)}</div></div>
    <div class="cell"><div class="lbl">Articles</div><div class="val">${opts.items.length}</div></div>
    <div class="cell"><div class="lbl">Qté totale</div><div class="val">${totalQty}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="center" style="width:10mm;">#</th>
        <th style="width:28mm;">Référence</th>
        <th>Désignation</th>
        <th class="center" style="width:18mm;">Quantité</th>
        <th style="width:40mm;">Observation</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr class="total-row">
        <td colspan="3" style="text-align:right;">TOTAL</td>
        <td style="text-align:center;">${totalQty}</td>
        <td></td>
      </tr>
    </tbody>
  </table>

  ${opts.observation ? `<div class="observation"><div class="lbl">Observation</div><div class="txt">${esc(opts.observation)}</div></div>` : ''}

  <div class="signatures">
    <div class="sig-block"><div class="line"></div><div class="cap">Magasinier</div></div>
    <div class="sig-block"><div class="line"></div><div class="cap">Responsable</div></div>
  </div>

  <div class="footer-brand">Propulsée par <strong>WAARWI</strong> — Plateforme Business 2.0 made in Sénégal</div>
</div>
</body></html>`;
  printHtml(html, 400);
}

// ── Stock Movement Print (80mm Ticket) ────────────────────────────────────────
export function printStockMovement80(opts: StockMovementPrintOpts) {
  const t = opts.tenant;
  const title = MOVEMENT_TYPE_TITLES[opts.movementType] || 'MOUVEMENT STOCK';
  const totalQty = opts.items.reduce((s, i) => s + Math.abs(i.quantity), 0);

  const itemsHtml = opts.items.map(item => `
    <tr>
      <td style="font-weight:600;padding:1.5mm 0;">${esc(item.name)}</td>
      <td style="text-align:right;font-weight:700;font-variant-numeric:tabular-nums;padding:1.5mm 0;">${Math.abs(item.quantity)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { margin: 0; size: 80mm auto; }
  @media print { html, body { margin: 0 !important; } body { padding: 1.5mm 2mm !important; width: 80mm !important; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; width: 80mm; padding: 1.5mm 2mm; color: #000; line-height: 1.4; background: #fff; }
  .center { text-align: center; }
  .shop-name { text-align: center; font-weight: 900; font-size: 16px; margin-bottom: 2px; }
  .meta { text-align: center; font-size: 10px; color: #000; }
  .activity { text-align: center; font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; margin-top: 2px; margin-bottom: 5px; font-weight: 700; color: #000; }
  .logo-wrap { display: flex; justify-content: center; margin-bottom: 6px; }
  .logo-wrap img { max-width: 48mm; max-height: 22mm; object-fit: contain; }
  .title { text-align: center; font-weight: 900; font-size: 14px; margin: 4mm 0 2mm; letter-spacing: 0.5px; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 2mm 0; }
  .info { font-size: 10px; margin: 2mm 0; }
  .info span { font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin: 2mm 0; }
  table td { font-size: 11px; border-bottom: 1px dotted #ccc; }
  .total { border-top: 1.5px solid #000; margin-top: 1mm; padding-top: 2mm; font-weight: 900; font-size: 13px; display: flex; justify-content: space-between; }
  .footer { margin-top: 4mm; padding-top: 2mm; border-top: 1px dashed #000; text-align: center; font-size: 9px; color: #000; }
</style></head><body>
  ${tenantHeader80(t)}

  <div class="title">${esc(title)}</div>

  <div class="info">Réf : <span>${esc(opts.reference)}</span></div>
  <div class="info">Date : <span>${esc(opts.date)}</span></div>
  <div class="info">Opérateur : <span>${esc(opts.user)}</span></div>
  ${opts.siteOrigin ? `<div class="info">Origine : <span>${esc(opts.siteOrigin)}</span></div>` : ''}
  ${opts.siteDestination ? `<div class="info">Destination : <span>${esc(opts.siteDestination)}</span></div>` : ''}
  ${opts.siteName ? `<div class="info">Dépôt : <span>${esc(opts.siteName)}</span></div>` : ''}

  <table>${itemsHtml}</table>

  <div class="total"><span>TOTAL</span><span>${totalQty} article${totalQty > 1 ? 's' : ''}</span></div>

  ${opts.observation ? `<div class="info" style="margin-top:3mm;font-style:italic;">Obs: ${esc(opts.observation)}</div>` : ''}

  <div class="footer">Propulsée par <strong>WAARWI</strong><br/>Plateforme Business 2.0</div>
</body></html>`;
  printHtml(html, 400);
}

// ── Inventory Book Print (new design - light, professional) ───────────────────
export type InventoryBookOpts = {
  tenant: PrintTenant;
  siteName: string;
  items: { ref: string; name: string; location: string; qty_theoretical: number; qty_real: number; purchase_price: number }[];
  date: string;
  reference: string;
};

export function printInventoryBookA4(opts: InventoryBookOpts) {
  const t = opts.tenant;
  const totalQty = opts.items.reduce((s, i) => s + i.qty_real, 0);
  const totalValue = opts.items.reduce((s, i) => s + i.qty_real * i.purchase_price, 0);
  const totalEcart = opts.items.reduce((s, i) => s + (i.qty_real - i.qty_theoretical), 0);
  const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' F';

  const rowsHtml = opts.items.map((r, i) => {
    const ecart = r.qty_real - r.qty_theoretical;
    const ecartClass = ecart > 0 ? 'color:#059669;' : ecart < 0 ? 'color:#dc2626;' : 'color:#64748b;';
    return `
    <tr>
      <td style="text-align:center;font-weight:600;color:#94a3b8;font-size:8.5pt;">${i + 1}</td>
      <td style="font-family:'Courier New',monospace;font-size:8.5pt;font-weight:600;">${esc(r.ref)}</td>
      <td style="font-weight:600;">${esc(r.name)}</td>
      <td style="text-align:center;font-size:8.5pt;">${esc(r.location || '')}</td>
      <td style="text-align:center;font-variant-numeric:tabular-nums;">${r.qty_theoretical}</td>
      <td style="text-align:center;font-weight:700;font-variant-numeric:tabular-nums;">${r.qty_real}</td>
      <td style="text-align:center;font-weight:700;font-variant-numeric:tabular-nums;${ecartClass}">${ecart > 0 ? '+' : ''}${ecart}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;font-size:8.5pt;">${fmt(r.qty_real * r.purchase_price)}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Livre d'inventaire — ${esc(opts.reference)}</title>
<style>
  @page { size: A4; margin: 12mm 10mm 14mm 10mm; }
  @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1e293b; font-size: 9pt; line-height: 1.4; background: #fff; }
  .doc { max-width: 190mm; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 4mm; margin-bottom: 4mm; border-bottom: 2px solid #0f766e; }
  .header .logo { max-height: 14mm; max-width: 35mm; object-fit: contain; margin-bottom: 1.5mm; display: block; }
  .header .company { font-size: 13pt; font-weight: 800; color: #0f172a; }
  .header .sub { font-size: 8pt; color: #475569; margin-top: 0.5mm; }
  .header .right { text-align: right; }
  .header .ref { font-family: 'Courier New', monospace; font-size: 10pt; font-weight: 800; color: #0f766e; }
  .header .date { font-size: 8.5pt; color: #475569; margin-top: 1mm; }
  .doc-title { text-align: center; font-size: 13pt; font-weight: 800; letter-spacing: 1px; color: #0f766e; margin: 4mm 0 2mm; text-transform: uppercase; }
  .doc-subtitle { text-align: center; font-size: 8.5pt; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 4mm; }
  .summary { display: flex; gap: 3mm; margin-bottom: 4mm; }
  .summary .card { flex: 1; padding: 2.5mm 3mm; border: 1px solid #e2e8f0; border-radius: 1.5mm; background: #f8fafc; }
  .summary .card .lbl { font-size: 7pt; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.8px; }
  .summary .card .val { font-size: 10pt; font-weight: 800; color: #0f172a; margin-top: 0.3mm; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  thead tr { background: #f1f5f9; }
  thead th { text-align: left; font-size: 7.5pt; padding: 2mm 2.5mm; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; border-bottom: 1.5px solid #cbd5e1; }
  thead th.c { text-align: center; }
  thead th.r { text-align: right; }
  tbody tr { page-break-inside: avoid; border-bottom: 0.5px solid #e2e8f0; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tbody td { padding: 1.8mm 2.5mm; font-size: 8.5pt; vertical-align: top; }
  .tfoot-row { background: #f1f5f9; border-top: 1.5px solid #cbd5e1; }
  .tfoot-row td { padding: 2.5mm; font-weight: 800; font-size: 9pt; }
  .signatures { display: flex; justify-content: space-between; margin-top: 10mm; }
  .sig-block { width: 50mm; text-align: center; }
  .sig-block .line { height: 13mm; border-bottom: 1px solid #94a3b8; }
  .sig-block .cap { margin-top: 1.5mm; font-size: 7.5pt; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.8px; }
  .brand-footer { margin-top: 6mm; padding-top: 2mm; border-top: 1px dashed #cbd5e1; text-align: center; font-size: 7.5pt; color: #94a3b8; }
</style></head><body>
<div class="doc">
  <div class="header">
    <div>
      ${t.logo_url ? `<img class="logo" src="${esc(t.logo_url)}" onerror="this.style.display='none'"/>` : ''}
      <div class="company">${esc(t.name)}</div>
      ${t.legal_name ? `<div class="sub" style="font-weight:700">${esc(t.legal_name)}</div>` : ''}
      <div class="sub" style="text-transform:uppercase;letter-spacing:0.6px;font-weight:700">${esc(activityLabel(t))}</div>
      ${t.address ? `<div class="sub">${esc(t.address)}</div>` : ''}
      ${t.phone ? `<div class="sub">Tél : ${esc(t.phone)}</div>` : ''}
      ${t.email ? `<div class="sub">${esc(t.email)}</div>` : ''}
      ${t.ninea ? `<div class="sub">NINEA : ${esc(t.ninea)}</div>` : ''}
      ${t.rccm ? `<div class="sub">RCCM : ${esc(t.rccm)}</div>` : ''}
    </div>
    <div class="right">
      <div class="ref">${esc(opts.reference)}</div>
      <div class="date">${esc(opts.date)}</div>
    </div>
  </div>

  <div class="doc-title">Livre d'inventaire</div>
  <div class="doc-subtitle">État du stock disponible — ${esc(opts.siteName)}</div>

  <div class="summary">
    <div class="card"><div class="lbl">Dépôt</div><div class="val">${esc(opts.siteName)}</div></div>
    <div class="card"><div class="lbl">Références</div><div class="val">${opts.items.length}</div></div>
    <div class="card"><div class="lbl">Qté totale</div><div class="val">${totalQty.toLocaleString('fr-FR')}</div></div>
    <div class="card"><div class="lbl">Écart total</div><div class="val" style="${totalEcart > 0 ? 'color:#059669' : totalEcart < 0 ? 'color:#dc2626' : ''}">${totalEcart > 0 ? '+' : ''}${totalEcart}</div></div>
    <div class="card"><div class="lbl">Valeur stock</div><div class="val">${fmt(totalValue)}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="c" style="width:8mm;">#</th>
        <th style="width:22mm;">Réf.</th>
        <th>Désignation</th>
        <th class="c" style="width:16mm;">Empl.</th>
        <th class="c" style="width:14mm;">Théo.</th>
        <th class="c" style="width:14mm;">Réel</th>
        <th class="c" style="width:14mm;">Écart</th>
        <th class="r" style="width:24mm;">Valeur</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr class="tfoot-row">
        <td colspan="4" style="text-align:right;">TOTAL</td>
        <td style="text-align:center;">${opts.items.reduce((s, r) => s + r.qty_theoretical, 0)}</td>
        <td style="text-align:center;">${totalQty}</td>
        <td style="text-align:center;${totalEcart > 0 ? 'color:#059669' : totalEcart < 0 ? 'color:#dc2626' : ''}">${totalEcart > 0 ? '+' : ''}${totalEcart}</td>
        <td style="text-align:right;">${fmt(totalValue)}</td>
      </tr>
    </tbody>
  </table>

  <div class="signatures">
    <div class="sig-block"><div class="line"></div><div class="cap">Magasinier</div></div>
    <div class="sig-block"><div class="line"></div><div class="cap">Responsable</div></div>
    <div class="sig-block"><div class="line"></div><div class="cap">Directeur</div></div>
  </div>

  <div class="brand-footer">Propulsée par <strong>WAARWI</strong> — Plateforme Business 2.0 made in Sénégal</div>
</div>
</body></html>`;
  printHtml(html, 400);
}

// ── Warranty Certificate Print (A4) ──────────────────────────────────────────

export type WarrantyCertificateOpts = {
  tenant: PrintTenant;
  saleNumber: string;
  saleDate: string;
  customerName: string;
  customerPhone?: string;
  imei?: string | null;
  warrantyDuration: string;
  expirationDate: string;
  items?: { name: string; quantity: number; unit_price: number }[];
  total?: number;
  warrantyTerms?: string;
  representative?: string | null;
  siteName?: string | null;
  status: 'active' | 'expiring' | 'expired' | 'cancelled';
};

export function printWarrantyCertificate(opts: WarrantyCertificateOpts) {
  const t = opts.tenant;
  const logoImg = tenantLogoA4(t);
  const headerLines = tenantHeaderA4Lines(t);

  const statusLabels: Record<string, { text: string; color: string; bg: string }> = {
    active: { text: 'EN COURS DE VALIDITÉ', color: '#166534', bg: '#dcfce7' },
    expiring: { text: 'EXPIRE BIENTÔT', color: '#92400e', bg: '#fef3c7' },
    expired: { text: 'EXPIRÉE', color: '#991b1b', bg: '#fee2e2' },
    cancelled: { text: 'ANNULÉE', color: '#991b1b', bg: '#fee2e2' },
  };
  const statusCfg = statusLabels[opts.status] || statusLabels.active;

  const itemsHtml = opts.items && opts.items.length > 0
    ? `<table class="items-table">
        <thead><tr><th>Designation</th><th class="center">Qte</th><th class="right">Prix unit.</th><th class="right">Total</th></tr></thead>
        <tbody>${opts.items.map(i => `<tr><td>${esc(i.name)}</td><td class="center">${i.quantity}</td><td class="right">${fmtMoney(i.unit_price)} FCFA</td><td class="right bold">${fmtMoney(i.quantity * i.unit_price)} FCFA</td></tr>`).join('')}</tbody>
      </table>
      ${opts.total ? `<div class="total-line"><span>TOTAL TTC</span><span class="bold">${fmtMoney(opts.total)} FCFA</span></div>` : ''}`
    : '';

  const termsHtml = opts.warrantyTerms
    ? `<div class="terms-section">
        <h3>Conditions de garantie</h3>
        <div class="terms-content">${esc(opts.warrantyTerms).replace(/\n/g, '<br/>')}</div>
      </div>`
    : `<div class="terms-section">
        <h3>Conditions de garantie</h3>
        <div class="terms-content">
          La garantie couvre les defauts de fabrication et les pannes survenant dans des conditions normales d'utilisation.<br/>
          La garantie ne couvre pas les dommages causes par une mauvaise utilisation, les chocs, l'exposition a l'eau ou a des temperatures extremes, les modifications non autorisees ou l'usure normale.
        </div>
      </div>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>FICHE DE GARANTIE - ${esc(opts.saleNumber)}</title>
<style>${a4Style}
  .warranty-badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 16px; border-radius: 8px; font-size: 12px; font-weight: 800; letter-spacing: 0.5px; }
  .warranty-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; margin: 16px 0; }
  .warranty-info-item { padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 10px; background: #fafafa; }
  .warranty-info-item .label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; margin-bottom: 3px; }
  .warranty-info-item .value { font-size: 13px; font-weight: 600; color: #111827; }
  .warranty-info-item .value.mono { font-family: 'Courier New', monospace; letter-spacing: 0.5px; }
  .terms-section { margin-top: 20px; padding: 16px; border: 1px solid #e5e7eb; border-radius: 10px; background: #f9fafb; }
  .terms-section h3 { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #374151; margin-bottom: 8px; }
  .terms-content { font-size: 11px; line-height: 1.6; color: #4b5563; }
  .items-table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 11px; }
  .items-table th { background: #f3f4f6; padding: 8px 10px; border: 1px solid #e5e7eb; font-weight: 700; text-transform: uppercase; font-size: 9px; letter-spacing: 0.3px; color: #374151; }
  .items-table td { padding: 8px 10px; border: 1px solid #e5e7eb; }
  .total-line { display: flex; justify-content: space-between; padding: 10px 14px; background: #111827; color: #ffffff; border-radius: 8px; font-size: 13px; margin-top: 8px; }
  .signatures-warranty { display: flex; justify-content: space-between; gap: 24px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
  .sig-block-w { text-align: center; flex: 1; }
  .sig-block-w .line-w { border-bottom: 1px solid #d1d5db; height: 50px; margin-bottom: 6px; }
  .sig-block-w .cap-w { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #6b7280; letter-spacing: 0.3px; }
</style></head><body>
<div class="page-content">
  <div class="header">
    <div class="brand">
      ${logoImg}
      <div class="brand-text">
        ${headerLines}
      </div>
    </div>
    <div class="doc-info">
      <div class="doc-title">FICHE DE GARANTIE</div>
      <div class="doc-number">${esc(opts.saleNumber)}</div>
      <div class="doc-date">${new Date(opts.saleDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
      <div style="margin-top:8px;">
        <span class="warranty-badge" style="background:${statusCfg.bg};color:${statusCfg.color};">${statusCfg.text}</span>
      </div>
    </div>
  </div>

  ${opts.customerName ? `<div class="client-box"><div class="client-label">CLIENT</div><div class="client-name">${esc(opts.customerName)}</div>${opts.customerPhone ? `<div class="client-phone">${esc(opts.customerPhone)}</div>` : ''}</div>` : ''}

  <div class="warranty-info-grid">
    ${opts.imei ? `<div class="warranty-info-item"><div class="label">IMEI / Numéro de série</div><div class="value mono">${esc(opts.imei)}</div></div>` : ''}
    <div class="warranty-info-item"><div class="label">Durée de garantie</div><div class="value">${esc(opts.warrantyDuration)}</div></div>
    <div class="warranty-info-item"><div class="label">Date d'achat</div><div class="value">${new Date(opts.saleDate).toLocaleDateString('fr-FR')}</div></div>
    <div class="warranty-info-item"><div class="label">Date d'expiration</div><div class="value">${esc(opts.expirationDate)}</div></div>
    ${opts.representative ? `<div class="warranty-info-item"><div class="label">Représentant</div><div class="value">${esc(opts.representative)}</div></div>` : ''}
    ${opts.siteName ? `<div class="warranty-info-item"><div class="label">Point de vente</div><div class="value">${esc(opts.siteName)}</div></div>` : ''}
  </div>

  ${itemsHtml}
  ${termsHtml}

  <div class="signatures-warranty">
    <div class="sig-block-w"><div class="line-w"></div><div class="cap-w">Le vendeur</div></div>
    <div class="sig-block-w"><div class="line-w"></div><div class="cap-w">Le client</div></div>
    <div class="sig-block-w"><div class="line-w"></div><div class="cap-w">Cachet et signature</div></div>
  </div>
</div>

<div class="page-bottom">
  ${waarwiFooterA4()}
</div>
</body></html>`;
  printHtml(html, 400);
}
