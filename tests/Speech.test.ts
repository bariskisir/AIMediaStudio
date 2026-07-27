/**
 * Verifies speech language option generation.
 */

import { describe, expect, it } from 'vitest'
import { createSpeechLanguageOptions } from '../src/shared/speech'

describe('speech helpers', () => {
  it('places automatic STT detection first and includes searchable language codes', () => {
    const options = createSpeechLanguageOptions('en')
    expect(options[0]).toEqual({ value: '', label: 'Automatic detection' })
    expect(options.find((option) => option.value === 'tr')?.label).toContain('(tr)')
    expect(options.find((option) => option.value === 'en')?.label).toContain('(en)')
  })
})
