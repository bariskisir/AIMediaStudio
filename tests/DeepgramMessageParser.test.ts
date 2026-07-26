/**
 * Verifies that parseDeepgramMessage correctly parses interim and final
 * transcript messages, ignores non-Results messages, and handles malformed input.
 */

import { describe, expect, it } from 'vitest'
import { parseDeepgramMessage } from '../src/main/services/DeepgramMessageParser'

function makeResultsMessage(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'Results',
    channel: {
      alternatives: [
        {
          transcript: 'hello world',
          confidence: 0.98,
        },
      ],
    },
    ...overrides,
  })
}

describe('parseDeepgramMessage', () => {
  describe('valid Results messages', () => {
    it('parses a final transcript message', () => {
      const message = makeResultsMessage({
        is_final: true,
        channel: {
          alternatives: [{ transcript: 'Hello world.', confidence: 0.95 }],
        },
      })
      const result = parseDeepgramMessage('microphone', message)
      expect(result).not.toBeNull()
      expect(result?.text).toBe('Hello world.')
      expect(result?.isFinal).toBe(true)
      expect(result?.source).toBe('microphone')
    })

    it('parses a speech_final transcript message', () => {
      const message = makeResultsMessage({
        speech_final: true,
        channel: {
          alternatives: [{ transcript: 'Final utterance.', confidence: 0.9 }],
        },
      })
      const result = parseDeepgramMessage('speaker', message)
      expect(result).not.toBeNull()
      expect(result?.text).toBe('Final utterance.')
      expect(result?.speechFinal).toBe(true)
      expect(result?.isFinal).toBe(true)
    })

    it('parses an interim transcript message', () => {
      const message = makeResultsMessage({
        is_final: false,
        speech_final: false,
        channel: {
          alternatives: [{ transcript: 'partial text', confidence: 0.5 }],
        },
      })
      const result = parseDeepgramMessage('microphone', message)
      expect(result).not.toBeNull()
      expect(result?.isFinal).toBe(false)
      expect(result?.speechFinal).toBe(false)
      expect(result?.text).toBe('partial text')
    })

    it('trims whitespace from transcript', () => {
      const message = makeResultsMessage({
        channel: {
          alternatives: [{ transcript: '   padded text   ', confidence: 0.8 }],
        },
      })
      const result = parseDeepgramMessage('microphone', message)
      expect(result).not.toBeNull()
      expect(result?.text).toBe('padded text')
    })

    it('clamps confidence to 0-1 range', () => {
      const messageHigh = makeResultsMessage({
        channel: {
          alternatives: [{ transcript: 'high', confidence: 1.5 }],
        },
      })
      const resultHigh = parseDeepgramMessage('microphone', messageHigh)
      expect(resultHigh?.confidence).toBe(1)

      const messageLow = makeResultsMessage({
        channel: {
          alternatives: [{ transcript: 'low', confidence: -0.5 }],
        },
      })
      const resultLow = parseDeepgramMessage('microphone', messageLow)
      expect(resultLow?.confidence).toBe(0)
    })

    it('uses confidence 0 when alternatives lack confidence', () => {
      const message = makeResultsMessage({
        channel: {
          alternatives: [{ transcript: 'no confidence' }],
        },
      })
      const result = parseDeepgramMessage('microphone', message)
      expect(result).not.toBeNull()
      expect(result?.confidence).toBe(0)
    })

    it('preserves the source field', () => {
      const message = makeResultsMessage({ is_final: true })
      const micResult = parseDeepgramMessage('microphone', message)
      const speakerResult = parseDeepgramMessage('speaker', message)
      expect(micResult?.source).toBe('microphone')
      expect(speakerResult?.source).toBe('speaker')
    })
  })

  describe('non-Results messages', () => {
    it('returns null for a KeepAlive message', () => {
      const message = JSON.stringify({ type: 'KeepAlive' })
      const result = parseDeepgramMessage('microphone', message)
      expect(result).toBeNull()
    })

    it('returns null for a Metadata message', () => {
      const message = JSON.stringify({ type: 'Metadata', duration: 1.2 })
      const result = parseDeepgramMessage('speaker', message)
      expect(result).toBeNull()
    })

    it('returns null for a message without a type field', () => {
      const message = JSON.stringify({ channel: { alternatives: [] } })
      const result = parseDeepgramMessage('microphone', message)
      expect(result).toBeNull()
    })

    it('returns null for a Results message with empty transcript', () => {
      const message = makeResultsMessage({
        channel: {
          alternatives: [{ transcript: '' }],
        },
      })
      const result = parseDeepgramMessage('microphone', message)
      expect(result).toBeNull()
    })

    it('returns null for a Results message with whitespace-only transcript', () => {
      const message = makeResultsMessage({
        channel: {
          alternatives: [{ transcript: '   ' }],
        },
      })
      const result = parseDeepgramMessage('microphone', message)
      expect(result).toBeNull()
    })

    it('returns null for a Results message with no channel', () => {
      const message = JSON.stringify({ type: 'Results' })
      const result = parseDeepgramMessage('microphone', message)
      expect(result).toBeNull()
    })

    it('returns null for a Results message with no alternatives', () => {
      const message = JSON.stringify({
        type: 'Results',
        channel: { alternatives: [] },
      })
      const result = parseDeepgramMessage('microphone', message)
      expect(result).toBeNull()
    })
  })

  describe('malformed input', () => {
    it('returns null for invalid JSON', () => {
      const result = parseDeepgramMessage('microphone', 'not valid json {{{')
      expect(result).toBeNull()
    })

    it('returns null for an empty string', () => {
      const result = parseDeepgramMessage('microphone', '')
      expect(result).toBeNull()
    })

    it('returns null for a non-JSON string', () => {
      const result = parseDeepgramMessage('microphone', 'just some text')
      expect(result).toBeNull()
    })

    it('returns null for a JSON array', () => {
      const result = parseDeepgramMessage('microphone', '[1, 2, 3]')
      expect(result).toBeNull()
    })

    it('returns null for a JSON number', () => {
      const result = parseDeepgramMessage('microphone', '42')
      expect(result).toBeNull()
    })
  })
})
