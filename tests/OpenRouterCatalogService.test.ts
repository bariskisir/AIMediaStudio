/**
 * Verifies OpenRouter catalog filtering, hourly conversion, and price ordering.
 */

import { describe, expect, it } from 'vitest'
import { parseOpenRouterCatalog } from '../src/main/services/OpenRouterCatalogService'
import {
  OPENROUTER_FEATURED_TRANSCRIPTION_LANGUAGES,
  OPENROUTER_TRANSCRIPTION_LANGUAGES,
  ORDERED_OPENROUTER_TRANSCRIPTION_LANGUAGES,
} from '../src/shared/openrouter'

describe('OPENROUTER_TRANSCRIPTION_LANGUAGES', () => {
  it('contains every unique ISO 639-1 code in alphabetical order', () => {
    expect(OPENROUTER_TRANSCRIPTION_LANGUAGES).toHaveLength(184)
    expect(new Set(OPENROUTER_TRANSCRIPTION_LANGUAGES).size).toBe(184)
    expect([...OPENROUTER_TRANSCRIPTION_LANGUAGES].sort()).toEqual(
      OPENROUTER_TRANSCRIPTION_LANGUAGES,
    )
  })

  it('prioritizes English, Turkish, and other common transcription languages', () => {
    expect(ORDERED_OPENROUTER_TRANSCRIPTION_LANGUAGES.slice(0, 2)).toEqual(['en', 'tr'])
    expect(ORDERED_OPENROUTER_TRANSCRIPTION_LANGUAGES).toHaveLength(184)
    expect(new Set(ORDERED_OPENROUTER_TRANSCRIPTION_LANGUAGES).size).toBe(184)
    expect(
      OPENROUTER_FEATURED_TRANSCRIPTION_LANGUAGES.every((language) =>
        OPENROUTER_TRANSCRIPTION_LANGUAGES.includes(language),
      ),
    ).toBe(true)
  })
})

describe('parseOpenRouterCatalog', () => {
  it('normalizes duration prices and sorts models from cheapest to most expensive', () => {
    const models = parseOpenRouterCatalog({
      data: [
        makeModel('minute', 'Minute model', '0.003', '/minute'),
        makeModel('hour', 'Hour model', '0.04', '/hour'),
        makeModel('second', 'Second model', '0.000035', '/second'),
      ],
    })

    expect(models).toEqual([
      { id: 'hour', name: 'Hour model', hourlyPriceUsd: 0.04 },
      { id: 'second', name: 'Second model', hourlyPriceUsd: 0.126 },
      { id: 'minute', name: 'Minute model', hourlyPriceUsd: 0.18 },
    ])
  })

  it('excludes token, character, request, and non-transcription models', () => {
    const models = parseOpenRouterCatalog({
      data: [
        makeModel('tokens', 'Token model', '0.000005', '/M tokens'),
        makeModel('characters', 'Character model', '0.01', '/M characters'),
        makeModel('request', 'Request model', '0.1', '/request'),
        { ...makeModel('image', 'Image model', '0.02', '/second'), output_modalities: ['image'] },
      ],
    })

    expect(models).toEqual([])
  })
})

/** Creates one minimal frontend-catalog model fixture. */
function makeModel(id: string, name: string, price: string, unitLabel: string) {
  return {
    slug: id,
    name,
    output_modalities: ['transcription'],
    endpoint: {
      display_pricing: [{ kind: 'unit', sku_label: 'Audio', price, unitLabel }],
    },
  }
}
