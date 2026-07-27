/**
 * Verifies renderer model ordering and capability-safe setting reconciliation.
 */

import { describe, expect, it } from 'vitest'
import { estimateTtsCost, type MediaModel } from '../src/shared/openrouter'
import { DEFAULT_SETTINGS, type AppSettings } from '../src/shared/types'
import {
  createCompatibleModelPatch,
  createSessionSettingsPatch,
  createSupportedGenerationOptions,
  sortModelsByOutputPrice,
} from '../src/renderer/src/utils/modelSettings'
import { formatModelPrice } from '../src/renderer/src/utils/formatters'

/** Creates a complete media model fixture with focused test overrides. */
const createModel = (overrides: Partial<MediaModel>): MediaModel => ({
  id: 'vendor/model',
  name: 'Model',
  description: '',
  kind: 'image',
  capabilities: {},
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
  ...overrides,
})

describe('modelSettings', () => {
  it('orders per-image prices before megapixel and token prices, then leaves unknown prices last', () => {
    const models = [
      createModel({ id: 'unknown', name: 'Unknown' }),
      createModel({
        id: 'tokens',
        name: 'Tokens',
        prices: [{ amountUsd: 0.000001, unit: 'token', billable: 'output_image' }],
      }),
      createModel({
        id: 'megapixel',
        name: 'Megapixel',
        prices: [{ amountUsd: 0.01, unit: 'megapixel', billable: 'output_image' }],
      }),
      createModel({
        id: 'image-expensive',
        name: 'Image Expensive',
        prices: [{ amountUsd: 0.08, unit: 'image', billable: 'output_image' }],
      }),
      createModel({
        id: 'image-cheap',
        name: 'Image Cheap',
        prices: [{ amountUsd: 0.02, unit: 'image', billable: 'output_image' }],
      }),
    ]

    expect(sortModelsByOutputPrice(models).map((model) => model.id)).toEqual([
      'image-cheap',
      'image-expensive',
      'megapixel',
      'tokens',
      'unknown',
    ])
  })

  it('orders per-second video prices before video-token prices', () => {
    const models = [
      createModel({
        id: 'video-tokens',
        name: 'Video Tokens',
        kind: 'video',
        prices: [{ amountUsd: 0.0000012, unit: 'video_tokens', billable: 'output_video' }],
      }),
      createModel({
        id: 'per-second',
        name: 'Per Second',
        kind: 'video',
        prices: [{ amountUsd: 0.1, unit: 'second', billable: 'output_video' }],
      }),
    ]

    expect(sortModelsByOutputPrice(models).map((model) => model.id)).toEqual([
      'per-second',
      'video-tokens',
    ])
  })

  it('formats token prices per one million tokens without changing native media units', () => {
    const millionTokenAmount = (1.2).toLocaleString(undefined, { maximumFractionDigits: 6 })
    const imageAmount = (0.04).toLocaleString(undefined, { maximumFractionDigits: 6 })
    expect(
      formatModelPrice({ amountUsd: 0.0000012, unit: 'video_tokens', billable: 'output_video' }),
    ).toBe(`$${millionTokenAmount} / 1M video tokens`)
    expect(formatModelPrice({ amountUsd: 0.04, unit: 'image', billable: 'output_image' })).toBe(
      `$${imageAmount} / image`,
    )
  })

  it('formats TTS character prices per one million characters', () => {
    const amount = (15).toLocaleString(undefined, { maximumFractionDigits: 6 })
    expect(
      formatModelPrice({
        amountUsd: 0.000015,
        unit: 'character',
        billable: 'input_character',
      }),
    ).toBe(`$${amount} / 1M characters`)
  })

  it('estimates TTS output cost from live per-character catalog pricing', () => {
    const model = createModel({
      kind: 'tts',
      prices: [{ amountUsd: 0.000002, unit: 'character', billable: 'input_character' }],
    })

    expect(estimateTtsCost(model, 'Hello')).toBeCloseTo(0.00001, 10)
  })

  it('replaces an incompatible PNG selection when the next image model only supports JPEG', () => {
    const settings: AppSettings = structuredClone(DEFAULT_SETTINGS)
    settings.image.providers.openrouter.outputFormat = 'png'
    const model = createModel({
      id: 'vendor/jpeg-only',
      capabilities: {
        output_format: { type: 'enum', values: ['jpeg'] },
      },
    })

    const patch = createCompatibleModelPatch('image', model, settings)

    expect(patch.image?.providers?.openrouter?.modelId).toBe('vendor/jpeg-only')
    expect(patch.image?.providers?.openrouter?.outputFormat).toBe('jpeg')
  })

  it('refreshes incompatible video options and disables unsupported audio and seed values', () => {
    const settings: AppSettings = structuredClone(DEFAULT_SETTINGS)
    settings.video.providers.openrouter.duration = 10
    settings.video.providers.openrouter.resolution = '1080p'
    settings.video.providers.openrouter.aspectRatio = '9:16'
    settings.video.providers.openrouter.size = '1920x1080'
    settings.video.providers.openrouter.generateAudio = true
    settings.video.providers.openrouter.seed = 42
    const model = createModel({
      id: 'vendor/video',
      kind: 'video',
      supportedDurations: [5],
      supportedResolutions: ['720p'],
      supportedAspectRatios: ['16:9'],
      supportedSizes: ['1280x720'],
    })

    const patch = createCompatibleModelPatch('video', model, settings)

    expect(patch.video?.providers?.openrouter).toMatchObject({
      modelId: 'vendor/video',
      duration: 5,
      resolution: '720p',
      aspectRatio: '16:9',
      size: '',
      generateAudio: false,
      seed: null,
    })
  })

  it('replaces an incompatible TTS voice when the selected model changes', () => {
    const settings: AppSettings = structuredClone(DEFAULT_SETTINGS)
    settings.tts.providers.openrouter.voice = 'old-voice'
    const model = createModel({
      id: 'vendor/tts',
      kind: 'tts',
      supportedVoices: ['alloy', 'nova'],
    })
    expect(createCompatibleModelPatch('tts', model, settings).tts?.providers?.openrouter).toEqual({
      modelId: 'vendor/tts',
      voice: 'alloy',
      speed: 1,
    })
  })

  it('builds only advertised image options for immutable session comparison', () => {
    const settings: AppSettings = structuredClone(DEFAULT_SETTINGS)
    settings.image.providers.openrouter.aspectRatio = '16:9'
    settings.image.providers.openrouter.resolution = '2K'
    settings.image.providers.openrouter.count = 1
    const model = createModel({
      capabilities: {
        aspect_ratio: { type: 'enum', values: ['16:9'] },
        resolution: { type: 'enum', values: ['2K'] },
        n: { type: 'range', min: 1, max: 1 },
      },
    })

    expect(createSupportedGenerationOptions('image', model, settings)).toEqual({
      resolution: '2K',
      aspectRatio: '16:9',
      count: 1,
    })
  })

  it('hydrates an immutable video input while clearing absent optional values', () => {
    expect(
      createSessionSettingsPatch({
        id: 'generation-1',
        kind: 'video',
        provider: 'openrouter',
        modelId: 'vendor/video',
        prompt: 'A lake',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        options: { duration: 5, resolution: '720p', aspectRatio: '16:9' },
        assets: [],
      }),
    ).toEqual({
      generationMode: 'video',
      video: {
        providers: {
          openrouter: {
            modelId: 'vendor/video',
            duration: 5,
            resolution: '720p',
            aspectRatio: '16:9',
            size: '',
            seed: null,
          },
        },
      },
    })
  })

  it('hydrates immutable TTS and STT composer defaults', () => {
    const base = {
      id: 'generation-1',
      provider: 'openrouter' as const,
      status: 'completed' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      assets: [],
    }
    expect(
      createSessionSettingsPatch({
        ...base,
        kind: 'tts',
        modelId: 'vendor/tts',
        prompt: 'Hello',
        options: { voice: 'alloy', responseFormat: 'mp3', speed: 1 },
      }),
    ).toMatchObject({
      generationMode: 'tts',
      tts: { providers: { openrouter: { voice: 'alloy' } } },
    })
    expect(
      createSessionSettingsPatch({
        ...base,
        kind: 'stt',
        modelId: 'vendor/stt',
        prompt: '',
        options: {},
      }),
    ).toMatchObject({
      generationMode: 'stt',
      stt: { providers: { openrouter: { language: '', temperature: 0 } } },
    })
  })
})
