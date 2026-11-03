// Height-based pagination for paged print documents (A4 and A5 invoices).
// Heights are in millimetres. Probe HTML must contain, in order:
// a first page [data-m="page"] holding every row, with its totals and tail,
// then an empty intermediate page [data-m="page"] ending with its closing block (subtotal strip or masked totals).
// Rows are marked [data-m="row"] and table headers [data-m="thead"].

export type PageMetrics = {
  firstFixed: number;
  contFixed: number;
  strip: number;
  finalBlock: number;
  rows: number[];
};

const PX_TO_MM = 25.4 / 96;

function waitImages(doc: Document, timeoutMs: number): Promise<void> {
  const imgs = Array.from(doc.images || []);
  return Promise.all(imgs.map(img => (img.complete
    ? Promise.resolve()
    : new Promise<void>(resolve => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
        setTimeout(resolve, timeoutMs);
      })))).then(() => undefined);
}

function waitFonts(doc: Document, timeoutMs: number): Promise<void> {
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return Promise.resolve();
  return Promise.race([fonts.ready.then(() => undefined), new Promise<void>(r => setTimeout(r, timeoutMs))]);
}

// Renders the probe in an offscreen iframe as wide as the printable area, once fonts and images are loaded.
export async function measurePageMetrics(probeHtml: string, contentWidthMm: number): Promise<PageMetrics> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${contentWidthMm}mm;height:400mm;border:0;visibility:hidden;pointer-events:none;`;
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('probe document unavailable');
    const loaded = new Promise<void>(resolve => {
      iframe.addEventListener('load', () => resolve(), { once: true });
      setTimeout(resolve, 1500);
    });
    doc.open();
    doc.write(probeHtml);
    doc.close();
    await loaded;
    await Promise.all([waitImages(doc, 3000), waitFonts(doc, 3000)]);

    const pages = Array.from(doc.querySelectorAll<HTMLElement>('[data-m="page"]'));
    if (pages.length < 2) throw new Error('probe pages missing');
    const [first, cont] = pages;
    const box = (el: Element) => el.getBoundingClientRect();
    const firstHead = first.querySelector('[data-m="thead"]');
    const contHead = cont.querySelector('[data-m="thead"]');
    if (!firstHead || !contHead) throw new Error('probe headers missing');
    const rows = Array.from(first.querySelectorAll('[data-m="row"]')).map(r => box(r).height * PX_TO_MM);
    const lastAnchor = rows.length ? first.querySelectorAll('[data-m="row"]')[rows.length - 1] : firstHead;
    const metrics: PageMetrics = {
      firstFixed: (box(firstHead).bottom - box(first).top) * PX_TO_MM,
      contFixed: (box(contHead).bottom - box(cont).top) * PX_TO_MM,
      strip: (box(cont).bottom - box(contHead).bottom) * PX_TO_MM,
      finalBlock: (box(first).bottom - box(lastAnchor).bottom) * PX_TO_MM,
      rows,
    };
    if (!(metrics.firstFixed > 0) || rows.some(h => !(h > 0))) throw new Error('probe not laid out');
    return metrics;
  } finally {
    iframe.parentNode?.removeChild(iframe);
  }
}

// Fallback when the probe cannot be measured. Calibrated on the A5 invoice (~58% designation column),
// other formats pass their own characters per line and a height scale. It over-estimates wrapped lines,
// so it may end a page a row or two early, but a dozen short rows still fit on one page.
export function estimatePageMetrics(o: {
  rows: { nameLength: number; refs: number }[];
  headerLines: number;
  payCount: number;
  hasDiscount: boolean;
  hasPaymentRows: boolean;
  hasNote: boolean;
  fullHeaderEveryPage: boolean;
  totalsOnEveryPage: boolean;
}, cal: { charsPerLine: number; scale: number }): PageMetrics {
  const header = Math.max(22, 6 + o.headerLines * 3.6) + 4;
  const totals = 6.5 + 4.5 * (1 + (o.hasDiscount ? 1 : 0) + (o.hasPaymentRows ? 2 : 0));
  const payExtra = Math.max(0, o.payCount - 3) * 3.5;
  const firstFixed = header + 15 + 6;
  return {
    firstFixed: firstFixed * cal.scale,
    contFixed: (o.fullHeaderEveryPage ? firstFixed : 8 + 6) * cal.scale,
    strip: (o.totalsOnEveryPage ? totals + 4 : 6 + 4) * cal.scale,
    finalBlock: (totals + payExtra + 9 + 4 + (o.hasNote ? 5 : 0)) * cal.scale,
    rows: o.rows.map(r => (2 + 4 * Math.max(1, Math.ceil(r.nameLength / cal.charsPerLine)) + 3.2 * r.refs) * cal.scale),
  };
}

// Returns row indices per page. Final totals/tail always sit on the last page with at least one row when possible.
export function paginateByHeight(m: PageMetrics, availMm: number): number[][] {
  const n = m.rows.length;
  const pages: number[][] = [];
  let i = 0;
  for (;;) {
    const fixed = pages.length === 0 ? m.firstFixed : m.contFixed;
    let remaining = 0;
    for (let k = i; k < n; k++) remaining += m.rows[k];
    if (fixed + remaining + m.finalBlock <= availMm) {
      pages.push(Array.from({ length: n - i }, (_, k) => i + k));
      return pages;
    }
    const cur: number[] = [];
    let used = fixed + m.strip;
    while (i < n && (cur.length === 0 || used + m.rows[i] <= availMm)) {
      used += m.rows[i];
      cur.push(i++);
    }
    if (i === n && cur.length > 1) { cur.pop(); i--; }
    pages.push(cur);
    if (i === n) { pages.push([]); return pages; }
  }
}
