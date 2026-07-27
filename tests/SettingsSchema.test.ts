/**
 * Verifies media settings defaults, nested patches, and tray invariants.
 */

import { describe, expect, it } from 'vitest'
import {
  parsePersistedSettings,
  settingsPatchSchema,
  settingsSchema,
} from '../src/main/settingsSchema'
import { DEFAULT_SETTINGS, WORKSPACE_INPUT_PERCENT_LIMITS } from '../src/shared/types'

describe('media settings schema', () => {
  it('accepts independent defaults for all four media workflows', () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS).image.provider).toBe('openrouter')
    expect(settingsSchema.parse(DEFAULT_SETTINGS).video.provider).toBe('openrouter')
    expect(settingsSchema.parse(DEFAULT_SETTINGS).tts.provider).toBe('openrouter')
    expect(settingsSchema.parse(DEFAULT_SETTINGS).stt.provider).toBe('openrouter')
  })

  it('accepts a sparse nested image model patch', () => {
    expect(
      settingsPatchSchema.parse({
        image: { providers: { openrouter: { modelId: 'vendor/image' } } },
      }),
    ).toEqual({ image: { providers: { openrouter: { modelId: 'vendor/image' } } } })
  })

  it('persists a valid workspace split and rejects unusable proportions', () => {
    expect(settingsPatchSchema.parse({ workspaceInputPercent: 62 })).toEqual({
      workspaceInputPercent: 62,
    })
    expect(settingsPatchSchema.safeParse({ workspaceInputPercent: 10 }).success).toBe(false)
  })

  it('applies the three-to-seven workspace default to older settings documents', () => {
    const { workspaceInputPercent, ...olderSettings } = DEFAULT_SETTINGS
    expect(workspaceInputPercent).toBe(WORKSPACE_INPUT_PERCENT_LIMITS.default)
    expect(parsePersistedSettings(olderSettings).workspaceInputPercent).toBe(
      WORKSPACE_INPUT_PERCENT_LIMITS.default,
    )
  })

  it('adds new nested video defaults without discarding older provider settings', () => {
    const olderVideoSettings = Object.fromEntries(
      Object.entries(DEFAULT_SETTINGS.video.providers.openrouter).filter(([key]) => key !== 'size'),
    )
    olderVideoSettings.duration = 8
    const parsed = parsePersistedSettings({
      ...DEFAULT_SETTINGS,
      video: {
        ...DEFAULT_SETTINGS.video,
        providers: { openrouter: olderVideoSettings },
      },
    })
    expect(parsed.video.providers.openrouter.duration).toBe(8)
    expect(parsed.video.providers.openrouter.size).toBe('')
  })

  it('migrates older image and video settings with new speech defaults', () => {
    const { tts: _tts, stt: _stt, ...olderSettings } = DEFAULT_SETTINGS
    const parsed = parsePersistedSettings(olderSettings)
    expect(parsed.tts.providers.openrouter).toEqual(DEFAULT_SETTINGS.tts.providers.openrouter)
    expect(parsed.stt.providers.openrouter).toEqual(DEFAULT_SETTINGS.stt.providers.openrouter)
  })

  it('returns new defaults for unrelated legacy data', () => {
    expect(parsePersistedSettings({ microphoneEnabled: true })).toEqual(DEFAULT_SETTINGS)
  })

  it('rejects close-to-tray without a visible tray icon', () => {
    expect(
      settingsSchema.safeParse({
        ...DEFAULT_SETTINGS,
        showTrayIcon: false,
        minimizeToTrayOnClose: true,
      }).success,
    ).toBe(false)
  })
})
