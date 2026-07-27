/**
 * Coordinates parallel media jobs while persisting every lifecycle transition.
 */

import { randomUUID } from 'node:crypto'
import type { MediaModel } from '@shared/openrouter'
import type {
  AppErrorEvent,
  GenerateRequest,
  GenerationItem,
  GenerationStatus,
  ImageGenerationOptions,
  MediaKind,
  SessionDocument,
  SessionUpdatedEvent,
  SttGenerationOptions,
  TtsGenerationOptions,
  VideoGenerationOptions,
} from '@shared/types'
import { toActionableVideoError } from '@shared/video'
import type CredentialService from './CredentialService'
import type AudioInputService from './AudioInputService'
import type { ClaimedAudioInput } from './AudioInputService'
import type LoggerService from './LoggerService'
import type MediaAssetService from './MediaAssetService'
import type OpenRouterCatalogService from './OpenRouterCatalogService'
import type OpenRouterMediaService from './OpenRouterMediaService'
import type ReferenceImageService from './ReferenceImageService'
import type StorageService from './StorageService'
import { toSessionSummary } from './StorageService'

interface GenerationEvents {
  onUpdated(event: SessionUpdatedEvent): void
  onError(event: AppErrorEvent): void
}

export default class GenerationService {
  /** Creates a generation coordinator with independently scoped credentials. */
  public constructor(
    private readonly storage: StorageService,
    private readonly credentials: Record<MediaKind, CredentialService>,
    private readonly catalog: OpenRouterCatalogService,
    private readonly references: ReferenceImageService,
    private readonly audioInputs: AudioInputService,
    private readonly assets: MediaAssetService,
    private readonly openRouter: OpenRouterMediaService,
    private readonly events: GenerationEvents,
    private readonly logger: LoggerService,
    private readonly pollingIntervalMs = 30_000,
  ) {}

  /** Persists a new session immediately and runs its provider work in the background. */
  public async generate(request: GenerateRequest): Promise<SessionDocument> {
    const prompt = request.kind === 'stt' ? '' : request.prompt.trim()
    if (request.kind !== 'stt' && !prompt) throw new Error('A text input is required.')
    const apiKey = await this.credentials[request.kind].getApiKey()
    if (!apiKey) throw new Error(`Add an OpenRouter API key for ${request.kind} generation.`)
    const models = await this.catalog.getModels(request.kind)
    const model = models.find((candidate) => candidate.id === request.modelId)
    if (!model) throw new Error('The selected model is no longer available.')
    let session = request.sessionId ? await this.storage.getSession(request.sessionId) : null
    if (!session || session.item) session = await this.storage.createSession()
    const audio =
      request.kind === 'stt' ? await this.resolveAudioInput(request, session.id) : undefined
    const now = new Date().toISOString()
    const item: GenerationItem = {
      id: randomUUID(),
      kind: request.kind,
      provider: 'openrouter',
      modelId: model.id,
      prompt,
      status: 'submitting',
      createdAt: now,
      updatedAt: now,
      options: this.filterOptions(request, model),
      assets: [],
      ...(audio ? { inputAudio: audio.metadata } : {}),
    }
    const persisted = await this.storage.setGeneration(session.id, item)
    this.emitUpdated(persisted)
    void this.run(session.id, item, request, apiKey, audio).catch((error: unknown) => {
      this.logger.error('GenerationService', 'Unhandled background generation error.', {
        kind: request.kind,
        modelId: request.modelId,
        promptLength: prompt.length,
        error,
      })
    })
    return persisted
  }

  /** Resumes durable video polling and marks interrupted synchronous submissions safely. */
  public async resumePendingJobs(): Promise<void> {
    const sessions = await this.storage.listSessions()
    await Promise.all(
      sessions.map(async (summary) => {
        if (!summary.status || !['submitting', 'pending', 'in_progress'].includes(summary.status)) {
          return
        }
        const session = await this.storage.getSession(summary.id)
        const item = session.item
        if (!item) return
        if (item.kind === 'video' && item.remoteJobId && item.pollingUrl) {
          const apiKey = await this.credentials.video.getApiKey()
          if (apiKey) void this.pollVideo(session.id, item, apiKey)
          else
            await this.fail(session.id, item, 'The video API key is required to resume this job.')
          return
        }
        await this.fail(
          session.id,
          item,
          'Generation was interrupted before a remote job was created.',
        )
      }),
    )
  }

  /** Executes one image response or asynchronous video submission without blocking other jobs. */
  private async run(
    sessionId: string,
    item: GenerationItem,
    request: GenerateRequest,
    apiKey: string,
    audio?: ClaimedAudioInput,
  ): Promise<void> {
    try {
      const claimed =
        request.kind === 'image' || request.kind === 'video'
          ? await this.references.claim(
              request.references,
              this.storage.getSessionInputPath(sessionId),
            )
          : []
      if (request.kind === 'image') {
        const result = await this.openRouter.generateImage(
          apiKey,
          item.modelId,
          item.prompt,
          item.options as ImageGenerationOptions,
          claimed,
        )
        const assets = await Promise.all(
          result.images.map((image, index) =>
            this.assets.saveBase64(sessionId, image.base64, image.mediaType, index),
          ),
        )
        await this.update(sessionId, item, 'completed', {
          assets,
          ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
        })
        return
      }
      if (request.kind === 'tts') {
        const result = await this.openRouter.generateSpeech(
          apiKey,
          item.modelId,
          item.prompt,
          item.options as TtsGenerationOptions,
        )
        const asset = await this.assets.saveAudio(sessionId, result.bytes, result.mediaType)
        await this.update(sessionId, item, 'completed', {
          assets: [asset],
          ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
        })
        return
      }
      if (request.kind === 'stt') {
        if (!audio) throw new Error('An audio file is required for transcription.')
        const result = await this.openRouter.transcribeAudio(
          apiKey,
          item.modelId,
          audio.base64,
          audio.metadata.format,
          item.options as SttGenerationOptions,
        )
        await this.update(sessionId, item, 'completed', {
          resultText: result.text,
          ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
        })
        return
      }
      const job = await this.openRouter.submitVideo(
        apiKey,
        item.modelId,
        item.prompt,
        item.options as VideoGenerationOptions,
        claimed,
      )
      const submitted = await this.update(sessionId, item, 'pending', {
        remoteJobId: job.id,
        pollingUrl: job.pollingUrl,
      })
      if (submitted.item) await this.pollVideo(sessionId, submitted.item, apiKey)
    } catch (error) {
      await this.fail(
        sessionId,
        item,
        error instanceof Error ? error.message : 'Generation failed.',
      )
    }
  }

  /** Resolves a new opaque selection or clones a prior immutable STT session input. */
  private async resolveAudioInput(
    request: Extract<GenerateRequest, { kind: 'stt' }>,
    targetSessionId: string,
  ): Promise<ClaimedAudioInput> {
    const inputDirectory = this.storage.getSessionInputPath(targetSessionId)
    if ('token' in request.audio) {
      return this.audioInputs.claimToken(request.audio.token, inputDirectory)
    }
    const source = await this.storage.getSession(request.audio.sourceSessionId)
    if (source.item?.kind !== 'stt' || !source.item.inputAudio) {
      throw new Error('The source transcription audio is no longer available.')
    }
    return this.audioInputs.clonePersisted(
      this.storage.resolveInputPath(source.id, source.item.inputAudio.fileName),
      source.item.inputAudio,
      inputDirectory,
    )
  }

  /** Polls a video until a terminal state, then downloads all completed outputs. */
  private async pollVideo(
    sessionId: string,
    initial: GenerationItem,
    apiKey: string,
  ): Promise<void> {
    let item = initial
    for (let attempt = 0; attempt < 240; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, this.pollingIntervalMs))
      try {
        const status = await this.openRouter.pollVideo(apiKey, item.pollingUrl ?? '')
        if (status.status === 'pending' || status.status === 'in_progress') {
          const session = await this.update(sessionId, item, status.status)
          if (session.item) item = session.item
          continue
        }
        if (status.status === 'completed') {
          if (!status.urls.length) {
            await this.fail(
              sessionId,
              item,
              toActionableVideoError('Video generation completed without an output URL.'),
            )
            return
          }
          const assets = await Promise.all(
            status.urls.map((url, index) =>
              this.assets.downloadVideo(sessionId, url, apiKey, index),
            ),
          )
          await this.update(sessionId, item, 'completed', {
            assets,
            ...(status.costUsd !== undefined ? { costUsd: status.costUsd } : {}),
          })
          return
        }
        const message = toActionableVideoError(status.error ?? `Video generation ${status.status}.`)
        await this.fail(sessionId, item, message, status.status)
        return
      } catch (error) {
        if (attempt < 3) continue
        await this.fail(
          sessionId,
          item,
          error instanceof Error ? error.message : 'Video polling failed.',
        )
        return
      }
    }
    await this.fail(sessionId, item, 'Video generation exceeded the maximum polling period.')
  }

  /** Applies only options confirmed by the selected model's discovery record. */
  private filterOptions(request: GenerateRequest, model: MediaModel): GenerationItem['options'] {
    const supported = model.capabilities
    if (request.kind === 'image') {
      const options = request.options
      return {
        ...(supported.resolution && options.resolution ? { resolution: options.resolution } : {}),
        ...(supported.aspect_ratio && options.aspectRatio
          ? { aspectRatio: options.aspectRatio }
          : {}),
        ...(supported.quality && options.quality ? { quality: options.quality } : {}),
        ...(supported.output_format && options.outputFormat
          ? { outputFormat: options.outputFormat }
          : {}),
        ...(supported.n && options.count ? { count: options.count } : {}),
        ...(supported.background && options.background ? { background: options.background } : {}),
        ...(supported.output_compression && options.outputCompression !== undefined
          ? { outputCompression: options.outputCompression }
          : {}),
        ...(supported.seed && options.seed !== undefined ? { seed: options.seed } : {}),
      }
    }
    if (request.kind === 'tts') {
      const options = request.options
      const voice = model.supportsCustomVoice
        ? options.voice.trim()
        : model.supportedVoices.includes(options.voice)
          ? options.voice
          : (model.supportedVoices[0] ?? '')
      if (!voice) throw new Error('Select or enter a voice supported by this TTS model.')
      const speedCapability = model.capabilities.speed
      const minimumSpeed = speedCapability?.type === 'range' ? speedCapability.min : 0.25
      const maximumSpeed = speedCapability?.type === 'range' ? speedCapability.max : 4
      return {
        voice,
        responseFormat: options.responseFormat,
        speed: Math.min(maximumSpeed, Math.max(minimumSpeed, options.speed)),
      }
    }
    if (request.kind === 'stt') {
      const options = request.options
      return {
        ...(options.language?.trim() ? { language: options.language.trim() } : {}),
        ...(options.temperature !== undefined
          ? { temperature: Math.min(1, Math.max(0, options.temperature)) }
          : {}),
      }
    }
    const options = request.options
    const exactSize =
      options.size && model.supportedSizes.includes(options.size) ? options.size : ''
    return {
      ...(model.supportedDurations.length && options.duration
        ? { duration: options.duration }
        : {}),
      ...(exactSize
        ? { size: exactSize }
        : {
            ...(model.supportedResolutions.length && options.resolution
              ? { resolution: options.resolution }
              : {}),
            ...(model.supportedAspectRatios.length && options.aspectRatio
              ? { aspectRatio: options.aspectRatio }
              : {}),
          }),
      ...(model.supportsAudio && options.generateAudio !== undefined
        ? { generateAudio: options.generateAudio }
        : {}),
      ...(supported.seed && options.seed !== undefined ? { seed: options.seed } : {}),
    }
  }

  /** Persists one lifecycle transition and broadcasts the complete session. */
  private async update(
    sessionId: string,
    current: GenerationItem,
    status: GenerationStatus,
    patch: Partial<GenerationItem> = {},
  ): Promise<SessionDocument> {
    const item: GenerationItem = {
      ...current,
      ...patch,
      status,
      updatedAt: new Date().toISOString(),
    }
    const session = await this.storage.updateGeneration(sessionId, item)
    this.emitUpdated(session)
    return session
  }

  /** Converts a provider failure into a durable terminal state, renderer event, and log entry. */
  private async fail(
    sessionId: string,
    item: GenerationItem,
    message: string,
    status: Extract<GenerationStatus, 'failed' | 'cancelled' | 'expired'> = 'failed',
  ): Promise<void> {
    const session = await this.update(sessionId, item, status, { error: message })
    this.events.onError({ context: item.kind, message, recoverable: true })
    this.logger.warn('GenerationService', 'Generation failed.', {
      sessionId,
      kind: item.kind,
      modelId: item.modelId,
      promptLength: item.prompt.length,
      status: session.item?.status,
      message,
      ...(item.remoteJobId ? { remoteJobId: item.remoteJobId } : {}),
    })
  }

  /** Broadcasts synchronized document and summary forms. */
  private emitUpdated(session: SessionDocument): void {
    this.events.onUpdated({ session, summary: toSessionSummary(session) })
  }
}
