/**
 * Validates persisted and IPC settings for all OpenRouter media workflows.
 */

import {
  IMAGE_BACKGROUNDS,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_QUALITIES,
  MEDIA_KINDS,
  TTS_OUTPUT_FORMATS,
} from '@shared/openrouter'
import {
  APP_LOCALES,
  DEFAULT_SETTINGS,
  LOG_LEVELS,
  NAVBAR_POSITIONS,
  PAGE_ZOOM_LIMITS,
  TIME_FORMATS,
  THEME_MODES,
  WORKSPACE_INPUT_PERCENT_LIMITS,
  type AppSettings,
} from '@shared/types'
import { z } from 'zod'

const nullableSeedSchema = z.number().int().min(0).max(2_147_483_647).nullable()

const imageProviderSettingsSchema = z.object({
  modelId: z.string().trim().max(200),
  resolution: z.string().trim().min(1).max(32),
  aspectRatio: z.string().trim().min(1).max(32),
  quality: z.enum(IMAGE_QUALITIES),
  outputFormat: z.enum(IMAGE_OUTPUT_FORMATS),
  count: z.number().int().min(1).max(10),
  background: z.enum(IMAGE_BACKGROUNDS),
  outputCompression: z.number().int().min(0).max(100),
  seed: nullableSeedSchema,
})

const videoProviderSettingsSchema = z.object({
  modelId: z.string().trim().max(200),
  duration: z.number().int().min(1).max(120),
  resolution: z.string().trim().min(1).max(32),
  aspectRatio: z.string().trim().min(1).max(32),
  size: z.string().trim().max(32),
  generateAudio: z.boolean(),
  seed: nullableSeedSchema,
})

const ttsProviderSettingsSchema = z.object({
  modelId: z.string().trim().max(200),
  voice: z.string().trim().max(200),
  responseFormat: z.enum(TTS_OUTPUT_FORMATS),
  speed: z.number().min(0.25).max(4),
})

const sttProviderSettingsSchema = z.object({
  modelId: z.string().trim().max(200),
  language: z
    .string()
    .trim()
    .regex(/^$|^[a-z]{2,3}(?:-[A-Z]{2})?$/)
    .max(12),
  temperature: z.number().min(0).max(1),
})

const settingsFieldsSchema = z.object({
  settingsRevision: z.literal(1),
  uiLanguage: z.enum(APP_LOCALES),
  theme: z.enum(THEME_MODES),
  navbarPosition: z.enum(NAVBAR_POSITIONS),
  pageZoom: z.number().min(PAGE_ZOOM_LIMITS.min).max(PAGE_ZOOM_LIMITS.max),
  workspaceInputPercent: z
    .number()
    .min(WORKSPACE_INPUT_PERCENT_LIMITS.min)
    .max(WORKSPACE_INPUT_PERCENT_LIMITS.max),
  timeFormat: z.enum(TIME_FORMATS),
  generationMode: z.enum(MEDIA_KINDS),
  image: z.object({
    provider: z.literal('openrouter'),
    providers: z.object({ openrouter: imageProviderSettingsSchema }),
  }),
  video: z.object({
    provider: z.literal('openrouter'),
    providers: z.object({ openrouter: videoProviderSettingsSchema }),
  }),
  tts: z.object({
    provider: z.literal('openrouter'),
    providers: z.object({ openrouter: ttsProviderSettingsSchema }),
  }),
  stt: z.object({
    provider: z.literal('openrouter'),
    providers: z.object({ openrouter: sttProviderSettingsSchema }),
  }),
  alwaysOnTop: z.boolean(),
  showTrayIcon: z.boolean(),
  minimizeToTrayOnClose: z.boolean(),
  autoUpdate: z.boolean(),
  logLevel: z.enum(LOG_LEVELS),
})

/** Validates a complete settings document and dependent tray preferences. */
export const settingsSchema = settingsFieldsSchema.superRefine((settings, context) => {
  if (settings.minimizeToTrayOnClose && !settings.showTrayIcon) {
    context.addIssue({
      code: 'custom',
      path: ['minimizeToTrayOnClose'],
      message: 'Minimize to tray requires the tray icon to be enabled.',
    })
  }
})

/** Validates a sparse provider-aware settings update. */
export const settingsPatchSchema = settingsFieldsSchema
  .omit({ settingsRevision: true, image: true, video: true, tts: true, stt: true })
  .partial()
  .extend({
    image: z
      .object({
        provider: z.literal('openrouter').optional(),
        providers: z
          .object({ openrouter: imageProviderSettingsSchema.partial().optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    video: z
      .object({
        provider: z.literal('openrouter').optional(),
        providers: z
          .object({ openrouter: videoProviderSettingsSchema.partial().optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    tts: z
      .object({
        provider: z.literal('openrouter').optional(),
        providers: z
          .object({ openrouter: ttsProviderSettingsSchema.partial().optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    stt: z
      .object({
        provider: z.literal('openrouter').optional(),
        providers: z
          .object({ openrouter: sttProviderSettingsSchema.partial().optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'At least one setting must be provided.')

/** Returns named persisted fields only for plain object inputs. */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Parses only complete AI Media Studio media settings and otherwise returns safe defaults. */
export const parsePersistedSettings = (input: unknown): AppSettings => {
  const source = asRecord(input)
  const image = asRecord(source?.image)
  const video = asRecord(source?.video)
  if (source?.settingsRevision !== 1 || !image || !video) {
    return structuredClone(DEFAULT_SETTINGS)
  }
  const imageProviders = asRecord(image.providers)
  const videoProviders = asRecord(video.providers)
  const tts = asRecord(source?.tts)
  const stt = asRecord(source?.stt)
  const ttsProviders = asRecord(tts?.providers)
  const sttProviders = asRecord(stt?.providers)
  const parsed = settingsSchema.safeParse({
    ...DEFAULT_SETTINGS,
    ...source,
    image: {
      ...DEFAULT_SETTINGS.image,
      ...image,
      providers: {
        openrouter: {
          ...DEFAULT_SETTINGS.image.providers.openrouter,
          ...(asRecord(imageProviders?.openrouter) ?? {}),
        },
      },
    },
    video: {
      ...DEFAULT_SETTINGS.video,
      ...video,
      providers: {
        openrouter: {
          ...DEFAULT_SETTINGS.video.providers.openrouter,
          ...(asRecord(videoProviders?.openrouter) ?? {}),
        },
      },
    },
    tts: {
      ...DEFAULT_SETTINGS.tts,
      ...(tts ?? {}),
      providers: {
        openrouter: {
          ...DEFAULT_SETTINGS.tts.providers.openrouter,
          ...(asRecord(ttsProviders?.openrouter) ?? {}),
        },
      },
    },
    stt: {
      ...DEFAULT_SETTINGS.stt,
      ...(stt ?? {}),
      providers: {
        openrouter: {
          ...DEFAULT_SETTINGS.stt.providers.openrouter,
          ...(asRecord(sttProviders?.openrouter) ?? {}),
        },
      },
    },
  })
  return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS)
}
