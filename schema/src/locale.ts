/** Bounded BCP 47 syntax; Intl performs semantic/canonical syntax validation. */
export const localeSchema = {
  type: 'string',
  minLength: 2,
  maxLength: 64,
  pattern: '^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,12}$',
} as const;

export function canonicalLocale(value: string): string | null {
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null;
  } catch {
    return null;
  }
}

/** Deterministic messages ship in two languages; a host may translate afterward. */
export function messageLanguage(value: string): 'pt-BR' | 'en' {
  try {
    return new Intl.Locale(value).language === 'pt' ? 'pt-BR' : 'en';
  } catch {
    return 'en';
  }
}
