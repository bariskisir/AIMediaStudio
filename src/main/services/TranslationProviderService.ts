/**
 * Routes sentence translation to the provider selected for the active transcript.
 */

import type { TranslationProvider, TranslationTargetLanguage } from '@shared/translation'
import type BingTranslateService from './BingTranslateService'
import type GoogleTranslateService from './GoogleTranslateService'

/** Selects the configured implementation without exposing provider details to session logic. */
export default class TranslationProviderService {
  /** Creates a provider router with explicit translation clients. */
  public constructor(
    private readonly google: GoogleTranslateService,
    private readonly bing: BingTranslateService,
  ) {}

  /** Translates one sentence using the requested provider implementation. */
  public translate(
    provider: TranslationProvider,
    sentence: string,
    sourceLanguage: string,
    targetLanguage: TranslationTargetLanguage,
  ): Promise<string> {
    if (provider === 'bing') return this.bing.translate(sentence, sourceLanguage, targetLanguage)
    return this.google.translate(sentence, sourceLanguage, targetLanguage)
  }
}
