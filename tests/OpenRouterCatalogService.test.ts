/**
 * Verifies capability and price normalization from dedicated model discovery APIs.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OpenRouterCatalogService from '../src/main/services/OpenRouterCatalogService'
import type LoggerService from '../src/main/services/LoggerService'

describe('OpenRouterCatalogService', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('loads image capabilities and preserves endpoint billing units', async () => {
    root = await mkdtemp(join(tmpdir(), 'aimedia-catalog-'))
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/endpoints')) {
        return new Response(
          JSON.stringify({
            endpoints: [{ pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.05 }] }],
          }),
          { status: 200 },
        )
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'vendor/image',
              name: 'Image Model',
              description: 'Creates images.',
              supported_parameters: {
                resolution: { type: 'enum', values: ['1K', '2K'] },
                seed: { type: 'boolean' },
              },
              supports_streaming: false,
              endpoints: '/api/v1/images/models/vendor/image/endpoints',
            },
          ],
        }),
        { status: 200 },
      )
    })
    const logger = {
      warn: vi.fn(),
    } as unknown as LoggerService
    const service = new OpenRouterCatalogService(root, logger, fetcher as typeof fetch)
    const models = await service.getModels('image')
    expect(models[0]?.supportedResolutions).toEqual(['1K', '2K'])
    expect(models[0]?.capabilities.seed).toEqual({ type: 'boolean' })
    expect(models[0]?.prices[0]).toMatchObject({ amountUsd: 0.05, unit: 'image' })
  })

  it('converts explicitly cent-denominated video SKUs to USD per second', async () => {
    root = await mkdtemp(join(tmpdir(), 'aimedia-video-catalog-'))
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'vendor/video',
                name: 'Video Model',
                supported_resolutions: ['720p'],
                supported_aspect_ratios: ['16:9'],
                supported_sizes: ['1280x720'],
                supported_durations: [5],
                supported_frame_images: ['first_frame'],
                pricing_skus: { cents_per_video_output_second_720p: '14' },
              },
            ],
          }),
          { status: 200 },
        ),
    )
    const logger = { warn: vi.fn() } as unknown as LoggerService
    const service = new OpenRouterCatalogService(root, logger, fetcher as typeof fetch)
    const models = await service.getModels('video')
    expect(models[0]?.prices[0]).toMatchObject({
      amountUsd: 0.14,
      unit: 'second',
      variant: '720p',
    })
    expect(models[0]?.supportedSizes).toEqual(['1280x720'])
  })

  it('loads TTS voices and normalizes its input-character price', async () => {
    root = await mkdtemp(join(tmpdir(), 'aimedia-tts-catalog-'))
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'vendor/voice',
                name: 'Voice Model',
                pricing: { prompt: '0.000015', completion: '0' },
                supported_parameters: ['response_format'],
                supported_voices: ['alloy', 'nova'],
              },
            ],
          }),
          { status: 200 },
        ),
    )
    const logger = { warn: vi.fn() } as unknown as LoggerService
    const models = await new OpenRouterCatalogService(
      root,
      logger,
      fetcher as typeof fetch,
    ).getModels('tts')
    expect(models[0]?.supportedVoices).toEqual(['alloy', 'nova'])
    expect(models[0]?.prices[0]).toEqual({
      amountUsd: 0.000015,
      unit: 'character',
      billable: 'input_character',
    })
  })

  it('distinguishes duration and token based STT pricing', async () => {
    root = await mkdtemp(join(tmpdir(), 'aimedia-stt-catalog-'))
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'vendor/duration-stt',
                name: 'Duration STT',
                pricing: { prompt: '0.006', completion: '0' },
              },
              {
                id: 'vendor/token-stt',
                name: 'Token STT',
                pricing: { prompt: '0.00000125', completion: '0.000005' },
              },
            ],
          }),
          { status: 200 },
        ),
    )
    const logger = { warn: vi.fn() } as unknown as LoggerService
    const models = await new OpenRouterCatalogService(
      root,
      logger,
      fetcher as typeof fetch,
    ).getModels('stt')
    expect(models.find((model) => model.id.includes('duration'))?.prices[0]).toMatchObject({
      amountUsd: 0.36,
      unit: 'hour',
    })
    expect(models.find((model) => model.id.includes('token'))?.prices).toEqual([
      { amountUsd: 0.00000125, unit: 'input token', billable: 'input_audio' },
      { amountUsd: 0.000005, unit: 'output token', billable: 'output_transcription' },
    ])
  })
})
