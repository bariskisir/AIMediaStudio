/**
 * Renders session documents into portable text and lossless JSON formats.
 */

import type { SessionDocument, SessionFormat } from '@shared/types'
import type { TranslationProvider, TranslationTargetLanguage } from '@shared/translation'

/** Formats a millisecond offset as an elapsed timestamp. */
const formatTimestamp = (offsetMs: number): string => {
  const totalSeconds = Math.floor(offsetMs / 1000)
  return `${Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0')}:${(totalSeconds % 60).toString().padStart(2, '0')}`
}

/** Renders one session in the requested export format. */
export const renderSession = (
  session: SessionDocument,
  format: SessionFormat,
  includeTranslation = false,
  provider: TranslationProvider = 'google',
  targetLanguage: TranslationTargetLanguage = 'tr',
): string => {
  if (format === 'json') return `${JSON.stringify(session, null, 2)}\n`
  const lines = session.segments.map((segment) => {
    const source = segment.source === 'microphone' ? 'Microphone' : 'Speaker'
    return `[${formatTimestamp(segment.offsetMs)}] ${source}: ${segment.text}`
  })
  const source = `${session.title}\n${'='.repeat(session.title.length)}\n\n${lines.join('\n')}\n`
  if (!includeTranslation) return source

  const translatedText = [...session.translations]
    .filter(
      (translation) =>
        translation.provider === provider && translation.targetLanguage === targetLanguage,
    )
    .sort((left, right) => left.sourceStartIndex - right.sourceStartIndex)
    .map((translation) => translation.text.trim())
    .filter(Boolean)
    .join(' ')
  if (!translatedText) return source

  const heading = `Translation (${targetLanguage})`
  return `${source}\n${heading}\n${'='.repeat(heading.length)}\n\n${translatedText}\n`
}
