/**
 * Provides provider-neutral speech language choices.
 */

/** Lists broadly used ISO-639-1 speech language codes accepted by the OpenRouter STT contract. */
export const SPEECH_LANGUAGE_CODES = [
  'af',
  'ar',
  'az',
  'be',
  'bg',
  'bn',
  'bs',
  'ca',
  'cs',
  'cy',
  'da',
  'de',
  'el',
  'en',
  'es',
  'et',
  'fa',
  'fi',
  'fr',
  'gl',
  'he',
  'hi',
  'hr',
  'hu',
  'hy',
  'id',
  'is',
  'it',
  'ja',
  'ka',
  'kk',
  'kn',
  'ko',
  'lt',
  'lv',
  'mk',
  'mr',
  'ms',
  'ne',
  'nl',
  'no',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sr',
  'sv',
  'sw',
  'ta',
  'th',
  'tl',
  'tr',
  'uk',
  'ur',
  'vi',
  'zh',
] as const

/** Describes one searchable language control entry. */
export interface SpeechLanguageOption {
  value: string
  label: string
}

/** Creates localized, alphabetized STT language choices with automatic detection first. */
export const createSpeechLanguageOptions = (locale: string): SpeechLanguageOption[] => {
  const displayNames = new Intl.DisplayNames([locale], { type: 'language' })
  const languages = SPEECH_LANGUAGE_CODES.map((code) => ({
    value: code,
    label: `${displayNames.of(code) ?? code.toUpperCase()} (${code})`,
  })).sort((left, right) => left.label.localeCompare(right.label, locale))
  return [{ value: '', label: 'Automatic detection' }, ...languages]
}
