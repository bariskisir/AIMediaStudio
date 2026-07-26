/**
 * Defines renderer-safe Deepgram catalog metadata and streaming option values.
 */

export const DEEPGRAM_PUBLIC_MODELS_URL = 'https://api.deepgram.com/v1/models'
export const DEEPGRAM_DEFAULT_MODEL = 'nova-3-general'
export const DEEPGRAM_STREAMING_PRICES_USD_PER_HOUR = {
  nova3Monolingual: 0.288,
  nova2: 0.35,
  enhanced: 0.99,
  base: 0.87,
} as const
export const DEEPGRAM_DIARIZATION_MODES = ['off', 'latest', 'v1'] as const
export const DEEPGRAM_REDACTION_MODES = [
  'none',
  'pii',
  'phi',
  'pci',
  'numbers',
  'aggressive_numbers',
] as const

export type DeepgramDiarization = (typeof DEEPGRAM_DIARIZATION_MODES)[number]
export type DeepgramRedaction = (typeof DEEPGRAM_REDACTION_MODES)[number]
export type DeepgramVocabularyParameter = 'keyterm' | 'keywords' | null

/** Public metadata for one canonical streaming speech-to-text model. */
export interface DeepgramSpeechModel {
  id: string
  name: string
  languages: string[]
  hourlyPriceUsd: number | null
  vocabularyParameter: DeepgramVocabularyParameter
}

/** Maps historical general-model aliases to their canonical catalog identifiers. */
export const canonicalizeDeepgramModel = (model: string): string => {
  if (model === 'nova-3') return 'nova-3-general'
  if (model === 'nova-2') return 'nova-2-general'
  return model
}

/** Selects the vocabulary query supported by a canonical model family. */
export const getDeepgramVocabularyParameter = (model: string): DeepgramVocabularyParameter => {
  if (model.startsWith('nova-3')) return 'keyterm'
  if (model.startsWith('whisper-') || model === 'phoneme') return null
  return 'keywords'
}

/** Returns Deepgram's published Pay-As-You-Go streaming rate for a public model family. */
export const getDeepgramHourlyPriceUsd = (model: string, architecture: string): number | null => {
  if (model.startsWith('nova-3')) return DEEPGRAM_STREAMING_PRICES_USD_PER_HOUR.nova3Monolingual
  if (model.startsWith('nova-2')) return DEEPGRAM_STREAMING_PRICES_USD_PER_HOUR.nova2
  if (model.startsWith('enhanced-') || architecture === 'polaris') {
    return DEEPGRAM_STREAMING_PRICES_USD_PER_HOUR.enhanced
  }
  if (architecture === 'base' && model !== 'phoneme' && !model.startsWith('whisper-')) {
    return DEEPGRAM_STREAMING_PRICES_USD_PER_HOUR.base
  }
  return null
}
