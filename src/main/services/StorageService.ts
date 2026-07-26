/**
 * Stores validated settings and sessions through serialized direct JSON file access.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AUDIO_SOURCES,
  type AppSettings,
  type AppSettingsPatch,
  type DeleteSessionResult,
  type SessionDocument,
  type TranscriptSegment,
  type SessionSummary,
  type TranslationSegment,
} from '@shared/types'
import { TRANSLATION_PROVIDERS, TRANSLATION_TARGET_LANGUAGES } from '@shared/translation'
import { z } from 'zod'
import { parsePersistedSettings, settingsSchema } from '../settingsSchema'

const segmentSchema = z.object({
  id: z.uuid(),
  source: z.enum(AUDIO_SOURCES),
  text: z.string(),
  confidence: z.number().min(0).max(1),
  createdAt: z.iso.datetime(),
  offsetMs: z.number().nonnegative(),
})

const translationSchema = z
  .object({
    id: z.uuid(),
    provider: z.enum(TRANSLATION_PROVIDERS),
    sourceText: z.string().trim().min(1).max(20_000),
    text: z.string().trim().min(1).max(20_000),
    sourceLanguage: z.string().trim().min(1).max(24),
    targetLanguage: z.enum(TRANSLATION_TARGET_LANGUAGES),
    sourceSegmentIds: z.array(z.uuid()).min(1).max(200),
    sourceStartIndex: z.number().int().nonnegative(),
    sourceEndIndex: z.number().int().positive(),
    createdAt: z.iso.datetime(),
  })
  .refine((translation) => translation.sourceEndIndex > translation.sourceStartIndex, {
    path: ['sourceEndIndex'],
    message: 'Translation source range must have a positive length.',
  })

const sessionSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(200),
  isDefaultTitle: z.boolean(),
  language: z.string().min(1).max(24),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  durationMs: z.number().nonnegative(),
  segments: z.array(segmentSchema),
  translations: z.array(translationSchema),
})

const DEFAULT_SESSION_TITLE = 'New Session'
const LEGACY_DEFAULT_TITLE_PATTERN = /^\d{4}-\d{2}-\d{2}\s*(?:\u00b7|\.|T)\s*\d{2}:\d{2}$/

/** Rewrites source names from the first Electron schema before domain validation. */
const migrateSession = (input: unknown): unknown => {
  if (!input || typeof input !== 'object') return input
  const session = input as Record<string, unknown>
  if (!Array.isArray(session.segments)) return input
  const segments = session.segments as unknown[]
  const hasLegacyDefaultTitle =
    typeof session.title === 'string' &&
    (session.title === DEFAULT_SESSION_TITLE || LEGACY_DEFAULT_TITLE_PATTERN.test(session.title))
  const isDefaultTitle =
    typeof session.isDefaultTitle === 'boolean' ? session.isDefaultTitle : hasLegacyDefaultTitle
  return {
    ...session,
    title:
      isDefaultTitle &&
      typeof session.title === 'string' &&
      LEGACY_DEFAULT_TITLE_PATTERN.test(session.title)
        ? DEFAULT_SESSION_TITLE
        : session.title,
    isDefaultTitle,
    translations: Array.isArray(session.translations)
      ? session.translations.map((translation): unknown => {
          if (!translation || typeof translation !== 'object') return translation
          const value = translation as Record<string, unknown>
          return { provider: 'google', ...value }
        })
      : [],
    segments: segments.map((segment): unknown => {
      if (!segment || typeof segment !== 'object') return segment
      const value = segment as Record<string, unknown>
      return value.source === 'system' ? { ...value, source: 'speaker' } : value
    }),
  }
}

/** Rejects identifiers that could escape the session directory. */
const assertSessionId = (id: string): void => {
  if (!z.uuid().safeParse(id).success) throw new Error('Invalid session identifier.')
}

export default class StorageService {
  private readonly settingsPath: string
  private readonly sessionsPath: string
  private readonly fileOperationTails = new Map<string, Promise<void>>()

  /** Creates a storage service rooted in the private application data directory. */
  public constructor(private readonly rootPath: string) {
    this.settingsPath = join(rootPath, 'settings.json')
    this.sessionsPath = join(rootPath, 'sessions')
  }

  /** Creates required directories and removes obsolete temporary files from previous versions. */
  public async initialize(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true })
    await mkdir(this.sessionsPath, { recursive: true })
    await Promise.all([
      this.removeObsoleteTemporaryFiles(this.rootPath),
      this.removeObsoleteTemporaryFiles(this.sessionsPath),
    ])
  }

  /** Loads validated settings or safe defaults for missing or malformed data. */
  public async loadSettings(): Promise<AppSettings> {
    return this.withFileLock(this.settingsPath, () => this.readSettingsUnlocked())
  }

  /** Reads settings while its caller owns the settings-file operation lock. */
  private async readSettingsUnlocked(): Promise<AppSettings> {
    try {
      const value: unknown = JSON.parse(await readFile(this.settingsPath, 'utf8'))
      return parsePersistedSettings(value)
    } catch {
      return parsePersistedSettings(null)
    }
  }

  /** Validates and writes application settings directly to their JSON file. */
  public async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const validated = settingsSchema.parse(settings)
    await this.writeJsonFile(this.settingsPath, validated)
    return validated
  }

  /** Atomically merges changed fields into the latest validated settings document. */
  public async updateSettings(patch: AppSettingsPatch): Promise<AppSettings> {
    return this.withFileLock(this.settingsPath, async () => {
      const current = await this.readSettingsUnlocked()
      const deepgramPatch = patch.transcriptionProviderSettings?.deepgram
      const openRouterPatch = patch.transcriptionProviderSettings?.openrouter
      const validated = settingsSchema.parse({
        ...current,
        ...patch,
        transcriptionProviderSettings:
          deepgramPatch || openRouterPatch
            ? {
                ...current.transcriptionProviderSettings,
                deepgram: {
                  ...current.transcriptionProviderSettings.deepgram,
                  ...deepgramPatch,
                },
                openrouter: {
                  ...current.transcriptionProviderSettings.openrouter,
                  ...openRouterPatch,
                },
              }
            : current.transcriptionProviderSettings,
      })
      await this.writeJsonFileUnlocked(this.settingsPath, validated)
      return validated
    })
  }

  /** Creates a new empty session. */
  public async createSession(language: string, title?: string): Promise<SessionDocument> {
    const now = new Date()
    const normalizedTitle = title?.trim().slice(0, 200)
    const session: SessionDocument = {
      id: randomUUID(),
      title: normalizedTitle || DEFAULT_SESSION_TITLE,
      isDefaultTitle: !normalizedTitle,
      language,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      durationMs: 0,
      segments: [],
      translations: [],
    }
    await this.writeSession(session)
    return session
  }

  /** Adds one final source-attributed segment to a session. */
  public async appendSegment(id: string, segment: TranscriptSegment): Promise<void> {
    await this.appendSegments(id, [segment])
  }

  /** Adds a batch of final segments within one serialized read-modify-write operation. */
  public async appendSegments(id: string, segments: TranscriptSegment[]): Promise<void> {
    if (segments.length === 0) return
    const validatedSegments = segments.map((segment) => segmentSchema.parse(segment))
    await this.updateSession(id, (session) => {
      session.segments.push(...validatedSegments)
      session.updatedAt = new Date().toISOString()
    })
  }

  /** Adds one validated sentence translation without duplicating its source-language pair. */
  public async appendTranslation(id: string, translation: TranslationSegment): Promise<void> {
    const validatedTranslation = translationSchema.parse(translation)
    await this.updateSession(id, (session) => {
      const duplicate = session.translations.some(
        (candidate) =>
          candidate.sourceEndIndex === validatedTranslation.sourceEndIndex &&
          candidate.provider === validatedTranslation.provider &&
          candidate.sourceLanguage === validatedTranslation.sourceLanguage &&
          candidate.targetLanguage === validatedTranslation.targetLanguage,
      )
      if (duplicate) return
      session.translations.push(validatedTranslation)
      session.updatedAt = new Date().toISOString()
    })
  }

  /** Finalizes a session with its total recording duration. */
  public async finishSession(id: string, durationMs: number): Promise<SessionDocument> {
    return this.updateSession(id, (session) => {
      session.durationMs = Math.max(0, Math.round(durationMs))
      session.updatedAt = new Date().toISOString()
    })
  }

  /** Loads and validates one complete session. */
  public async getSession(id: string): Promise<SessionDocument> {
    assertSessionId(id)
    const filePath = this.sessionPath(id)
    return this.withFileLock(filePath, () => this.readSessionUnlocked(filePath))
  }

  /** Lists compact session summaries in reverse chronological order. */
  public async listSessions(): Promise<SessionSummary[]> {
    const entries = await readdir(this.sessionsPath, { withFileTypes: true })
    const documents = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => this.tryReadSession(join(this.sessionsPath, entry.name))),
    )

    return documents
      .filter((document): document is SessionDocument => document !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((document) => ({
        id: document.id,
        title: document.title,
        isDefaultTitle: document.isDefaultTitle,
        language: document.language,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        durationMs: document.durationMs,
        segmentCount: document.segments.length,
        preview: document.segments
          .map((segment) => segment.text)
          .join(' ')
          .slice(0, 140),
      }))
  }

  /** Renames a session within the same serialized file operation used by live writes. */
  public async renameSession(id: string, title: string): Promise<SessionDocument> {
    const normalizedTitle = title.trim().slice(0, 200)
    if (!normalizedTitle) throw new Error('Session title cannot be empty.')
    return this.updateSession(id, (session) => {
      session.title = normalizedTitle
      session.isDefaultTitle = false
      session.updatedAt = new Date().toISOString()
    })
  }

  /** Deletes a session while preserving one non-deletable empty workspace. */
  public async deleteSession(id: string): Promise<DeleteSessionResult> {
    assertSessionId(id)
    return this.withFileLock(this.sessionsPath, () => this.deleteSessionUnlocked(id))
  }

  /** Performs one deletion while holding the workspace-wide history lock. */
  private async deleteSessionUnlocked(id: string): Promise<DeleteSessionResult> {
    const sessions = await this.listSessions()
    const target = sessions.find((session) => session.id === id)
    if (!target) return { deleted: false }
    if (sessions.length === 1 && target.segmentCount === 0) return { deleted: false }

    const replacement =
      sessions.length === 1 ? await this.createSession(target.language) : undefined
    const filePath = this.sessionPath(id)
    try {
      await this.withFileLock(filePath, () => unlink(filePath))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (replacement) await unlink(this.sessionPath(replacement.id)).catch(() => undefined)
        throw error
      }
    }
    return replacement ? { deleted: true, replacement } : { deleted: true }
  }

  /** Reads one session while tolerating malformed history entries. */
  private async tryReadSession(filePath: string): Promise<SessionDocument | null> {
    try {
      return await this.withFileLock(filePath, () => this.readSessionUnlocked(filePath))
    } catch {
      return null
    }
  }

  /** Applies one session mutation without allowing another operation to interleave. */
  private async updateSession(
    id: string,
    update: (session: SessionDocument) => void,
  ): Promise<SessionDocument> {
    assertSessionId(id)
    const filePath = this.sessionPath(id)
    return this.withFileLock(filePath, async () => {
      const session = await this.readSessionUnlocked(filePath)
      update(session)
      const validated = sessionSchema.parse(session)
      await this.writeJsonFileUnlocked(filePath, validated)
      return validated
    })
  }

  /** Validates and writes a complete session document. */
  private async writeSession(session: SessionDocument): Promise<void> {
    const validated = sessionSchema.parse(session)
    await this.writeJsonFile(this.sessionPath(validated.id), validated)
  }

  /** Reads a session while its caller owns the file-operation lock. */
  private async readSessionUnlocked(filePath: string): Promise<SessionDocument> {
    const value: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    return sessionSchema.parse(migrateSession(value))
  }

  /** Resolves a validated session identifier to its JSON file. */
  private sessionPath(id: string): string {
    return join(this.sessionsPath, `${id}.json`)
  }

  /** Serializes and writes one JSON value directly to its destination file. */
  private async writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await this.withFileLock(filePath, () => this.writeJsonFileUnlocked(filePath, value))
  }

  /** Writes one complete JSON payload while its caller owns the file-operation lock. */
  private async writeJsonFileUnlocked(filePath: string, value: unknown): Promise<void> {
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }

  /** Runs one operation after every earlier operation targeting the same file. */
  private async withFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.fileOperationTails.get(filePath) ?? Promise.resolve()
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => gate)
    this.fileOperationTails.set(filePath, tail)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.fileOperationTails.get(filePath) === tail) this.fileOperationTails.delete(filePath)
    }
  }

  /** Removes only obsolete temporary files created by pre-v3 direct-write builds. */
  private async removeObsoleteTemporaryFiles(directoryPath: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    await Promise.allSettled(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.tmp'))
        .map((entry) => unlink(join(directoryPath, entry.name))),
    )
  }
}
