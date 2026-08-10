import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enTranslations from './locales/en.json';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: enTranslations,
      },
    },
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en'],
    interpolation: {
      escapeValue: false,
    },
    pluralSeparator: '_',
    contextSeparator: '_',
  });

export default i18n;
