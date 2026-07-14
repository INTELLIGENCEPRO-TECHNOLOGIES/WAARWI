import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type AppLocale, isRTL, getIntlLocale, LOCALES } from '../i18n';

type LocaleContextValue = {
  locale: AppLocale;
  intlLocale: string;
  rtl: boolean;
  setLocale: (locale: AppLocale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const [locale, setLocaleState] = useState<AppLocale>(
    (i18n.language as AppLocale) || 'fr',
  );

  const rtl = isRTL(locale);
  const intlLocale = getIntlLocale(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  }, [locale, rtl]);

  const setLocale = (newLocale: AppLocale) => {
    i18n.changeLanguage(newLocale);
    setLocaleState(newLocale);
    localStorage.setItem('waarwi_locale', newLocale);
  };

  return (
    <LocaleContext.Provider value={{ locale, intlLocale, rtl, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    return {
      locale: 'fr',
      intlLocale: 'fr-FR',
      rtl: false,
      setLocale: () => {},
    };
  }
  return ctx;
}

export { LOCALES };
