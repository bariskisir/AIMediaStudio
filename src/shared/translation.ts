/**
 * Defines translation providers and target languages in preferred display order.
 */

export const TRANSLATION_TARGET_LANGUAGES = [
  'tr',
  'en',
  'ar',
  'de',
  'es',
  'fr',
  'it',
  'pt',
  'ru',
  'zh',
  'ja',
  'ko',
  'th',
  'vi',
] as const

export const TRANSLATION_PROVIDERS = ['google', 'bing'] as const

export type TranslationTargetLanguage = (typeof TRANSLATION_TARGET_LANGUAGES)[number]
export type TranslationProvider = (typeof TRANSLATION_PROVIDERS)[number]

/** Converts a regional speech language into the coarser Google Translate language code. */
export const toGoogleLanguageCode = (language: string): string =>
  (language.split('-')[0] || language).toLowerCase()
