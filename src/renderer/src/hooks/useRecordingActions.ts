/**
 * Coordinates cancellable renderer audio capture with main-process transcription sessions.
 */

import { useCallback } from 'react'
import { App as AntdApp } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AudioSource } from '@shared/types'
import AudioCaptureService from '@renderer/audio/AudioCaptureService'
import { createLogger, toErrorMessage } from '@renderer/services/LoggerService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  replaceSessionSummary,
  setAudioLevel,
  setCurrentSession,
  setPage,
  setSessionState,
  setSettingsSection,
} from '@renderer/store/appSlice'
import { toSessionSummary } from '@renderer/utils/formatters'

interface RecordingAttempt {
  backendReady: boolean
  cancelled: boolean
}

const captureService = new AudioCaptureService()
const logger = createLogger('RecordingActions')
const MAX_PRECONNECT_FRAMES = 20
let activeAttempt: RecordingAttempt | null = null

/** Returns low-latency start and deterministic stop commands for the active workspace. */
export const useRecordingActions = () => {
  const dispatch = useAppDispatch()
  const settings = useAppSelector((state) => state.app.settings)
  const platform = useAppSelector((state) => state.app.platform)
  const hasApiKey = useAppSelector(
    (state) => state.app.hasApiKeys[state.app.settings.transcriptionProvider],
  )
  const currentSessionId = useAppSelector((state) => state.app.currentSession?.id ?? null)
  const { message } = AntdApp.useApp()
  const { t } = useTranslation()

  /** Starts capture immediately and buffers recent frames while Deepgram connects. */
  const startRecording = useCallback(async (): Promise<void> => {
    if (activeAttempt) return
    if (!hasApiKey) {
      dispatch(setSettingsSection('transcription'))
      dispatch(setPage('settings'))
      void message.warning(
        t('notices.transcriptionApiKeyRequired', {
          provider: t(`settings.transcriptionProviders.${settings.transcriptionProvider}`),
        }),
      )
      return
    }
    if (!settings.microphoneEnabled && !settings.speakerEnabled) {
      void message.warning(t('notices.microphoneRequired'))
      return
    }

    const sessionSettings = {
      ...settings,
      speakerEnabled: platform === 'win32' && settings.speakerEnabled,
    }
    const sources: AudioSource[] = []
    if (sessionSettings.microphoneEnabled) sources.push('microphone')
    if (sessionSettings.speakerEnabled) sources.push('speaker')
    const pendingFrames = new Map(sources.map((source) => [source, [] as ArrayBuffer[]] as const))
    const attempt: RecordingAttempt = { backendReady: false, cancelled: false }
    let captureStarted = false
    activeAttempt = attempt
    dispatch(setSessionState({ state: 'connecting' }))

    try {
      await captureService.start({
        sources,
        microphoneDeviceId: sessionSettings.microphoneDeviceId,
        speakerDeviceId: sessionSettings.speakerDeviceId,
        onFrame: (source, samples) => {
          if (attempt.cancelled) return
          if (attempt.backendReady) {
            window.app.sendAudio(source, samples)
            return
          }
          const frames = pendingFrames.get(source)
          if (!frames) return
          if (frames.length >= MAX_PRECONNECT_FRAMES) frames.shift()
          frames.push(samples)
        },
        onLevel: (source, level) => dispatch(setAudioLevel({ source, level })),
        onDiagnostic: (messageText, details) => logger.debug(messageText, details),
      })
      captureStarted = true
      if (attempt.cancelled) return

      const result = await window.app.startSession({
        settings: sessionSettings,
        ...(currentSessionId ? { transcriptId: currentSessionId } : {}),
      })
      if (attempt.cancelled) {
        await window.app.stopSession()
        return
      }

      dispatch(setCurrentSession(result.session))
      attempt.backendReady = true
      for (const source of result.activeSources) {
        const frames = pendingFrames.get(source) ?? []
        frames.forEach((samples) => {
          window.app.sendAudio(source, samples)
        })
        frames.length = 0
      }
    } catch (error) {
      await captureService.stop()
      await window.app.stopSession().catch(() => null)
      dispatch(setSessionState({ state: 'idle' }))
      if (activeAttempt === attempt) activeAttempt = null
      if (!attempt.cancelled) {
        logger.error(
          captureStarted
            ? 'Transcription session failed to start.'
            : 'Audio capture failed to start.',
          error,
        )
        const errorKey = captureStarted ? 'errors.sessionStartDetails' : 'errors.captureDetails'
        void message.error(t(errorKey, { details: toErrorMessage(error) }), 8)
      }
    } finally {
      if (attempt.cancelled && activeAttempt === attempt) activeAttempt = null
    }
  }, [currentSessionId, dispatch, hasApiKey, message, platform, settings, t])

  /** Cancels a pending start or stops capture before flushing the remote streams. */
  const stopRecording = useCallback(async (): Promise<void> => {
    const attempt = activeAttempt
    if (attempt) attempt.cancelled = true
    activeAttempt = null
    dispatch(
      setSessionState({
        state: 'stopping',
        ...(currentSessionId ? { transcriptId: currentSessionId } : {}),
      }),
    )
    try {
      await captureService.stop()
      const transcript = await window.app.stopSession()
      if (!transcript) return
      dispatch(setCurrentSession(transcript))
      const summary = toSessionSummary(transcript)
      dispatch(replaceSessionSummary(summary))
    } catch (error) {
      logger.error('Recording failed to stop cleanly.', error)
      void message.error(t('errors.generic'))
    } finally {
      dispatch(setSessionState({ state: 'idle' }))
    }
  }, [currentSessionId, dispatch, message, t])

  return { captureService, startRecording, stopRecording }
}
