/**
 * Converts untrusted Deepgram payloads into renderer-safe transcript events.
 */

import type { AudioSource, TranscriptResultEvent } from '@shared/types'

interface DeepgramMessage {
  type?: string
  is_final?: boolean
  speech_final?: boolean
  channel?: { alternatives?: Array<{ transcript?: string; confidence?: number }> }
}

/** Parses one Deepgram text frame and ignores non-transcript messages. */
export const parseDeepgramMessage = (
  source: AudioSource,
  rawMessage: string,
): TranscriptResultEvent | null => {
  let message: DeepgramMessage
  try {
    message = JSON.parse(rawMessage) as DeepgramMessage
  } catch {
    return null
  }
  if (message.type !== 'Results') return null
  const alternative = message.channel?.alternatives?.[0]
  const text = alternative?.transcript?.trim()
  if (!text) return null
  return {
    source,
    text,
    isFinal: message.is_final === true || message.speech_final === true,
    speechFinal: message.speech_final === true,
    confidence: Math.min(1, Math.max(0, alternative?.confidence ?? 0)),
  }
}
