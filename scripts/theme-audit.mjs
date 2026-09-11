#!/usr/bin/env node
/**
 * Theme Audit — exits 1 if any authenticated-UI source file
 * still uses a hardcoded color class that should be a CSS variable,
 * or violates structural rules (fake underlines, missing print-preview, etc.).
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(process.cwd(), 'src');

const EXEMPT_PATHS = [
  'index.css',
  'context/ThemeContext.tsx',
  'components/ThemeToggle.tsx',
  'pages/PublicInvoice.tsx',
  'pages/PublicSupplierOrder.tsx',
  'pages/Shop.tsx',
  'components/shop/',
  'components/ShopTrackOrder.tsx',
  'lib/',
  'i18n/',
  'vite-env.d.ts',
];

// ── Color rules ──────────────────────────────────────────
const RULES = [
  { re: /\bfocus:bg-white\b/, id: 'focus:bg-white' },
  { re: /\bborder-slate-50\b/, id: 'border-slate-50' },
  { re: /\bdivide-slate-50\b/, id: 'divide-slate-50' },
  { re: /\btext-purple-\d{3}\b/, id: 'text-purple-*' },
  { re: /\bbg-blue-50\b/, id: 'bg-blue-50 (use var(--w-active))' },
  { re: /\bbg-slate-50\b(?![/])/, id: 'bg-slate-50' },
  { re: /\bborder-slate-100\b/, id: 'border-slate-100' },
  { re: /\bdivide-slate-100\b/, id: 'divide-slate-100' },
  { re: /\bborder-neutral-50\b/, id: 'border-neutral-50 (use var(--w-separator-l))' },
  { re: /\bdivide-neutral-50\b/, id: 'divide-neutral-50 (use var(--w-separator-l))' },
  { re: /background:\s*['"]?var\(--w-text\)['"]?/, id: 'mobile action uses background var(--w-text) (use var(--w-accent))' }
];

// Inline underline-input outside of CSS class definitions
const INLINE_UL_RE = /(?:className|class)=.*?border-0\s+border-b\b/;
const INLINE_UL_EXEMPT = /w-input-ul|w-select-ul|w-textarea-ul|flat-form|\.input\b/;

// Fake underline: an h-px div immediately after an input/select/textarea
const FAKE_UL_RE = /className="h-px\s[^"]*bg-neutral-\d+[^"]*"/;
const FAKE_UL_FIELD_RE = /className="h-px\s[^"]*bg-neutral-\d+[^"]*mt-1"/;
const FIELD_ABOVE_RE = /<(?:input|select|textarea)\b|bare-input|SearchableSelect/;

// CSS primitive must NOT use transparent default border
const TRANSPARENT_BORDER_RE = /border-color:\s*transparent/;

function isExempt(relPath) {
  return EXEMPT_PATHS.some(e =>
    e.endsWith('/') ? relPath.startsWith(e) : relPath === e
  );
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (/\.(tsx?|css)$/.test(entry)) files.push(full);
  }
  return files;
}

let violations = 0;

for (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  if (isExempt(rel)) continue;

  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\/\//.test(line) || /print-preview/.test(line)) continue;

    for (const rule of RULES) {
      if (rule.re.test(line)) {
        console.log(`  ${rel}:${i + 1}  ${rule.id}`);
        violations++;
      }
    }

    // Check inline underline-input pattern
    if (INLINE_UL_RE.test(line) && !INLINE_UL_EXEMPT.test(line)) {
      console.log(`  ${rel}:${i + 1}  inline border-0 border-b (use w-input-ul)`);
      violations++;
    }

    // Check fake underline h-px after a field
    if (FAKE_UL_FIELD_RE.test(line) && i > 0 && FIELD_ABOVE_RE.test(lines.slice(Math.max(0, i - 4), i).join('\n'))) {
      console.log(`  ${rel}:${i + 1}  fake h-px underline after field (remove and use w-input-ul)`);
      violations++;
    }
  }
}

// ── Structural checks ────────────────────────────────────

// Reports.tsx must have print-preview on the A4 sheet
const reportsPath = join(SRC, 'pages', 'Reports.tsx');
try {
  const reportsContent = readFileSync(reportsPath, 'utf8');
  if (!/className="print-preview/.test(reportsContent) && /dangerouslySetInnerHTML.*buildHtml/.test(reportsContent)) {
    console.log('  pages/Reports.tsx  A4 sheet missing print-preview class');
    violations++;
  }
} catch {}

// CSS primitives must NOT use transparent default border
const cssPath = join(SRC, 'index.css');
try {
  const cssContent = readFileSync(cssPath, 'utf8');
  for (const cls of ['w-input-ul', 'w-select-ul', 'w-textarea-ul']) {
    const re = new RegExp(`\\.${cls}\\s*\\{[^}]+\\}`, 's');
    const m = cssContent.match(re);
    if (m) {
      const borderLine = m[0].match(/border-color:\s*(.+?)(!important)?;/);
      if (borderLine) {
        const val = borderLine[1].trim();
        if (val === 'transparent' || val === 'transparent !important') {
          console.log(`  index.css  ${cls} uses fully transparent default border (must use --w-field-border)`);
          violations++;
        }
      }
    }
  }
} catch {}

if (violations > 0) {
  console.log(`\n  ${violations} violation(s) found. Fix them or add to EXEMPT_PATHS if truly unreachable.\n`);
  process.exit(1);
} else {
  console.log('  0 violations — theme audit passed.\n');
  process.exit(0);
}
