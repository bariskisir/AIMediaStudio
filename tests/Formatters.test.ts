/**
 * Verifies the shared date and duration formatting helpers.
 */

import { describe, expect, it } from 'vitest'
import { formatDate, formatDuration } from '../src/renderer/src/utils/formatters'

describe('formatDuration', () => {
  it('formats zero milliseconds as 00:00', () => {
    expect(formatDuration(0)).toBe('00:00')
  })

  it('formats less than one minute as mm:ss', () => {
    expect(formatDuration(45_000)).toBe('00:45')
  })

  it('formats exactly one minute as 01:00', () => {
    expect(formatDuration(60_000)).toBe('01:00')
  })

  it('formats over an hour as hh:mm:ss', () => {
    expect(formatDuration(3_660_000)).toBe('01:01:00')
  })

  it('handles negative input by clamping to zero', () => {
    expect(formatDuration(-5_000)).toBe('00:00')
  })
})

describe('formatDate', () => {
  const isoDate = '2026-12-25T14:30:00.000Z'

  it('formats a 24-hour timestamp without an AM/PM suffix', () => {
    const result = formatDate(isoDate, '24-hour')
    expect(result).not.toContain('AM')
    expect(result).not.toContain('PM')
    expect(result).toMatch(/^\d{2}\.\d{2}\.\d{2} \d{2}:\d{2}$/)
  })

  it('formats a 12-hour timestamp with an AM or PM suffix', () => {
    const result = formatDate(isoDate, '12-hour')
    expect(result).toMatch(/^\d{2}\.\d{2}\.\d{2} \d{2}:\d{2} (AM|PM)$/)
  })

  it('formats midnight as 12:xx AM in 12-hour mode', () => {
    const date = new Date(2026, 11, 25, 0, 15, 0) // midnight local time
    const result = formatDate(date.toISOString(), '12-hour')
    expect(result).toContain('12:')
    expect(result).toContain('AM')
  })

  it('formats noon as 12:xx PM in 12-hour mode', () => {
    const date = new Date(2026, 11, 25, 12, 0, 0) // noon local time
    const result = formatDate(date.toISOString(), '12-hour')
    expect(result).toContain('12:')
    expect(result).toContain('PM')
  })
})
