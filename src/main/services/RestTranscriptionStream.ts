/**
 * Turns request-response speech APIs into stable and provisional live transcript events.
 */

import type { RestTranscriptionSpeed } from '@shared/transcription'
import type { AudioSource, TranscriptResultEvent } from '@shared/types'

interface TranscriptWord {
  normalized: string
  start: number
}

interface UtteranceState {
  id: number
  buffers: Buffer[]
  bufferedBytes: number
  voicedBytes: number
  trailingSilenceBytes: number
  lastScheduledBytes: number
  overlapWith?: UtteranceState
  finalTranscript: string
}

interface TranscriptionSnapshot {
  utterance: UtteranceState
  pcm: Buffer
  final: boolean
}

interface SpeedProfile {
  previewIntervalBytes: number
  trailingSilenceBytes: number
}

/** Provider adapter callbacks and provider-neutral live transcription controls. */
export interface RestTranscriptionStreamOptions {
  source: AudioSource
  language: string
  speed: RestTranscriptionSpeed
  transcribe: (pcm: Uint8Array) => Promise<string>
  onResult: (event: TranscriptResultEvent) => void
  onError: (error: unknown) => void
}

const SAMPLE_RATE = 16_000
const BYTES_PER_SAMPLE = 2
const BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE
const MINIMUM_SPEECH_SECONDS = 0.5
const MINIMUM_SPEECH_BYTES = BYTES_PER_SECOND * MINIMUM_SPEECH_SECONDS
const MINIMUM_FINAL_SECONDS = 0.25
const MINIMUM_FINAL_BYTES = BYTES_PER_SECOND * MINIMUM_FINAL_SECONDS
const PRE_ROLL_SECONDS = 0.2
const PRE_ROLL_BYTES = BYTES_PER_SECOND * PRE_ROLL_SECONDS
const MAX_UTTERANCE_SECONDS = 20
const MAX_UTTERANCE_BYTES = BYTES_PER_SECOND * MAX_UTTERANCE_SECONDS
const ROLLOVER_OVERLAP_SECONDS = 1
const ROLLOVER_OVERLAP_BYTES = BYTES_PER_SECOND * ROLLOVER_OVERLAP_SECONDS
const SPEECH_RMS_THRESHOLD = 250
const MAX_OVERLAP_WORDS = 12
const SPEED_PROFILES: Record<RestTranscriptionSpeed, SpeedProfile> = {
  low: {
    previewIntervalBytes: BYTES_PER_SECOND * 6,
    trailingSilenceBytes: BYTES_PER_SECOND * 2,
  },
  medium: {
    previewIntervalBytes: BYTES_PER_SECOND * 3,
    trailingSilenceBytes: BYTES_PER_SECOND * 1.2,
  },
  high: {
    previewIntervalBytes: BYTES_PER_SECOND * 1.5,
    trailingSilenceBytes: BYTES_PER_SECOND * 0.7,
  },
}

/** Removes the exact normalized word overlap introduced at a bounded audio rollover. */
export const stripTranscriptOverlap = (
  previousText: string,
  currentText: string,
  language: string,
): string => {
  const previousWords = segmentTranscript(previousText, language)
  const currentWords = segmentTranscript(currentText, language)
  const maximum = Math.min(MAX_OVERLAP_WORDS, previousWords.length, currentWords.length)
  let overlapWords = 0
  for (let count = maximum; count >= 2; count -= 1) {
    const previousStart = previousWords.length - count
    const matches = currentWords
      .slice(0, count)
      .every((word, index) => word.normalized === previousWords[previousStart + index]?.normalized)
    if (matches) {
      overlapWords = count
      break
    }
  }
  if (overlapWords === 0) return currentText.trim()
  const firstUniqueWord = currentWords[overlapWords]
  return firstUniqueWord ? currentText.slice(firstUniqueWord.start).trim() : ''
}

/** Maintains one ordered pseudo-stream over a provider's request-response STT endpoint. */
export default class RestTranscriptionStream {
  private readonly profile: SpeedProfile
  private activeUtterance: UtteranceState | null = null
  private preRoll = Buffer.alloc(0)
  private pendingSnapshots = new Map<number, TranscriptionSnapshot>()
  private drainPromise: Promise<void> | null = null
  private stopping = false
  private nextUtteranceId = 1

  /** Creates a provider-neutral REST transcript stream for one independent audio source. */
  public constructor(private readonly options: RestTranscriptionStreamOptions) {
    this.profile = SPEED_PROFILES[options.speed]
  }

  /** Builds natural utterances and schedules rolling hypotheses without stale request buildup. */
  public send(samples: Uint8Array): void {
    if (this.stopping || samples.byteLength === 0) return
    const frame = Buffer.from(samples)
    const voiced = calculateRms(frame) >= SPEECH_RMS_THRESHOLD
    if (!this.activeUtterance) {
      if (!voiced) {
        this.appendPreRoll(frame)
        return
      }
      this.activeUtterance = this.createUtterance(this.preRoll)
      this.preRoll = Buffer.alloc(0)
    }

    const utterance = this.activeUtterance
    this.appendFrame(utterance, frame, voiced)
    if (
      utterance.trailingSilenceBytes >= this.profile.trailingSilenceBytes &&
      utterance.voicedBytes >= MINIMUM_SPEECH_BYTES
    ) {
      this.finalizeActiveUtterance(false)
      return
    }
    if (utterance.bufferedBytes >= MAX_UTTERANCE_BYTES) {
      this.finalizeActiveUtterance(true)
      return
    }
    if (
      voiced &&
      utterance.voicedBytes >= MINIMUM_SPEECH_BYTES &&
      utterance.bufferedBytes - utterance.lastScheduledBytes >= this.profile.previewIntervalBytes
    ) {
      this.scheduleSnapshot(utterance, false)
    }
  }

  /** Finalizes audible captured audio and waits for every current or coalesced request. */
  public async close(): Promise<void> {
    this.stopping = true
    if (
      this.activeUtterance?.voicedBytes &&
      this.activeUtterance.voicedBytes >= MINIMUM_FINAL_BYTES
    ) {
      this.finalizeActiveUtterance(false)
    } else {
      this.activeUtterance = null
    }
    this.preRoll = Buffer.alloc(0)
    while (this.drainPromise) await this.drainPromise
  }

  /** Creates one independently reconciled natural speech buffer. */
  private createUtterance(preRoll: Buffer, overlapWith?: UtteranceState): UtteranceState {
    return {
      id: this.nextUtteranceId++,
      buffers: preRoll.byteLength > 0 ? [Buffer.from(preRoll)] : [],
      bufferedBytes: preRoll.byteLength,
      voicedBytes: 0,
      trailingSilenceBytes: 0,
      lastScheduledBytes: preRoll.byteLength,
      ...(overlapWith ? { overlapWith } : {}),
      finalTranscript: '',
    }
  }

  /** Appends one classified frame without losing silence needed for endpoint detection. */
  private appendFrame(utterance: UtteranceState, frame: Buffer, voiced: boolean): void {
    utterance.buffers.push(frame)
    utterance.bufferedBytes += frame.byteLength
    if (voiced) {
      utterance.voicedBytes += frame.byteLength
      utterance.trailingSilenceBytes = 0
    } else {
      utterance.trailingSilenceBytes += frame.byteLength
    }
  }

  /** Retains only enough leading silence to avoid clipping the next speech onset. */
  private appendPreRoll(frame: Buffer): void {
    const combined = Buffer.concat([this.preRoll, frame])
    this.preRoll = Buffer.from(combined.subarray(Math.max(0, combined.byteLength - PRE_ROLL_BYTES)))
  }

  /** Queues a final snapshot and optionally starts a bounded overlap continuation. */
  private finalizeActiveUtterance(withRollover: boolean): void {
    const utterance = this.activeUtterance
    if (!utterance) return
    const pcm = Buffer.concat(utterance.buffers, utterance.bufferedBytes)
    this.activeUtterance = null
    if (utterance.voicedBytes >= MINIMUM_FINAL_BYTES) this.scheduleSnapshot(utterance, true, pcm)

    if (withRollover) {
      const overlap = Buffer.from(
        pcm.subarray(Math.max(0, pcm.byteLength - ROLLOVER_OVERLAP_BYTES)),
      )
      this.activeUtterance = this.createUtterance(overlap, utterance)
      return
    }
    this.preRoll = Buffer.alloc(0)
  }

  /** Keeps only the newest pending snapshot for each utterance; final always supersedes preview. */
  private scheduleSnapshot(
    utterance: UtteranceState,
    final: boolean,
    pcm = Buffer.concat(utterance.buffers, utterance.bufferedBytes),
  ): void {
    const existing = this.pendingSnapshots.get(utterance.id)
    if (!existing?.final) {
      this.pendingSnapshots.set(utterance.id, { utterance, pcm: Buffer.from(pcm), final })
    }
    utterance.lastScheduledBytes = utterance.bufferedBytes
    this.ensureDrain()
  }

  /** Starts the single in-flight REST loop used by this audio source. */
  private ensureDrain(): void {
    if (this.drainPromise) return
    const promise = this.drainSnapshots().finally(() => {
      if (this.drainPromise === promise) this.drainPromise = null
      if (this.pendingSnapshots.size > 0) this.ensureDrain()
    })
    this.drainPromise = promise
  }

  /** Processes snapshots in utterance order while allowing stale previews to be replaced. */
  private async drainSnapshots(): Promise<void> {
    while (this.pendingSnapshots.size > 0) {
      const entry = this.pendingSnapshots.entries().next().value as
        [number, TranscriptionSnapshot] | undefined
      if (!entry) return
      const [utteranceId, snapshot] = entry
      this.pendingSnapshots.delete(utteranceId)
      try {
        await this.processSnapshot(snapshot)
      } catch (error) {
        this.options.onError(error)
        if (snapshot.final) this.publishInterim('')
      }
    }
  }

  /** Keeps previews replaceable and commits the complete utterance exactly once. */
  private async processSnapshot(snapshot: TranscriptionSnapshot): Promise<void> {
    const rawText = (await this.options.transcribe(snapshot.pcm)).trim()
    const text = snapshot.utterance.overlapWith
      ? stripTranscriptOverlap(
          snapshot.utterance.overlapWith.finalTranscript,
          rawText,
          this.options.language,
        )
      : rawText
    if (snapshot.final) {
      snapshot.utterance.finalTranscript = text
      if (!text) {
        this.publishInterim('')
        return
      }
      this.options.onResult({
        source: this.options.source,
        text,
        isFinal: true,
        speechFinal: true,
        confidence: 1,
      })
      return
    }
    this.publishInterim(text)
  }

  /** Replaces the source's provisional tail, including with an empty clear operation. */
  private publishInterim(text: string): void {
    this.options.onResult({
      source: this.options.source,
      text,
      isFinal: false,
      speechFinal: false,
      confidence: 1,
    })
  }
}

/** Segments multilingual text into comparable word spans while retaining source offsets. */
const segmentTranscript = (text: string, language: string): TranscriptWord[] => {
  const segmenter = new Intl.Segmenter(language || undefined, { granularity: 'word' })
  return [...segmenter.segment(text)]
    .filter((segment) => segment.isWordLike)
    .map((segment) => ({
      normalized: segment.segment.normalize('NFKC').toLocaleLowerCase(language || undefined),
      start: segment.index,
    }))
}

/** Measures the energy of one PCM16 frame without retaining or exposing its samples. */
const calculateRms = (samples: Uint8Array): number => {
  const view = new DataView(samples.buffer, samples.byteOffset, samples.byteLength)
  let squaredTotal = 0
  const sampleCount = Math.floor(samples.byteLength / BYTES_PER_SAMPLE)
  for (let index = 0; index < sampleCount; index += 1) {
    const value = view.getInt16(index * BYTES_PER_SAMPLE, true)
    squaredTotal += value * value
  }
  return sampleCount > 0 ? Math.sqrt(squaredTotal / sampleCount) : 0
}
