/**
 * Verifies actionable wording for asynchronous video failures.
 */

import { describe, expect, it } from 'vitest'
import { toActionableVideoError } from '../src/shared/video'

describe('toActionableVideoError', () => {
  it('explains transient upstream server failures', () => {
    expect(toActionableVideoError('Internal Server Error (HTTP 500)')).toBe(
      'The video provider is temporarily unavailable (HTTP 500). Wait a moment and try again, or choose another video model.',
    )
  })

  it('keeps the safety-filter guidance for filtered prompts', () => {
    expect(toActionableVideoError('Video generation completed without an output')).toContain(
      'safety filter rejected the prompt',
    )
  })

  it('passes through unrelated provider messages', () => {
    expect(toActionableVideoError('Video generation exceeded the maximum polling period.')).toBe(
      'Video generation exceeded the maximum polling period.',
    )
  })
})
