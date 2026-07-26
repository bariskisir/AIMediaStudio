/**
 * Finds completed sentences and maps their character ranges back to durable source segments.
 */

import type { TranscriptSegment } from '@shared/types'

export interface CompletedTranscriptSentence {
  text: string
  startIndex: number
  endIndex: number
  sourceSegmentIds: string[]
}

export interface TranscriptSentenceMatchOptions {
  startIndex?: number
  includeTrailing?: boolean
}

interface SegmentRange {
  id: string
  startIndex: number
  endIndex: number
}

const SENTENCE_ENDINGS = new Set(['.', '!', '?'])
const CLOSING_MARKS = new Set(['"', "'", ')', ']', '}'])

/** Joins final segments exactly as the renderer does and records each segment's text range. */
const renderSegments = (
  segments: TranscriptSegment[],
): { text: string; ranges: SegmentRange[] } => {
  let text = ''
  const ranges: SegmentRange[] = []

  segments.forEach((segment) => {
    const segmentText = segment.text.trim()
    if (!segmentText) return
    if (text) text += ' '
    const startIndex = text.length
    text += segmentText
    ranges.push({ id: segment.id, startIndex, endIndex: text.length })
  })

  return { text, ranges }
}

/** Builds one trimmed sentence match and resolves every overlapping durable segment. */
const createSentenceMatch = (
  text: string,
  ranges: SegmentRange[],
  startIndex: number,
  endIndex: number,
): CompletedTranscriptSentence | null => {
  let trimmedStart = startIndex
  while (trimmedStart < endIndex && /\s/u.test(text[trimmedStart] ?? '')) trimmedStart += 1
  const sentenceText = text.slice(trimmedStart, endIndex).trim()
  if (!sentenceText) return null
  return {
    text: sentenceText,
    startIndex: trimmedStart,
    endIndex,
    sourceSegmentIds: ranges
      .filter((range) => range.endIndex > trimmedStart && range.startIndex < endIndex)
      .map((range) => range.id),
  }
}

/** Extracts punctuation-complete sentences with source segment identifiers for hover mapping. */
export const findCompletedTranscriptSentences = (
  segments: TranscriptSegment[],
  options: TranscriptSentenceMatchOptions = {},
): CompletedTranscriptSentence[] => {
  const { text, ranges } = renderSegments(segments)
  const sentences: CompletedTranscriptSentence[] = []
  let sentenceStart = Math.min(Math.max(0, options.startIndex ?? 0), text.length)
  let index = sentenceStart

  while (index < text.length) {
    if (!SENTENCE_ENDINGS.has(text[index] ?? '')) {
      index += 1
      continue
    }

    let sentenceEnd = index + 1
    while (sentenceEnd < text.length && CLOSING_MARKS.has(text[sentenceEnd] ?? '')) {
      sentenceEnd += 1
    }
    if (sentenceEnd < text.length && !/\s/u.test(text[sentenceEnd] ?? '')) {
      index = sentenceEnd
      continue
    }

    const sentence = createSentenceMatch(text, ranges, sentenceStart, sentenceEnd)
    if (sentence) sentences.push(sentence)

    sentenceStart = sentenceEnd
    while (sentenceStart < text.length && /\s/u.test(text[sentenceStart] ?? '')) {
      sentenceStart += 1
    }
    index = sentenceStart
  }

  if (options.includeTrailing && sentenceStart < text.length) {
    const trailing = createSentenceMatch(text, ranges, sentenceStart, text.length)
    if (trailing) sentences.push(trailing)
  }

  return sentences
}
