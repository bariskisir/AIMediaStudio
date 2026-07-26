/**
 * Coordinates credentials, storage, and source-separated streaming for each recording session.
 */

import { randomUUID } from 'node:crypto'
import type {
  AppErrorEvent,
  AudioSource,
  SessionStateEvent,
  StartSessionRequest,
  StartSessionResult,
  SessionDocument,
  TranscriptResultEvent,
  TranscriptSegment,
  TranslationResultEvent,
  TranslationSegment,
} from '@shared/types'
import type { TranscriptionProvider } from '@shared/transcription'
import type { TranslationProvider, TranslationTargetLanguage } from '@shared/translation'
import type CredentialService from './CredentialService'
import type DeepgramService from './DeepgramService'
import type LoggerService from './LoggerService'
import type OpenRouterService from './OpenRouterService'
import type StorageService from './StorageService'
import type TranslationProviderService from './TranslationProviderService'
import {
  findCompletedTranscriptSentences,
  type CompletedTranscriptSentence,
} from './TranscriptSentenceMatcher'

interface TranscriptEvents {
  onState: (event: SessionStateEvent) => void
  onResult: (event: TranscriptResultEvent) => void
  onTranslation: (event: TranslationResultEvent) => void
  onError: (event: AppErrorEvent) => void
}

const PERSISTENCE_BATCH_MS = 250

class SessionStartCancelledError extends Error {
  /** Creates an internal cancellation marker that is safe to serialize across IPC. */
  public constructor() {
    super('Recording start was cancelled.')
    this.name = 'SessionStartCancelledError'
  }
}

export default class TranscriptService {
  private currentSessionId: string | null = null
  private startingSessionId: string | null = null
  private baseDurationMs = 0
  private startedAt = 0
  private persistenceQueue = Promise.resolve()
  private startPromise: Promise<StartSessionResult> | null = null
  private startCancelled = false
  private stopPromise: Promise<SessionDocument | null> | null = null
  private pendingSegments: TranscriptSegment[] = []
  private persistenceTimer: NodeJS.Timeout | null = null
  private sessionSegments: TranscriptSegment[] = []
  private sessionLanguage = ''
  private transcriptionProvider: TranscriptionProvider | null = null
  private translationProvider: TranslationProvider = 'google'
  private translationEnabled = false
  private translationTarget: TranslationTargetLanguage = 'tr'
  private readonly translationCoverage = new Map<string, number>()
  private readonly queuedTranslationKeys = new Set<string>()
  private readonly translationQueues = new Map<string, Promise<void>>()

  /** Creates a session coordinator with explicit service dependencies. */
  public constructor(
    private readonly storage: StorageService,
    private readonly credentials: Record<TranscriptionProvider, CredentialService>,
    private readonly deepgram: DeepgramService,
    private readonly openRouter: OpenRouterService,
    private readonly translator: TranslationProviderService,
    private readonly events: TranscriptEvents,
    private readonly logger: LoggerService,
  ) {}

  /** Starts a session and one remote stream for every enabled source. */
  public async start(request: StartSessionRequest): Promise<StartSessionResult> {
    if (this.stopPromise) await this.stopPromise
    if (this.startPromise || this.currentSessionId) {
      throw new Error('A recording session is already active.')
    }
    this.startCancelled = false
    const startPromise = this.startInternal(request)
    this.startPromise = startPromise
    try {
      return await startPromise
    } finally {
      if (this.startPromise === startPromise) this.startPromise = null
    }
  }

  /** Performs the cancellable connection sequence for one recording request. */
  private async startInternal(request: StartSessionRequest): Promise<StartSessionResult> {
    try {
      const sources = this.resolveSources(request)
      const provider = request.settings.transcriptionProvider
      const providerSettings = request.settings.transcriptionProviderSettings[provider]
      const language =
        provider === 'deepgram'
          ? providerSettings.language
          : providerSettings.language || request.settings.uiLanguage
      const apiKey = await this.credentials[provider].getApiKey()
      this.throwIfStartCancelled()
      if (!apiKey)
        throw new Error(
          `Save a valid ${provider === 'deepgram' ? 'Deepgram' : 'OpenRouter'} API key before recording.`,
        )
      const session = request.transcriptId
        ? await this.storage.getSession(request.transcriptId)
        : await this.storage.createSession(language, request.title)
      this.startingSessionId = session.id
      this.throwIfStartCancelled()
      this.events.onState({ state: 'connecting', transcriptId: session.id })
      const onError = (source: AudioSource, message: string): void => {
        this.logger.error('TranscriptService', 'A transcription source reported an error.', {
          source,
          message,
        })
        this.events.onError({ source, message, recoverable: true })
      }
      if (provider === 'deepgram') {
        await this.deepgram.start({
          sources,
          apiKey,
          settings: request.settings.transcriptionProviderSettings.deepgram,
          onResult: (event) => this.handleResult(event),
          onError,
        })
      } else {
        await this.openRouter.start({
          sources,
          apiKey,
          settings: request.settings.transcriptionProviderSettings.openrouter,
          onResult: (event) => this.handleResult(event),
          onError,
        })
      }
      this.throwIfStartCancelled()
      this.currentSessionId = session.id
      this.transcriptionProvider = provider
      this.startingSessionId = null
      this.baseDurationMs = session.durationMs
      this.startedAt = Date.now()
      this.persistenceQueue = Promise.resolve()
      this.pendingSegments = []
      this.clearPersistenceTimer()
      this.sessionSegments = [...session.segments]
      this.sessionLanguage = language
      this.translationProvider = request.settings.translationProvider
      this.translationEnabled = request.settings.translationEnabled
      this.translationTarget = request.settings.translationTargetLanguage
      this.initializeTranslationCoverage(session)
      this.events.onState({
        state: 'recording',
        transcriptId: session.id,
        startedAt: new Date(this.startedAt).toISOString(),
      })
      this.logger.info('TranscriptService', 'Recording session started.', {
        sessionId: session.id,
        sources,
        transcriptionProvider: provider,
        model: providerSettings.model,
        language: providerSettings.language,
        translationProvider: request.settings.translationProvider,
        translationEnabled: request.settings.translationEnabled,
        translationTarget: request.settings.translationTargetLanguage,
      })
      this.schedulePendingTranslations(session.id, true)
      return { session, activeSources: sources }
    } catch (error) {
      await Promise.allSettled([this.deepgram.stop(), this.openRouter.stop()])
      const cancelled = error instanceof SessionStartCancelledError || this.startCancelled
      this.resetSessionState()
      this.events.onState({ state: 'idle' })
      if (cancelled) {
        this.logger.info('TranscriptService', 'Recording session start was cancelled.')
      } else {
        this.logger.error('TranscriptService', 'Recording session failed to start.', error)
      }
      throw error
    }
  }

  /** Sends a source-specific PCM frame to the active transcription provider. */
  public sendAudio(source: AudioSource, samples: Uint8Array): void {
    if (!this.currentSessionId) return
    if (this.transcriptionProvider === 'deepgram') this.deepgram.send(source, samples)
    if (this.transcriptionProvider === 'openrouter') this.openRouter.send(source, samples)
  }

  /** Changes the target language and translates the selected session from its beginning. */
  public async translateSession(
    sessionId: string,
    enabled: boolean,
    provider: TranslationProvider,
    targetLanguage: TranslationTargetLanguage,
  ): Promise<void> {
    if (this.currentSessionId === sessionId) {
      this.translationEnabled = enabled
      this.translationProvider = provider
      this.translationTarget = targetLanguage
      if (enabled) this.schedulePendingTranslations(sessionId, true)
      return
    }
    if (!enabled) return

    const session = await this.storage.getSession(sessionId)
    this.initializeTranslationCoverage(session)
    this.scheduleTranslations(
      session.id,
      session.segments,
      session.language,
      provider,
      targetLanguage,
      true,
    )
  }

  /** Flushes streams, persists duration, and returns the completed session. */
  public async stop(): Promise<SessionDocument | null> {
    if (this.stopPromise) return this.stopPromise
    const sessionId = this.currentSessionId
    if (!sessionId && this.startPromise) {
      this.startCancelled = true
      this.events.onState({
        state: 'stopping',
        ...(this.startingSessionId ? { transcriptId: this.startingSessionId } : {}),
      })
      await Promise.allSettled([this.deepgram.stop(), this.openRouter.stop()])
      await this.startPromise.catch(() => undefined)
      return null
    }
    if (!sessionId) return null
    const stoppedAt = Date.now()
    this.events.onState({ state: 'stopping', transcriptId: sessionId })
    this.stopPromise = this.finishStop(sessionId, stoppedAt).finally(() => {
      this.stopPromise = null
    })
    return this.stopPromise
  }

  /** Completes the remote flush and persistence after the capture stop time is fixed. */
  private async finishStop(sessionId: string, stoppedAt: number): Promise<SessionDocument> {
    try {
      if (this.transcriptionProvider === 'openrouter') await this.openRouter.stop()
      else await this.deepgram.stop()
      this.flushPendingSegments(sessionId)
      this.schedulePendingTranslations(sessionId, true)
      await Promise.all([this.persistenceQueue, ...this.translationQueues.values()])
      const session = await this.storage.finishSession(
        sessionId,
        this.baseDurationMs + Math.max(0, stoppedAt - this.startedAt),
      )
      this.logger.info('TranscriptService', 'Recording session stopped.', {
        sessionId,
        durationMs: session.durationMs,
      })
      return session
    } finally {
      this.resetSessionState()
      this.events.onState({ state: 'idle' })
    }
  }

  /** Interrupts a pending start before it can publish a recording state. */
  private throwIfStartCancelled(): void {
    if (this.startCancelled) throw new SessionStartCancelledError()
  }

  /** Clears all active and pending session fields after stop or failed start. */
  private resetSessionState(): void {
    this.currentSessionId = null
    this.startingSessionId = null
    this.baseDurationMs = 0
    this.startedAt = 0
    this.pendingSegments = []
    this.sessionSegments = []
    this.sessionLanguage = ''
    this.transcriptionProvider = null
    this.translationProvider = 'google'
    this.translationEnabled = false
    this.translationTarget = 'tr'
    this.clearPersistenceTimer()
  }

  /** Resolves enabled audio sources and rejects an empty selection. */
  private resolveSources(request: StartSessionRequest): AudioSource[] {
    const sources: AudioSource[] = []
    if (request.settings.microphoneEnabled) sources.push('microphone')
    if (request.settings.speakerEnabled) sources.push('speaker')
    if (sources.length === 0) throw new Error('Enable at least one audio source.')
    return sources
  }

  /** Converts final gateway results into durable transcript segments. */
  private handleResult(event: TranscriptResultEvent): void {
    const sessionId = this.currentSessionId
    if (!sessionId || !event.isFinal) {
      this.events.onResult(event)
      return
    }
    const segment: TranscriptSegment = {
      id: randomUUID(),
      source: event.source,
      text: event.text,
      confidence: event.confidence,
      createdAt: new Date().toISOString(),
      offsetMs: this.baseDurationMs + Math.max(0, Date.now() - this.startedAt),
    }
    this.pendingSegments.push(segment)
    this.sessionSegments.push(segment)
    if (!this.persistenceTimer) {
      this.persistenceTimer = setTimeout(() => {
        this.persistenceTimer = null
        this.flushPendingSegments(sessionId)
      }, PERSISTENCE_BATCH_MS)
    }
    this.events.onResult({ ...event, segment })
    this.schedulePendingTranslations(sessionId, false)
  }

  /** Enqueues newly completed sentences once for the active language pair. */
  private schedulePendingTranslations(sessionId: string, includeTrailing: boolean): void {
    if (!this.translationEnabled || !this.sessionLanguage) return
    this.scheduleTranslations(
      sessionId,
      this.sessionSegments,
      this.sessionLanguage,
      this.translationProvider,
      this.translationTarget,
      includeTrailing,
    )
  }

  /** Adds every untranslated sentence after the persisted coverage for one language pair. */
  private scheduleTranslations(
    sessionId: string,
    segments: TranscriptSegment[],
    sourceLanguage: string,
    provider: TranslationProvider,
    targetLanguage: TranslationTargetLanguage,
    includeTrailing: boolean,
  ): void {
    const pairKey = this.translationPairKey(sessionId, provider, sourceLanguage, targetLanguage)
    const pending = findCompletedTranscriptSentences(segments, {
      startIndex: this.translationCoverage.get(pairKey) ?? 0,
      includeTrailing,
    })

    pending.forEach((sentence) => {
      const translationKey = `${pairKey}\u0000${sentence.endIndex}`
      if (this.queuedTranslationKeys.has(translationKey)) return
      this.queuedTranslationKeys.add(translationKey)
      this.translationCoverage.set(pairKey, sentence.endIndex)
      const queue = (this.translationQueues.get(pairKey) ?? Promise.resolve())
        .then(() =>
          this.translateSentence(sessionId, sentence, provider, sourceLanguage, targetLanguage),
        )
        .finally(() => this.queuedTranslationKeys.delete(translationKey))
      this.translationQueues.set(pairKey, queue)
      void queue.then(() => {
        if (this.translationQueues.get(pairKey) === queue) this.translationQueues.delete(pairKey)
      })
    })
  }

  /** Seeds source coverage from every translation already stored in one document. */
  private initializeTranslationCoverage(session: SessionDocument): void {
    session.translations.forEach((translation) => {
      const pairKey = this.translationPairKey(
        session.id,
        translation.provider,
        translation.sourceLanguage,
        translation.targetLanguage,
      )
      this.translationCoverage.set(
        pairKey,
        Math.max(this.translationCoverage.get(pairKey) ?? 0, translation.sourceEndIndex),
      )
    })
  }

  /** Translates, persists, and publishes one source-mapped sentence without logging its text. */
  private async translateSentence(
    sessionId: string,
    sentence: CompletedTranscriptSentence,
    provider: TranslationProvider,
    sourceLanguage: string,
    targetLanguage: TranslationTargetLanguage,
  ): Promise<void> {
    try {
      const text = await this.translator.translate(
        provider,
        sentence.text,
        sourceLanguage,
        targetLanguage,
      )
      if (!text) return
      const translation: TranslationSegment = {
        id: randomUUID(),
        provider,
        sourceText: sentence.text,
        text,
        sourceLanguage,
        targetLanguage,
        sourceSegmentIds: sentence.sourceSegmentIds,
        sourceStartIndex: sentence.startIndex,
        sourceEndIndex: sentence.endIndex,
        createdAt: new Date().toISOString(),
      }
      await this.storage.appendTranslation(sessionId, translation)
      this.events.onTranslation({ transcriptId: sessionId, translation })
    } catch (error) {
      this.logger.warn('TranscriptService', 'A completed sentence could not be translated.', error)
      this.events.onError({
        context: 'translation',
        message: 'The latest completed sentence could not be translated.',
        recoverable: true,
      })
    }
  }

  /** Builds a stable session and language-pair key for translation coverage. */
  private translationPairKey(
    sessionId: string,
    provider: TranslationProvider,
    sourceLanguage: string,
    targetLanguage: string,
  ): string {
    return `${sessionId}\u0000${provider}\u0000${sourceLanguage}\u0000${targetLanguage}`
  }

  /** Moves pending final segments into one serialized AppData write. */
  private flushPendingSegments(sessionId: string): void {
    this.clearPersistenceTimer()
    const segments = this.pendingSegments.splice(0)
    if (segments.length === 0) return
    this.persistenceQueue = this.persistenceQueue
      .then(() => this.storage.appendSegments(sessionId, segments))
      .catch((error: unknown) => {
        this.logger.error('TranscriptService', 'Session segment persistence failed.', error)
        this.events.onError({
          message: `The session could not be saved: ${error instanceof Error ? error.message : 'Unknown error'}`,
          recoverable: true,
        })
      })
  }

  /** Cancels the active persistence debounce without discarding queued segments. */
  private clearPersistenceTimer(): void {
    if (this.persistenceTimer) clearTimeout(this.persistenceTimer)
    this.persistenceTimer = null
  }
}
