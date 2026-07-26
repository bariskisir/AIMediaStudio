/**
 * Verifies that renderSession produces valid JSON, timestamped TXT output,
 * and correctly includes or omits translation sections based on flags.
 */

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { renderSession } from '../src/main/services/ExportService'
import type { SessionDocument, TranscriptSegment, TranslationSegment } from '../src/shared/types'

function makeSegment(overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    id: randomUUID(),
    source: 'microphone',
    text: 'hello world',
    confidence: 0.95,
    createdAt: new Date().toISOString(),
    offsetMs: 0,
    ...overrides,
  }
}

function makeTranslation(overrides: Partial<TranslationSegment> = {}): TranslationSegment {
  return {
    id: randomUUID(),
    provider: 'google',
    sourceText: 'hello world',
    text: 'merhaba dunya',
    sourceLanguage: 'en',
    targetLanguage: 'tr',
    sourceSegmentIds: [randomUUID()],
    sourceStartIndex: 0,
    sourceEndIndex: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeBasicSession(overrides: Partial<SessionDocument> = {}): SessionDocument {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    title: 'Test Session',
    isDefaultTitle: false,
    language: 'en',
    createdAt: now,
    updatedAt: now,
    durationMs: 0,
    segments: [],
    translations: [],
    ...overrides,
  }
}

describe('renderSession', () => {
  describe('JSON export', () => {
    it('produces valid JSON', () => {
      const session = makeBasicSession()
      const output = renderSession(session, 'json')
      expect(() => JSON.parse(output)).not.toThrow()
    })

    it('serialises all session fields', () => {
      const session = makeBasicSession({
        segments: [makeSegment({ text: 'test' })],
      })
      const output = renderSession(session, 'json')
      const parsed = JSON.parse(output)
      expect(parsed.id).toBe(session.id)
      expect(parsed.title).toBe(session.title)
      expect(parsed.language).toBe(session.language)
      expect(parsed.segments).toHaveLength(1)
      expect(parsed.translations).toEqual([])
    })

    it('includes translation data in the JSON object', () => {
      const session = makeBasicSession({
        translations: [makeTranslation({ text: 'translated' })],
      })
      const output = renderSession(session, 'json')
      const parsed = JSON.parse(output)
      expect(parsed.translations).toHaveLength(1)
      expect(parsed.translations[0].text).toBe('translated')
    })
  })

  describe('TXT export', () => {
    it('includes the session title as a heading', () => {
      const session = makeBasicSession({ title: 'My Recording' })
      const output = renderSession(session, 'txt')
      expect(output).toContain('My Recording')
    })

    it('includes a title underline of equal signs', () => {
      const session = makeBasicSession({ title: 'Hi' })
      const output = renderSession(session, 'txt')
      expect(output).toContain('==')
    })

    it('includes timestamped segments', () => {
      const segments = [
        makeSegment({ text: 'Hello', source: 'microphone', offsetMs: 0 }),
        makeSegment({ text: 'World', source: 'microphone', offsetMs: 5000 }),
      ]
      const session = makeBasicSession({ segments })
      const output = renderSession(session, 'txt')
      expect(output).toContain('[00:00] Microphone: Hello')
      expect(output).toContain('[00:05] Microphone: World')
    })

    it('labels speaker source correctly', () => {
      const session = makeBasicSession({
        segments: [makeSegment({ text: 'Speaker text', source: 'speaker', offsetMs: 1000 })],
      })
      const output = renderSession(session, 'txt')
      expect(output).toContain('[00:01] Speaker: Speaker text')
    })

    it('formats mm:ss timestamps with zero padding', () => {
      const session = makeBasicSession({
        segments: [makeSegment({ text: 'T', offsetMs: 61_000 })],
      })
      const output = renderSession(session, 'txt')
      expect(output).toContain('[01:01]')
    })

    it('formats over one hour timestamps correctly', () => {
      const session = makeBasicSession({
        segments: [makeSegment({ text: 'Long', offsetMs: 3_660_000 })],
      })
      const output = renderSession(session, 'txt')
      expect(output).toContain('[61:00]')
    })
  })

  describe('translation inclusion', () => {
    it('does not include translation section when includeTranslation is false', () => {
      const session = makeBasicSession({
        translations: [makeTranslation({ text: 'ceviri' })],
      })
      const output = renderSession(session, 'txt', false)
      expect(output).not.toContain('Translation')
      expect(output).not.toContain('ceviri')
    })

    it('includes translation section when includeTranslation is true', () => {
      const session = makeBasicSession({
        translations: [makeTranslation({ text: 'ceviri metin', targetLanguage: 'tr' })],
      })
      const output = renderSession(session, 'txt', true, 'google', 'tr')
      expect(output).toContain('Translation (tr)')
      expect(output).toContain('ceviri metin')
    })

    it('filters translations by the specified provider', () => {
      const session = makeBasicSession({
        translations: [
          makeTranslation({ provider: 'google', text: 'google text' }),
          makeTranslation({ provider: 'bing', text: 'bing text' }),
        ],
      })
      const googleOutput = renderSession(session, 'txt', true, 'google')
      expect(googleOutput).toContain('google text')
      expect(googleOutput).not.toContain('bing text')

      const bingOutput = renderSession(session, 'txt', true, 'bing')
      expect(bingOutput).toContain('bing text')
      expect(bingOutput).not.toContain('google text')
    })

    it('filters translations by target language', () => {
      const session = makeBasicSession({
        translations: [
          makeTranslation({ targetLanguage: 'tr', text: 'turkce' }),
          makeTranslation({ targetLanguage: 'de', text: 'deutsch' }),
        ],
      })
      const output = renderSession(session, 'txt', true, 'google', 'de')
      expect(output).toContain('Translation (de)')
      expect(output).toContain('deutsch')
      expect(output).not.toContain('turkce')
    })

    it('omits translation heading when no matching translations exist', () => {
      const session = makeBasicSession()
      const output = renderSession(session, 'txt', true, 'google', 'tr')
      expect(output).not.toContain('Translation')
    })

    it('joins multiple translations in source order', () => {
      const t1 = makeTranslation({
        text: 'first',
        sourceStartIndex: 0,
        sourceEndIndex: 1,
      })
      const t2 = makeTranslation({
        text: 'second',
        sourceStartIndex: 1,
        sourceEndIndex: 2,
      })
      const session = makeBasicSession({ translations: [t2, t1] })
      const output = renderSession(session, 'txt', true, 'google', 'tr')
      const idx1 = output.indexOf('first')
      const idx2 = output.indexOf('second')
      expect(idx1).toBeLessThan(idx2)
    })
  })
})
