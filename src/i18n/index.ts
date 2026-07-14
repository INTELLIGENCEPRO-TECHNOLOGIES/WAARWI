import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from './locales/fr.json';
import en from './locales/en.json';
import ar from './locales/ar.json';

export type AppLocale = 'fr' | 'en' | 'ar';

export const LOCALES: { code: AppLocale; label: string; flag: string; rtl: boolean; intlLocale: string }[] = [
  { code: 'fr', label: 'Français', flag: '🇫🇷', rtl: false, intlLocale: 'fr-FR' },
  { code: 'en', label: 'English', flag: '🇬🇧', rtl: false, intlLocale: 'en-GB' },
  { code: 'ar', label: 'العربية', flag: '🇸🇳', rtl: true, intlLocale: 'ar-SN' },
];

export const RTL_LOCALES: AppLocale[] = ['ar'];

export function isRTL(locale: string): boolean {
  return RTL_LOCALES.includes(locale as AppLocale);
}

export function getIntlLocale(locale: string): string {
  const found = LOCALES.find(l => l.code === locale);
  return found?.intlLocale || 'fr-FR';
}

const savedLocale = (typeof localStorage !== 'undefined' && localStorage.getItem('waarwi_locale')) || 'fr';

i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: savedLocale,
  fallbackLng: 'fr',
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
});

export default i18n;
