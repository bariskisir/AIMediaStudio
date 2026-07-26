/**
 * Translates completed sentences through Google Translate's public web endpoint.
 */

import { toGoogleLanguageCode, type TranslationTargetLanguage } from '@shared/translation'

const GOOGLE_TRANSLATE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single'
const REQUEST_TIMEOUT_MS = 10_000

export default class GoogleTranslateService {
  /** Creates a translator with an injectable fetch boundary for deterministic tests. */
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  /** Translates one non-empty sentence and combines Google's nested response chunks. */
  public async translate(
    sentence: string,
    sourceLanguage: string,
    targetLanguage: TranslationTargetLanguage,
  ): Promise<string> {
    const text = sentence.trim()
    if (!text) return ''

    const query = new URLSearchParams({
      client: 'gtx',
      sl: toGoogleLanguageCode(sourceLanguage),
      tl: targetLanguage,
      dt: 't',
      q: text,
    })
    const response = await this.fetcher(`${GOOGLE_TRANSLATE_ENDPOINT}?${query.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`Google Translate returned HTTP ${response.status}.`)
    }

    const payload: unknown = await response.json()
    return this.extractTranslation(payload)
  }

  /** Reads translated strings from Google's nested array response without trusting its shape. */
  private extractTranslation(payload: unknown): string {
    if (!Array.isArray(payload) || !Array.isArray(payload[0])) return ''
    return payload[0]
      .map((chunk: unknown) =>
        Array.isArray(chunk) && typeof chunk[0] === 'string' ? chunk[0] : '',
      )
      .join('')
      .trim()
  }
}
