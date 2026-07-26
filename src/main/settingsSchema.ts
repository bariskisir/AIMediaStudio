/**
 * Centralizes persisted and IPC settings validation, including migrations from earlier schemas.
 */

import {
  canonicalizeDeepgramModel,
  DEEPGRAM_DIARIZATION_MODES,
  DEEPGRAM_REDACTION_MODES,
} from '@shared/deepgram'
import {
  DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS,
  DEFAULT_OPENROUTER_TRANSCRIPTION_SETTINGS,
  REST_TRANSCRIPTION_SPEEDS,
  TRANSCRIPTION_PROVIDERS,
} from '@shared/transcription'
import { TRANSLATION_PROVIDERS, TRANSLATION_TARGET_LANGUAGES } from '@shared/translation'
import {
  APP_LOCALES,
  DEFAULT_SETTINGS,
  LOG_LEVELS,
  NAVBAR_POSITIONS,
  PAGE_ZOOM_LIMITS,
  TIME_FORMATS,
  THEME_MODES,
  type AppSettings,
} from '@shared/types'
import { z } from 'zod'

const deepgramSettingsFieldsSchema = z.object({
  language: z.string().min(1).max(24),
  model: z.string().trim().min(1).max(200),
  modelVersion: z.string().trim().min(1).max(80),
  punctuate: z.boolean(),
  smartFormat: z.boolean(),
  numerals: z.boolean(),
  profanityFilter: z.boolean(),
  diarization: z.enum(DEEPGRAM_DIARIZATION_MODES),
  redaction: z.enum(DEEPGRAM_REDACTION_MODES),
  endpointingMs: z.number().int().min(10).max(5_000),
  utteranceEndEnabled: z.boolean(),
  utteranceEndMs: z.number().int().min(1_000).max(5_000),
  vocabulary: z.array(z.string().trim().min(1).max(120)).max(100),
  mipOptOut: z.boolean(),
})

const openRouterSettingsFieldsSchema = z.object({
  model: z.string().trim().min(1).max(200),
  language: z.string().regex(/^(?:|[a-z]{2})$/),
  speed: z.enum(REST_TRANSCRIPTION_SPEEDS),
})

const transcriptionProviderSettingsSchema = z
  .object({
    deepgram: deepgramSettingsFieldsSchema,
    openrouter: openRouterSettingsFieldsSchema,
  })
  .strict()

const settingsFieldsSchema = z.object({
  settingsRevision: z.literal(1),
  uiLanguage: z.enum(APP_LOCALES),
  theme: z.enum(THEME_MODES),
  navbarPosition: z.enum(NAVBAR_POSITIONS),
  pageZoom: z.number().min(PAGE_ZOOM_LIMITS.min).max(PAGE_ZOOM_LIMITS.max),
  timeFormat: z.enum(TIME_FORMATS),
  transcriptionProvider: z.enum(TRANSCRIPTION_PROVIDERS),
  transcriptionProviderSettings: transcriptionProviderSettingsSchema,
  translationProvider: z.enum(TRANSLATION_PROVIDERS),
  translationEnabled: z.boolean(),
  translationTargetLanguage: z.enum(TRANSLATION_TARGET_LANGUAGES),
  microphoneDeviceId: z.string().max(512),
  microphoneEnabled: z.boolean(),
  speakerDeviceId: z.string().max(512),
  speakerEnabled: z.boolean(),
  alwaysOnTop: z.boolean(),
  showTrayIcon: z.boolean(),
  minimizeToTrayOnClose: z.boolean(),
  autoUpdate: z.boolean(),
  logLevel: z.enum(LOG_LEVELS),
})

export const settingsSchema = settingsFieldsSchema.superRefine((settings, context) => {
  if (settings.minimizeToTrayOnClose && !settings.showTrayIcon) {
    context.addIssue({
      code: 'custom',
      path: ['minimizeToTrayOnClose'],
      message: 'Minimize to tray requires the tray icon to be enabled.',
    })
  }
  const deepgram = settings.transcriptionProviderSettings.deepgram
  if (deepgram.redaction !== 'none' && !deepgram.language.startsWith('en')) {
    context.addIssue({
      code: 'custom',
      path: ['transcriptionProviderSettings', 'deepgram', 'redaction'],
      message: 'Deepgram streaming redaction is available for English audio only.',
    })
  }
})

const deepgramSettingsPatchSchema = deepgramSettingsFieldsSchema
  .partial()
  .strict()
  .refine(
    (patch) => Object.keys(patch).length > 0,
    'At least one Deepgram setting must be provided.',
  )

const openRouterSettingsPatchSchema = openRouterSettingsFieldsSchema
  .partial()
  .strict()
  .refine(
    (patch) => Object.keys(patch).length > 0,
    'At least one OpenRouter setting must be provided.',
  )

const transcriptionProviderSettingsPatchSchema = z
  .object({
    deepgram: deepgramSettingsPatchSchema.optional(),
    openrouter: openRouterSettingsPatchSchema.optional(),
  })
  .strict()
  .refine(
    (patch) => Object.keys(patch).length > 0,
    'At least one provider setting must be provided.',
  )

export const settingsPatchSchema = settingsFieldsSchema
  .omit({ settingsRevision: true, transcriptionProviderSettings: true })
  .partial()
  .extend({
    transcriptionProviderSettings: transcriptionProviderSettingsPatchSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'At least one setting must be provided.')

/** Returns an object record only when a persisted value can contain named settings. */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Migrates a previously persisted settings object and applies new defaults safely. */
export const parsePersistedSettings = (input: unknown): AppSettings => {
  const legacy = asRecord(input)
  if (!legacy) return structuredClone(DEFAULT_SETTINGS)

  const persistedProviderSettings = asRecord(legacy.transcriptionProviderSettings)
  const persistedDeepgram = asRecord(persistedProviderSettings?.deepgram)
  const persistedOpenRouter = asRecord(persistedProviderSettings?.openrouter)
  const deepgramSource = persistedDeepgram ?? legacy
  const deepgramCandidate = {
    ...DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS,
    ...deepgramSource,
    endpointingMs:
      typeof deepgramSource.endpointingMs === 'number' &&
      (persistedDeepgram !== null ||
        legacy.settingsRevision === 2 ||
        legacy.settingsRevision === 3 ||
        legacy.settingsRevision === 4 ||
        legacy.settingsRevision === 5 ||
        legacy.settingsRevision === 6)
        ? deepgramSource.endpointingMs
        : DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS.endpointingMs,
  }
  const model = canonicalizeDeepgramModel(String(deepgramCandidate.model))
  const language = String(deepgramCandidate.language)
  const openRouterCandidate = {
    ...DEFAULT_OPENROUTER_TRANSCRIPTION_SETTINGS,
    ...persistedOpenRouter,
  }
  const transcriptionProvider =
    TRANSCRIPTION_PROVIDERS.find((provider) => provider === legacy.transcriptionProvider) ??
    DEFAULT_SETTINGS.transcriptionProvider
  const translationTargetLanguage = TRANSLATION_TARGET_LANGUAGES.find(
    (targetLanguage) => targetLanguage === legacy.translationTargetLanguage,
  )
  const candidate = {
    ...DEFAULT_SETTINGS,
    ...legacy,
    settingsRevision: 1 as const,
    transcriptionProvider,
    transcriptionProviderSettings: {
      deepgram: {
        ...deepgramCandidate,
        model,
        language,
        ...(language.startsWith('en') ? {} : { redaction: 'none' as const }),
      },
      openrouter: openRouterCandidate,
    },
    translationEnabled:
      typeof legacy.translationEnabled === 'boolean'
        ? legacy.translationEnabled
        : translationTargetLanguage !== undefined,
    translationTargetLanguage:
      translationTargetLanguage ?? DEFAULT_SETTINGS.translationTargetLanguage,
    speakerDeviceId:
      typeof legacy.speakerDeviceId === 'string' ? legacy.speakerDeviceId : 'default',
    speakerEnabled:
      typeof legacy.speakerEnabled === 'boolean'
        ? legacy.speakerEnabled
        : typeof legacy.systemAudioEnabled === 'boolean'
          ? legacy.systemAudioEnabled
          : DEFAULT_SETTINGS.speakerEnabled,
  }
  const parsed = settingsSchema.safeParse(candidate)
  if (parsed.success) return parsed.data

  return settingsSchema.parse({
    ...DEFAULT_SETTINGS,
    uiLanguage: APP_LOCALES.includes(candidate.uiLanguage)
      ? candidate.uiLanguage
      : DEFAULT_SETTINGS.uiLanguage,
    theme: THEME_MODES.includes(candidate.theme) ? candidate.theme : DEFAULT_SETTINGS.theme,
    transcriptionProviderSettings: {
      deepgram: {
        ...DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS,
        model: DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS.model,
        language: DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS.language,
      },
      openrouter: DEFAULT_OPENROUTER_TRANSCRIPTION_SETTINGS,
    },
  })
}
