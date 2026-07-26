/**
 * Translates completed sentences through Bing Translator's keyless web-session client.
 */

import { translate as bingTranslate } from 'bing-translate-api'
import type { TranslationTargetLanguage } from '@shared/translation'
import { toGoogleLanguageCode } from '@shared/translation'

interface BingTranslationResponse {
  translation: string
}

type BingTranslate = (
  text: string,
  sourceLanguage: string | null | undefined,
  targetLanguage: string,
) => Promise<BingTranslationResponse | undefined>

/** Converts application language codes into values accepted by the Bing web client. */
const toBingLanguageCode = (language: string): string => {
  if (language.toLowerCase().startsWith('zh')) {
    return /(?:hant|tw|hk)/iu.test(language) ? 'zh-Hant' : 'zh-Hans'
  }
  return toGoogleLanguageCode(language)
}

/** Provides keyless sentence translation through Bing's browser-facing workflow. */
export default class BingTranslateService {
  /** Creates a translator with an injectable client boundary for deterministic tests. */
  public constructor(private readonly translateWithBing: BingTranslate = bingTranslate) {}

  /** Translates one sentence through Bing's temporary anonymous web session. */
  public async translate(
    sentence: string,
    sourceLanguage: string,
    targetLanguage: TranslationTargetLanguage,
  ): Promise<string> {
    const text = sentence.trim()
    if (!text) return ''
    const result = await this.translateWithBing(
      text,
      toBingLanguageCode(sourceLanguage),
      toBingLanguageCode(targetLanguage),
    )
    const translated = result?.translation.trim() ?? ''
    if (!translated) throw new Error('Bing Translator returned an empty response.')
    return translated
  }
}
