/**
 * Discovers duration-priced OpenRouter speech models and normalizes their rates to USD/hour.
 */

import {
  OPENROUTER_CATALOG_URL,
  type OpenRouterSpeechModel,
  toHourlyPriceUsd,
} from '@shared/openrouter'
import { z } from 'zod'
import type LoggerService from './LoggerService'

const pricingItemSchema = z.object({
  kind: z.string(),
  price: z.string(),
  displayMultiplier: z.number().nullish(),
  unitLabel: z.string().nullish(),
})

const catalogSchema = z.object({
  data: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      output_modalities: z.array(z.string()).nullish(),
      endpoint: z
        .object({
          display_pricing: z.array(pricingItemSchema).nullish(),
        })
        .nullish(),
    }),
  ),
})

const FALLBACK_MODELS: OpenRouterSpeechModel[] = [
  {
    id: 'openai/whisper-large-v3-turbo',
    name: 'OpenAI: Whisper Large V3 Turbo',
    hourlyPriceUsd: 0.04,
  },
  { id: 'nvidia/parakeet-tdt-0.6b-v3', name: 'NVIDIA: Parakeet TDT 0.6B v3', hourlyPriceUsd: 0.09 },
  { id: 'openai/whisper-large-v3', name: 'OpenAI: Whisper Large V3', hourlyPriceUsd: 0.09 },
  { id: 'x-ai/grok-stt-1.0', name: 'xAI: Grok STT 1.0', hourlyPriceUsd: 0.1 },
  { id: 'qwen/qwen3-asr-flash-2026-02-10', name: 'Qwen: Qwen3 ASR Flash', hourlyPriceUsd: 0.126 },
  {
    id: 'mistralai/voxtral-mini-transcribe',
    name: 'Mistral: Voxtral Mini Transcribe',
    hourlyPriceUsd: 0.18,
  },
  { id: 'deepgram/nova-3', name: 'Deepgram: Nova-3', hourlyPriceUsd: 0.258 },
  {
    id: 'microsoft/mai-transcribe-1.5',
    name: 'Microsoft: MAI-Transcribe 1.5',
    hourlyPriceUsd: 0.36,
  },
  { id: 'openai/whisper-1', name: 'OpenAI: Whisper 1', hourlyPriceUsd: 0.36 },
  { id: 'google/chirp-3', name: 'Google: Chirp 3', hourlyPriceUsd: 0.96 },
]

/** Parses a catalog response, excluding token-, character-, and request-priced models. */
export const parseOpenRouterCatalog = (input: unknown): OpenRouterSpeechModel[] => {
  const { data } = catalogSchema.parse(input)
  return data
    .filter((item) => item.output_modalities?.includes('transcription'))
    .flatMap((item): OpenRouterSpeechModel[] => {
      const price = item.endpoint?.display_pricing?.find((candidate) => {
        return candidate.kind === 'unit' && toHourlyPriceUsd(0, candidate.unitLabel ?? '') !== null
      })
      if (!price?.unitLabel) return []
      const rawPrice = Number(price.price) * (price.displayMultiplier ?? 1)
      const hourlyPriceUsd = toHourlyPriceUsd(rawPrice, price.unitLabel)
      return hourlyPriceUsd === null ? [] : [{ id: item.slug, name: item.name, hourlyPriceUsd }]
    })
    .sort(
      (left, right) =>
        left.hourlyPriceUsd - right.hourlyPriceUsd || left.name.localeCompare(right.name),
    )
}

export default class OpenRouterCatalogService {
  /** Creates a catalog client with fallback diagnostics. */
  public constructor(private readonly logger: LoggerService) {}

  /** Fetches the live catalog and falls back to the last verified duration-priced set. */
  public async getModels(): Promise<OpenRouterSpeechModel[]> {
    try {
      const response = await fetch(OPENROUTER_CATALOG_URL)
      if (!response.ok) throw new Error(`OpenRouter catalog returned HTTP ${response.status}.`)
      const models = parseOpenRouterCatalog(await response.json())
      if (models.length === 0)
        throw new Error('OpenRouter catalog contained no duration-priced STT models.')
      return models
    } catch (error) {
      this.logger.warn('OpenRouterCatalog', 'Live model catalog could not be loaded.', error)
      return structuredClone(FALLBACK_MODELS)
    }
  }
}
