/**
 * Builds validated Deepgram Nova streaming endpoints from persisted transcription preferences.
 */

import { getDeepgramVocabularyParameter } from '@shared/deepgram'
import type { DeepgramTranscriptionSettings } from '@shared/transcription'

/** Builds a linear16 mono streaming URL with only compatible optional parameters. */
export const buildDeepgramEndpoint = (settings: DeepgramTranscriptionSettings): string => {
  const vocabularyParameter = getDeepgramVocabularyParameter(settings.model)
  const query = new URLSearchParams({
    model: settings.model,
    version: settings.modelVersion,
    language: settings.language,
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    vad_events: 'true',
    punctuate: String(settings.punctuate),
    smart_format: String(settings.smartFormat),
    numerals: String(settings.numerals),
    profanity_filter: String(settings.profanityFilter),
    endpointing: String(settings.endpointingMs),
    mip_opt_out: String(settings.mipOptOut),
  })

  if (settings.utteranceEndEnabled) {
    query.set('utterance_end_ms', String(settings.utteranceEndMs))
  }
  if (settings.diarization !== 'off') query.set('diarize_model', settings.diarization)
  if (settings.redaction !== 'none') query.set('redact', settings.redaction)
  if (vocabularyParameter) {
    settings.vocabulary.forEach((term) => {
      query.append(vocabularyParameter, term)
    })
  }

  return `wss://api.deepgram.com/v1/listen?${query.toString()}`
}
