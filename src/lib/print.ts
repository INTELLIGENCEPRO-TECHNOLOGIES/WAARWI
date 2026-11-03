import { BUSINESS_TYPE_LABELS, mergeTicketHeaderConfig, mergeA4HeaderConfig } from './types';
import type { TicketHeaderItem, TicketHeaderSize, A4HeaderConfig, A4LogoPosition } from './types';
import { cashMovementLabel, cashMovementSign } from './cashMovements';
import { measurePageMetrics, paginateByHeight, estimatePageMetrics } from './printPaginate';
import type { PageMetrics } from './printPaginate';
import type { CashMovementKind } from './cashMovements';

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
  a4_header_config?: A4HeaderConfig | null;
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
    a4_header_config: t?.a4_header_config ?? null,
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
    a4_header_config: site.a4_header_config ?? base.a4_header_config,
  };
}

const WAARWI_FOOTER = 'Propulsée par WAARWI — Plateforme Business 2.0 made in Sénégal';

export type PrintItem = {
  name: string;
  supplier_ref?: string | null;
  oem_ref?: string | null;
  internal_ref?: string | null;
  quantity: number;
  unit_price: number;
  discount?: number;
};

export function showsOemRefs(t: PrintTenant): boolean {
  return mergeA4HeaderConfig(t.a4_header_config).show_oem_ref ?? t.business_type === 'auto_parts';
}

// An OEM equal to the internal reference is an import artefact, not a manufacturer reference.
function withVisibleOemRefs(items: PrintItem[], t: PrintTenant): PrintItem[] {
  const show = showsOemRefs(t);
  return items.map(i => {
    const oem = (i.oem_ref || '').trim();
    const hide = !show || !oem || oem === (i.internal_ref || '').trim();
    return hide ? { ...i, oem_ref: null } : i;
  });
}

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

function tenantHeader80Compact(t: PrintTenant) {
  const config = mergeTicketHeaderConfig(t.header_config);
  const shown = (key: string) => config.some(i => i.key === key && i.show);
  const logoItem = config.find(i => i.key === 'logo' && i.show);
  const parts: string[] = [];
  if (logoItem && t.logo_url) {
    const px = logoItem.size === 'xl' ? 14 : logoItem.size === 'lg' ? 11 : logoItem.size === 'md' ? 9 : 7;
    parts.push(`<div class="logo-wrap" style="margin-bottom:2px;"><img src="${esc(t.logo_url)}" alt="" style="max-height:${px}mm;max-width:40mm;object-fit:contain;" onerror="this.style.display='none'"/></div>`);
  }
  if (shown('name') && t.name) parts.push(`<div class="shop-name" style="font-size:13px;font-weight:900;">${esc(t.name)}</div>`);
  const meta = [shown('phone') && t.phone ? `Tél: ${t.phone}` : '', shown('address') ? t.address || '' : ''].filter(Boolean);
  if (meta.length) parts.push(`<div class="meta" style="font-size:10px;font-weight:600;">${esc(meta.join(' · '))}</div>`);
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

// ── Shared A4 header (used by all A4 documents) ──────────────────────────────
// One unified header component for reports, invoices, supplier orders,
// inventory book, warranty certificates, and cash reports.

const A4_LOGO_SIZES: Record<TicketHeaderSize, number> = {
  xs: 50, sm: 70, md: 90, lg: 120, xl: 160,
};

export type A4HeaderOpts = {
  tenant: PrintTenant;
  docTitle: string;
  docNumber?: string;
  docDate?: string;
  siteName?: string;
  status?: string;
  subtitle?: string;
};

export function renderA4Header(opts: A4HeaderOpts): string {
  const t = opts.tenant;
  const config = mergeTicketHeaderConfig(t.header_config);
  const a4cfg = mergeA4HeaderConfig(t.a4_header_config);
  const logoPx = A4_LOGO_SIZES[a4cfg.logo_size] || 60;

  // Build info lines (each on its own line, no "·" merging)
  const infoLines: string[] = [];
  for (const item of config) {
    if (item.key === 'logo') continue;
    if (!item.show) continue;
    const value = headerFieldValue(t, item.key);
    if (!value) continue;
    const sz = HEADER_SIZES_A4[item.size] || HEADER_SIZES_A4.sm;
    if (item.key === 'name') {
      infoLines.push(`<div class="a4h-company" style="font-size:${sz.fs}px;font-weight:${sz.fw};">${esc(value)}</div>`);
    } else if (item.key === 'activity') {
      infoLines.push(`<div class="a4h-activity" style="font-size:${sz.fs}px;font-weight:${sz.fw};">${esc(value)}</div>`);
    } else {
      const extraStyle = item.key === 'legal_name' ? 'font-weight:700;' : '';
      const breakStyle = item.breakAfter ? 'margin-bottom:4px;' : '';
      infoLines.push(`<div class="a4h-info-line" style="font-size:${sz.fs}px;font-weight:${sz.fw};${extraStyle}${breakStyle}">${esc(value)}</div>`);
    }
  }
  const infoHtml = infoLines.join('');

  // Logo HTML
  const logoItem = config.find(c => c.key === 'logo');
  const showLogo = logoItem && logoItem.show && t.logo_url;
  const logoHtml = showLogo
    ? `<img src="${esc(t.logo_url)}" alt="" class="a4h-logo" style="max-width:${logoPx}px;max-height:${logoPx}px;object-fit:contain;" onerror="this.style.display='none'"/>`
    : '';

  // Doc meta (right side)
  const metaHtml = `<div class="a4h-meta">
    <div class="a4h-title">${esc(opts.docTitle)}</div>
    ${opts.docNumber ? `<div class="a4h-number">${esc(opts.docNumber)}</div>` : ''}
    ${opts.docDate ? `<div class="a4h-date">${esc(opts.docDate)}</div>` : ''}
    ${opts.siteName ? `<div class="a4h-site">${esc(opts.siteName)}</div>` : ''}
    ${opts.subtitle ? `<div class="a4h-subtitle">${esc(opts.subtitle)}</div>` : ''}
    ${opts.status ? `<div class="a4h-status">${esc(opts.status)}</div>` : ''}
  </div>`;

  // Layout based on logo position
  const pos = a4cfg.logo_position;
  let headerInner = '';

  if (pos === 'above') {
    headerInner = `
      ${logoHtml ? `<div class="a4h-logo-above">${logoHtml}</div>` : ''}
      <div class="a4h-body">
        <div class="a4h-info">${infoHtml}</div>
        ${metaHtml}
      </div>`;
  } else if (pos === 'left') {
    headerInner = `
      <div class="a4h-body a4h-body-row">
        <div class="a4h-left-block">
          ${logoHtml}
          <div class="a4h-info">${infoHtml}</div>
        </div>
        ${metaHtml}
      </div>`;
  } else {
    // right
    headerInner = `
      <div class="a4h-body a4h-body-row">
        <div class="a4h-info">${infoHtml}</div>
        <div class="a4h-right-block">
          ${logoHtml}
          ${metaHtml}
        </div>
      </div>`;
  }

  const wideMeta = (opts.docNumber?.length ?? 0) > 16 || opts.docTitle.length > 18;
  return `<div class="a4h-header${wideMeta ? ' a4h-wide-meta' : ''}">${headerInner}</div>`;
}

export const a4HeaderCss = `
  .a4h-header { margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid #000; }
  .a4h-logo-above { margin-bottom: 8px; }
  .a4h-logo-above img { display: block; }
  .a4h-body { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .a4h-body-row { width: 100%; }
  .a4h-left-block { display: flex; gap: 10px; align-items: flex-start; flex: 1; min-width: 0; }
  .a4h-right-block { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
  .a4h-info { flex: 1; min-width: 0; }
  .a4h-company { font-weight: 900; color: #000; line-height: 1.15; }
  .a4h-activity { text-transform: uppercase; letter-spacing: 1px; color: #000; margin-top: 2px; }
  .a4h-info-line { color: #000; margin-top: 1px; }
  .a4h-meta { text-align: right; min-width: 160px; flex: 0 0 auto; max-width: 55%; }
  .a4h-title { font-size: 13px; font-weight: 800; color: #000; text-transform: uppercase; letter-spacing: 0.5px; }
  .a4h-number { font-size: 18px; font-weight: 900; color: #000; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .a4h-date { font-size: 10px; font-weight: 600; color: #000; margin-top: 2px; }
  .a4h-site { font-size: 9px; font-weight: 600; color: #555; margin-top: 2px; }
  .a4h-subtitle { font-size: 9px; font-weight: 500; color: #555; margin-top: 2px; }
  .a4h-status { display: inline-block; padding: 3px 8px; border: 1.5px solid #000; color: #000; background: #fff; font-size: 9px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 5px; border-radius: 2px; }
`;

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

  let triggered = false;
  const trigger = () => {
    if (triggered) return;
    triggered = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch { /* ignore */ }
    try {
      if (iframe.contentWindow) iframe.contentWindow.onafterprint = cleanup;
    } catch { /* ignore */ }
    setTimeout(cleanup, 60_000);
  };

  const waitForImages = (): Promise<void> => {
    try {
      const idoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!idoc) return Promise.resolve();
      const imgs = Array.from(idoc.images || []);
      if (imgs.length === 0) return Promise.resolve();
      return Promise.all(
        imgs.map(img => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return new Promise<void>(resolve => {
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
            setTimeout(done, 5000);
          });
        })
      ).then(() => undefined);
    } catch {
      return Promise.resolve();
    }
  };

  const runWhenReady = () => {
    waitForImages().then(() => setTimeout(trigger, delayMs));
  };

  const win = iframe.contentWindow;
  if (win && win.document.readyState !== 'complete') {
    win.addEventListener('load', runWhenReady, { once: true });
    setTimeout(runWhenReady, 800);
  } else {
    runWhenReady();
  }
  setTimeout(trigger, 8000);
}

// ── 80mm Thermal Receipt Style ────────────────────────────────────────────────
// All text is pure black, no grey, no opacity, optimized for low-quality thermal printers
const printFontLink = '<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">';

// Paper is 80mm but most 80mm printers only print ~72mm centred: content stays inside that zone.
const ticketStyle = `
  @page { margin: 0; size: 80mm auto; }
  @media print {
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html { width: 80mm !important; margin: 0 !important; padding: 0 !important; }
    body { width: 72mm !important; margin: 0 auto !important; padding: 1.5mm 0 !important; }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { width: 80mm; background: #fff; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 13px;
    width: 72mm;
    margin: 0 auto;
    padding: 1.5mm 0;
    color: #000000;
    line-height: 1.4;
    background: #fff;
    overflow-wrap: break-word;
  }
  img { max-width: 100%; }
  .center { text-align: center; }
  .logo-wrap { display: flex; justify-content: center; margin-bottom: 6px; }
  .logo-wrap img { max-width: 48mm; height: auto; max-height: 22mm; object-fit: contain; }
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
    font-size: 17px;
    font-weight: 800;
    font-family: 'Space Grotesk', 'Helvetica Neue', Arial, sans-serif;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
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
    align-items: baseline;
    gap: 3mm;
    font-size: 11.5px;
    margin-top: 3px;
    font-weight: 600;
    color: #000000;
  }
  .info-row > :first-child { flex: 0 0 auto; }
  .info-row > :last-child:not(:first-child) { flex: 1 1 auto; min-width: 0; text-align: right; overflow-wrap: anywhere; }
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
    gap: 3mm;
  }
  .item-line > :first-child { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .item-qty { font-weight: 900; font-size: 13px; color: #000000; }
  .item-pu { font-weight: 600; font-size: 11.5px; color: #000000; }
  .item-total { flex: 0 0 auto; font-weight: 900; font-size: 14px; white-space: nowrap; text-align: right; color: #000000; }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 12px;
    padding: 2px 0;
    gap: 3mm;
    color: #000000;
    font-weight: 600;
  }
  .row > :first-child { flex: 1 1 auto; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
  .row > :last-child:not(:first-child) { flex: 0 0 auto; white-space: nowrap; text-align: right; }
  .ctl { padding: 3px 0 4px; border-bottom: 1px dashed #000000; }
  .ctl:last-of-type { border-bottom: 0; }
  .ctl-name { font-size: 12px; font-weight: 800; overflow-wrap: anywhere; }
  .ctl .row { padding: 0 0 0 3mm; font-size: 11px; }
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

const compactTicketStyle = `${ticketStyle}
  body { font-size: 11.5px; line-height: 1.25; }
  .hr { margin: 3px 0; }
  .hr-solid { border-top-width: 1px; margin: 3px 0; }
  .doc-label { font-size: 12.5px; letter-spacing: 0.8px; margin: 2px 0 0; }
  .doc-date { font-size: 10px; margin: 0; }
  .row { font-size: 11px; padding: 0; }
  .row.total { font-size: 13.5px; padding: 2px 0; margin: 2px 0; }
  .section { font-size: 10.5px; margin: 2px 0 0; }
  .line { font-size: 10.5px; font-weight: 600; color: #000; }
  .footer { margin-top: 3px; line-height: 1.3; }
  .footer .thanks { font-size: 11.5px; }
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
  const itemsHtml = withVisibleOemRefs(sale.items, tenant)
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
<style>${ticketStyle}</style>${printFontLink}</head><body>
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
  returnNumber?: string,
  customerName?: string | null
) {
  const itemsHtml = items
    .map(i => `<div class="row"><span style="white-space:normal">${esc(i.name)} x${i.quantity}</span><span>- ${fmtMoney(i.quantity * i.unit_price)}</span></div>`)
    .join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Retour</title>
<style>${compactTicketStyle}</style>${printFontLink}</head><body>
${tenantHeader80Compact(tenant)}
<hr class="hr-solid" />
<div class="doc-label">RETOUR${returnNumber ? ` · N° ${esc(returnNumber)}` : ''}</div>
<div class="doc-date">${new Date().toLocaleString('fr-FR')} · Vente ${esc(refSaleNumber)}</div>
<div class="line">Caissier: ${esc(cashier)}${customerName ? ` · Client: ${esc(customerName)}` : ''}</div>
<hr class="hr" />
${itemsHtml}
<div class="row total"><span>REMBOURSEMENT</span><span>- ${fmtMoney(total)} FCFA</span></div>
</body></html>`;
  printHtml(html);
}

function cashReceiptBody80(o: {
  title: string;
  receiptNumber: string;
  date: Date;
  cashier: string;
  party?: string | null;
  partyLabel: string;
  label?: string;
  reference?: string;
  method: string;
  totalLabel: string;
  amountText: string;
}) {
  return `<hr class="hr-solid" />
<div class="doc-label">${o.title} · N° ${esc(o.receiptNumber)}</div>
<div class="doc-date">${o.date.toLocaleString('fr-FR')}</div>
<div class="line">Caissier: ${esc(o.cashier)}${o.party ? ` · ${o.partyLabel}: ${esc(o.party)}` : ''}</div>
${o.label ? `<div class="line">Motif: ${esc(o.label)}</div>` : ''}
${o.reference ? `<div class="line">Réf: ${esc(o.reference)}</div>` : ''}
<div class="row total"><span>${o.totalLabel} (${esc(o.method)})</span><span>${o.amountText} FCFA</span></div>`;
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
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recu ${esc(opts.receiptNumber)}</title>
<style>${compactTicketStyle}</style>${printFontLink}</head><body>
${tenantHeader80Compact(opts.tenant)}
${cashReceiptBody80({
    title: 'ENCAISSEMENT',
    receiptNumber: opts.receiptNumber,
    date: opts.createdAt ? new Date(opts.createdAt) : new Date(),
    cashier: opts.cashier,
    party: opts.customerName,
    partyLabel: 'Client',
    label: opts.label,
    reference: opts.reference,
    method: opts.method,
    totalLabel: 'REÇU',
    amountText: fmtMoney(opts.amount),
  })}
<div class="footer"><div class="thanks">Merci de votre règlement</div></div>
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
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recu ${esc(opts.receiptNumber)}</title>
<style>${compactTicketStyle}</style>${printFontLink}</head><body>
${tenantHeader80Compact(opts.tenant)}
${cashReceiptBody80({
    title: 'DÉCAISSEMENT',
    receiptNumber: opts.receiptNumber,
    date: opts.createdAt ? new Date(opts.createdAt) : new Date(),
    cashier: opts.cashier,
    party: opts.beneficiary,
    partyLabel: 'Bénéf.',
    label: opts.label,
    reference: opts.reference,
    method: opts.method,
    totalLabel: 'VERSÉ',
    amountText: `- ${fmtMoney(opts.amount)}`,
  })}
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
  kind: CashMovementKind;
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
  registerLabel?: string;
}) {
  const movements = opts.movements || [];
  const controls = opts.controls || [];
  const regularizations = opts.regularizations || [];

  const movementGroups = new Map<string, { count: number; amount: number }>();
  for (const m of movements) {
    const g = movementGroups.get(m.kind) || { count: 0, amount: 0 };
    g.count += 1;
    g.amount += m.amount;
    movementGroups.set(m.kind, g);
  }
  const regGroups = new Map<string, { count: number; amount: number }>();
  for (const r of regularizations) {
    const g = regGroups.get(r.reg_type) || { count: 0, amount: 0 };
    g.count += 1;
    g.amount += Number(r.amount);
    regGroups.set(r.reg_type, g);
  }

  const mvExpense = movements.filter(m => m.kind === 'expense').reduce((s, m) => s + m.amount, 0);
  const mvRefund = movements.filter(m => m.kind === 'refund').reduce((s, m) => s + m.amount, 0);
  const mvWithdrawal = movements.filter(m => m.kind === 'customer_withdrawal').reduce((s, m) => s + m.amount, 0);
  const mvLoan = movements.filter(m => m.kind === 'customer_loan').reduce((s, m) => s + m.amount, 0);
  const mvIncome = movements.filter(m => m.kind === 'income').reduce((s, m) => s + m.amount, 0);
  const mvPrepay = movements.filter(m => m.kind === 'customer_prepayment').reduce((s, m) => s + m.amount, 0);
  const mvVaultIn = movements.filter(m => m.kind === 'vault_withdrawal').reduce((s, m) => s + m.amount, 0);
  const mvVaultOut = movements.filter(m => m.kind === 'vault_deposit').reduce((s, m) => s + m.amount, 0);
  const netTotal = opts.openingAmount + opts.salesTotal + mvVaultIn - mvExpense - mvRefund - mvWithdrawal - mvLoan - mvVaultOut;
  const variance = controls.length > 0
    ? controls.reduce((s, c) => s + Number(c.difference_amount ?? (c.counted_amount - c.theoretical_amount)), 0)
    : 0;

  const movementsHtml = movements.length > 0 ? `
<hr class="hr" />
<div class="section">Mouvements</div>
${[...movementGroups].map(([kind, g]) =>
    `<div class="row"><span>${esc(cashMovementLabel(kind))} (${g.count})</span><span>${cashMovementSign(kind)}${fmtMoney(g.amount)}</span></div>`
  ).join('')}
<div class="row"><span>Total entrées</span><span>+${fmtMoney(mvIncome + mvPrepay + mvVaultIn)}</span></div>
<div class="row"><span>Total sorties</span><span>-${fmtMoney(mvExpense + mvRefund + mvWithdrawal + mvLoan + mvVaultOut)}</span></div>
<div class="row total"><span>Net caisse</span><span>${fmtMoney(netTotal)} FCFA</span></div>
` : '';

  const controlsHtml = controls.length > 0 ? `
<hr class="hr" />
<div class="section">Contrôle de caisse</div>
${controls.map(c => {
    const diff = Number(c.difference_amount ?? (c.counted_amount - c.theoretical_amount));
    return `<div class="ctl"><div class="ctl-name">${esc(c.method_name)}</div><div class="row"><span>Théorique</span><span>${fmtMoney(c.theoretical_amount)}</span></div><div class="row"><span>Compté</span><span>${fmtMoney(c.counted_amount)}</span></div><div class="row"><span>Écart</span><span><strong>${diff >= 0 ? '+' : ''}${fmtMoney(diff)}</strong></span></div></div>`;
  }).join('')}
<div class="row total"><span>Écart total</span><span>${variance >= 0 ? '+' : ''}${fmtMoney(variance)} FCFA</span></div>
` : '';

  const regularizationsHtml = regularizations.length > 0 ? `
<hr class="hr" />
<div class="section">Régularisations</div>
${[...regGroups].map(([type, g]) => `<div class="row"><span>${esc(type)} (${g.count})</span><span>${fmtMoney(g.amount)}</span></div>`).join('')}
` : '';

  const fmtDt = (d: string | Date) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>X de Caisse</title>
<style>${compactTicketStyle}</style>${printFontLink}</head><body>
${tenantHeader80Compact(opts.tenant)}
<hr class="hr-solid" />
<div class="doc-label">X DE CAISSE · ${esc(opts.sessionId.slice(0, 8).toUpperCase())}</div>
<div class="line">${esc(opts.siteName)} · ${esc(opts.cashier)}</div>
${opts.registerLabel ? `<div class="line">Caisse : ${esc(opts.registerLabel)}</div>` : ''}
<div class="line">Ouv. ${fmtDt(opts.openedAt)}${opts.closedAt ? ` · Clôt. ${fmtDt(opts.closedAt)}` : ''}</div>
<div class="line">Imprimé ${fmtDt(new Date())}</div>
<hr class="hr" />
<div class="row"><span>Fond d'ouverture</span><span>${fmtMoney(opts.openingAmount)}</span></div>
<div class="row"><span>Ventes (${opts.salesCount})</span><span>${fmtMoney(opts.salesTotal)}</span></div>
${opts.byMethod.length > 0
    ? opts.byMethod.map(m => `<div class="row"><span>· ${esc(m.method_name)}</span><span>${fmtMoney(m.amount)}</span></div>`).join('')
    : '<div class="line">Aucun encaissement</div>'}
${movementsHtml}
${controlsHtml}
${regularizationsHtml}
</body></html>`;
  printHtml(html);
}

// ── A4 Document Style ─────────────────────────────────────────────────────────
// Pure black text, no grey, no opacity, professional corporate layout
const a4Style = `
  @page {
    margin: 10mm 10mm 14mm 10mm;
    size: A4;
    @bottom-right {
      content: "Page " counter(page) " / " counter(pages);
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 8.5px;
      font-weight: 600;
      color: #000;
    }
  }
  @media print {
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html, body { margin: 0 !important; }
    .no-break { page-break-inside: avoid; break-inside: avoid; }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    color: #000000;
    background: #ffffff;
    line-height: 1.4;
  }
  .invoice-page {
    display: flex;
    flex-direction: column;
    min-height: 268mm;
    page-break-after: always;
    break-after: page;
  }
  .invoice-page:last-child { page-break-after: auto; break-after: auto; }
  .page-bottom-block { margin-top: auto; page-break-inside: avoid; break-inside: avoid; }

  /* Full header — first page only (replaced by renderA4Header) */
  ${a4HeaderCss}
  .compact-header { margin-bottom: 10px; padding-bottom: 6px; }

  /* Parties */
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
  .party { border: 1.5px solid #000; border-radius: 4px; padding: 9px 12px; }
  .party h3 { font-size: 9px; font-weight: 800; text-transform: uppercase; color: #000; margin-bottom: 5px; letter-spacing: 1.2px; border-bottom: 1px solid #000; padding-bottom: 3px; }
  .party p { font-size: 10.5px; margin-bottom: 2px; color: #000; font-weight: 500; }
  .party p strong { font-weight: 800; }

  /* Items table */
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; table-layout: fixed; }
  thead { display: table-header-group; }
  thead tr { background: #e8e8e8; color: #000; }
  th { padding: 6px 8px; text-align: left; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #000; }
  th.right { text-align: right; }
  th.center { text-align: center; }
  th:nth-child(1) { width: 55%; }
  th:nth-child(2) { width: 8%; }
  th:nth-child(3) { width: 18%; }
  th:nth-child(4) { width: 19%; }
  td { padding: 5px 8px; font-size: 10px; border-bottom: 0.75px solid #000; vertical-align: top; color: #000; font-weight: 500; line-height: 1.35; }
  tbody tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #f5f5f5; }
  td.right { text-align: right; }
  td.center { text-align: center; font-weight: 700; }
  td.bold { font-weight: 800; color: #000; }
  .item-ref { font-size: 7.5px; font-weight: 600; font-family: 'Courier New', monospace; margin-top: 1px; color: #000; }

  /* Subtotal row inside the financial box */

  /* Financial summary — at the very end */
  .financial-summary { display: flex; justify-content: flex-end; margin-top: 0; }
  .financial-box { width: 320px; border: 1.5px solid #000; border-radius: 3px; overflow: hidden; }
  .fin-row { display: flex; justify-content: space-between; align-items: baseline; padding: 7px 12px; font-size: 11px; font-weight: 600; border-bottom: 1px solid #000; gap: 8px; flex-wrap: wrap; color: #000; }
  .fin-row:last-child { border-bottom: none; }
  .fin-row span { white-space: nowrap; }
  .fin-row.discount { background: #f5f5f5; font-weight: 700; }
  .fin-row.subtotal-fin { background: #f5f5f5; font-weight: 700; }
  .fin-row.grand { background: #e8e8e8; color: #000; font-size: 15px; font-weight: 900; padding: 9px 14px; }
  .fin-row.grand span { color: #000 !important; }
  .fin-row.paid-row { background: #f5f5f5; font-weight: 700; }
  .fin-row.due-row { background: #e8e8e8; font-weight: 900; font-size: 11px; }

  /* Payment details */
  .payments-section { margin-top: 12px; page-break-inside: avoid; break-inside: avoid; }
  .payments-section h3 { font-size: 9px; font-weight: 800; text-transform: uppercase; color: #000; margin-bottom: 5px; letter-spacing: 0.8px; border-bottom: 1px solid #000; padding-bottom: 3px; }
  .p-row { display: flex; justify-content: space-between; font-size: 10px; font-weight: 600; padding: 3px 0; color: #000; border-bottom: 0.5px dashed #000; }
  .p-row:last-child { border-bottom: none; }
  .p-row strong { font-weight: 800; }

  /* Footer */
  .footer { padding-top: 8px; border-top: 1.5px solid #000; display: flex; justify-content: space-between; font-size: 9px; font-weight: 600; color: #000; margin-top: 14px; }
  .footer-note { margin-top: 8px; font-size: 10px; color: #000; font-style: italic; font-weight: 600; }
  .waarwi-brand-footer { margin-top: 8px; padding-top: 5px; border-top: 0.75px dashed #000; text-align: center; font-size: 8.5px; color: #000; font-weight: 600; letter-spacing: 0.2px; }
`;

// Frame from the item headers down to the totals, for commercial documents (A4 and A5).
const commercialBlockCss = `
  .commercial-block { flex: 1 1 auto; display: flex; flex-direction: column; border: 1px solid #000; }
  .commercial-block table { margin-bottom: 0; }
  .commercial-block tbody tr:last-child td { border-bottom: 0; }
  .cb-fill { flex: 1 1 auto; }
  .cb-totals { display: flex; justify-content: flex-end; border-top: 1px solid #000; page-break-inside: avoid; break-inside: avoid; }
  .cb-totals .financial-box { border: 0; border-left: 1px solid #000; border-radius: 0; overflow: visible; }
  .fin-row span:last-child { margin-left: auto; text-align: right; }
  .page-tail { flex: 0 0 auto; }
`;

// Paged invoices (A4 and A5) share one layout; each format only sets its paper, margins and scale factors.
// fs scales type (pt), sp vertical spacing (mm), w widths (mm). A5 is the reference at 1/1/1.
type PagedFormat = {
  paper: string;
  marginMm: number;
  widthMm: number;
  heightMm: number;
  fs: number;
  sp: number;
  w: number;
  fullHeaderEveryPage: boolean;
  maskedTotalsOnEveryPage: boolean;
  estimate: { charsPerLine: number; scale: number };
};

const A5_FORMAT: PagedFormat = {
  paper: 'A5 portrait', marginMm: 7, widthMm: 148, heightMm: 210, fs: 1, sp: 1, w: 1,
  fullHeaderEveryPage: false, maskedTotalsOnEveryPage: false, estimate: { charsPerLine: 34, scale: 1 },
};
const A4_FORMAT: PagedFormat = {
  paper: 'A4 portrait', marginMm: 10, widthMm: 210, heightMm: 297, fs: 10 / 8.5, sp: 1.3, w: 1.42,
  fullHeaderEveryPage: true, maskedTotalsOnEveryPage: true, estimate: { charsPerLine: 43, scale: 1.2 },
};

const contentWidth = (f: PagedFormat) => f.widthMm - 2 * f.marginMm;
const contentHeight = (f: PagedFormat) => f.heightMm - 2 * f.marginMm;

// The page number is printed inside the document, so the inherited @page counter is switched off.
function pagedDocCss(f: PagedFormat): string {
  const n = (v: number) => String(Number(v.toFixed(2)));
  const pt = (v: number) => `${n(v * f.fs)}pt`;
  const mm = (v: number) => `${n(v * f.sp)}mm`;
  const wmm = (v: number) => `${n(v * f.w)}mm`;
  return `
  @page { size: ${f.paper}; margin: ${f.marginMm}mm; @bottom-right { content: none; } }
  html, body { height: auto; }
  body { font-size: ${pt(8.5)}; line-height: 1.3; }
  .invoice-page { min-height: ${n(contentHeight(f) - 3)}mm; }
  .commercial-block tbody tr:last-child td { border-bottom: 0.5pt solid #000; }
  .doc-pageno { flex: 0 0 auto; text-align: right; font-size: ${pt(6.5)}; font-weight: 700; margin-top: ${mm(1)}; }
  .a4h-header { margin-bottom: ${mm(2)}; padding-bottom: ${mm(1.5)}; border-bottom-width: 1.2px; }
  .a4h-logo-above { margin-bottom: ${mm(1.2)}; }
  .a4h-body { gap: ${wmm(3)}; }
  .a4h-info { flex: 1 1 auto; min-width: 0; line-height: 1.22; overflow-wrap: anywhere; }
  .a4h-company { line-height: 1.1; }
  .a4h-activity { margin-top: ${mm(0.3)}; letter-spacing: 0.6px; }
  .a4h-info-line { margin-top: 0; }
  .a4h-info-line[style*="margin-bottom"] { margin-bottom: ${mm(1)} !important; }
  .a4h-left-block { gap: ${wmm(2.5)}; }
  .a4h-right-block { flex: 0 1 auto; max-width: 64%; min-width: 0; flex-direction: row-reverse; align-items: flex-start; gap: ${wmm(2.5)}; }
  .a4h-logo { max-width: ${wmm(24)} !important; max-height: ${wmm(18)} !important; }
  .a4h-meta { min-width: 0; max-width: none; flex: 0 1 auto; }
  .a4h-body > .a4h-meta { max-width: 55%; }
  .a4h-title { font-size: ${pt(9)}; letter-spacing: 0.4px; line-height: 1.15; }
  .a4h-number { font-size: ${pt(12)}; margin-top: ${mm(0.4)}; line-height: 1.15; overflow-wrap: anywhere; }
  .a4h-date { font-size: ${pt(8)}; margin-top: ${mm(0.3)}; }
  .a4h-status { font-size: ${pt(6.5)}; padding: ${mm(0.3)} ${wmm(1.4)}; margin-top: ${mm(0.8)}; border-width: 1px; }
  .doc-cont { display: flex; justify-content: space-between; align-items: baseline; gap: ${wmm(3)}; margin-bottom: ${mm(2)}; padding-bottom: ${mm(1.2)}; border-bottom: 1.2px solid #000; font-size: ${pt(8)}; font-weight: 600; }
  .doc-cont strong { font-size: ${pt(9)}; font-weight: 800; overflow-wrap: anywhere; }
  .doc-cont span:last-child { text-align: right; white-space: nowrap; }
  .parties { gap: ${wmm(2)}; margin-bottom: ${mm(2)}; }
  .party { padding: ${mm(1.1)} ${wmm(2)}; border-width: 1px; border-radius: 2px; }
  .party h3 { font-size: ${pt(6.5)}; margin-bottom: ${mm(0.6)}; padding-bottom: ${mm(0.4)}; border-bottom-width: 0.5pt; letter-spacing: 0.8px; }
  .party p { font-size: ${pt(8.5)}; line-height: 1.25; margin-bottom: 0; overflow-wrap: anywhere; }
  th { padding: ${mm(1)} ${wmm(1.5)}; font-size: ${pt(6.8)}; letter-spacing: 0.3px; line-height: 1.2; }
  th:nth-child(1) { width: 58%; }
  th:nth-child(2) { width: 7%; }
  th:nth-child(3) { width: 14%; }
  th:nth-child(4) { width: 21%; }
  th:nth-child(n+2), td:nth-child(n+2) { padding-left: ${wmm(1)}; padding-right: ${wmm(1)}; }
  td { padding: ${mm(0.9)} ${wmm(1.5)}; font-size: ${pt(8.5)}; line-height: 1.25; border-bottom-width: 0.5pt; }
  td .bold { font-size: ${pt(8.5)}; font-weight: 700; overflow-wrap: anywhere; }
  td.center { font-size: ${pt(8.5)}; }
  td.right { white-space: nowrap; }
  td.right.bold { font-size: ${pt(8.5)}; }
  .item-ref { font-size: ${pt(7)}; line-height: 1.2; margin-top: ${mm(0.2)}; overflow-wrap: anywhere; }
  .cb-totals { align-items: stretch; }
  .cb-pay { flex: 1 1 auto; min-width: 0; padding: ${mm(1.2)} ${wmm(2)}; }
  .cb-pay h3 { font-size: ${pt(6.5)}; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; padding-bottom: ${mm(0.4)}; margin-bottom: ${mm(0.6)}; border-bottom: 0.5pt solid #000; }
  .cb-pay .p-row { font-size: ${pt(8)}; padding: ${mm(0.4)} 0; gap: ${wmm(2)}; }
  .financial-box { width: ${wmm(66)}; flex: 0 0 ${wmm(66)}; }
  .fin-row { padding: ${mm(0.9)} ${wmm(2.2)}; font-size: ${pt(8.5)}; gap: ${wmm(2)}; }
  .fin-row.grand { font-size: ${pt(11)}; padding: ${mm(1.3)} ${wmm(2.2)}; }
  .fin-row.due-row { font-size: ${pt(9)}; }
  .cb-strip { display: flex; justify-content: space-between; gap: ${wmm(3)}; border-top: 1px solid #000; padding: ${mm(1)} ${wmm(2.2)}; font-size: ${pt(8.5)}; font-weight: 700; background: #f5f5f5; }
  .cb-strip span:last-child { white-space: nowrap; }
  .footer-note { font-size: ${pt(7.5)}; margin-top: ${mm(1.5)}; }
  .footer { font-size: ${pt(6.5)}; margin-top: ${mm(1.5)}; padding-top: ${mm(1)}; border-top-width: 0.75pt; gap: ${wmm(3)}; }
  .waarwi-brand-footer { font-size: ${pt(6)}; margin-top: ${mm(0.8)}; padding-top: ${mm(0.6)}; }
`;
}

export type DocPaperFormat = 'A4' | 'A5';
const DOC_FORMAT_KEY = 'waarwi_doc_paper_format';

// Paper size depends on the printer attached to this device, so the choice is stored per device.
export function getDocPaperFormat(): DocPaperFormat {
  try { return localStorage.getItem(DOC_FORMAT_KEY) === 'A5' ? 'A5' : 'A4'; } catch { return 'A4'; }
}

export function setDocPaperFormat(format: DocPaperFormat) {
  try { localStorage.setItem(DOC_FORMAT_KEY, format); } catch { /* storage unavailable */ }
}

type CommercialDocOpts = {
  tenant: PrintTenant;
  format?: DocPaperFormat;
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
};

function paymentStatusLabel(opts: CommercialDocOpts, paidAmount: number): string | undefined {
  if (!['FACTURE', 'BON DE COMMANDE'].includes(opts.docLabel)) return undefined;
  return paidAmount >= opts.total ? 'PAYÉE' : paidAmount > 0 ? 'PARTIELLEMENT PAYÉE' : 'NON PAYÉE';
}

export function printDocumentA4(opts: CommercialDocOpts) {
  opts = { ...opts, items: withVisibleOemRefs(opts.items, opts.tenant) };
  const format = (opts.format ?? getDocPaperFormat()) === 'A5' ? A5_FORMAT : A4_FORMAT;
  void printPagedDocument(opts, format);
}

// Pages are cut from measured heights so totals, payments and footer close the last page.
// A5 intermediate pages carry only their page subtotal; A4 ones repeat the totals box with masked amounts.
async function printPagedDocument(opts: CommercialDocOpts, f: PagedFormat) {
  const t = opts.tenant;
  const paidAmount = typeof opts.paid === 'number' ? opts.paid : (opts.payments || []).reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, opts.total - paidAmount);
  const status = paymentStatusLabel(opts, paidAmount);
  const isInvoiceType = status !== undefined;
  const hasDiscount = !!(opts.discount && opts.discount > 0);
  const payments = opts.payments || [];

  const rows = opts.items.map(i => {
    const lineTotal = i.quantity * i.unit_price - (i.discount || 0);
    return {
      lineTotal,
      html: `<tr data-m="row">
      <td>
        <div class="bold">${esc(i.name)}</div>
        ${i.supplier_ref || i.oem_ref ? `<div class="item-ref">${[
          i.supplier_ref ? `Réf : ${esc(i.supplier_ref)}` : '',
          i.oem_ref ? `OEM : ${esc(i.oem_ref)}` : '',
        ].filter(Boolean).join(' · ')}</div>` : ''}
      </td>
      <td class="center">${i.quantity}</td>
      <td class="right">${fmtMoney(i.unit_price)}</td>
      <td class="right bold">${fmtMoney(lineTotal)}</td>
    </tr>`,
    };
  });
  const itemsTotal = rows.reduce((s, r) => s + r.lineTotal, 0);

  const tableHead = `<thead data-m="thead"><tr>
    <th>Désignation</th>
    <th class="center">Qté</th>
    <th class="right">P.U.</th>
    <th class="right">Montant</th>
  </tr></thead>`;

  const headerHtml = renderA4Header({
    tenant: t,
    docTitle: opts.docLabel,
    docNumber: `N° ${opts.docNumber}`,
    docDate: `Date : ${opts.docDate}`,
    status,
  });

  const partiesHtml = `<div class="parties">
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
  </div>`;

  const paymentsHtml = payments.length
    ? `<h3>Détail des règlements</h3>${payments.map(p => `<div class="p-row"><span>${esc(p.method_name)}</span><span><strong>${fmtMoney(p.amount)} FCFA</strong></span></div>`).join('')}`
    : '';

  const MASK = 'XXXXXX';
  const totalsHtml = (subtotalLabel: string, subtotal: number, masked: boolean) => `<div class="cb-totals">
    <div class="cb-pay">${masked ? '' : paymentsHtml}</div>
    <div class="financial-box">
      <div class="fin-row subtotal-fin"><span>${subtotalLabel}</span><span>${fmtMoney(subtotal)} FCFA</span></div>
      ${hasDiscount ? `<div class="fin-row discount"><span>Remise</span><span>${masked ? MASK : `- ${fmtMoney(opts.discount || 0)} FCFA`}</span></div>` : ''}
      <div class="fin-row grand"><span>TOTAL TTC</span><span>${masked ? MASK : `${fmtMoney(opts.total)} FCFA`}</span></div>
      ${isInvoiceType ? `
        <div class="fin-row paid-row"><span>Règlement</span><span>${masked ? MASK : `${fmtMoney(paidAmount)} FCFA`}</span></div>
        <div class="fin-row due-row"><span>Reste à payer</span><span>${masked ? MASK : `${fmtMoney(remaining)} FCFA`}</span></div>
      ` : ''}
    </div>
  </div>`;

  const footerHtml = `<div class="page-tail">${opts.footerNote ? `<div class="footer-note">${esc(opts.footerNote)}</div>` : ''}
  <div class="footer">
    <span>${esc(t.name)}${t.ninea ? ` — NINEA : ${esc(t.ninea)}` : ''}</span>
    <span>Imprimé le ${new Date().toLocaleString('fr-FR')}</span>
  </div>
  ${waarwiFooterA4()}</div>`;

  const contHeader = (pageNo: number, count: number) => `<div class="doc-cont">
    <strong>${esc(t.name)}</strong>
    <span>${esc(opts.docLabel)} N° ${esc(opts.docNumber)} · ${esc(opts.docDate)} · Page ${pageNo}/${count}</span>
  </div>`;

  const closingHtml = (pageNo: number, count: number, pageSubtotal: number) => {
    if (f.maskedTotalsOnEveryPage) {
      return totalsHtml(count > 1 ? `Sous-total page ${pageNo}/${count}` : 'Sous-total', count > 1 ? pageSubtotal : itemsTotal, pageNo !== count);
    }
    return pageNo === count
      ? totalsHtml(count > 1 ? 'Sous-total général' : 'Sous-total', itemsTotal, false)
      : `<div class="cb-strip"><span>Suite page suivante</span><span>Sous-total de cette page : ${fmtMoney(pageSubtotal)} FCFA</span></div>`;
  };

  const renderPage = (idx: number[], pageNo: number, count: number) => {
    const isLast = pageNo === count;
    const pageSubtotal = idx.reduce((s, k) => s + rows[k].lineTotal, 0);
    const fullHeader = pageNo === 1 || f.fullHeaderEveryPage;
    return `<div class="invoice-page" data-m="page">
      ${fullHeader ? headerHtml + partiesHtml : contHeader(pageNo, count)}
      <div class="commercial-block">
        <table>${tableHead}<tbody>${idx.map(k => rows[k].html).join('')}</tbody></table>
        <div class="cb-fill"></div>
        ${closingHtml(pageNo, count, pageSubtotal)}
      </div>
      ${isLast ? footerHtml : ''}
      <div class="doc-pageno">Page ${pageNo} / ${count}</div>
    </div>`;
  };

  const docHtml = (body: string, extraCss = '') => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(opts.docLabel)} ${esc(opts.docNumber)}</title>
<style>${a4Style}${commercialBlockCss}${pagedDocCss(f)}${extraCss}</style>${printFontLink}</head><body>
${body}
</body></html>`;

  const all = rows.map((_, k) => k);
  let metrics: PageMetrics;
  try {
    // Probe: full first page (all rows + totals + tail), then an empty intermediate page with its closing block.
    metrics = await measurePageMetrics(docHtml(renderPage(all, 1, 1) + renderPage([], 2, 3), '.invoice-page { min-height: 0; }'), contentWidth(f));
  } catch {
    const headerConfig = mergeTicketHeaderConfig(t.header_config);
    metrics = estimatePageMetrics({
      rows: opts.items.map(i => ({ nameLength: String(i.name || '').length, refs: (i.supplier_ref ? 1 : 0) + (i.oem_ref ? 1 : 0) })),
      headerLines: headerConfig.filter(c => c.key !== 'logo' && c.show && headerFieldValue(t, c.key)).length,
      payCount: payments.length,
      hasDiscount,
      hasPaymentRows: isInvoiceType,
      hasNote: !!opts.footerNote,
      fullHeaderEveryPage: f.fullHeaderEveryPage,
      totalsOnEveryPage: f.maskedTotalsOnEveryPage,
    }, f.estimate);
  }
  // Small safety margin for rounding between screen layout and the print engine.
  const pages = paginateByHeight(metrics, contentHeight(f) - 2.5);
  printHtml(docHtml(pages.map((idx, p) => renderPage(idx, p + 1, pages.length)).join('')), 400);
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
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #000; font-size: 10pt; line-height: 1.5; background: #fff; }
  .doc { max-width: 186mm; margin: 0 auto; }
  ${a4HeaderCss}
  .a4h-header { border-bottom: 2px solid #000; }
  .title { text-align: center; font-size: 14pt; font-weight: 800; letter-spacing: 1px; color: #000; margin: 5mm 0 3mm; text-transform: uppercase; }
  .meta-bar { display: flex; gap: 4mm; flex-wrap: wrap; margin-bottom: 5mm; padding: 3mm 0; border-top: 1px solid #000; border-bottom: 1px solid #e5e7eb; }
  .meta-bar .cell { flex: 1; min-width: 35mm; }
  .meta-bar .cell .lbl { font-size: 7.5pt; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.8px; }
  .meta-bar .cell .val { font-size: 10pt; font-weight: 700; color: #000; margin-top: 0.5mm; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
  thead tr { background: #f5f5f5; }
  thead th { text-align: left; font-size: 8pt; padding: 2.5mm 3mm; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #000; border-bottom: 1.5px solid #000; }
  thead th.center { text-align: center; }
  tbody tr { border-bottom: 1px solid #e5e7eb; }
  tbody td { padding: 2.5mm 3mm; font-size: 9.5pt; vertical-align: top; color: #000; }
  .total-row { background: #f5f5f5 !important; border-top: 1.5px solid #000; }
  .total-row td { font-weight: 800; font-size: 10pt; padding: 3mm; }
  .observation { margin: 5mm 0; padding: 3mm 4mm; border: 1px solid #e5e7eb; background: #fafafa; }
  .observation .lbl { font-size: 8pt; font-weight: 700; color: #6b7280; text-transform: uppercase; margin-bottom: 1mm; }
  .observation .txt { font-size: 9.5pt; color: #000; }
  .signatures { display: flex; justify-content: space-between; margin-top: 12mm; padding-top: 5mm; }
  .sig-block { width: 55mm; text-align: center; }
  .sig-block .line { height: 15mm; border-bottom: 1px solid #000; }
  .sig-block .cap { margin-top: 2mm; font-size: 8pt; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.8px; }
  .footer-brand { margin-top: 8mm; padding-top: 3mm; border-top: 1px dashed #cbd5e1; text-align: center; font-size: 8pt; color: #94a3b8; }
</style>${printFontLink}</head><body>
<div class="doc">
  ${renderA4Header({ tenant: t, docTitle: title, docNumber: opts.reference, docDate: opts.date })}

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

// ── Customer Account Statement (A4) ───────────────────────────────────────────
export type CustomerStatementRow = {
  ts: string;
  piece: string;
  label: string;
  debit: number;
  credit: number;
  running: number;
  affects: boolean;
};

export type CustomerStatementPrintOpts = {
  tenant: PrintTenant;
  siteName?: string;
  customer: { name: string; account_code?: string; phone?: string; address?: string };
  periodLabel: string;
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  rows: CustomerStatementRow[];
  issuedBy?: string;
};

export function printCustomerStatementA4(opts: CustomerStatementPrintOpts) {
  const t = opts.tenant;
  const title = 'RELEVÉ DE COMPTE CLIENT';
  const fmtDate = (v: string) => new Date(v).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const dirLabel = (v: number) => v > 0 ? 'Débiteur' : v < 0 ? 'Créditeur' : 'Équilibré';
  const openDebit = Math.max(opts.openingBalance, 0);
  const openCredit = Math.max(-opts.openingBalance, 0);

  const rowsHtml = opts.rows.map(r => {
    const muted = r.affects ? '' : 'color:#94a3b8;font-style:italic;';
    return `
    <tr>
      <td style="white-space:nowrap;${muted}">${fmtDate(r.ts)}</td>
      <td style="font-family:'Courier New',monospace;font-size:8.5pt;${muted}">${esc(r.piece || '')}</td>
      <td style="${muted}">${esc(r.label)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;${muted}">${r.debit > 0 ? fmtMoney(r.debit) : ''}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;${muted}">${r.credit > 0 ? fmtMoney(r.credit) : ''}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:700;">${r.affects ? `${fmtMoney(Math.abs(r.running))} ${dirLabel(r.running)}` : ''}</td>
    </tr>`;
  }).join('');

  const finalLabel = dirLabel(opts.closingBalance);
  const finalValue = Math.abs(opts.closingBalance);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)} - ${esc(opts.customer.name)}</title>
<style>
  @page { size: A4; margin: 15mm 12mm; }
  @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #000; font-size: 10pt; line-height: 1.5; background: #fff; }
  .doc { max-width: 186mm; margin: 0 auto; }
  ${a4HeaderCss}
  .a4h-header { border-bottom: 2px solid #000; }
  .title { text-align: center; font-size: 14pt; font-weight: 800; letter-spacing: 1px; color: #000; margin: 5mm 0 3mm; text-transform: uppercase; }
  .meta-bar { display: flex; gap: 4mm; flex-wrap: wrap; margin-bottom: 4mm; padding: 3mm 0; border-top: 1px solid #000; border-bottom: 1px solid #e5e7eb; }
  .meta-bar .cell { flex: 1; min-width: 40mm; }
  .meta-bar .cell .lbl { font-size: 7.5pt; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.8px; }
  .meta-bar .cell .val { font-size: 10pt; font-weight: 700; color: #000; margin-top: 0.5mm; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
  thead tr { background: #f5f5f5; }
  thead th { text-align: left; font-size: 8pt; padding: 2.5mm 3mm; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #000; border-bottom: 1.5px solid #000; }
  thead th.right { text-align: right; }
  tbody tr { border-bottom: 1px solid #eef0f2; }
  tbody td { padding: 2mm 3mm; font-size: 9pt; vertical-align: top; color: #000; }
  .opening-row td { background: #fafafa; font-weight: 700; }
  .total-row { background: #f5f5f5 !important; border-top: 1.5px solid #000; }
  .total-row td { font-weight: 800; font-size: 9.5pt; padding: 2.5mm 3mm; }
  .closing-box { display: flex; justify-content: flex-end; margin-top: 3mm; }
  .closing-box .inner { border: 1.5px solid #000; padding: 3mm 6mm; text-align: right; min-width: 60mm; }
  .closing-box .lbl { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #6b7280; }
  .closing-box .val { font-size: 13pt; font-weight: 900; font-variant-numeric: tabular-nums; margin-top: 1mm; }
  .footer-brand { margin-top: 8mm; padding-top: 3mm; border-top: 1px dashed #cbd5e1; text-align: center; font-size: 8pt; color: #94a3b8; }
</style>${printFontLink}</head><body>
<div class="doc">
  ${renderA4Header({ tenant: t, docTitle: title, docDate: new Date().toLocaleDateString('fr-FR'), siteName: opts.siteName })}

  <div class="title">${esc(title)}</div>

  <div class="meta-bar">
    <div class="cell"><div class="lbl">Client</div><div class="val">${esc(opts.customer.name)}</div></div>
    ${opts.customer.account_code ? `<div class="cell"><div class="lbl">Compte</div><div class="val">${esc(opts.customer.account_code)}</div></div>` : ''}
    ${opts.customer.phone ? `<div class="cell"><div class="lbl">Téléphone</div><div class="val">${esc(opts.customer.phone)}</div></div>` : ''}
    <div class="cell"><div class="lbl">Période</div><div class="val">${esc(opts.periodLabel)}</div></div>
    ${opts.customer.address ? `<div class="cell"><div class="lbl">Adresse</div><div class="val">${esc(opts.customer.address)}</div></div>` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:22mm;">Date</th>
        <th style="width:26mm;">Pièce</th>
        <th>Libellé</th>
        <th class="right" style="width:26mm;">Débit</th>
        <th class="right" style="width:26mm;">Crédit</th>
        <th class="right" style="width:30mm;">Solde</th>
      </tr>
    </thead>
    <tbody>
      <tr class="opening-row">
        <td colspan="3">Solde d'ouverture</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;">${openDebit > 0 ? fmtMoney(openDebit) : ''}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;">${openCredit > 0 ? fmtMoney(openCredit) : ''}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;">${fmtMoney(Math.abs(opts.openingBalance))} ${dirLabel(opts.openingBalance)}</td>
      </tr>
      ${rowsHtml}
      <tr class="total-row">
        <td colspan="3" style="text-align:right;">TOTAUX</td>
        <td style="text-align:right;">${fmtMoney(opts.totalDebit + openDebit)}</td>
        <td style="text-align:right;">${fmtMoney(opts.totalCredit + openCredit)}</td>
        <td style="text-align:right;">${fmtMoney(Math.abs(opts.closingBalance))} ${dirLabel(opts.closingBalance)}</td>
      </tr>
    </tbody>
  </table>

  <div class="closing-box">
    <div class="inner">
      <div class="lbl">Solde client — ${finalLabel}</div>
      <div class="val">${fmtMoney(finalValue)} FCFA</div>
    </div>
  </div>

  ${opts.issuedBy ? `<div style="margin-top:5mm;font-size:8.5pt;color:#6b7280;">Établi par ${esc(opts.issuedBy)}</div>` : ''}

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

  const itemsHtml = opts.items.map(item =>
    `<div class="row"><span style="white-space:normal">${esc(item.name)}</span><span>${Math.abs(item.quantity)}</span></div>`
  ).join('');

  const sites = [
    opts.siteOrigin ? `De: ${opts.siteOrigin}` : '',
    opts.siteDestination ? `Vers: ${opts.siteDestination}` : '',
    opts.siteName ? `Dépôt: ${opts.siteName}` : '',
  ].filter(Boolean).join(' · ');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${compactTicketStyle}</style>${printFontLink}</head><body>
${tenantHeader80Compact(t)}
<hr class="hr-solid" />
<div class="doc-label">${esc(title)} · ${esc(opts.reference)}</div>
<div class="doc-date">${esc(opts.date)}</div>
<div class="line">Opérateur: ${esc(opts.user)}</div>
${sites ? `<div class="line">${esc(sites)}</div>` : ''}
<hr class="hr" />
${itemsHtml}
<div class="row total"><span>TOTAL</span><span>${totalQty} article${totalQty > 1 ? 's' : ''}</span></div>
${opts.observation ? `<div class="line" style="font-style:italic;">Obs: ${esc(opts.observation)}</div>` : ''}
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
  const totalTheo = opts.items.reduce((s, i) => s + i.qty_theoretical, 0);
  const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' F';

  const rowsHtml = opts.items.map((r, i) => {
    const ecart = r.qty_real - r.qty_theoretical;
    return `
    <tr>
      <td class="c num">${i + 1}</td>
      <td class="ref">${esc(r.ref)}</td>
      <td>${esc(r.name)}</td>
      <td class="c">${esc(r.location || '')}</td>
      <td class="c num">${r.qty_theoretical}</td>
      <td class="c num b">${r.qty_real}</td>
      <td class="c num">${ecart > 0 ? '+' : ''}${ecart}</td>
      <td class="r num">${fmt(r.qty_real * r.purchase_price)}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Livre d'inventaire — ${esc(opts.reference)}</title>
<style>
  @page { size: A4; margin: 12mm 10mm 14mm 10mm; }
  @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #000; font-size: 9pt; line-height: 1.4; background: #fff; }
  .doc { max-width: 190mm; margin: 0 auto; }
  ${a4HeaderCss}
  .doc-subtitle { text-align: center; font-size: 9pt; color: #555; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin: 3mm 0 4mm; }
  .summary-bar { display: flex; margin: 0 0 4mm; border-top: 1px solid #000; border-bottom: 1px solid #e5e7eb; }
  .summary-bar .cell { flex: 1; padding: 3mm 4mm; border-left: 1px solid #e5e7eb; }
  .summary-bar .cell:first-child { border-left: none; }
  .summary-bar .cell .lbl { font-size: 7pt; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
  .summary-bar .cell .val { font-size: 10pt; font-weight: 700; color: #000; margin-top: 0.5mm; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  thead tr { background: #f5f5f5; }
  thead th { text-align: left; font-size: 7.5pt; padding: 2mm 2.5mm; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #000; border-bottom: 1px solid #000; }
  thead th.c { text-align: center; }
  thead th.r { text-align: right; }
  tbody tr { page-break-inside: avoid; border-bottom: 0.5px solid #e5e7eb; }
  tbody td { padding: 1.8mm 2.5mm; font-size: 8.5pt; vertical-align: top; color: #000; }
  .c { text-align: center; }
  .r { text-align: right; }
  .b { font-weight: 700; }
  .num { font-variant-numeric: tabular-nums; }
  .ref { font-family: 'Courier New', monospace; font-size: 8pt; font-weight: 600; }
  .tfoot-row { background: #f5f5f5; border-top: 1px solid #000; }
  .tfoot-row td { padding: 2.5mm; font-weight: 800; font-size: 9pt; }
  .signatures { display: flex; justify-content: space-between; margin-top: 10mm; }
  .sig-block { width: 50mm; text-align: center; }
  .sig-block .line { height: 13mm; border-bottom: 1px solid #000; }
  .sig-block .cap { margin-top: 1.5mm; font-size: 7.5pt; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.8px; }
  .brand-footer { margin-top: 6mm; padding-top: 2mm; border-top: 1px dashed #cbd5e1; text-align: center; font-size: 7.5pt; color: #94a3b8; }
</style>${printFontLink}</head><body>
<div class="doc">
  ${renderA4Header({ tenant: t, docTitle: "Livre d'inventaire", docNumber: opts.reference, docDate: opts.date, siteName: opts.siteName })}
  <div class="doc-subtitle">État du stock disponible — ${esc(opts.siteName)}</div>

  <div class="summary-bar">
    <div class="cell"><div class="lbl">Dépôt</div><div class="val">${esc(opts.siteName)}</div></div>
    <div class="cell"><div class="lbl">Références</div><div class="val">${opts.items.length}</div></div>
    <div class="cell"><div class="lbl">Qté totale</div><div class="val">${totalQty.toLocaleString('fr-FR')}</div></div>
    <div class="cell"><div class="lbl">Écart total</div><div class="val">${totalEcart > 0 ? '+' : ''}${totalEcart}</div></div>
    <div class="cell"><div class="lbl">Valeur stock</div><div class="val">${fmt(totalValue)}</div></div>
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
        <td colspan="4" class="r">TOTAL</td>
        <td class="c num">${totalTheo}</td>
        <td class="c num">${totalQty}</td>
        <td class="c num">${totalEcart > 0 ? '+' : ''}${totalEcart}</td>
        <td class="r num">${fmt(totalValue)}</td>
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
  ${a4HeaderCss}
  .doc-number { font-family: 'Space Grotesk', 'Helvetica Neue', Arial, sans-serif; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
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
</style>${printFontLink}</head><body>
<div class="page-content">
  ${renderA4Header({
    tenant: t,
    docTitle: 'FICHE DE GARANTIE',
    docNumber: opts.saleNumber,
    docDate: new Date(opts.saleDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
    subtitle: opts.siteName || undefined,
    status: statusCfg.text,
  })}

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

// ── Generic HTML report (A4) ─────────────────────────────────────────────────

export function printHtmlReport(opts: {
  title: string;
  subtitle?: string;
  kpis?: { label: string; value: string }[];
  tableHead: string;
  tableBody: string;
}) {
  const kpisHtml = (opts.kpis && opts.kpis.length > 0)
    ? `<div class="summary">${opts.kpis.map(k => `<div class="card"><div class="lbl">${esc(k.label)}</div><div class="val">${esc(k.value)}</div></div>`).join('')}</div>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
<style>
  @page { size: A4; margin: 12mm 10mm 14mm 10mm; }
  @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1e293b; font-size: 9pt; line-height: 1.4; background: #fff; }
  .doc { max-width: 190mm; margin: 0 auto; }
  .doc-title { text-align: center; font-size: 13pt; font-weight: 800; letter-spacing: 1px; color: #0f766e; margin: 2mm 0; text-transform: uppercase; }
  .doc-subtitle { text-align: center; font-size: 8.5pt; color: #64748b; font-weight: 600; letter-spacing: 0.6px; margin-bottom: 4mm; }
  .summary { display: flex; flex-wrap: wrap; gap: 3mm; margin-bottom: 4mm; }
  .summary .card { flex: 1; min-width: 30mm; padding: 2.5mm 3mm; border: 1px solid #e2e8f0; border-radius: 1.5mm; background: #f8fafc; }
  .summary .card .lbl { font-size: 7pt; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.8px; }
  .summary .card .val { font-size: 10pt; font-weight: 800; color: #0f172a; margin-top: 0.3mm; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  thead tr { background: #f1f5f9; }
  thead th { text-align: left; font-size: 7.5pt; padding: 2mm 2.5mm; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; border-bottom: 1.5px solid #cbd5e1; }
  tbody tr { page-break-inside: avoid; border-bottom: 0.5px solid #e2e8f0; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tbody td { padding: 1.8mm 2.5mm; font-size: 8.5pt; vertical-align: top; font-variant-numeric: tabular-nums; }
  .brand-footer { margin-top: 6mm; padding-top: 2mm; border-top: 1px dashed #cbd5e1; text-align: center; font-size: 7.5pt; color: #94a3b8; }
</style>${printFontLink}</head><body>
<div class="doc">
  <div class="doc-title">${esc(opts.title)}</div>
  ${opts.subtitle ? `<div class="doc-subtitle">${esc(opts.subtitle)}</div>` : ''}
  ${kpisHtml}
  <table>
    <thead>${opts.tableHead}</thead>
    <tbody>${opts.tableBody}</tbody>
  </table>
  <div class="brand-footer">Propulsée par <strong>WAARWI</strong> — Plateforme Business 2.0 made in Sénégal</div>
</div>
</body></html>`;
  printHtml(html, 400);
}
