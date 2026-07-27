/**
 * Discovers OpenRouter media models while retaining a last-successful local cache.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  OPENROUTER_IMAGE_MODELS_URL,
  OPENROUTER_STT_MODELS_URL,
  OPENROUTER_TTS_MODELS_URL,
  OPENROUTER_VIDEO_MODELS_URL,
  type CapabilityDescriptor,
  type MediaKind,
  type MediaModel,
  type ModelPrice,
} from '@shared/openrouter'
import { z } from 'zod'
import type LoggerService from './LoggerService'

const descriptorSchema = z.union([
  z.object({ type: z.literal('enum'), values: z.array(z.union([z.string(), z.number()])) }),
  z.object({ type: z.literal('range'), min: z.number(), max: z.number() }),
  z.object({ type: z.literal('boolean') }),
])

const imageCatalogSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullish(),
      supported_parameters: z.record(z.string(), descriptorSchema).nullish(),
      supports_streaming: z.boolean().nullish(),
      endpoints: z.string().nullish(),
    }),
  ),
})

const endpointCatalogSchema = z.object({
  endpoints: z.array(
    z.object({
      pricing: z
        .array(
          z.object({
            billable: z.string(),
            unit: z.string(),
            cost_usd: z.union([z.number(), z.string()]),
            variant: z.string().nullish(),
          }),
        )
        .nullish(),
    }),
  ),
})

const videoCatalogSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullish(),
      supported_resolutions: z.array(z.string()).nullish(),
      supported_aspect_ratios: z.array(z.string()).nullish(),
      supported_sizes: z.array(z.string()).nullish(),
      supported_durations: z.array(z.union([z.number(), z.string()])).nullish(),
      supported_frame_images: z.array(z.string()).nullish(),
      generate_audio: z.boolean().nullish(),
      seed: z.boolean().nullish(),
      pricing_skus: z.record(z.string(), z.union([z.string(), z.number()])).nullish(),
    }),
  ),
})

const audioCatalogSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullish(),
      pricing: z
        .object({
          prompt: z.union([z.string(), z.number()]).nullish(),
          completion: z.union([z.string(), z.number()]).nullish(),
        })
        .nullish(),
      supported_parameters: z.array(z.string()).nullish(),
      supported_voices: z.array(z.string()).nullish(),
    }),
  ),
})

type Fetcher = typeof globalThis.fetch

/** Converts OpenRouter descriptors to renderer-safe primitive values. */
const normalizeCapabilities = (
  input: Record<string, z.infer<typeof descriptorSchema>> | null | undefined,
): Record<string, CapabilityDescriptor> =>
  Object.fromEntries(
    Object.entries(input ?? {}).map(([key, descriptor]) => [
      key,
      descriptor.type === 'enum'
        ? { type: 'enum' as const, values: descriptor.values.map(String) }
        : descriptor,
    ]),
  )

/** Returns distinct price records ordered by their numeric amount. */
const normalizePrices = (prices: ModelPrice[]): ModelPrice[] => {
  const distinct = new Map<string, ModelPrice>()
  for (const price of prices) {
    const key = `${price.billable}:${price.unit}:${price.variant ?? ''}:${price.amountUsd}`
    distinct.set(key, price)
  }
  return [...distinct.values()].sort((left, right) => left.amountUsd - right.amountUsd)
}

/** Converts explicit video SKU semantics to USD without estimating a complete job cost. */
const normalizeVideoPrice = (sku: string, raw: string | number): ModelPrice | null => {
  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) return null
  if (sku.startsWith('cents_per_')) {
    const variant = /_(480p|720p|1080p|1k|2k|4k)$/i.exec(sku)?.[1]
    const isImageInput = sku.includes('image_input')
    return {
      amountUsd: numeric / 100,
      unit: isImageInput ? 'image input' : 'second',
      billable: isImageInput ? 'input_image' : 'output_video',
      ...(variant ? { variant } : {}),
    }
  }
  if (sku.includes('duration_seconds')) {
    const variant = sku
      .replace(/^(?:text_to_video_|image_to_video_)?duration_seconds_?/, '')
      .replaceAll('_', ' ')
    return {
      amountUsd: numeric,
      unit: 'second',
      billable: 'output_video',
      ...(variant ? { variant } : {}),
    }
  }
  return { amountUsd: numeric, unit: sku, billable: 'output_video' }
}

export default class OpenRouterCatalogService {
  private readonly cachePath: string
  private readonly memoryCache = new Map<MediaKind, MediaModel[]>()

  /** Creates a public catalog client with injectable transport for deterministic tests. */
  public constructor(
    dataRoot: string,
    private readonly logger: LoggerService,
    private readonly fetcher: Fetcher = globalThis.fetch,
  ) {
    this.cachePath = join(dataRoot, 'openrouter-models.json')
  }

  /** Retrieves one media catalog and falls back only to the last successful response. */
  public async getModels(kind: MediaKind, refresh = false): Promise<MediaModel[]> {
    const memory = this.memoryCache.get(kind)
    if (!refresh && memory?.length) return memory
    try {
      const models = await this.fetchModels(kind)
      this.memoryCache.set(kind, models)
      await this.persistCache()
      return models
    } catch (error) {
      this.logger.warn('OpenRouterCatalogService', `${kind} model discovery failed.`, error)
      const cached = await this.loadCachedModels(kind)
      if (cached.length) {
        this.memoryCache.set(kind, cached)
        return cached
      }
      throw new Error(`OpenRouter ${kind} models are temporarily unavailable.`)
    }
  }

  /** Routes one media kind to the dedicated or modality-filtered discovery endpoint. */
  private async fetchModels(kind: MediaKind): Promise<MediaModel[]> {
    if (kind === 'image') return this.fetchImageModels()
    if (kind === 'video') return this.fetchVideoModels()
    return this.fetchAudioModels(kind)
  }

  /** Loads image capabilities and exact per-endpoint pricing with bounded concurrency. */
  private async fetchImageModels(): Promise<MediaModel[]> {
    const response = await this.fetcher(OPENROUTER_IMAGE_MODELS_URL, {
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Image catalog returned HTTP ${response.status}.`)
    const catalog = imageCatalogSchema.parse(await response.json())
    const models: MediaModel[] = []
    for (let offset = 0; offset < catalog.data.length; offset += 6) {
      const batch = catalog.data.slice(offset, offset + 6)
      const normalized = await Promise.all(
        batch.map(async (model): Promise<MediaModel> => {
          const prices = model.endpoints ? await this.fetchImagePrices(model.endpoints) : []
          return {
            id: model.id,
            name: model.name,
            description: model.description ?? '',
            kind: 'image',
            capabilities: normalizeCapabilities(model.supported_parameters),
            prices,
            supportsStreaming: model.supports_streaming ?? false,
            supportedResolutions: this.enumValues(model.supported_parameters, 'resolution'),
            supportedAspectRatios: this.enumValues(model.supported_parameters, 'aspect_ratio'),
            supportedSizes: [],
            supportedDurations: [],
            supportedFrameImages: [],
            supportsAudio: false,
            supportedVoices: [],
            supportsCustomVoice: false,
          }
        }),
      )
      models.push(...normalized)
    }
    return models.sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Retrieves directly reported image billing lines for one model. */
  private async fetchImagePrices(endpointPath: string): Promise<ModelPrice[]> {
    try {
      const url = new URL(endpointPath, 'https://openrouter.ai').toString()
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(20_000) })
      if (!response.ok) return []
      const payload = endpointCatalogSchema.parse(await response.json())
      return normalizePrices(
        payload.endpoints.flatMap((endpoint) =>
          (endpoint.pricing ?? []).flatMap((price): ModelPrice[] => {
            const amountUsd = Number(price.cost_usd)
            if (!Number.isFinite(amountUsd)) return []
            return [
              {
                amountUsd,
                unit: price.unit,
                billable: price.billable,
                ...(price.variant ? { variant: price.variant } : {}),
              },
            ]
          }),
        ),
      )
    } catch {
      return []
    }
  }

  /** Normalizes asynchronous video models and exact pricing SKU labels. */
  private async fetchVideoModels(): Promise<MediaModel[]> {
    const response = await this.fetcher(OPENROUTER_VIDEO_MODELS_URL, {
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Video catalog returned HTTP ${response.status}.`)
    const catalog = videoCatalogSchema.parse(await response.json())
    return catalog.data
      .map((model): MediaModel => {
        const prices = Object.entries(model.pricing_skus ?? {}).flatMap(
          ([sku, raw]): ModelPrice[] => {
            const price = normalizeVideoPrice(sku, raw)
            return price ? [price] : []
          },
        )
        const supportedFrameImages = (model.supported_frame_images ?? []).filter(
          (value): value is 'first_frame' | 'last_frame' =>
            value === 'first_frame' || value === 'last_frame',
        )
        const capabilities: Record<string, CapabilityDescriptor> = {}
        if (model.seed) capabilities.seed = { type: 'boolean' }
        if (model.generate_audio) capabilities.generate_audio = { type: 'boolean' }
        return {
          id: model.id,
          name: model.name,
          description: model.description ?? '',
          kind: 'video',
          capabilities,
          prices: normalizePrices(prices),
          supportsStreaming: false,
          supportedResolutions: model.supported_resolutions ?? [],
          supportedAspectRatios: model.supported_aspect_ratios ?? [],
          supportedSizes: model.supported_sizes ?? [],
          supportedDurations: (model.supported_durations ?? [])
            .map(Number)
            .filter((value) => Number.isInteger(value) && value > 0),
          supportedFrameImages,
          supportsAudio: model.generate_audio ?? false,
          supportedVoices: [],
          supportsCustomVoice: false,
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Normalizes TTS/STT models and preserves their distinct billing semantics. */
  private async fetchAudioModels(kind: Extract<MediaKind, 'tts' | 'stt'>): Promise<MediaModel[]> {
    const response = await this.fetcher(
      kind === 'tts' ? OPENROUTER_TTS_MODELS_URL : OPENROUTER_STT_MODELS_URL,
      { signal: AbortSignal.timeout(30_000) },
    )
    if (!response.ok)
      throw new Error(`${kind.toUpperCase()} catalog returned HTTP ${response.status}.`)
    const catalog = audioCatalogSchema.parse(await response.json())
    return catalog.data
      .map((model): MediaModel => {
        const promptPrice = Number(model.pricing?.prompt)
        const completionPrice = Number(model.pricing?.completion)
        const prices: ModelPrice[] = []
        if (kind === 'tts' && Number.isFinite(promptPrice) && promptPrice > 0) {
          prices.push({
            amountUsd: promptPrice,
            unit: 'character',
            billable: 'input_character',
          })
        }
        if (kind === 'stt' && Number.isFinite(promptPrice) && promptPrice > 0) {
          if (Number.isFinite(completionPrice) && completionPrice > 0) {
            prices.push({ amountUsd: promptPrice, unit: 'input token', billable: 'input_audio' })
          } else {
            prices.push({ amountUsd: promptPrice * 60, unit: 'hour', billable: 'input_audio' })
          }
        }
        if (kind === 'stt' && Number.isFinite(completionPrice) && completionPrice > 0) {
          prices.push({
            amountUsd: completionPrice,
            unit: 'output token',
            billable: 'output_transcription',
          })
        }
        const capabilities: Record<string, CapabilityDescriptor> = Object.fromEntries(
          (model.supported_parameters ?? []).map((parameter) => [
            parameter,
            { type: 'boolean' as const },
          ]),
        )
        if (kind === 'tts') {
          capabilities.speed = model.id.startsWith('microsoft/')
            ? { type: 'range', min: 0.5, max: 2 }
            : { type: 'range', min: 0.25, max: 4 }
        }
        return {
          id: model.id,
          name: model.name,
          description: model.description ?? '',
          kind,
          capabilities,
          prices: normalizePrices(prices),
          supportsStreaming: false,
          supportedResolutions: [],
          supportedAspectRatios: [],
          supportedSizes: [],
          supportedDurations: [],
          supportedFrameImages: [],
          supportsAudio: false,
          supportedVoices: model.supported_voices ?? [],
          supportsCustomVoice: kind === 'tts' && model.supported_voices == null,
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Reads enum values from one image capability descriptor. */
  private enumValues(
    source: Record<string, z.infer<typeof descriptorSchema>> | null | undefined,
    key: string,
  ): string[] {
    const descriptor = source?.[key]
    return descriptor?.type === 'enum' ? descriptor.values.map(String) : []
  }

  /** Writes both in-memory catalogs after a successful refresh. */
  private async persistCache(): Promise<void> {
    const cache = Object.fromEntries(
      await Promise.all(
        (['image', 'video', 'tts', 'stt'] as const).map(async (kind) => [
          kind,
          this.memoryCache.get(kind) ?? (await this.loadCachedModels(kind)),
        ]),
      ),
    )
    await writeFile(this.cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
  }

  /** Loads a last-successful catalog without treating malformed cache data as authoritative. */
  private async loadCachedModels(kind: MediaKind): Promise<MediaModel[]> {
    try {
      const value = JSON.parse(await readFile(this.cachePath, 'utf8')) as Record<string, unknown>
      const candidate = value[kind]
      return Array.isArray(candidate) ? (candidate as MediaModel[]) : []
    } catch {
      return []
    }
  }
}
