import { i18n } from '@lingui/core';
import { getLocales } from 'expo-localization';
import { messages as en } from './locales/en/messages';
import { messages as es } from './locales/es/messages';

export const locales = ['en', 'es'] as const;
export type Locale = (typeof locales)[number];

i18n.load({ en, es });

export function detectLocale(): Locale {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return (locales as readonly string[]).includes(code) ? (code as Locale) : 'en';
}

export function activateLocale(locale: Locale) {
  i18n.activate(locale);
}

activateLocale(detectLocale());

export { i18n };
