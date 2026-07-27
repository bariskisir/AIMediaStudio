/**
 * Verifies dedicated OpenRouter media request and response handling.
 */

import { describe, expect, it, vi } from 'vitest'
import OpenRouterMediaService from '../src/main/services/OpenRouterMediaService'

describe('OpenRouterMediaService', () => {
  it('uses the buffered image API and returns final base64 output', async () => {
    let capturedInit: RequestInit | undefined
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedInit = init
      return new Response(
        JSON.stringify({
          data: [{ b64_json: 'aGVsbG8=', media_type: 'image/png' }],
          usage: { cost: 0.04 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const service = new OpenRouterMediaService(fetcher as typeof fetch)
    const result = await service.generateImage(
      'secret-key',
      'vendor/image',
      'A lake',
      { count: 1 },
      [],
    )
    expect(result.images[0]?.mediaType).toBe('image/png')
    expect(result.costUsd).toBe(0.04)
    expect(JSON.parse(String(capturedInit?.body)).stream).toBe(false)
  })

  it('submits a video and preserves its polling URL', async () => {
    let capturedInit: RequestInit | undefined
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedInit = init
      return new Response(
        JSON.stringify({
          id: 'job-1',
          polling_url: 'https://openrouter.ai/api/v1/videos/job-1',
          status: 'pending',
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      )
    })
    const service = new OpenRouterMediaService(fetcher as typeof fetch)
    await expect(
      service.submitVideo(
        'secret-key',
        'vendor/video',
        'A lake',
        { duration: 5, resolution: '720p', aspectRatio: '16:9', size: '1280x720' },
        [],
      ),
    ).resolves.toMatchObject({ id: 'job-1' })
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      duration: 5,
      size: '1280x720',
    })
    expect(JSON.parse(String(capturedInit?.body))).not.toHaveProperty('resolution')
    expect(JSON.parse(String(capturedInit?.body))).not.toHaveProperty('aspect_ratio')
  })

  it('surfaces the provider error message', async () => {
    const service = new OpenRouterMediaService(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'Invalid model' } }), { status: 400 }),
      ) as typeof fetch,
    )
    await expect(service.generateImage('secret-key', 'bad', 'Prompt', {}, [])).rejects.toThrow(
      'Invalid model',
    )
  })

  it('sends TTS voice options, preserves audio, and resolves exact generation cost', async () => {
    let capturedInit: RequestInit | undefined
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).startsWith('https://openrouter.ai/api/v1/generation?')) {
        return new Response(JSON.stringify({ data: { total_cost: 0.0042, usage: 0.0042 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      capturedInit = init
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg', 'x-generation-id': 'gen-tts-1' },
      })
    })
    const service = new OpenRouterMediaService(fetcher as typeof fetch)
    const result = await service.generateSpeech('secret-key', 'vendor/tts', 'Hello', {
      voice: 'alloy',
      responseFormat: 'mp3',
      speed: 1.2,
    })
    expect(result.mediaType).toBe('audio/mpeg')
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(result.costUsd).toBe(0.0042)
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      input: 'Hello',
      voice: 'alloy',
      response_format: 'mp3',
      speed: 1.2,
    })
  })

  it('retries TTS accounting while generation cost is not materialized yet', async () => {
    let metadataRequests = 0
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith('https://openrouter.ai/api/v1/generation?')) {
        metadataRequests += 1
        return new Response(
          JSON.stringify({
            data: {
              total_cost: metadataRequests === 1 ? null : 0.0025,
              usage: metadataRequests === 1 ? null : 0.0025,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg', 'x-generation-id': 'gen-delayed-cost' },
      })
    })
    const service = new OpenRouterMediaService(fetcher as typeof fetch)

    const result = await service.generateSpeech('secret-key', 'vendor/tts', 'Hello', {
      voice: 'alloy',
      responseFormat: 'mp3',
      speed: 1,
    })

    expect(result.costUsd).toBe(0.0025)
    expect(metadataRequests).toBe(2)
  })

  it('surfaces nested upstream error details instead of only the HTTP status', async () => {
    const service = new OpenRouterMediaService(
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: 'Provider returned 400',
                metadata: {
                  provider_name: 'Alibaba',
                  raw: JSON.stringify({ err_msg: 'Audio duration exceeds five minutes.' }),
                },
              },
            }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          ),
      ) as typeof fetch,
    )

    await expect(
      service.transcribeAudio('secret-key', 'vendor/stt', 'UklGRg==', 'wav', {}),
    ).rejects.toThrow('Alibaba: Audio duration exceeds five minutes. (HTTP 400)')
  })

  it('sends base64 STT audio and returns text with exact usage cost', async () => {
    let capturedInit: RequestInit | undefined
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedInit = init
      return new Response(JSON.stringify({ text: 'Hello world', usage: { cost: 0.000508 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const service = new OpenRouterMediaService(fetcher as typeof fetch)
    await expect(
      service.transcribeAudio('secret-key', 'vendor/stt', 'UklGRg==', 'wav', {
        language: 'en',
        temperature: 0,
      }),
    ).resolves.toEqual({ text: 'Hello world', costUsd: 0.000508 })
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      input_audio: { data: 'UklGRg==', format: 'wav' },
      language: 'en',
      temperature: 0,
    })
  })
})
