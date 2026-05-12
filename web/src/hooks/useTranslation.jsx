import { translations } from '../lib/translations';

export function useTranslations(lang = 'en') {
  const t = translations[lang] || translations.en;

  const tLogin = (key) => t.login[key] || key;

  return {
    t,
    tLogin,
  };
}

export function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

export function useTranslation(lang = 'en') {
  const t = translations[lang] || translations.en;

  return (key) => {
    const value = getNestedValue(t, key);
    return value !== undefined ? value : key;
  };
}