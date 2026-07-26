/**
 * Discovers public Deepgram streaming STT models and normalizes duplicate language records.
 */

import {
  canonicalizeDeepgramModel,
  DEEPGRAM_DEFAULT_MODEL,
  DEEPGRAM_PUBLIC_MODELS_URL,
  getDeepgramHourlyPriceUsd,
  getDeepgramVocabularyParameter,
  type DeepgramSpeechModel,
} from '@shared/deepgram'
import type { DeepgramTranscriptionSettings } from '@shared/transcription'
import { z } from 'zod'
import type LoggerService from './LoggerService'

const catalogSchema = z.object({
  stt: z.array(
    z.object({
      name: z.string(),
      canonical_name: z.string(),
      architecture: z.string(),
      languages: z.array(z.string()),
      streaming: z.boolean(),
    }),
  ),
})

const FRIENDLY_TOKENS: Record<string, string> = {
  atc: 'ATC',
  ea: 'EA',
  conversationalai: 'Conversational AI',
  drivethru: 'Drive-Thru',
  phonecall: 'Phone Call',
  voicemail: 'Voicemail',
}

/** Produces a readable label without maintaining a second model catalog. */
export const formatDeepgramModelName = (canonicalName: string): string => {
  const parts = canonicalName.split('-')
  const formatted: string[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? ''
    if (part === 'nova' && /^\d+$/.test(parts[index + 1] ?? '')) {
      formatted.push(`Nova-${parts[index + 1]}`)
      index += 1
      continue
    }
    if (part === 'nova') {
      formatted.push('Nova')
      continue
    }
    if (part === 'whisper') {
      formatted.push('Whisper')
      continue
    }
    formatted.push(
      FRIENDLY_TOKENS[part] ??
        (part === part.toLowerCase() ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part),
    )
  }
  return formatted.join(' ')
}

/** Filters streaming STT records and merges their languages by canonical model identifier. */
export const parseDeepgramCatalog = (input: unknown): DeepgramSpeechModel[] => {
  const { stt } = catalogSchema.parse(input)
  const models = new Map<string, DeepgramSpeechModel>()
  stt
    .filter((record) => record.streaming)
    .forEach((record) => {
      const existing = models.get(record.canonical_name)
      const languages = new Set(existing?.languages ?? [])
      record.languages.forEach((language) => {
        languages.add(language)
      })
      models.set(record.canonical_name, {
        id: record.canonical_name,
        name: formatDeepgramModelName(record.canonical_name),
        languages: [...languages].sort((left, right) => left.localeCompare(right)),
        hourlyPriceUsd: getDeepgramHourlyPriceUsd(record.canonical_name, record.architecture),
        vocabularyParameter: getDeepgramVocabularyParameter(record.canonical_name),
      })
    })

  return [...models.values()].sort((left, right) => {
    if (left.id === DEEPGRAM_DEFAULT_MODEL) return -1
    if (right.id === DEEPGRAM_DEFAULT_MODEL) return 1
    return left.name.localeCompare(right.name)
  })
}

/** Migrates aliases and ensures persisted model/language choices exist in a live catalog. */
export const reconcileDeepgramSettings = (
  settings: DeepgramTranscriptionSettings,
  models: DeepgramSpeechModel[],
): DeepgramTranscriptionSettings => {
  const canonicalModel = canonicalizeDeepgramModel(settings.model)
  if (models.length === 0) return { ...settings, model: canonicalModel }
  const selectedModel =
    models.find((model) => model.id === canonicalModel) ??
    models.find((model) => model.id === DEEPGRAM_DEFAULT_MODEL) ??
    models[0]
  if (!selectedModel) return { ...settings, model: canonicalModel }
  const language = selectedModel.languages.includes(settings.language)
    ? settings.language
    : selectedModel.languages.includes('en')
      ? 'en'
      : (selectedModel.languages[0] ?? settings.language)
  return {
    ...settings,
    model: selectedModel.id,
    language,
    ...(language.startsWith('en') ? {} : { redaction: 'none' }),
  }
}

/** Loads and caches the unauthenticated public Deepgram catalog for one app process. */
export default class DeepgramCatalogService {
  private models: DeepgramSpeechModel[] | null = null

  /** Creates a public catalog client with structured fallback diagnostics. */
  public constructor(private readonly logger: LoggerService) {}

  /** Retrieves canonical streaming STT models, returning no stale static catalog on failure. */
  public async getModels(): Promise<DeepgramSpeechModel[]> {
    if (this.models) return structuredClone(this.models)
    try {
      const response = await fetch(DEEPGRAM_PUBLIC_MODELS_URL)
      if (!response.ok) throw new Error(`Deepgram catalog returned HTTP ${response.status}.`)
      const models = parseDeepgramCatalog(await response.json())
      if (models.length === 0)
        throw new Error('Deepgram catalog contained no streaming STT models.')
      this.models = models
      return structuredClone(models)
    } catch (error) {
      this.logger.warn('DeepgramCatalog', 'Live model catalog could not be loaded.', error)
      return []
    }
  }
}
