/**
 * Verifies normalization and settings reconciliation for Deepgram's public model catalog.
 */

import { describe, expect, it } from 'vitest'
import {
  formatDeepgramModelName,
  parseDeepgramCatalog,
  reconcileDeepgramSettings,
} from '../src/main/services/DeepgramCatalogService'
import { DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS } from '../src/shared/transcription'
import { getDeepgramHourlyPriceUsd, type DeepgramSpeechModel } from '../src/shared/deepgram'

const catalogFixture = {
  stt: [
    {
      name: '3-general',
      canonical_name: 'nova-3-general',
      architecture: 'nova-3',
      languages: ['en', 'en-US'],
      streaming: true,
    },
    {
      name: '3-general',
      canonical_name: 'nova-3-general',
      architecture: 'nova-3',
      languages: ['tr', 'en'],
      streaming: true,
    },
    {
      name: '2-phonecall',
      canonical_name: 'nova-2-phonecall',
      architecture: 'nova-2',
      languages: ['en-US'],
      streaming: true,
    },
    {
      name: 'batch-only',
      canonical_name: 'batch-only',
      architecture: 'test',
      languages: ['en'],
      streaming: false,
    },
  ],
}

const models: DeepgramSpeechModel[] = parseDeepgramCatalog(catalogFixture)

describe('parseDeepgramCatalog', () => {
  it('merges duplicate streaming records and excludes batch-only models', () => {
    expect(models.map((model) => model.id)).toEqual(['nova-3-general', 'nova-2-phonecall'])
    expect(models[0]?.languages).toEqual(['en', 'en-US', 'tr'])
  })

  it('places nova-3-general first and derives readable labels', () => {
    expect(models[0]).toMatchObject({ id: 'nova-3-general', name: 'Nova-3 General' })
    expect(formatDeepgramModelName('nova-2-phonecall')).toBe('Nova-2 Phone Call')
  })

  it('derives the vocabulary parameter from each model family', () => {
    expect(models[0]?.vocabularyParameter).toBe('keyterm')
    expect(models[1]?.vocabularyParameter).toBe('keywords')
  })

  it('attaches published hourly streaming prices by model family', () => {
    expect(models[0]?.hourlyPriceUsd).toBe(0.288)
    expect(models[1]?.hourlyPriceUsd).toBe(0.35)
  })
})

describe('getDeepgramHourlyPriceUsd', () => {
  it('maps every officially published streaming model family', () => {
    expect(getDeepgramHourlyPriceUsd('nova-3-medical', 'nova-3')).toBe(0.288)
    expect(getDeepgramHourlyPriceUsd('nova-2-general', 'nova-2')).toBe(0.35)
    expect(getDeepgramHourlyPriceUsd('enhanced-general', 'polaris')).toBe(0.99)
    expect(getDeepgramHourlyPriceUsd('general', 'base')).toBe(0.87)
  })

  it('does not invent a rate for unpublished catalog families', () => {
    expect(getDeepgramHourlyPriceUsd('nova-general', 'nova')).toBeNull()
    expect(getDeepgramHourlyPriceUsd('whisper-large', 'whisper')).toBeNull()
    expect(getDeepgramHourlyPriceUsd('phoneme', 'base')).toBeNull()
  })
})

describe('reconcileDeepgramSettings', () => {
  it('migrates nova-3 to the canonical default model', () => {
    const settings = {
      ...DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS,
      model: 'nova-3',
      language: 'tr',
    }
    expect(reconcileDeepgramSettings(settings, models)).toMatchObject({
      model: 'nova-3-general',
      language: 'tr',
    })
  })

  it('falls back to nova-3-general and English for an unavailable selection', () => {
    const settings = {
      ...DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS,
      model: 'removed-model',
      language: 'de',
    }
    expect(reconcileDeepgramSettings(settings, models)).toMatchObject({
      model: 'nova-3-general',
      language: 'en',
    })
  })

  it('uses a model first language and disables redaction when English is unavailable', () => {
    const nonEnglishModels: DeepgramSpeechModel[] = [
      {
        id: 'test-model',
        name: 'Test Model',
        languages: ['tr'],
        hourlyPriceUsd: null,
        vocabularyParameter: 'keywords',
      },
    ]
    const settings = {
      ...DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS,
      model: 'test-model',
      language: 'en',
      redaction: 'pii' as const,
    }
    expect(reconcileDeepgramSettings(settings, nonEnglishModels)).toMatchObject({
      language: 'tr',
      redaction: 'none',
    })
  })

  it('still canonicalizes legacy aliases when the catalog is unavailable', () => {
    const settings = { ...DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS, model: 'nova-2' }
    expect(reconcileDeepgramSettings(settings, [])).toMatchObject({ model: 'nova-2-general' })
  })
})
