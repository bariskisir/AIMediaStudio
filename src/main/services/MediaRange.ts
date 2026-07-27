/**
 * Parses single HTTP byte ranges used by Chromium media playback and seeking.
 */

export interface MediaByteRange {
  start: number
  end: number
}

/** Parses one satisfiable byte range and rejects malformed or multi-range requests. */
export const parseMediaByteRange = (header: string, fileSize: number): MediaByteRange | null => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || fileSize <= 0) return null
  const [, startText = '', endText = ''] = match
  if (!startText && !endText) return null
  if (!startText) {
    const suffixLength = Number(endText)
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(0, fileSize - suffixLength), end: fileSize - 1 }
  }
  const start = Number(startText)
  const requestedEnd = endText ? Number(endText) : fileSize - 1
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(requestedEnd) ||
    start < 0 ||
    start >= fileSize ||
    requestedEnd < start
  ) {
    return null
  }
  return { start, end: Math.min(requestedEnd, fileSize - 1) }
}
