/**
 * Verifies byte-range parsing used for repeatable video playback and seeking.
 */

import { describe, expect, it } from 'vitest'
import { parseMediaByteRange } from '../src/main/services/MediaRange'

describe('parseMediaByteRange', () => {
  it('parses bounded, open-ended, and suffix byte ranges', () => {
    expect(parseMediaByteRange('bytes=100-199', 1_000)).toEqual({ start: 100, end: 199 })
    expect(parseMediaByteRange('bytes=900-', 1_000)).toEqual({ start: 900, end: 999 })
    expect(parseMediaByteRange('bytes=-100', 1_000)).toEqual({ start: 900, end: 999 })
  })

  it('clamps valid end offsets and rejects unsatisfiable ranges', () => {
    expect(parseMediaByteRange('bytes=900-1200', 1_000)).toEqual({ start: 900, end: 999 })
    expect(parseMediaByteRange('bytes=1000-', 1_000)).toBeNull()
    expect(parseMediaByteRange('bytes=0-1,4-5', 1_000)).toBeNull()
  })
})
