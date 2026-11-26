const FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/;

export function sanitizeCsvValue(value: string): string {
  if (typeof value !== 'string') return value;
  if (FORMULA_PREFIX.test(value)) return "'" + value;
  return value;
}

export function desanitizeCsvValue(value: string): string {
  if (typeof value !== 'string') return value;
  if (value.startsWith("'") && FORMULA_PREFIX.test(value.slice(1))) return value.slice(1);
  return value;
}
