import { getIntlLocale } from '../i18n';

function getLocale(): string {
  if (typeof localStorage !== 'undefined') {
    return getIntlLocale(localStorage.getItem('waarwi_locale') || 'fr');
  }
  return 'fr-FR';
}

export function formatFCFA(amount: number | null | undefined): string {
  const v = Number(amount || 0);
  return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 }).format(v) + ' FCFA';
}

export function formatCompactFCFA(amount: number | null | undefined): string {
  const v = Math.round(Number(amount || 0));
  const abs = Math.abs(v);
  if (abs < 100_000_000) {
    return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 }).format(v) + ' FCFA';
  }
  if (abs < 1_000_000_000) {
    const m = v / 1_000_000;
    return `${m.toFixed(1).replace(/\.0$/, '')}M FCFA`;
  }
  const b = v / 1_000_000_000;
  return `${b.toFixed(1).replace(/\.0$/, '')}Md FCFA`;
}

export function formatDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString(getLocale(), { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString(getLocale(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Locale-aware formatters for use in components that need the current locale
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getLocale(), options).format(value);
}

export function formatCurrency(value: number, currency = 'XOF'): string {
  return new Intl.NumberFormat(getLocale(), { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

export function formatDateLong(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatTime(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
}
