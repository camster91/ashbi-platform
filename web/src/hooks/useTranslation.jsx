import { useState, useCallback, useEffect } from 'react';
import { translations as defaultTranslations, languages as defaultLanguages } from '../lib/translations';

export function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, part) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[part];
  }, obj);
}

export function useTranslation(lang = 'en', customTranslations = defaultTranslations) {
  const [currentLang, setCurrentLang] = useState(() => {
    // 1. URL ?lang= override (highest priority)
    try {
      const params = new URLSearchParams(window.location.search);
      const urlLang = params.get('lang');
      if (urlLang && customTranslations[urlLang]) {
        localStorage.setItem('hub_language', urlLang);
        return urlLang;
      }
    } catch { }

    // 2. localStorage cached preference
    try {
      const savedLang = localStorage.getItem('hub_language');
      if (savedLang && customTranslations[savedLang]) {
        return savedLang;
      }
    } catch { }

    // 3. Browser language detection
    try {
      const browserLang = navigator.language?.slice(0, 2).toLowerCase();
      if (browserLang && customTranslations[browserLang]) {
        return browserLang;
      }
    } catch { }

    // 4. Default fallback
    return lang;
  });

  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === 'hub_language' && e.newValue !== currentLang) {
        const next = e.newValue || lang;
        if (customTranslations[next]) {
          setCurrentLang(next);
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [currentLang, customTranslations, lang]);

  const t = useCallback((key) => {
    const dict = customTranslations[currentLang] || customTranslations.en;
    const value = getNestedValue(dict, key);
    return value !== undefined && value !== null ? value : key;
  }, [currentLang, customTranslations]);

  const setLang = useCallback((newLang) => {
    if (customTranslations[newLang]) {
      setCurrentLang(newLang);
      try { localStorage.setItem('hub_language', newLang); } catch { }
    }
  }, [customTranslations]);

  return { t, currentLang, setLang, languages: defaultLanguages };
}

// Legacy exports for backward compatibility
export function useTranslations(lang = 'en') {
  console.warn('useTranslations is deprecated. Use useTranslation instead.');
  const { t } = useTranslation(lang);
  return { t, tLogin: (key) => t(`auth.${key}`) };
}
