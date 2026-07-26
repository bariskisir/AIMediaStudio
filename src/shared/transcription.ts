/**
 * Defines independently typed transcription providers and their provider-specific settings.
 */

import {
  DEEPGRAM_DEFAULT_MODEL,
  type DeepgramDiarization,
  type DeepgramRedaction,
} from './deepgram'

export const TRANSCRIPTION_PROVIDERS = ['deepgram', 'openrouter'] as const
export const REST_TRANSCRIPTION_SPEEDS = ['low', 'medium', 'high'] as const

export type TranscriptionProvider = (typeof TRANSCRIPTION_PROVIDERS)[number]
/** Responsiveness profile used by request-response transcription providers. */
export type RestTranscriptionSpeed = (typeof REST_TRANSCRIPTION_SPEEDS)[number]

export interface DeepgramTranscriptionSettings {
  language: string
  model: string
  modelVersion: string
  punctuate: boolean
  smartFormat: boolean
  numerals: boolean
  profanityFilter: boolean
  diarization: DeepgramDiarization
  redaction: DeepgramRedaction
  endpointingMs: number
  utteranceEndEnabled: boolean
  utteranceEndMs: number
  vocabulary: string[]
  mipOptOut: boolean
}

/** Request parameters supported consistently by OpenRouter's STT endpoint. */
export interface OpenRouterTranscriptionSettings {
  model: string
  language: string
  speed: RestTranscriptionSpeed
}

export interface TranscriptionProviderSettings {
  deepgram: DeepgramTranscriptionSettings
  openrouter: OpenRouterTranscriptionSettings
}

export type DeepgramTranscriptionSettingsPatch = {
  [Key in keyof DeepgramTranscriptionSettings]?: DeepgramTranscriptionSettings[Key] | undefined
}

/** Partial persisted update for OpenRouter-specific STT settings. */
export type OpenRouterTranscriptionSettingsPatch = {
  [Key in keyof OpenRouterTranscriptionSettings]?: OpenRouterTranscriptionSettings[Key] | undefined
}

export type TranscriptionProviderSettingsPatch = {
  deepgram?: DeepgramTranscriptionSettingsPatch | undefined
  openrouter?: OpenRouterTranscriptionSettingsPatch | undefined
}

export const DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS: DeepgramTranscriptionSettings = {
  language: 'en',
  model: DEEPGRAM_DEFAULT_MODEL,
  modelVersion: 'latest',
  punctuate: true,
  smartFormat: true,
  numerals: true,
  profanityFilter: false,
  diarization: 'off',
  redaction: 'none',
  endpointingMs: 10,
  utteranceEndEnabled: true,
  utteranceEndMs: 1_000,
  vocabulary: [],
  mipOptOut: false,
}

export const DEFAULT_OPENROUTER_TRANSCRIPTION_SETTINGS: OpenRouterTranscriptionSettings = {
  model: 'openai/whisper-large-v3-turbo',
  language: '',
  speed: 'low',
}
