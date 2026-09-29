import { describe, expect, it } from 'vitest';
import { translations } from '../lib/translations';

describe('login marketing copy', () => {
  it('speaks to an agency, not an online store', () => {
    for (const lang of Object.keys(translations)) {
      const copy = Object.values(translations[lang].brand).join(' ').toLowerCase();
      expect(copy, lang).not.toMatch(/\bstores?\b|\bbrands\b|tienda|marcas/);
    }
    expect(translations.en.brand.tagline).toBe('Your clients and projects, one workspace');
  });
});
