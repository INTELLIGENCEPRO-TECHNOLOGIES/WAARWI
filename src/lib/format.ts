export function formatFCFA(amount: number | null | undefined): string {
  const v = Number(amount || 0);
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v) + ' FCFA';
}

export function formatCompactFCFA(amount: number | null | undefined): string {
  const v = Math.round(Number(amount || 0));
  const abs = Math.abs(v);
  if (abs < 100_000_000) {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v) + ' FCFA';
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
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
