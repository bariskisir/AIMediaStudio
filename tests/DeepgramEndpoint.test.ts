/**
 * Verifies that buildDeepgramEndpoint constructs correct WebSocket URLs
 * for different models, languages, diarization, redaction, and optional features.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS } from '../src/shared/transcription'
import { buildDeepgramEndpoint } from '../src/main/services/DeepgramEndpoint'
import type { DeepgramTranscriptionSettings } from '../src/shared/transcription'

function makeSettings(
  overrides: Partial<DeepgramTranscriptionSettings> = {},
): DeepgramTranscriptionSettings {
  return { ...DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS, ...overrides }
}

describe('buildDeepgramEndpoint', () => {
  it('returns a WebSocket URL starting with wss://', () => {
    const url = buildDeepgramEndpoint(makeSettings())
    expect(url).toMatch(/^wss:\/\/api\.deepgram\.com\/v1\/listen\?/)
  })

  it('includes the model parameter', () => {
    const url = buildDeepgramEndpoint(makeSettings({ model: 'nova-3-general' }))
    expect(url).toContain('model=nova-3-general')
  })

  it('includes the language parameter', () => {
    const url = buildDeepgramEndpoint(makeSettings({ language: 'tr' }))
    expect(url).toContain('language=tr')
  })

  it('includes the encoding and sample rate parameters', () => {
    const url = buildDeepgramEndpoint(makeSettings())
    expect(url).toContain('encoding=linear16')
    expect(url).toContain('sample_rate=16000')
    expect(url).toContain('channels=1')
  })

  it('includes interim_results and vad_events flags', () => {
    const url = buildDeepgramEndpoint(makeSettings())
    expect(url).toContain('interim_results=true')
    expect(url).toContain('vad_events=true')
  })

  it('includes boolean formatting parameters', () => {
    const url = buildDeepgramEndpoint(
      makeSettings({
        punctuate: true,
        smartFormat: false,
        numerals: true,
        profanityFilter: false,
      }),
    )
    expect(url).toContain('punctuate=true')
    expect(url).toContain('smart_format=false')
    expect(url).toContain('numerals=true')
    expect(url).toContain('profanity_filter=false')
  })

  it('includes the endpointing parameter', () => {
    const url = buildDeepgramEndpoint(makeSettings({ endpointingMs: 250 }))
    expect(url).toContain('endpointing=250')
  })

  it('includes the mip_opt_out parameter', () => {
    const url = buildDeepgramEndpoint(makeSettings({ mipOptOut: true }))
    expect(url).toContain('mip_opt_out=true')
  })

  it('includes utterance_end_ms when utteranceEndEnabled is true', () => {
    const url = buildDeepgramEndpoint(
      makeSettings({ utteranceEndEnabled: true, utteranceEndMs: 2000 }),
    )
    expect(url).toContain('utterance_end_ms=2000')
  })

  it('omits utterance_end_ms when utteranceEndEnabled is false', () => {
    const url = buildDeepgramEndpoint(
      makeSettings({ utteranceEndEnabled: false, utteranceEndMs: 2000 }),
    )
    expect(url).not.toContain('utterance_end_ms')
  })

  it('includes diarize_model when diarization is v1', () => {
    const url = buildDeepgramEndpoint(makeSettings({ diarization: 'v1' }))
    expect(url).toContain('diarize_model=v1')
  })

  it('includes diarize_model when diarization is latest', () => {
    const url = buildDeepgramEndpoint(makeSettings({ diarization: 'latest' }))
    expect(url).toContain('diarize_model=latest')
  })

  it('omits diarize_model when diarization is off', () => {
    const url = buildDeepgramEndpoint(makeSettings({ diarization: 'off' }))
    expect(url).not.toContain('diarize_model')
  })

  it('includes redact parameter when redaction is enabled', () => {
    const url = buildDeepgramEndpoint(makeSettings({ redaction: 'pii' }))
    expect(url).toContain('redact=pii')
  })

  it('omits redact parameter when redaction is none', () => {
    const url = buildDeepgramEndpoint(makeSettings({ redaction: 'none' }))
    expect(url).not.toContain('redact=')
  })

  it('includes vocabulary terms as repeated query parameters', () => {
    const url = buildDeepgramEndpoint(
      makeSettings({ model: 'nova-3-general', vocabulary: ['alpha', 'beta'] }),
    )
    expect(url).toContain('keyterm=alpha')
    expect(url).toContain('keyterm=beta')
  })

  it('uses keyterm parameter name for nova-3 models', () => {
    const url = buildDeepgramEndpoint(
      makeSettings({ model: 'nova-3-general', vocabulary: ['term1'] }),
    )
    expect(url).toContain('keyterm=term1')
  })

  it('uses keywords parameter name for nova-2 models', () => {
    const url = buildDeepgramEndpoint(
      makeSettings({ model: 'nova-2-general', vocabulary: ['term1'] }),
    )
    expect(url).toContain('keywords=term1')
  })

  it('omits unsupported vocabulary parameters for Whisper models', () => {
    const url = buildDeepgramEndpoint(
      makeSettings({ model: 'whisper-large', vocabulary: ['term1'] }),
    )
    expect(url).not.toContain('keyterm=')
    expect(url).not.toContain('keywords=')
  })

  it('includes the model version', () => {
    const url = buildDeepgramEndpoint(makeSettings({ modelVersion: '2024-05-01.12345' }))
    expect(url).toContain('version=2024-05-01.12345')
  })

  it('handles nova-3-medical model correctly', () => {
    const url = buildDeepgramEndpoint(makeSettings({ model: 'nova-3-medical', language: 'en-US' }))
    expect(url).toContain('model=nova-3-medical')
    expect(url).toContain('language=en-US')
  })

  it('handles nova-2-phonecall model with vocabulary correctly', () => {
    const url = buildDeepgramEndpoint(
      makeSettings({
        model: 'nova-2-phonecall',
        language: 'en-US',
        vocabulary: ['term1'],
      }),
    )
    expect(url).toContain('model=nova-2-phonecall')
    expect(url).toContain('language=en-US')
    expect(url).toContain('keywords=term1')
  })
})
