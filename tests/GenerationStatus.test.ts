/**
 * Verifies generation lifecycle classification used by global submission locking.
 */

import { describe, expect, it } from 'vitest'
import { isActiveGenerationStatus } from '../src/renderer/src/utils/generationStatus'

describe('generation status', () => {
  it('locks only while a generation can still produce an output', () => {
    expect(isActiveGenerationStatus('submitting')).toBe(true)
    expect(isActiveGenerationStatus('pending')).toBe(true)
    expect(isActiveGenerationStatus('in_progress')).toBe(true)
    expect(isActiveGenerationStatus('completed')).toBe(false)
    expect(isActiveGenerationStatus('failed')).toBe(false)
    expect(isActiveGenerationStatus(undefined)).toBe(false)
  })
})
