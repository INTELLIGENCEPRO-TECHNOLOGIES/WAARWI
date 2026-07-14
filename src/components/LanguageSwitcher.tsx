import { useState, useRef, useEffect } from 'react';
import { Globe, Check } from 'lucide-react';
import { useLocale, LOCALES } from '../context/LocaleContext';
import type { AppLocale } from '../i18n';

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const current = LOCALES.find(l => l.code === locale) || LOCALES[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
        aria-label="Switch language"
      >
        <Globe className="w-4 h-4" />
        {!compact && <span className="font-medium">{current.code.toUpperCase()}</span>}
      </button>

      {open && (
        <div className="absolute end-0 mt-1 w-44 rounded-xl border border-slate-200 bg-white shadow-lg z-50 overflow-hidden">
          {LOCALES.map(l => (
            <button
              key={l.code}
              type="button"
              onClick={() => {
                setLocale(l.code as AppLocale);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${
                locale === l.code ? 'text-blue-600 font-semibold' : 'text-slate-700'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="text-base">{l.flag}</span>
                {l.label}
              </span>
              {locale === l.code && <Check className="w-4 h-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
