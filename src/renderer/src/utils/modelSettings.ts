/**
 * Normalizes model ordering and provider defaults against live OpenRouter capabilities.
 */

import {
  getComparablePriceAmount,
  getDisplayPrice,
  getModelPriceUnitPriority,
  IMAGE_BACKGROUNDS,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_QUALITIES,
  type ImageBackground,
  type ImageOutputFormat,
  type ImageQuality,
  type MediaModel,
} from '@shared/openrouter'
import type {
  AppSettings,
  AppSettingsPatch,
  GenerationItem,
  ImageGenerationOptions,
  MediaKind,
  SttGenerationOptions,
  TtsGenerationOptions,
  VideoGenerationOptions,
} from '@shared/types'

/** Returns enum values or a caller-provided normalized fallback for boolean capabilities. */
export const getCapabilityValues = (
  model: MediaModel | undefined,
  key: string,
  fallback: string[] = [],
): string[] => {
  const descriptor = model?.capabilities[key]
  return descriptor?.type === 'enum' && descriptor.values.length ? descriptor.values : fallback
}

/** Returns one numeric capability range or a normalized caller fallback. */
export const getCapabilityRange = (
  model: MediaModel | undefined,
  key: string,
  fallback: { min: number; max: number },
): { min: number; max: number } => {
  const descriptor = model?.capabilities[key]
  return descriptor?.type === 'range' ? { min: descriptor.min, max: descriptor.max } : fallback
}

/** Orders native per-image or per-second prices first, then secondary billing units by price. */
export const sortModelsByOutputPrice = (models: MediaModel[]): MediaModel[] =>
  [...models].sort((left, right) => {
    const leftPrice = getDisplayPrice(left)
    const rightPrice = getDisplayPrice(right)
    const leftPriority = leftPrice
      ? getModelPriceUnitPriority(left.kind, leftPrice)
      : Number.POSITIVE_INFINITY
    const rightPriority = rightPrice
      ? getModelPriceUnitPriority(right.kind, rightPrice)
      : Number.POSITIVE_INFINITY
    if (leftPriority !== rightPriority) return leftPriority - rightPriority
    const leftAmount = leftPrice ? getComparablePriceAmount(leftPrice) : Number.POSITIVE_INFINITY
    const rightAmount = rightPrice ? getComparablePriceAmount(rightPrice) : Number.POSITIVE_INFINITY
    return leftAmount === rightAmount
      ? left.name.localeCompare(right.name)
      : leftAmount - rightAmount
  })

/** Selects the current value when supported, otherwise the first valid model value. */
const compatibleValue = <Value>(current: Value, supported: Value[]): Value =>
  supported.includes(current) ? current : (supported[0] ?? current)

/** Preserves an optional exact value only while the next model still advertises it. */
const compatibleOptionalValue = (current: string, supported: string[]): string =>
  current && supported.includes(current) ? current : ''

/** Clamps a numeric setting to a range capability while preserving integral request values. */
const compatibleRange = (current: number, model: MediaModel, key: string): number => {
  const descriptor = model.capabilities[key]
  if (descriptor?.type !== 'range') return current
  return Math.round(Math.min(descriptor.max, Math.max(descriptor.min, current)))
}

/** Clamps decimal options without applying the integral media-option normalization. */
const compatibleDecimalRange = (current: number, model: MediaModel, key: string): number => {
  const descriptor = model.capabilities[key]
  if (descriptor?.type !== 'range') return current
  return Math.min(descriptor.max, Math.max(descriptor.min, current))
}

/** Narrows provider strings to the application's normalized image option allowlist. */
const allowedImageValues = <Value extends string>(
  values: string[],
  allowed: readonly Value[],
): Value[] => values.filter((value): value is Value => allowed.includes(value as Value))

/** Builds a complete nested patch whose values are valid for the selected model. */
export const createCompatibleModelPatch = (
  kind: MediaKind,
  model: MediaModel,
  settings: AppSettings,
): AppSettingsPatch => {
  if (kind === 'image') {
    const current = settings.image.providers.openrouter
    const aspectRatios = getCapabilityValues(model, 'aspect_ratio')
    const resolutions = getCapabilityValues(model, 'resolution')
    const qualities = allowedImageValues<ImageQuality>(
      getCapabilityValues(model, 'quality', [...IMAGE_QUALITIES]),
      IMAGE_QUALITIES,
    )
    const formats = allowedImageValues<ImageOutputFormat>(
      getCapabilityValues(model, 'output_format', [...IMAGE_OUTPUT_FORMATS]),
      IMAGE_OUTPUT_FORMATS,
    )
    const backgrounds = allowedImageValues<ImageBackground>(
      getCapabilityValues(model, 'background', [...IMAGE_BACKGROUNDS]),
      IMAGE_BACKGROUNDS,
    )
    return {
      image: {
        providers: {
          openrouter: {
            modelId: model.id,
            ...(aspectRatios.length
              ? { aspectRatio: compatibleValue(current.aspectRatio, aspectRatios) }
              : {}),
            ...(resolutions.length
              ? { resolution: compatibleValue(current.resolution, resolutions) }
              : {}),
            ...(model.capabilities.quality
              ? { quality: compatibleValue(current.quality, qualities) }
              : {}),
            ...(model.capabilities.output_format
              ? { outputFormat: compatibleValue(current.outputFormat, formats) }
              : {}),
            ...(model.capabilities.background
              ? { background: compatibleValue(current.background, backgrounds) }
              : {}),
            ...(model.capabilities.n ? { count: compatibleRange(current.count, model, 'n') } : {}),
            ...(model.capabilities.output_compression
              ? {
                  outputCompression: compatibleRange(
                    current.outputCompression,
                    model,
                    'output_compression',
                  ),
                }
              : {}),
            seed: model.capabilities.seed ? current.seed : null,
          },
        },
      },
    }
  }

  if (kind === 'video') {
    const current = settings.video.providers.openrouter
    return {
      video: {
        providers: {
          openrouter: {
            modelId: model.id,
            ...(model.supportedDurations.length
              ? { duration: compatibleValue(current.duration, model.supportedDurations) }
              : {}),
            ...(model.supportedResolutions.length
              ? { resolution: compatibleValue(current.resolution, model.supportedResolutions) }
              : {}),
            ...(model.supportedAspectRatios.length
              ? { aspectRatio: compatibleValue(current.aspectRatio, model.supportedAspectRatios) }
              : {}),
            size: compatibleOptionalValue(current.size, model.supportedSizes),
            generateAudio: model.supportsAudio ? current.generateAudio : false,
            seed: model.capabilities.seed ? current.seed : null,
          },
        },
      },
    }
  }
  if (kind === 'tts') {
    const current = settings.tts.providers.openrouter
    return {
      tts: {
        providers: {
          openrouter: {
            modelId: model.id,
            voice: model.supportsCustomVoice
              ? current.voice
              : compatibleValue(current.voice, model.supportedVoices),
            speed: compatibleDecimalRange(current.speed, model, 'speed'),
          },
        },
      },
    }
  }
  return {
    stt: {
      providers: { openrouter: { modelId: model.id } },
    },
  }
}

/** Builds only request options supported by the selected media model. */
export const createSupportedGenerationOptions = (
  kind: MediaKind,
  model: MediaModel,
  settings: AppSettings,
): GenerationItem['options'] => {
  if (kind === 'image') {
    const image = settings.image.providers.openrouter
    const supported = model.capabilities
    return {
      ...(supported.resolution ? { resolution: image.resolution } : {}),
      ...(supported.aspect_ratio ? { aspectRatio: image.aspectRatio } : {}),
      ...(supported.quality ? { quality: image.quality } : {}),
      ...(supported.output_format ? { outputFormat: image.outputFormat } : {}),
      ...(supported.n ? { count: image.count } : {}),
      ...(supported.background ? { background: image.background } : {}),
      ...(supported.output_compression ? { outputCompression: image.outputCompression } : {}),
      ...(supported.seed && image.seed !== null ? { seed: image.seed } : {}),
    }
  }

  if (kind === 'video') {
    const video = settings.video.providers.openrouter
    const exactSize = video.size && model.supportedSizes.includes(video.size) ? video.size : ''
    return {
      ...(model.supportedDurations.length ? { duration: video.duration } : {}),
      ...(exactSize
        ? { size: exactSize }
        : {
            ...(model.supportedResolutions.length ? { resolution: video.resolution } : {}),
            ...(model.supportedAspectRatios.length ? { aspectRatio: video.aspectRatio } : {}),
          }),
      ...(model.supportsAudio ? { generateAudio: video.generateAudio } : {}),
      ...(model.capabilities.seed && video.seed !== null ? { seed: video.seed } : {}),
    }
  }
  if (kind === 'tts') {
    const tts = settings.tts.providers.openrouter
    return { voice: tts.voice, responseFormat: tts.responseFormat, speed: tts.speed }
  }
  const stt = settings.stt.providers.openrouter
  return {
    ...(stt.language ? { language: stt.language } : {}),
    temperature: stt.temperature,
  }
}

/** Converts one immutable session input snapshot back into editable composer defaults. */
export const createSessionSettingsPatch = (item: GenerationItem): AppSettingsPatch => {
  if (item.kind === 'image') {
    const options = item.options as ImageGenerationOptions
    return {
      generationMode: 'image',
      image: {
        providers: {
          openrouter: {
            modelId: item.modelId,
            ...options,
            seed: options.seed ?? null,
          },
        },
      },
    }
  }

  if (item.kind === 'video') {
    const options = item.options as VideoGenerationOptions
    return {
      generationMode: 'video',
      video: {
        providers: {
          openrouter: {
            modelId: item.modelId,
            ...options,
            size: options.size ?? '',
            seed: options.seed ?? null,
          },
        },
      },
    }
  }
  if (item.kind === 'tts') {
    const options = item.options as TtsGenerationOptions
    return {
      generationMode: 'tts',
      tts: { providers: { openrouter: { modelId: item.modelId, ...options } } },
    }
  }
  const options = item.options as SttGenerationOptions
  return {
    generationMode: 'stt',
    stt: {
      providers: {
        openrouter: {
          modelId: item.modelId,
          language: options.language ?? '',
          temperature: options.temperature ?? 0,
        },
      },
    },
  }
}
