/**
 * Provides consistent formatting helpers for transcript timestamps and summaries.
 */

import type { TimeFormat, SessionDocument, SessionSummary } from '@shared/types'

/** Formats elapsed milliseconds as mm:ss or hh:mm:ss. */
export const formatDuration = (milliseconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts = [minutes.toString().padStart(2, '0'), seconds.toString().padStart(2, '0')]
  if (hours > 0) parts.unshift(hours.toString().padStart(2, '0'))
  return parts.join(':')
}

/** Formats a stored ISO date as DD.MM.YYYY with the preferred 12- or 24-hour clock. */
export const formatDate = (isoDate: string, timeFormat: TimeFormat): string => {
  const date = new Date(isoDate)
  const day = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const year = String(date.getFullYear()).slice(2)
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const localHours = date.getHours()

  if (timeFormat === '12-hour') {
    const hours = (localHours % 12 || 12).toString().padStart(2, '0')
    const period = localHours >= 12 ? 'PM' : 'AM'
    return `${day}.${month}.${year} ${hours}:${minutes} ${period}`
  }

  return `${day}.${month}.${year} ${localHours.toString().padStart(2, '0')}:${minutes}`
}

/** Converts a complete session into a compact history summary. */
export const toSessionSummary = (session: SessionDocument): SessionSummary => ({
  id: session.id,
  title: session.title,
  isDefaultTitle: session.isDefaultTitle,
  language: session.language,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  durationMs: session.durationMs,
  segmentCount: session.segments.length,
  preview: session.segments
    .map((segment) => segment.text)
    .join(' ')
    .slice(0, 140),
})
