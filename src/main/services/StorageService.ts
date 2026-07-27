/**
 * Persists validated settings and one-generation session documents in isolated JSON files.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { MEDIA_KINDS } from '@shared/openrouter'
import {
  GENERATION_STATUSES,
  DEFAULT_SETTINGS,
  type AppSettings,
  type AppSettingsPatch,
  type DeleteSessionResult,
  type GenerationItem,
  type SessionDocument,
  type SessionSummary,
} from '@shared/types'
import { z } from 'zod'
import { parsePersistedSettings, settingsSchema } from '../settingsSchema'

const mediaAssetSchema = z.object({
  id: z.uuid(),
  fileName: z.string().min(1).max(240),
  mediaType: z.string().min(1).max(100),
  size: z.number().int().nonnegative(),
  url: z.string().min(1).max(500),
})

const persistedAudioInputSchema = z.object({
  originalName: z.string().min(1).max(240),
  fileName: z.string().min(1).max(240),
  mediaType: z.string().min(1).max(100),
  format: z.enum(['wav', 'mp3', 'flac', 'm4a', 'ogg', 'webm', 'aac']),
  size: z.number().int().positive(),
})

const generationItemSchema = z.object({
  id: z.uuid(),
  kind: z.enum(MEDIA_KINDS),
  provider: z.literal('openrouter'),
  modelId: z.string().min(1).max(200),
  prompt: z.string().max(20_000),
  status: z.enum(GENERATION_STATUSES),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  options: z.record(z.string(), z.unknown()),
  assets: z.array(mediaAssetSchema).max(10),
  inputAudio: persistedAudioInputSchema.optional(),
  resultText: z.string().max(1_000_000).optional(),
  costUsd: z.number().nonnegative().optional(),
  error: z.string().max(4_000).optional(),
  remoteJobId: z.string().max(500).optional(),
  pollingUrl: z.url().optional(),
})

const sessionSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(200),
  isDefaultTitle: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  item: generationItemSchema.nullable(),
})

const DEFAULT_SESSION_TITLE = 'New Generation'

/** Rejects identifiers that could escape private application storage. */
const assertSessionId = (id: string): void => {
  if (!z.uuid().safeParse(id).success) throw new Error('Invalid session identifier.')
}

/** Converts one document to renderer-friendly history metadata. */
export const toSessionSummary = (document: SessionDocument): SessionSummary => ({
  id: document.id,
  title: document.title,
  isDefaultTitle: document.isDefaultTitle,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
  hasItem: document.item !== null,
  ...(document.item ? { mediaKind: document.item.kind, status: document.item.status } : {}),
  preview:
    (document.item?.kind === 'stt'
      ? document.item.resultText || document.item.inputAudio?.originalName
      : document.item?.prompt
    )?.slice(0, 140) ?? '',
})

export default class StorageService {
  private readonly settingsPath: string
  private readonly sessionsPath: string
  private readonly mediaPath: string
  private readonly operationTails = new Map<string, Promise<void>>()

  /** Creates a storage service rooted exclusively in AI Media Studio AppData. */
  public constructor(private readonly rootPath: string) {
    this.settingsPath = join(rootPath, 'settings.json')
    this.sessionsPath = join(rootPath, 'sessions')
    this.mediaPath = join(rootPath, 'media')
  }

  /** Creates the durable directory layout before other services access it. */
  public async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.rootPath, { recursive: true }),
      mkdir(this.sessionsPath, { recursive: true }),
      mkdir(this.mediaPath, { recursive: true }),
    ])
  }

  /** Returns the validated media root for protocol and asset services. */
  public getMediaRoot(): string {
    return this.mediaPath
  }

  /** Loads validated settings or new-application defaults. */
  public async loadSettings(): Promise<AppSettings> {
    return this.withLock(this.settingsPath, async () => {
      try {
        return parsePersistedSettings(JSON.parse(await readFile(this.settingsPath, 'utf8')))
      } catch {
        return parsePersistedSettings(null)
      }
    })
  }

  /** Merges nested provider settings without discarding another media mode. */
  public async updateSettings(patch: AppSettingsPatch): Promise<AppSettings> {
    return this.withLock(this.settingsPath, async () => {
      let current = structuredClone(DEFAULT_SETTINGS)
      try {
        current = parsePersistedSettings(JSON.parse(await readFile(this.settingsPath, 'utf8')))
      } catch {
        // Defaults are intentionally used when no durable settings exist.
      }
      const imagePatch = patch.image?.providers?.openrouter
      const videoPatch = patch.video?.providers?.openrouter
      const ttsPatch = patch.tts?.providers?.openrouter
      const sttPatch = patch.stt?.providers?.openrouter
      const next = settingsSchema.parse({
        ...current,
        ...patch,
        image: {
          provider: patch.image?.provider ?? current.image.provider,
          providers: {
            openrouter: { ...current.image.providers.openrouter, ...imagePatch },
          },
        },
        video: {
          provider: patch.video?.provider ?? current.video.provider,
          providers: {
            openrouter: { ...current.video.providers.openrouter, ...videoPatch },
          },
        },
        tts: {
          provider: patch.tts?.provider ?? current.tts.provider,
          providers: {
            openrouter: { ...current.tts.providers.openrouter, ...ttsPatch },
          },
        },
        stt: {
          provider: patch.stt?.provider ?? current.stt.provider,
          providers: {
            openrouter: { ...current.stt.providers.openrouter, ...sttPatch },
          },
        },
      })
      await this.writeJsonUnlocked(this.settingsPath, next)
      return next
    })
  }

  /** Creates one empty workspace so history is never structurally absent. */
  public async createSession(title?: string): Promise<SessionDocument> {
    const now = new Date().toISOString()
    const normalizedTitle = title?.trim().slice(0, 200)
    const document: SessionDocument = {
      id: randomUUID(),
      title: normalizedTitle || DEFAULT_SESSION_TITLE,
      isDefaultTitle: !normalizedTitle,
      createdAt: now,
      updatedAt: now,
      item: null,
    }
    await this.writeSession(document)
    return document
  }

  /** Loads one complete generation workspace. */
  public async getSession(id: string): Promise<SessionDocument> {
    assertSessionId(id)
    const filePath = this.sessionPath(id)
    return this.withLock(filePath, () => this.readSessionUnlocked(filePath))
  }

  /** Returns compact history entries with the most recently changed first. */
  public async listSessions(): Promise<SessionSummary[]> {
    const entries = await readdir(this.sessionsPath, { withFileTypes: true })
    const documents = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry): Promise<SessionDocument | null> => {
          try {
            return await this.readSessionUnlocked(join(this.sessionsPath, entry.name))
          } catch {
            return null
          }
        }),
    )
    return documents
      .filter((document): document is SessionDocument => document !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(toSessionSummary)
  }

  /** Attaches one new generation to an empty session. */
  public async setGeneration(id: string, item: GenerationItem): Promise<SessionDocument> {
    return this.updateSession(id, (document) => {
      if (document.item) throw new Error('This session already contains a generation.')
      document.item = generationItemSchema.parse(item) as GenerationItem
      const titleSource = item.kind === 'stt' ? item.inputAudio?.originalName : item.prompt.trim()
      document.title = titleSource?.slice(0, 64) || DEFAULT_SESSION_TITLE
      document.isDefaultTitle = false
      document.updatedAt = item.updatedAt
    })
  }

  /** Replaces the generation after a provider or download lifecycle update. */
  public async updateGeneration(id: string, item: GenerationItem): Promise<SessionDocument> {
    return this.updateSession(id, (document) => {
      if (!document.item || document.item.id !== item.id) {
        throw new Error('Generation does not belong to this session.')
      }
      document.item = generationItemSchema.parse(item) as GenerationItem
      document.updatedAt = item.updatedAt
    })
  }

  /** Renames a history entry while preserving its generation data. */
  public async renameSession(id: string, title: string): Promise<SessionDocument> {
    const normalized = title.trim().slice(0, 200)
    if (!normalized) throw new Error('Session title cannot be empty.')
    return this.updateSession(id, (document) => {
      document.title = normalized
      document.isDefaultTitle = false
      document.updatedAt = new Date().toISOString()
    })
  }

  /** Deletes a terminal session and replaces the last workspace when necessary. */
  public async deleteSession(id: string): Promise<DeleteSessionResult> {
    assertSessionId(id)
    return this.withLock(this.sessionsPath, async () => {
      const sessions = await this.listSessions()
      const target = sessions.find((candidate) => candidate.id === id)
      if (!target) return { deleted: false }
      if (
        target.status === 'submitting' ||
        target.status === 'pending' ||
        target.status === 'in_progress'
      ) {
        throw new Error('An active generation cannot be deleted.')
      }
      if (sessions.length === 1 && !target.hasItem) return { deleted: false }
      const replacement = sessions.length === 1 ? await this.createSession() : undefined
      await unlink(this.sessionPath(id)).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
      const assetDirectory = this.sessionMediaPath(id)
      await rm(assetDirectory, { recursive: true, force: true })
      return replacement ? { deleted: true, replacement } : { deleted: true }
    })
  }

  /** Resolves an asset path only after validating containment in the session media directory. */
  public resolveAssetPath(sessionId: string, fileName: string): string {
    assertSessionId(sessionId)
    if (!fileName || fileName !== fileName.split(/[\\/]/).at(-1)) {
      throw new Error('Invalid media file name.')
    }
    const root = resolve(this.sessionMediaPath(sessionId), 'outputs')
    const candidate = resolve(root, fileName)
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      throw new Error('Media path escaped its session directory.')
    }
    return candidate
  }

  /** Resolves one persisted STT input while enforcing containment in its owning session. */
  public resolveInputPath(sessionId: string, fileName: string): string {
    assertSessionId(sessionId)
    if (!fileName || fileName !== fileName.split(/[\\/]/).at(-1)) {
      throw new Error('Invalid input file name.')
    }
    const root = resolve(this.sessionMediaPath(sessionId), 'inputs')
    const candidate = resolve(root, fileName)
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      throw new Error('Input path escaped its session directory.')
    }
    return candidate
  }

  /** Resolves a session-owned input directory for copied reference files. */
  public getSessionInputPath(sessionId: string): string {
    assertSessionId(sessionId)
    return join(this.sessionMediaPath(sessionId), 'inputs')
  }

  /** Resolves a session-owned output directory for generated media. */
  public getSessionOutputPath(sessionId: string): string {
    assertSessionId(sessionId)
    return join(this.sessionMediaPath(sessionId), 'outputs')
  }

  /** Creates one renderer-safe custom-protocol URL. */
  public createAssetUrl(sessionId: string, assetId: string): string {
    assertSessionId(sessionId)
    if (!z.uuid().safeParse(assetId).success) throw new Error('Invalid asset identifier.')
    return `aimedia://asset/${sessionId}/${assetId}`
  }

  /** Applies a serialized document mutation and validates the complete result. */
  private async updateSession(
    id: string,
    mutate: (document: SessionDocument) => void,
  ): Promise<SessionDocument> {
    assertSessionId(id)
    const filePath = this.sessionPath(id)
    return this.withLock(filePath, async () => {
      const document = await this.readSessionUnlocked(filePath)
      mutate(document)
      const validated = sessionSchema.parse(document) as SessionDocument
      await this.writeJsonUnlocked(filePath, validated)
      return validated
    })
  }

  /** Writes one complete validated session document. */
  private async writeSession(document: SessionDocument): Promise<void> {
    const validated = sessionSchema.parse(document) as SessionDocument
    await this.withLock(this.sessionPath(validated.id), () =>
      this.writeJsonUnlocked(this.sessionPath(validated.id), validated),
    )
  }

  /** Reads one session only after schema validation. */
  private async readSessionUnlocked(filePath: string): Promise<SessionDocument> {
    return sessionSchema.parse(JSON.parse(await readFile(filePath, 'utf8'))) as SessionDocument
  }

  /** Resolves a validated session identifier to its JSON document. */
  private sessionPath(id: string): string {
    return join(this.sessionsPath, `${id}.json`)
  }

  /** Resolves a validated session identifier to its private media directory. */
  private sessionMediaPath(id: string): string {
    assertSessionId(id)
    return join(this.mediaPath, id)
  }

  /** Serializes a complete JSON value without temporary plaintext artifacts. */
  private async writeJsonUnlocked(filePath: string, value: unknown): Promise<void> {
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }

  /** Orders operations targeting the same durable resource. */
  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTails.get(key) ?? Promise.resolve()
    let release = (): void => undefined
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    const tail = previous.catch(() => undefined).then(() => gate)
    this.operationTails.set(key, tail)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.operationTails.get(key) === tail) this.operationTails.delete(key)
    }
  }
}
