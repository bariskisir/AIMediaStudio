/**
 * Defines OpenRouter media model contracts shared by all application processes.
 */

export const OPENROUTER_PROVIDER = 'openrouter' as const
export const OPENROUTER_IMAGE_MODELS_URL = 'https://openrouter.ai/api/v1/images/models'
export const OPENROUTER_VIDEO_MODELS_URL = 'https://openrouter.ai/api/v1/videos/models'
export const OPENROUTER_TTS_MODELS_URL =
  'https://openrouter.ai/api/v1/models?output_modalities=speech'
export const OPENROUTER_STT_MODELS_URL =
  'https://openrouter.ai/api/v1/models?output_modalities=transcription'
export const OPENROUTER_IMAGES_URL = 'https://openrouter.ai/api/v1/images'
export const OPENROUTER_VIDEOS_URL = 'https://openrouter.ai/api/v1/videos'
export const OPENROUTER_TTS_URL = 'https://openrouter.ai/api/v1/audio/speech'
export const OPENROUTER_STT_URL = 'https://openrouter.ai/api/v1/audio/transcriptions'
export const OPENROUTER_GENERATION_URL = 'https://openrouter.ai/api/v1/generation'
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/settings/keys'

export const IMAGE_OUTPUT_FORMATS = ['png', 'jpeg', 'webp', 'svg'] as const
export const IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high'] as const
export const IMAGE_BACKGROUNDS = ['auto', 'transparent', 'opaque'] as const
export const TTS_OUTPUT_FORMATS = ['mp3', 'pcm'] as const
export const AUDIO_INPUT_FORMATS = ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'webm', 'aac'] as const
export const MEDIA_KINDS = ['image', 'video', 'tts', 'stt'] as const

export type OpenRouterProvider = typeof OPENROUTER_PROVIDER
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number]
export type ImageQuality = (typeof IMAGE_QUALITIES)[number]
export type ImageBackground = (typeof IMAGE_BACKGROUNDS)[number]
export type TtsOutputFormat = (typeof TTS_OUTPUT_FORMATS)[number]
export type AudioInputFormat = (typeof AUDIO_INPUT_FORMATS)[number]
export type MediaKind = (typeof MEDIA_KINDS)[number]

/** Describes one typed request capability reported by OpenRouter. */
export type CapabilityDescriptor =
  | { type: 'enum'; values: string[] }
  | { type: 'range'; min: number; max: number }
  | { type: 'boolean' }

/** Preserves exact provider pricing without estimating across incompatible billing units. */
export interface ModelPrice {
  amountUsd: number
  unit: string
  billable: string
  variant?: string
}

/** Normalizes media discovery records for renderer selection controls. */
export interface MediaModel {
  id: string
  name: string
  description: string
  kind: MediaKind
  capabilities: Record<string, CapabilityDescriptor>
  prices: ModelPrice[]
  supportsStreaming: boolean
  supportedResolutions: string[]
  supportedAspectRatios: string[]
  supportedSizes: string[]
  supportedDurations: number[]
  supportedFrameImages: Array<'first_frame' | 'last_frame'>
  supportsAudio: boolean
  supportedVoices: string[]
  supportsCustomVoice: boolean
}

/** Returns the preferred native output price and then the cheapest price within that unit. */
export const getDisplayPrice = (model: MediaModel): ModelPrice | null =>
  [...model.prices].sort((left, right) => {
    const priorityDifference =
      getModelPriceUnitPriority(model.kind, left) - getModelPriceUnitPriority(model.kind, right)
    if (priorityDifference !== 0) return priorityDifference
    return getComparablePriceAmount(left) - getComparablePriceAmount(right)
  })[0] ?? null

/** Converts token-based prices to a comparable USD-per-million-token amount. */
export const getComparablePriceAmount = (price: ModelPrice): number =>
  isTokenPrice(price) || isCharacterPrice(price) ? price.amountUsd * 1_000_000 : price.amountUsd

/** Detects token and provider-specific media-token billing units. */
export const isTokenPrice = (price: ModelPrice): boolean =>
  price.unit.toLocaleLowerCase('en-US').includes('token')

/** Detects TTS input pricing that is easier to compare per one million characters. */
export const isCharacterPrice = (price: ModelPrice): boolean =>
  price.unit.toLocaleLowerCase('en-US').includes('character')

/** Estimates TTS input cost from the character price exposed by the live model catalog. */
export const estimateTtsCost = (model: MediaModel, input: string): number | null => {
  const characterPrice = model.prices
    .filter((price) => price.billable === 'input_character' && isCharacterPrice(price))
    .sort((left, right) => left.amountUsd - right.amountUsd)[0]
  return characterPrice ? characterPrice.amountUsd * Array.from(input).length : null
}

/** Prioritizes native media output units before secondary and input-only billing units. */
export const getModelPriceUnitPriority = (kind: MediaKind, price: ModelPrice): number => {
  const unit = price.unit.trim().toLocaleLowerCase('en-US')
  if (kind === 'tts') {
    if (price.billable === 'input_character' && isCharacterPrice(price)) return 0
    if (isTokenPrice(price)) return 1
    return 3
  }
  if (kind === 'stt') {
    if (
      price.billable === 'input_audio' &&
      (unit === 'hour' ||
        unit === 'hours' ||
        unit === 'minute' ||
        unit === 'minutes' ||
        unit === 'second' ||
        unit === 'seconds')
    ) {
      return 0
    }
    if (isTokenPrice(price)) return 1
    return 3
  }
  const expectedBillable = kind === 'image' ? 'output_image' : 'output_video'
  if (price.billable === expectedBillable) {
    if (kind === 'image' && (unit === 'image' || unit === 'images')) return 0
    if (kind === 'video' && (unit === 'second' || unit === 'seconds')) return 0
    if (kind === 'image' && (unit === 'megapixel' || unit === 'megapixels')) return 1
    if (isTokenPrice(price)) return kind === 'image' ? 2 : 1
    return 3
  }
  if (price.billable.startsWith('output_')) return 4
  return 5
}
