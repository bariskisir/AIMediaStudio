/**
 * Renders a left-side generation composer and a persistent right-side output workspace.
 */

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Switch,
  Tag,
  Tooltip,
} from 'antd'
import { AudioLines, Copy, Download, ExternalLink, Plus, Sparkles, Upload, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { estimateTtsCost, getDisplayPrice } from '@shared/openrouter'
import { createSpeechLanguageOptions } from '@shared/speech'
import {
  WORKSPACE_INPUT_PERCENT_LIMITS,
  type AudioInputSelection,
  type GenerateRequest,
  type GenerationReference,
  type ImageGenerationOptions,
  type MediaKind,
  type ReferenceImage,
  type SttGenerationOptions,
  type TtsGenerationOptions,
  type VideoGenerationOptions,
} from '@shared/types'
import { toActionableVideoError } from '@shared/video'
import SessionsSidebar from '@renderer/components/sidebar/SessionsSidebar'
import { useGenerationActions } from '@renderer/hooks/useGenerationActions'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppSelector } from '@renderer/store'
import { formatModelPrice } from '@renderer/utils/formatters'
import {
  getGenerationStatusColor,
  isActiveGenerationStatus,
} from '@renderer/utils/generationStatus'
import {
  createCompatibleModelPatch,
  createSessionSettingsPatch,
  createSupportedGenerationOptions,
  getCapabilityRange,
  getCapabilityValues,
  sortModelsByOutputPrice,
} from '@renderer/utils/modelSettings'
import MediaModeControl from './MediaModeControl'
import styles from './HomePage.module.scss'

interface PreviewTransform {
  scale: number
  x: number
  y: number
}

interface PreviewDrag {
  pointerId: number
  startClientX: number
  startClientY: number
  originX: number
  originY: number
}

interface PanelResize {
  pointerId: number
  left: number
  availableWidth: number
}

const INITIAL_PREVIEW_TRANSFORM: PreviewTransform = { scale: 1, x: 0, y: 0 }
const MIN_PREVIEW_SCALE = 1
const MAX_PREVIEW_SCALE = 6
const PREVIEW_SCALE_STEP = 0.25
const MIN_INPUT_PANEL_WIDTH = 240
const MIN_OUTPUT_PANEL_WIDTH = 260
const PANEL_SPLITTER_WIDTH = 6

/** Keeps a zoomed image offset within the visible preview viewport. */
const clampPreviewOffset = (offset: number, scale: number, viewportSize: number): number => {
  const limit = Math.max(0, (viewportSize * (scale - 1)) / 2)
  return Math.min(limit, Math.max(-limit, offset))
}

/** Keeps keyboard-driven panel proportions inside the persisted workspace limits. */
const clampInputPanelPercent = (percent: number): number =>
  Math.min(
    WORKSPACE_INPUT_PERCENT_LIMITS.max,
    Math.max(WORKSPACE_INPUT_PERCENT_LIMITS.min, percent),
  )

/** Formats very small media costs without rounding a non-zero charge down to zero. */
const formatGenerationCost = (costUsd: number): string =>
  `$${costUsd.toFixed(costUsd > 0 && costUsd < 0.0001 ? 6 : 4)}`

/** Compares normalized immutable generation options without transient renderer state. */
const generationOptionsMatch = (
  left: GenerateRequest['options'],
  right: GenerateRequest['options'],
): boolean => {
  const leftEntries = Object.entries(left)
  const rightRecord = right as Record<string, unknown>
  return (
    leftEntries.length === Object.keys(rightRecord).length &&
    leftEntries.every(([key, value]) => rightRecord[key] === value)
  )
}

/** Renders the primary media generation workspace. */
const HomePage = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const models = useAppSelector((state) => state.app.models)
  const hasApiKeys = useAppSelector((state) => state.app.hasApiKeys)
  const currentSession = useAppSelector((state) => state.app.currentSession)
  const settingsActions = useSettingsActions()
  const generationActions = useGenerationActions()
  const { t } = useTranslation()
  const generationLocked =
    generationActions.submitting || isActiveGenerationStatus(currentSession?.item?.status)
  const [prompt, setPrompt] = useState('')
  const [references, setReferences] = useState<ReferenceImage[]>([])
  const [audioInput, setAudioInput] = useState<AudioInputSelection | null>(null)
  const [audioSourceSessionId, setAudioSourceSessionId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewTransform, setPreviewTransform] =
    useState<PreviewTransform>(INITIAL_PREVIEW_TRANSFORM)
  const [inputPanelPercent, setInputPanelPercent] = useState(settings.workspaceInputPercent)
  const previewDrag = useRef<PreviewDrag | null>(null)
  const panelResize = useRef<PanelResize | null>(null)
  const hydratedSessionId = useRef<string | null | undefined>(undefined)
  const workbench = useRef<HTMLDivElement | null>(null)
  const mode = settings.generationMode
  const modeSettings = settings[mode].providers.openrouter
  const sortedModels = useMemo(() => sortModelsByOutputPrice(models[mode]), [mode, models])
  const selectedModel =
    sortedModels.find((model) => model.id === modeSettings.modelId) ?? sortedModels[0]
  const modelOptions = useMemo(
    () =>
      sortedModels.map((model) => ({
        value: model.id,
        searchText: `${model.name} ${model.id}`,
        label: (
          <span className={styles.modelOption}>
            <span className={styles.modelName}>{model.name}</span>
            <span className={styles.modelPrice}>{formatModelPrice(getDisplayPrice(model), t)}</span>
          </span>
        ),
      })),
    [sortedModels, t],
  )
  const languageOptions = useMemo(
    () => createSpeechLanguageOptions(settings.uiLanguage),
    [settings.uiLanguage],
  )

  useEffect(() => {
    if (!panelResize.current) setInputPanelPercent(settings.workspaceInputPercent)
  }, [settings.workspaceInputPercent])

  useEffect(() => {
    const sessionId = currentSession?.id ?? null
    if (hydratedSessionId.current === sessionId) return
    hydratedSessionId.current = sessionId
    if (references.length) {
      void window.app.releaseReferenceImages(references.map((reference) => reference.token))
    }
    if (audioInput) void window.app.releaseAudioInput(audioInput.token)
    setReferences([])
    setAudioInput(null)
    const item = currentSession?.item
    setPrompt(item?.kind === 'stt' ? '' : (item?.prompt ?? ''))
    setAudioSourceSessionId(item?.kind === 'stt' && item.inputAudio ? sessionId : null)
    if (item) void settingsActions.saveSettings(createSessionSettingsPatch(item))
  }, [
    audioInput,
    currentSession?.id,
    currentSession?.item,
    references,
    settingsActions.saveSettings,
  ])

  useEffect(() => {
    if (!selectedModel || selectedModel.id === modeSettings.modelId) return
    void settingsActions.saveSettings(createCompatibleModelPatch(mode, selectedModel, settings))
  }, [mode, modeSettings.modelId, selectedModel, settings, settingsActions.saveSettings])

  /** Changes media mode and releases references whose roles no longer match. */
  const changeMode = async (value: string | number): Promise<void> => {
    if (references.length) {
      await window.app.releaseReferenceImages(references.map((item) => item.token))
    }
    if (audioInput) await window.app.releaseAudioInput(audioInput.token)
    setReferences([])
    setAudioInput(null)
    setAudioSourceSessionId(null)
    await settingsActions.saveSettings({ generationMode: value as MediaKind })
  }

  /** Selects a model and atomically replaces every incompatible dependent value. */
  const changeModel = async (modelId: string): Promise<void> => {
    const model = sortedModels.find((candidate) => candidate.id === modelId)
    if (!model) return
    if (references.length) {
      await window.app.releaseReferenceImages(references.map((item) => item.token))
    }
    setReferences([])
    await settingsActions.saveSettings(createCompatibleModelPatch(mode, model, settings))
  }

  /** Opens a native image picker and limits video inputs to structured frame roles. */
  const selectReferences = async (): Promise<void> => {
    if (mode !== 'image' && mode !== 'video') return
    const selected = await window.app.selectReferenceImages(mode)
    const maximum = mode === 'image' ? 10 : (selectedModel?.supportedFrameImages.length ?? 0)
    const available = Math.max(0, maximum - references.length)
    setReferences((current) => [...current, ...selected.slice(0, available)])
    const discarded = selected.slice(available)
    if (discarded.length) {
      await window.app.releaseReferenceImages(discarded.map((item) => item.token))
    }
  }

  /** Removes one unused reference from the main-process token registry. */
  const removeReference = async (token: string): Promise<void> => {
    setReferences((current) => current.filter((item) => item.token !== token))
    await window.app.releaseReferenceImages([token])
  }

  /** Opens the native STT audio picker while replacing any unsubmitted prior selection. */
  const selectAudioInput = async (): Promise<void> => {
    const selected = await window.app.selectAudioInput()
    if (!selected) return
    if (audioInput) await window.app.releaseAudioInput(audioInput.token)
    setAudioInput(selected)
    setAudioSourceSessionId(null)
  }

  /** Releases one transient STT selection or detaches a durable source from the composer. */
  const removeAudioInput = async (): Promise<void> => {
    if (audioInput) await window.app.releaseAudioInput(audioInput.token)
    setAudioInput(null)
    setAudioSourceSessionId(null)
  }

  /** Opens one generated image with a reset zoom and pan position. */
  const openPreview = (url: string): void => {
    previewDrag.current = null
    setPreviewTransform(INITIAL_PREVIEW_TRANSFORM)
    setPreviewUrl(url)
  }

  /** Closes the image preview and clears transient interaction state. */
  const closePreview = (): void => {
    previewDrag.current = null
    setPreviewTransform(INITIAL_PREVIEW_TRANSFORM)
    setPreviewUrl(null)
  }

  /** Zooms around the pointer while keeping the image inside its viewport. */
  const zoomPreview = (event: ReactWheelEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    const viewport = event.currentTarget.getBoundingClientRect()
    setPreviewTransform((current) => {
      const direction = event.deltaY < 0 ? PREVIEW_SCALE_STEP : -PREVIEW_SCALE_STEP
      const scale = Math.min(
        MAX_PREVIEW_SCALE,
        Math.max(MIN_PREVIEW_SCALE, current.scale + direction),
      )
      if (scale === MIN_PREVIEW_SCALE) return INITIAL_PREVIEW_TRANSFORM
      const ratio = scale / current.scale
      const pointerX = event.clientX - viewport.left - viewport.width / 2
      const pointerY = event.clientY - viewport.top - viewport.height / 2
      return {
        scale,
        x: clampPreviewOffset(pointerX - (pointerX - current.x) * ratio, scale, viewport.width),
        y: clampPreviewOffset(pointerY - (pointerY - current.y) * ratio, scale, viewport.height),
      }
    })
  }

  /** Starts pointer-based panning only after the preview has been zoomed. */
  const beginPreviewPan = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (previewTransform.scale === MIN_PREVIEW_SCALE) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    previewDrag.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: previewTransform.x,
      originY: previewTransform.y,
    }
  }

  /** Moves a zoomed preview within clamped viewport boundaries. */
  const panPreview = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = previewDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const viewport = event.currentTarget.getBoundingClientRect()
    setPreviewTransform((current) => ({
      ...current,
      x: clampPreviewOffset(
        drag.originX + event.clientX - drag.startClientX,
        current.scale,
        viewport.width,
      ),
      y: clampPreviewOffset(
        drag.originY + event.clientY - drag.startClientY,
        current.scale,
        viewport.height,
      ),
    }))
  }

  /** Finishes pointer panning and releases capture safely. */
  const endPreviewPan = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (previewDrag.current?.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    previewDrag.current = null
  }

  /** Converts a horizontal pointer location to a panel percentage with usable minimum widths. */
  const resizePanelsToPointer = (clientX: number, resize: PanelResize): number => {
    const minimumInput = Math.min(MIN_INPUT_PANEL_WIDTH, resize.availableWidth / 2)
    const maximumInput = Math.max(minimumInput, resize.availableWidth - MIN_OUTPUT_PANEL_WIDTH)
    const inputWidth = Math.min(maximumInput, Math.max(minimumInput, clientX - resize.left))
    const percent = (inputWidth / resize.availableWidth) * 100
    setInputPanelPercent(percent)
    return percent
  }

  /** Persists one completed input/output panel proportion change. */
  const saveInputPanelPercent = (percent: number): void => {
    void settingsActions.saveSettings({ workspaceInputPercent: clampInputPanelPercent(percent) })
  }

  /** Starts resizing from the separator while preserving pointer capture outside the divider. */
  const beginPanelResize = (event: ReactPointerEvent<HTMLHRElement>): void => {
    const bounds = workbench.current?.getBoundingClientRect()
    if (!bounds) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const resize = {
      pointerId: event.pointerId,
      left: bounds.left,
      availableWidth: Math.max(1, bounds.width - PANEL_SPLITTER_WIDTH),
    }
    panelResize.current = resize
    resizePanelsToPointer(event.clientX, resize)
  }

  /** Updates panel proportions while the captured separator is dragged. */
  const continuePanelResize = (event: ReactPointerEvent<HTMLHRElement>): void => {
    const resize = panelResize.current
    if (!resize || resize.pointerId !== event.pointerId) return
    resizePanelsToPointer(event.clientX, resize)
  }

  /** Releases the active panel resize interaction safely. */
  const endPanelResize = (event: ReactPointerEvent<HTMLHRElement>): void => {
    const resize = panelResize.current
    if (!resize || resize.pointerId !== event.pointerId) return
    const percent = resizePanelsToPointer(event.clientX, resize)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    panelResize.current = null
    saveInputPanelPercent(percent)
  }

  /** Restores and persists the default three-to-seven panel proportion. */
  const resetPanelSplit = (): void => {
    setInputPanelPercent(WORKSPACE_INPUT_PERCENT_LIMITS.default)
    saveInputPanelPercent(WORKSPACE_INPUT_PERCENT_LIMITS.default)
  }

  /** Supports precise keyboard resizing and a keyboard reset on the separator. */
  const resizePanelsWithKeyboard = (event: ReactKeyboardEvent<HTMLHRElement>): void => {
    if (event.key === 'Home') {
      event.preventDefault()
      resetPanelSplit()
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction =
      event.key === 'ArrowLeft'
        ? -WORKSPACE_INPUT_PERCENT_LIMITS.step
        : WORKSPACE_INPUT_PERCENT_LIMITS.step
    const percent = clampInputPanelPercent(inputPanelPercent + direction)
    setInputPanelPercent(percent)
    saveInputPanelPercent(percent)
  }

  /** Converts selected references into dedicated API roles for the active model. */
  const generationReferences = (): GenerationReference[] =>
    references.map((reference, index) => ({
      token: reference.token,
      role:
        mode === 'image'
          ? 'reference'
          : mode === 'video'
            ? (selectedModel?.supportedFrameImages[index] ?? 'first_frame')
            : 'reference',
    }))

  /** Persists a sparse active-mode option update. */
  const saveModeOption = (patch: Record<string, unknown>): void => {
    if (mode === 'image') {
      void settingsActions.saveSettings({ image: { providers: { openrouter: patch } } })
    } else if (mode === 'video') {
      void settingsActions.saveSettings({ video: { providers: { openrouter: patch } } })
    } else if (mode === 'tts') {
      void settingsActions.saveSettings({ tts: { providers: { openrouter: patch } } })
    } else {
      void settingsActions.saveSettings({ stt: { providers: { openrouter: patch } } })
    }
  }

  /** Submits current values as a new independent history item. */
  const generate = async (): Promise<void> => {
    const hasAudioInput = Boolean(audioInput || audioSourceSessionId)
    if (generationLocked || !selectedModel || (mode === 'stt' ? !hasAudioInput : !prompt.trim())) {
      return
    }
    let request: GenerateRequest
    if (mode === 'image') {
      request = {
        kind: 'image',
        prompt,
        modelId: selectedModel.id,
        options: createSupportedGenerationOptions(
          'image',
          selectedModel,
          settings,
        ) as ImageGenerationOptions,
        references: generationReferences(),
        ...(currentSession && !currentSession.item ? { sessionId: currentSession.id } : {}),
      }
    } else if (mode === 'video') {
      request = {
        kind: 'video',
        prompt,
        modelId: selectedModel.id,
        options: createSupportedGenerationOptions(
          'video',
          selectedModel,
          settings,
        ) as VideoGenerationOptions,
        references: generationReferences(),
        ...(currentSession && !currentSession.item ? { sessionId: currentSession.id } : {}),
      }
    } else if (mode === 'tts') {
      request = {
        kind: 'tts',
        prompt,
        modelId: selectedModel.id,
        options: createSupportedGenerationOptions(
          'tts',
          selectedModel,
          settings,
        ) as TtsGenerationOptions,
        ...(currentSession && !currentSession.item ? { sessionId: currentSession.id } : {}),
      }
    } else {
      request = {
        kind: 'stt',
        modelId: selectedModel.id,
        options: createSupportedGenerationOptions(
          'stt',
          selectedModel,
          settings,
        ) as SttGenerationOptions,
        audio: audioInput
          ? { token: audioInput.token }
          : { sourceSessionId: audioSourceSessionId ?? '' },
        ...(currentSession && !currentSession.item ? { sessionId: currentSession.id } : {}),
      }
    }
    if (await generationActions.generate(request)) {
      setReferences([])
      setAudioInput(null)
    }
  }

  const imageSettings = settings.image.providers.openrouter
  const videoSettings = settings.video.providers.openrouter
  const ttsSettings = settings.tts.providers.openrouter
  const sttSettings = settings.stt.providers.openrouter
  const ttsSpeedRange = getCapabilityRange(selectedModel, 'speed', { min: 0.25, max: 4 })
  const supportsReferences =
    mode === 'image'
      ? Boolean(selectedModel?.capabilities.input_references)
      : mode === 'video'
        ? Boolean(selectedModel?.supportedFrameImages.length)
        : false
  const activeStatus = currentSession?.item?.status
  const resultItem = currentSession?.item
  const composerOptions = selectedModel
    ? createSupportedGenerationOptions(mode, selectedModel, settings)
    : null
  const isRegeneration = Boolean(
    resultItem &&
    selectedModel &&
    composerOptions &&
    references.length === 0 &&
    resultItem.kind === mode &&
    resultItem.modelId === selectedModel.id &&
    (mode === 'stt'
      ? audioInput === null && audioSourceSessionId === currentSession?.id
      : resultItem.prompt === prompt) &&
    generationOptionsMatch(resultItem.options, composerOptions),
  )
  const resultModel = resultItem
    ? models[resultItem.kind].find((candidate) => candidate.id === resultItem.modelId)
    : undefined
  const resultModelName = resultItem ? (resultModel?.name ?? resultItem.modelId) : null
  const estimatedResultCost =
    resultItem?.kind === 'tts' && resultItem.status === 'completed' && resultModel
      ? estimateTtsCost(resultModel, resultItem.prompt)
      : null
  const resultCost = resultItem?.costUsd ?? estimatedResultCost ?? undefined
  const resultCostIsEstimated =
    resultItem?.kind === 'tts' && resultItem.costUsd === undefined && estimatedResultCost !== null
  const generating = isActiveGenerationStatus(activeStatus)
  const hasRequiredInput =
    mode === 'stt'
      ? Boolean(audioInput || audioSourceSessionId)
      : Boolean(prompt.trim() && (mode !== 'tts' || ttsSettings.voice.trim()))

  /** Copies completed STT text through the trusted main-process clipboard boundary. */
  const copyTranscription = (): void => {
    if (resultItem?.resultText) void window.app.copyText(resultItem.resultText)
  }
  const workbenchStyle = {
    '--input-panel-width': `${inputPanelPercent}%`,
  } as CSSProperties

  return (
    <main className={styles.container}>
      <SessionsSidebar />
      <section className={styles.workspace}>
        <div ref={workbench} className={styles.workbench} style={workbenchStyle}>
          <section className={styles.inputPanel}>
            <header className={`${styles.panelHeader} ${styles.inputHeader}`}>
              <strong>{t('home.input')}</strong>
              <div className={styles.modeControls}>
                <MediaModeControl value={mode} onChange={(value) => void changeMode(value)} />
              </div>
            </header>
            <div className={styles.panelScroll}>
              <Card className={styles.composer ?? ''} bordered={false}>
                {!hasApiKeys[mode] && (
                  <Alert
                    showIcon
                    type="warning"
                    message={t('home.apiKeyMissing', { mode: t(`modes.${mode}`) })}
                  />
                )}
                {mode === 'stt' ? (
                  <div className={styles.audioInputField}>
                    {audioInput || audioSourceSessionId ? (
                      <div className={styles.audioInputSummary}>
                        <AudioLines size={18} />
                        <span>
                          {audioInput?.name ?? currentSession?.item?.inputAudio?.originalName}
                        </span>
                        <Button
                          type="text"
                          size="small"
                          aria-label={t('home.removeAudio')}
                          icon={<X size={14} />}
                          onClick={() => void removeAudioInput()}
                        />
                      </div>
                    ) : (
                      <Button
                        className={styles.audioUploadButton ?? ''}
                        icon={<Upload size={16} />}
                        onClick={() => void selectAudioInput()}
                      >
                        {t('home.selectAudioFile')}
                      </Button>
                    )}
                    <span className={styles.audioHint}>{t('home.audioFormatsHint')}</span>
                  </div>
                ) : (
                  <Input.TextArea
                    className={styles.prompt ?? ''}
                    value={prompt}
                    rows={6}
                    maxLength={20_000}
                    placeholder={
                      mode === 'tts'
                        ? t('home.enterTextToSynthesize')
                        : t('home.describeToCreate', { mode: t(`modes.${mode}`) })
                    }
                    onChange={(event) => setPrompt(event.target.value)}
                  />
                )}
                <Select
                  className={styles.modelSelect ?? ''}
                  showSearch
                  value={selectedModel?.id ?? ''}
                  options={modelOptions}
                  optionFilterProp="searchText"
                  placeholder={t('home.selectModel')}
                  notFoundContent={t('home.noModelsAvailable')}
                  onChange={(value: string) => void changeModel(value)}
                />

                <div className={styles.settingsGrid}>
                  {mode === 'image' ? (
                    <>
                      {selectedModel?.capabilities.aspect_ratio && (
                        <Select
                          value={imageSettings.aspectRatio}
                          options={getCapabilityValues(selectedModel, 'aspect_ratio').map(
                            (value) => ({ value }),
                          )}
                          onChange={(aspectRatio) => saveModeOption({ aspectRatio })}
                        />
                      )}
                      {selectedModel?.capabilities.resolution && (
                        <Select
                          value={imageSettings.resolution}
                          options={getCapabilityValues(selectedModel, 'resolution').map(
                            (value) => ({
                              value,
                            }),
                          )}
                          onChange={(resolution) => saveModeOption({ resolution })}
                        />
                      )}
                      {selectedModel?.capabilities.quality && (
                        <Select
                          value={imageSettings.quality}
                          options={getCapabilityValues(selectedModel, 'quality', [
                            'auto',
                            'low',
                            'medium',
                            'high',
                          ]).map((value) => ({
                            value,
                            label: t(`home.imageQuality.${value}`, value),
                          }))}
                          onChange={(quality) => saveModeOption({ quality })}
                        />
                      )}
                      {selectedModel?.capabilities.output_format && (
                        <Select
                          value={imageSettings.outputFormat}
                          options={getCapabilityValues(selectedModel, 'output_format', [
                            'png',
                            'jpeg',
                            'webp',
                            'svg',
                          ]).map((value) => ({
                            value,
                            label: t(`home.imageFormat.${value}`, value),
                          }))}
                          onChange={(outputFormat) => saveModeOption({ outputFormat })}
                        />
                      )}
                      {selectedModel?.capabilities.n && (
                        <InputNumber
                          className={styles.nextSettingsRow ?? ''}
                          min={1}
                          max={10}
                          value={imageSettings.count}
                          addonBefore={t('home.count')}
                          onChange={(count) => saveModeOption({ count: count ?? 1 })}
                        />
                      )}
                      {selectedModel?.capabilities.background && (
                        <Select
                          value={imageSettings.background}
                          options={getCapabilityValues(selectedModel, 'background', [
                            'auto',
                            'transparent',
                            'opaque',
                          ]).map((value) => ({
                            value,
                            label: t(`home.imageBackground.${value}`, value),
                          }))}
                          onChange={(background) => saveModeOption({ background })}
                        />
                      )}
                      {selectedModel?.capabilities.output_compression && (
                        <InputNumber
                          min={0}
                          max={100}
                          value={imageSettings.outputCompression}
                          addonBefore={t('home.compression')}
                          onChange={(outputCompression) =>
                            saveModeOption({ outputCompression: outputCompression ?? 90 })
                          }
                        />
                      )}
                      {selectedModel?.capabilities.seed && (
                        <InputNumber
                          min={0}
                          value={imageSettings.seed}
                          placeholder="Seed"
                          onChange={(seed) => saveModeOption({ seed })}
                        />
                      )}
                    </>
                  ) : mode === 'video' ? (
                    <>
                      {Boolean(selectedModel?.supportedDurations.length) && (
                        <Select
                          value={videoSettings.duration}
                          options={(selectedModel?.supportedDurations ?? []).map((value) => ({
                            value,
                            label: `${value}s`,
                          }))}
                          onChange={(duration) => saveModeOption({ duration })}
                        />
                      )}
                      {Boolean(selectedModel?.supportedAspectRatios.length) && (
                        <Select
                          value={videoSettings.aspectRatio}
                          options={(selectedModel?.supportedAspectRatios ?? []).map((value) => ({
                            value,
                          }))}
                          onChange={(aspectRatio) => saveModeOption({ aspectRatio, size: '' })}
                        />
                      )}
                      {Boolean(selectedModel?.supportedResolutions.length) && (
                        <Select
                          value={videoSettings.resolution}
                          options={(selectedModel?.supportedResolutions ?? []).map((value) => ({
                            value,
                          }))}
                          onChange={(resolution) => saveModeOption({ resolution, size: '' })}
                        />
                      )}
                      {Boolean(selectedModel?.supportedSizes.length) && (
                        <Select
                          allowClear
                          aria-label={t('home.exactVideoSize')}
                          value={videoSettings.size || undefined}
                          placeholder={t('home.exactSize')}
                          options={(selectedModel?.supportedSizes ?? []).map((value) => ({
                            value,
                          }))}
                          onChange={(size) => saveModeOption({ size: size ?? '' })}
                        />
                      )}
                      {selectedModel?.supportsAudio && (
                        <div className={`${styles.switchField} ${styles.nextSettingsRow}`}>
                          <span className={styles.switchLabel}>{t('home.audio')}</span>
                          <Switch
                            checked={videoSettings.generateAudio}
                            onChange={(generateAudio) => saveModeOption({ generateAudio })}
                          />
                        </div>
                      )}
                      {selectedModel?.capabilities.seed && (
                        <InputNumber
                          min={0}
                          value={videoSettings.seed}
                          placeholder={t('home.seed')}
                          onChange={(seed) => saveModeOption({ seed })}
                        />
                      )}
                    </>
                  ) : mode === 'tts' ? (
                    <>
                      {selectedModel?.supportsCustomVoice ? (
                        <Input
                          value={ttsSettings.voice}
                          placeholder={t('home.voiceId')}
                          onChange={(event) => saveModeOption({ voice: event.target.value })}
                        />
                      ) : (
                        <Select
                          showSearch
                          value={ttsSettings.voice || undefined}
                          placeholder={t('home.voice')}
                          options={(selectedModel?.supportedVoices ?? []).map((voice) => ({
                            value: voice,
                          }))}
                          onChange={(voice) => saveModeOption({ voice })}
                        />
                      )}
                      <Select
                        className={styles.nextSettingsRow ?? ''}
                        value={ttsSettings.responseFormat}
                        options={[
                          { value: 'mp3', label: t('home.audioFormat.mp3') },
                          { value: 'pcm', label: t('home.audioFormat.pcm') },
                        ]}
                        onChange={(responseFormat) => saveModeOption({ responseFormat })}
                      />
                      <InputNumber
                        min={ttsSpeedRange.min}
                        max={ttsSpeedRange.max}
                        step={0.1}
                        value={ttsSettings.speed}
                        addonBefore={t('home.speed')}
                        onChange={(speed) => saveModeOption({ speed: speed ?? 1 })}
                      />
                      <span className={styles.speechHint}>{t('home.speechHint')}</span>
                    </>
                  ) : (
                    <>
                      <Select
                        showSearch
                        value={sttSettings.language}
                        options={languageOptions}
                        optionFilterProp="label"
                        placeholder={t('home.automaticLanguage')}
                        onChange={(language) => saveModeOption({ language })}
                      />
                      <InputNumber
                        min={0}
                        max={1}
                        step={0.1}
                        value={sttSettings.temperature}
                        addonBefore={t('home.temperature')}
                        onChange={(temperature) =>
                          saveModeOption({ temperature: temperature ?? 0 })
                        }
                      />
                    </>
                  )}
                </div>

                {supportsReferences && (
                  <div className={styles.references}>
                    {references.map((reference, index) => (
                      <div className={styles.reference} key={reference.token}>
                        <img src={reference.previewUrl} alt={reference.name} />
                        <span>
                          {mode === 'video'
                            ? selectedModel?.supportedFrameImages[index]?.replace('_', ' ')
                            : reference.name}
                        </span>
                        <Button
                          type="text"
                          size="small"
                          icon={<X size={13} />}
                          onClick={() => void removeReference(reference.token)}
                        />
                      </div>
                    ))}
                    <Button icon={<Plus size={14} />} onClick={() => void selectReferences()}>
                      {mode === 'image' ? t('home.addReference') : t('home.addFrame')}
                    </Button>
                  </div>
                )}
                <Button
                  type="primary"
                  size="large"
                  block
                  icon={<Sparkles size={17} />}
                  loading={generationLocked}
                  disabled={
                    generationLocked || !hasRequiredInput || !selectedModel || !hasApiKeys[mode]
                  }
                  onClick={() => void generate()}
                >
                  {isRegeneration ? t('home.regenerate') : t('home.generate')}
                </Button>
              </Card>
            </div>
          </section>

          <hr
            className={styles.panelSplitter}
            aria-label={t('home.resizePanels')}
            aria-orientation="vertical"
            aria-valuemin={WORKSPACE_INPUT_PERCENT_LIMITS.min}
            aria-valuemax={WORKSPACE_INPUT_PERCENT_LIMITS.max}
            aria-valuenow={Math.round(inputPanelPercent)}
            tabIndex={0}
            onPointerDown={beginPanelResize}
            onPointerMove={continuePanelResize}
            onPointerUp={endPanelResize}
            onPointerCancel={endPanelResize}
            onDoubleClick={resetPanelSplit}
            onKeyDown={resizePanelsWithKeyboard}
          />

          <section className={styles.outputPanel}>
            <header className={`${styles.panelHeader} ${styles.outputHeader}`}>
              <strong>{t('home.output')}</strong>
              {resultItem && (
                <div className={styles.outputMeta}>
                  <span className={styles.outputModelName} title={resultModelName ?? undefined}>
                    {resultModelName}
                  </span>
                  <span className={styles.metaSeparator} aria-hidden="true" />
                  <span
                    className={styles.cost}
                    title={resultCostIsEstimated ? t('home.estimatedCost') : undefined}
                  >
                    {resultCost !== undefined
                      ? `${resultCostIsEstimated ? '~' : ''}${formatGenerationCost(resultCost)}`
                      : '—'}
                  </span>
                  <span className={styles.metaSeparator} aria-hidden="true" />
                  <Tag
                    className={styles.outputStatus ?? ''}
                    bordered={false}
                    color={getGenerationStatusColor(resultItem.status)}
                  >
                    {resultItem.status.replace('_', ' ')}
                  </Tag>
                </div>
              )}
            </header>
            <div className={styles.panelScroll}>
              {!currentSession?.item ? (
                <div className={styles.emptyOutput}>
                  <Empty description={t('home.emptyOutput')} />
                </div>
              ) : (
                <Card className={styles.result ?? ''} bordered={false}>
                  {generating && (
                    <div className={styles.processing}>
                      <Spin />
                      <span>
                        {currentSession.item.kind === 'video'
                          ? t('home.videoGenerating')
                          : currentSession.item.kind === 'tts'
                            ? t('home.speechGenerating')
                            : currentSession.item.kind === 'stt'
                              ? t('home.transcribing')
                              : t('home.imageGenerating')}
                      </span>
                    </div>
                  )}
                  {currentSession.item.error && (
                    <Alert
                      type="error"
                      showIcon
                      message={
                        currentSession.item.kind === 'video'
                          ? toActionableVideoError(currentSession.item.error)
                          : currentSession.item.error
                      }
                    />
                  )}
                  <div className={styles.mediaGrid}>
                    {currentSession.item.assets.map((asset) => (
                      <figure key={asset.id} className={styles.mediaCard}>
                        {currentSession.item?.kind === 'image' ? (
                          <button
                            type="button"
                            className={styles.previewButton}
                            aria-label={t('home.openImagePreview')}
                            onClick={() => openPreview(asset.url)}
                          >
                            <img src={asset.url} alt={currentSession.title} />
                          </button>
                        ) : currentSession.item?.kind === 'video' ? (
                          // biome-ignore lint/a11y/useMediaCaption: Providers do not return caption tracks with generated video assets.
                          <video src={asset.url} controls preload="metadata" />
                        ) : (
                          // biome-ignore lint/a11y/useMediaCaption: TTS providers return generated speech without a separate caption track.
                          <audio
                            className={styles.audioOutput ?? ''}
                            src={asset.url}
                            controls
                            preload="metadata"
                          />
                        )}
                        <figcaption>
                          <Tooltip title={t('home.saveAs')}>
                            <Button
                              type="text"
                              icon={<Download size={16} />}
                              onClick={() =>
                                void generationActions.saveMedia(currentSession.id, asset.id)
                              }
                            />
                          </Tooltip>
                          <Tooltip title={t('home.showInFolder')}>
                            <Button
                              type="text"
                              icon={<ExternalLink size={16} />}
                              onClick={() =>
                                void generationActions.showInFolder(currentSession.id, asset.id)
                              }
                            />
                          </Tooltip>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                  {currentSession.item.kind === 'stt' &&
                    currentSession.item.status === 'completed' && (
                      <section className={styles.transcriptionOutput}>
                        <header className={styles.transcriptionHeader}>
                          <strong>{t('home.transcription')}</strong>
                          <Tooltip title={t('home.copyTranscription')}>
                            <Button
                              type="text"
                              size="small"
                              icon={<Copy size={15} />}
                              disabled={!currentSession.item.resultText}
                              onClick={copyTranscription}
                            />
                          </Tooltip>
                        </header>
                        <Input.TextArea
                          className={styles.transcriptionText ?? ''}
                          value={currentSession.item.resultText ?? ''}
                          readOnly
                          autoSize={{ minRows: 2, maxRows: 20 }}
                        />
                      </section>
                    )}
                </Card>
              )}
            </div>
          </section>
        </div>
      </section>

      <Modal
        className={styles.previewModal ?? ''}
        open={previewUrl !== null}
        footer={null}
        closable={false}
        centered
        width="fit-content"
        maskClosable
        onCancel={closePreview}
      >
        {previewUrl && (
          <button
            type="button"
            className={styles.previewViewport}
            aria-label={t('home.imagePreviewAria')}
            onWheel={zoomPreview}
            onPointerDown={beginPreviewPan}
            onPointerMove={panPreview}
            onPointerUp={endPreviewPan}
            onPointerCancel={endPreviewPan}
            onDoubleClick={() => setPreviewTransform(INITIAL_PREVIEW_TRANSFORM)}
          >
            <img
              className={styles.fullPreview}
              src={previewUrl}
              alt={t('home.generatedPreview')}
              draggable={false}
              style={{
                transform: `translate3d(${previewTransform.x}px, ${previewTransform.y}px, 0) scale(${previewTransform.scale})`,
              }}
            />
          </button>
        )}
      </Modal>
    </main>
  )
}

export default HomePage
