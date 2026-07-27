/**
 * Verifies that independent generation submissions complete without a global job lock.
 */

import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GenerationService from '../src/main/services/GenerationService'
import type AudioInputService from '../src/main/services/AudioInputService'
import type CredentialService from '../src/main/services/CredentialService'
import type LoggerService from '../src/main/services/LoggerService'
import type MediaAssetService from '../src/main/services/MediaAssetService'
import type OpenRouterCatalogService from '../src/main/services/OpenRouterCatalogService'
import type OpenRouterMediaService from '../src/main/services/OpenRouterMediaService'
import type ReferenceImageService from '../src/main/services/ReferenceImageService'
import StorageService from '../src/main/services/StorageService'
import type { MediaModel } from '../src/shared/openrouter'

describe('GenerationService', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('allows parallel image jobs and persists both completed sessions', async () => {
    root = await mkdtemp(join(tmpdir(), 'aimedia-generation-'))
    const storage = new StorageService(root)
    await storage.initialize()
    const initial = await storage.createSession()
    const model: MediaModel = {
      id: 'vendor/image',
      name: 'Image',
      description: '',
      kind: 'image',
      capabilities: { n: { type: 'range', min: 1, max: 4 } },
      prices: [],
      supportsStreaming: false,
      supportedResolutions: [],
      supportedAspectRatios: [],
      supportedSizes: [],
      supportedDurations: [],
      supportedFrameImages: [],
      supportsAudio: false,
      supportedVoices: [],
      supportsCustomVoice: false,
    }
    const credential = {
      getApiKey: vi.fn(async () => 'secret-key'),
    } as unknown as CredentialService
    const catalog = { getModels: vi.fn(async () => [model]) } as unknown as OpenRouterCatalogService
    const references = { claim: vi.fn(async () => []) } as unknown as ReferenceImageService
    const assets = {
      saveBase64: vi.fn(async (_sessionId: string, _base64: string, mediaType: string) => ({
        id: randomUUID(),
        fileName: 'image.png',
        mediaType,
        size: 5,
        url: 'aimedia://asset/result',
      })),
    } as unknown as MediaAssetService
    const openRouter = {
      generateImage: vi.fn(async () => ({
        images: [{ base64: 'aGVsbG8=', mediaType: 'image/png' }],
        costUsd: 0.01,
      })),
    } as unknown as OpenRouterMediaService
    const service = new GenerationService(
      storage,
      { image: credential, video: credential, tts: credential, stt: credential },
      catalog,
      references,
      {} as AudioInputService,
      assets,
      openRouter,
      { onUpdated: vi.fn(), onError: vi.fn() },
      { error: vi.fn(), warn: vi.fn() } as unknown as LoggerService,
      1,
    )
    const first = await service.generate({
      kind: 'image',
      prompt: 'First',
      modelId: model.id,
      options: { count: 1 },
      references: [],
      sessionId: initial.id,
    })
    const second = await service.generate({
      kind: 'image',
      prompt: 'Second',
      modelId: model.id,
      options: { count: 1 },
      references: [],
    })
    expect(first.item?.status).toBe('submitting')
    expect(second.id).not.toBe(first.id)
    await vi.waitFor(async () => {
      expect((await storage.getSession(first.id)).item?.status).toBe('completed')
      expect((await storage.getSession(second.id)).item?.status).toBe('completed')
    })
  })

  it('logs, emits, and explains terminal video filtering failures', async () => {
    root = await mkdtemp(join(tmpdir(), 'aimedia-video-failure-'))
    const storage = new StorageService(root)
    await storage.initialize()
    const initial = await storage.createSession()
    const model: MediaModel = {
      id: 'vendor/video',
      name: 'Video',
      description: '',
      kind: 'video',
      capabilities: {},
      prices: [],
      supportsStreaming: false,
      supportedResolutions: ['720p'],
      supportedAspectRatios: ['16:9'],
      supportedSizes: ['1280x720'],
      supportedDurations: [4],
      supportedFrameImages: [],
      supportsAudio: false,
      supportedVoices: [],
      supportsCustomVoice: false,
    }
    const credential = {
      getApiKey: vi.fn(async () => 'secret-key'),
    } as unknown as CredentialService
    const catalog = { getModels: vi.fn(async () => [model]) } as unknown as OpenRouterCatalogService
    const references = { claim: vi.fn(async () => []) } as unknown as ReferenceImageService
    const openRouter = {
      submitVideo: vi.fn(async () => ({
        id: 'job-1',
        pollingUrl: 'https://openrouter.ai/api/v1/videos/job-1',
        status: 'pending',
      })),
      pollVideo: vi.fn(async () => ({
        id: 'job-1',
        status: 'failed',
        urls: [],
        error: 'Video generation completed with no output (content may have been filtered)',
      })),
    } as unknown as OpenRouterMediaService
    const events = { onUpdated: vi.fn(), onError: vi.fn() }
    const logger = { error: vi.fn(), warn: vi.fn() } as unknown as LoggerService
    const service = new GenerationService(
      storage,
      { image: credential, video: credential, tts: credential, stt: credential },
      catalog,
      references,
      {} as AudioInputService,
      {} as MediaAssetService,
      openRouter,
      events,
      logger,
      1,
    )

    const submitted = await service.generate({
      kind: 'video',
      prompt: 'A fictional simulated scene',
      modelId: model.id,
      options: {
        duration: 4,
        resolution: '720p',
        aspectRatio: '16:9',
        size: '1280x720',
      },
      references: [],
      sessionId: initial.id,
    })

    await vi.waitFor(async () => {
      const item = (await storage.getSession(submitted.id)).item
      expect(item?.status).toBe('failed')
      expect(item?.error).toContain('safety filter rejected the prompt')
    })
    expect(events.onError).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'video', recoverable: true }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'GenerationService',
      'Generation failed.',
      expect.objectContaining({ modelId: model.id, remoteJobId: 'job-1' }),
    )
    expect(openRouter.submitVideo).toHaveBeenCalledWith(
      'secret-key',
      model.id,
      'A fictional simulated scene',
      { duration: 4, size: '1280x720' },
      [],
    )
  })

  it('persists generated TTS audio as a playable session asset', async () => {
    root = await mkdtemp(join(tmpdir(), 'aimedia-tts-generation-'))
    const storage = new StorageService(root)
    await storage.initialize()
    const initial = await storage.createSession()
    const model: MediaModel = {
      id: 'vendor/tts',
      name: 'TTS',
      description: '',
      kind: 'tts',
      capabilities: {},
      prices: [],
      supportsStreaming: false,
      supportedResolutions: [],
      supportedAspectRatios: [],
      supportedSizes: [],
      supportedDurations: [],
      supportedFrameImages: [],
      supportsAudio: false,
      supportedVoices: ['alloy'],
      supportsCustomVoice: false,
    }
    const credential = {
      getApiKey: vi.fn(async () => 'secret-key'),
    } as unknown as CredentialService
    const service = new GenerationService(
      storage,
      { image: credential, video: credential, tts: credential, stt: credential },
      { getModels: vi.fn(async () => [model]) } as unknown as OpenRouterCatalogService,
      {} as ReferenceImageService,
      {} as AudioInputService,
      {
        saveAudio: vi.fn(async () => ({
          id: randomUUID(),
          fileName: 'speech.mp3',
          mediaType: 'audio/mpeg',
          size: 3,
          url: 'aimedia://asset/speech',
        })),
      } as unknown as MediaAssetService,
      {
        generateSpeech: vi.fn(async () => ({
          bytes: new Uint8Array([1, 2, 3]),
          mediaType: 'audio/mpeg',
          costUsd: 0.0042,
        })),
      } as unknown as OpenRouterMediaService,
      { onUpdated: vi.fn(), onError: vi.fn() },
      { error: vi.fn(), warn: vi.fn() } as unknown as LoggerService,
      1,
    )
    const submitted = await service.generate({
      kind: 'tts',
      prompt: 'Hello world',
      modelId: model.id,
      options: { voice: 'alloy', responseFormat: 'mp3', speed: 1 },
      sessionId: initial.id,
    })
    await vi.waitFor(async () => {
      const item = (await storage.getSession(submitted.id)).item
      expect(item?.status).toBe('completed')
      expect(item?.assets[0]?.mediaType).toBe('audio/mpeg')
      expect(item?.costUsd).toBe(0.0042)
    })
  })

  it('persists STT input metadata and completed transcription text', async () => {
    root = await mkdtemp(join(tmpdir(), 'aimedia-stt-generation-'))
    const storage = new StorageService(root)
    await storage.initialize()
    const initial = await storage.createSession()
    const model: MediaModel = {
      id: 'vendor/stt',
      name: 'STT',
      description: '',
      kind: 'stt',
      capabilities: { temperature: { type: 'boolean' } },
      prices: [],
      supportsStreaming: false,
      supportedResolutions: [],
      supportedAspectRatios: [],
      supportedSizes: [],
      supportedDurations: [],
      supportedFrameImages: [],
      supportsAudio: false,
      supportedVoices: [],
      supportsCustomVoice: false,
    }
    const credential = {
      getApiKey: vi.fn(async () => 'secret-key'),
    } as unknown as CredentialService
    const audioInputs = {
      claimToken: vi.fn(async () => ({
        base64: 'UklGRg==',
        metadata: {
          originalName: 'meeting.wav',
          fileName: 'audio-id.wav',
          mediaType: 'audio/wav',
          format: 'wav',
          size: 4,
        },
      })),
    } as unknown as AudioInputService
    const service = new GenerationService(
      storage,
      { image: credential, video: credential, tts: credential, stt: credential },
      { getModels: vi.fn(async () => [model]) } as unknown as OpenRouterCatalogService,
      {} as ReferenceImageService,
      audioInputs,
      {} as MediaAssetService,
      {
        transcribeAudio: vi.fn(async () => ({ text: 'Meeting notes', costUsd: 0.01 })),
      } as unknown as OpenRouterMediaService,
      { onUpdated: vi.fn(), onError: vi.fn() },
      { error: vi.fn(), warn: vi.fn() } as unknown as LoggerService,
      1,
    )
    const submitted = await service.generate({
      kind: 'stt',
      modelId: model.id,
      options: { language: 'en', temperature: 0 },
      audio: { token: randomUUID() },
      sessionId: initial.id,
    })
    await vi.waitFor(async () => {
      const session = await storage.getSession(submitted.id)
      expect(session.title).toBe('meeting.wav')
      expect(session.item).toMatchObject({
        status: 'completed',
        resultText: 'Meeting notes',
        costUsd: 0.01,
      })
    })
  })
})
