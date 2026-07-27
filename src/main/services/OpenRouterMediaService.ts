/**
 * Implements image, video, speech synthesis, and transcription transport for OpenRouter.
 */

import {
  OPENROUTER_GENERATION_URL,
  OPENROUTER_IMAGES_URL,
  OPENROUTER_STT_URL,
  OPENROUTER_TTS_URL,
  OPENROUTER_VIDEOS_URL,
  type AudioInputFormat,
} from '@shared/openrouter'
import type {
  ImageGenerationOptions,
  SttGenerationOptions,
  TtsGenerationOptions,
  VideoGenerationOptions,
} from '@shared/types'
import { z } from 'zod'

const imageResponseSchema = z.object({
  data: z.array(
    z.object({
      b64_json: z.string().min(1),
      media_type: z.string().nullish(),
    }),
  ),
  usage: z.object({ cost: z.number().nonnegative().nullish() }).nullish(),
})

const videoSubmitSchema = z.object({
  id: z.string().min(1),
  polling_url: z.url(),
  status: z.string(),
})

const videoStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'expired']),
  unsigned_urls: z.array(z.url()).nullish(),
  error: z.union([z.string(), z.object({ message: z.string() })]).nullish(),
  usage: z.object({ cost: z.number().nonnegative().nullish() }).nullish(),
})

const transcriptionResponseSchema = z.object({
  text: z.string(),
  usage: z.object({ cost: z.number().nonnegative().nullish() }).nullish(),
})

const generationMetadataSchema = z.object({
  data: z.object({
    total_cost: z.number().nonnegative().nullish(),
    usage: z.number().nonnegative().nullish(),
  }),
})

type Fetcher = typeof globalThis.fetch

export interface ProviderReference {
  role: 'reference' | 'first_frame' | 'last_frame'
  dataUrl: string
}

export interface GeneratedImageResult {
  images: Array<{ base64: string; mediaType: string }>
  costUsd?: number
}

export interface SubmittedVideoJob {
  id: string
  pollingUrl: string
  status: string
}

export interface VideoJobStatus {
  id: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired'
  urls: string[]
  costUsd?: number
  error?: string
}

/** Contains the raw audio payload returned by the dedicated TTS endpoint. */
export interface GeneratedSpeechResult {
  bytes: Uint8Array
  mediaType: string
  costUsd?: number
}

/** Contains normalized STT text and any provider-reported final cost. */
export interface TranscriptionResult {
  text: string
  costUsd?: number
}

/** Narrows an unknown value to a plain JSON-style record. */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Extracts a provider's actionable message from nested or stringified error payloads. */
const extractErrorMessage = (value: unknown, depth = 0): string | null => {
  if (depth > 4) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
      return extractErrorMessage(JSON.parse(trimmed) as unknown, depth + 1) ?? trimmed
    } catch {
      return trimmed
    }
  }
  const record = asRecord(value)
  if (!record) return null
  for (const key of ['err_msg', 'detail', 'message']) {
    const message = extractErrorMessage(record[key], depth + 1)
    if (message) return message
  }
  return extractErrorMessage(record.error, depth + 1)
}

/** Reads OpenRouter and upstream-provider error layers without exposing request content. */
const providerError = async (response: Response): Promise<Error> => {
  const fallback = `OpenRouter request failed with HTTP ${response.status}.`
  try {
    const responseBody = await response.text()
    let decodedBody: unknown = responseBody
    try {
      decodedBody = JSON.parse(responseBody) as unknown
    } catch {
      // Plain-text provider errors remain useful and are handled below.
    }
    const payload = asRecord(decodedBody)
    const error = asRecord(payload?.error)
    const metadata = asRecord(error?.metadata)
    const providerName =
      typeof metadata?.provider_name === 'string' ? metadata.provider_name.trim() : ''
    const upstreamMessage = extractErrorMessage(metadata?.raw)
    const routerMessage = extractErrorMessage(error ?? payload ?? decodedBody)
    const message = upstreamMessage ?? routerMessage
    if (!message) return new Error(fallback)
    const prefix = providerName ? `${providerName}: ` : ''
    return new Error(`${prefix}${message} (HTTP ${response.status})`)
  } catch {
    return new Error(fallback)
  }
}

/** Waits briefly while OpenRouter materializes asynchronous generation accounting metadata. */
const wait = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

export default class OpenRouterMediaService {
  /** Creates an API client with injectable Fetch transport for unit tests. */
  public constructor(private readonly fetcher: Fetcher = globalThis.fetch) {}

  /** Sends one non-streaming image request and returns only final buffered images. */
  public async generateImage(
    apiKey: string,
    modelId: string,
    prompt: string,
    options: ImageGenerationOptions,
    references: ProviderReference[],
  ): Promise<GeneratedImageResult> {
    const inputReferences = references
      .filter((reference) => reference.role === 'reference')
      .map((reference) => ({ type: 'image_url', image_url: { url: reference.dataUrl } }))
    const response = await this.fetcher(OPENROUTER_IMAGES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        prompt,
        ...this.definedOptions(options),
        ...(inputReferences.length ? { input_references: inputReferences } : {}),
        stream: false,
      }),
      signal: AbortSignal.timeout(10 * 60 * 1_000),
    })
    if (!response.ok) throw await providerError(response)
    const result = imageResponseSchema.parse(await response.json())
    return {
      images: result.data.map((image) => ({
        base64: image.b64_json,
        mediaType: image.media_type ?? 'image/png',
      })),
      ...(result.usage?.cost != null ? { costUsd: result.usage.cost } : {}),
    }
  }

  /** Synthesizes one text input and preserves the provider's raw audio format. */
  public async generateSpeech(
    apiKey: string,
    modelId: string,
    input: string,
    options: TtsGenerationOptions,
  ): Promise<GeneratedSpeechResult> {
    const response = await this.fetcher(OPENROUTER_TTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        input,
        voice: options.voice,
        response_format: options.responseFormat,
        speed: options.speed,
      }),
      signal: AbortSignal.timeout(10 * 60 * 1_000),
    })
    if (!response.ok) throw await providerError(response)
    const generationId = response.headers.get('x-generation-id')?.trim()
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.byteLength) throw new Error('OpenRouter returned empty speech audio.')
    const costUsd = generationId ? await this.getGenerationCost(apiKey, generationId) : undefined
    return {
      bytes,
      mediaType:
        response.headers.get('content-type')?.split(';')[0] ??
        (options.responseFormat === 'mp3' ? 'audio/mpeg' : 'audio/pcm'),
      ...(costUsd !== undefined ? { costUsd } : {}),
    }
  }

  /** Transcribes one base64 audio input through the dedicated JSON endpoint. */
  public async transcribeAudio(
    apiKey: string,
    modelId: string,
    base64: string,
    format: AudioInputFormat,
    options: SttGenerationOptions,
  ): Promise<TranscriptionResult> {
    const response = await this.fetcher(OPENROUTER_STT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        input_audio: { data: base64, format },
        ...(options.language ? { language: options.language } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      }),
      signal: AbortSignal.timeout(10 * 60 * 1_000),
    })
    if (!response.ok) throw await providerError(response)
    const result = transcriptionResponseSchema.parse(await response.json())
    return {
      text: result.text,
      ...(result.usage?.cost != null ? { costUsd: result.usage.cost } : {}),
    }
  }

  /** Submits a dedicated asynchronous video generation job. */
  public async submitVideo(
    apiKey: string,
    modelId: string,
    prompt: string,
    options: VideoGenerationOptions,
    references: ProviderReference[],
  ): Promise<SubmittedVideoJob> {
    const frameImages = references
      .filter(
        (reference): reference is ProviderReference & { role: 'first_frame' | 'last_frame' } =>
          reference.role === 'first_frame' || reference.role === 'last_frame',
      )
      .map((reference) => ({
        type: 'image_url',
        image_url: { url: reference.dataUrl },
        frame_type: reference.role,
      }))
    const response = await this.fetcher(OPENROUTER_VIDEOS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        prompt,
        ...this.definedOptions(options),
        ...(frameImages.length ? { frame_images: frameImages } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw await providerError(response)
    const result = videoSubmitSchema.parse(await response.json())
    return { id: result.id, pollingUrl: result.polling_url, status: result.status }
  }

  /** Polls one known OpenRouter video job without accepting an arbitrary origin. */
  public async pollVideo(apiKey: string, pollingUrl: string): Promise<VideoJobStatus> {
    const url = new URL(pollingUrl)
    if (url.origin !== 'https://openrouter.ai') throw new Error('Untrusted video polling URL.')
    const response = await this.fetcher(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw await providerError(response)
    const result = videoStatusSchema.parse(await response.json())
    const error = typeof result.error === 'string' ? result.error : result.error?.message
    return {
      id: result.id,
      status: result.status,
      urls: result.unsigned_urls ?? [],
      ...(result.usage?.cost != null ? { costUsd: result.usage.cost } : {}),
      ...(error ? { error } : {}),
    }
  }

  /** Retrieves the exact billed cost without failing an otherwise successful TTS response. */
  private async getGenerationCost(
    apiKey: string,
    generationId: string,
  ): Promise<number | undefined> {
    const retryDelays = [0, 250, 750, 1_500, 3_000]
    for (const delay of retryDelays) {
      if (delay) await wait(delay)
      try {
        const url = new URL(OPENROUTER_GENERATION_URL)
        url.searchParams.set('id', generationId)
        const response = await this.fetcher(url.toString(), {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(15_000),
        })
        if (!response.ok) {
          if (response.status === 404) continue
          return undefined
        }
        const metadata = generationMetadataSchema.parse(await response.json()).data
        const costUsd = metadata.total_cost ?? metadata.usage ?? undefined
        if (costUsd !== undefined) return costUsd
      } catch {
        // A later attempt may succeed after transient network or metadata parsing delays.
      }
    }
    return undefined
  }

  /** Removes undefined request keys so unsupported optional values are never serialized. */
  private definedOptions(
    options: ImageGenerationOptions | VideoGenerationOptions,
  ): Record<string, unknown> {
    const exactSize = 'size' in options ? options.size : undefined
    return Object.fromEntries(
      Object.entries({
        ...(exactSize
          ? { size: exactSize }
          : { resolution: options.resolution, aspect_ratio: options.aspectRatio }),
        ...('quality' in options ? { quality: options.quality } : {}),
        ...('outputFormat' in options ? { output_format: options.outputFormat } : {}),
        ...('count' in options ? { n: options.count } : {}),
        ...('background' in options ? { background: options.background } : {}),
        ...('outputCompression' in options
          ? { output_compression: options.outputCompression }
          : {}),
        ...('duration' in options ? { duration: options.duration } : {}),
        ...('generateAudio' in options ? { generate_audio: options.generateAudio } : {}),
        seed: options.seed,
      }).filter((entry) => entry[1] !== undefined),
    )
  }
}
