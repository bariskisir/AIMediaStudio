/**
 * Renders provider, compact connection, model, and defaults for one media workflow.
 */

import { useEffect, useMemo, useState } from 'react'
import { Button, Input, InputNumber, Select, Switch, Tag } from 'antd'
import { CircleCheck, ExternalLink, KeyRound, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getDisplayPrice, OPENROUTER_KEYS_URL } from '@shared/openrouter'
import { createSpeechLanguageOptions } from '@shared/speech'
import type { MediaKind } from '@shared/types'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDesktopActions } from '@renderer/hooks/useDesktopActions'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppSelector } from '@renderer/store'
import { formatModelPrice } from '@renderer/utils/formatters'
import {
  createCompatibleModelPatch,
  getCapabilityRange,
  getCapabilityValues,
  sortModelsByOutputPrice,
} from '@renderer/utils/modelSettings'
import SettingLabel from './SettingLabel'
import styles from '../SettingsPage.module.scss'

interface MediaSettingsSectionProps {
  kind: MediaKind
}

/** Displays one independently authenticated OpenRouter media configuration. */
const MediaSettingsSection = ({ kind }: MediaSettingsSectionProps): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const models = useAppSelector((state) => state.app.models[kind])
  const hasKey = useAppSelector((state) => state.app.hasApiKeys[kind])
  const balance = useAppSelector((state) => state.app.apiBalances[kind])
  const actions = useSettingsActions()
  const desktopActions = useDesktopActions()
  const { theme } = useTheme()
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const light = theme === 'light'
  const modeSettings = settings[kind].providers.openrouter
  const kindLabel = t(`settings.media.${kind}`)
  const sortedModels = useMemo(() => sortModelsByOutputPrice(models), [models])
  const model =
    sortedModels.find((candidate) => candidate.id === modeSettings.modelId) ?? sortedModels[0]
  const balanceText = useMemo(
    () =>
      balance
        .map(({ amount, units }) => {
          try {
            return new Intl.NumberFormat(settings.uiLanguage, {
              style: 'currency',
              currency: units,
            }).format(amount)
          } catch {
            return `${amount.toLocaleString(settings.uiLanguage)} ${units}`
          }
        })
        .join(', '),
    [balance, settings.uiLanguage],
  )
  const modelOptions = useMemo(
    () =>
      sortedModels.map((candidate) => ({
        value: candidate.id,
        searchText: `${candidate.name} ${candidate.id}`,
        label: (
          <span className={styles.modelOption}>
            <span className={styles.modelOptionName}>{candidate.name}</span>
            <span className={styles.modelOptionPrice}>
              {formatModelPrice(getDisplayPrice(candidate), t)}
            </span>
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
    if (!hasKey) {
      setApiKey('')
      return undefined
    }
    let active = true
    void actions.refreshApiBalance(kind)
    void window.app
      .getApiKey({ kind, provider: 'openrouter' })
      .then((savedApiKey) => {
        if (active) setApiKey(savedApiKey ?? '')
      })
      .catch(() => {
        if (active) setApiKey('')
      })
    return () => {
      active = false
    }
  }, [actions.refreshApiBalance, hasKey, kind])

  useEffect(() => {
    if (!model || model.id === modeSettings.modelId) return
    void actions.saveSettings(createCompatibleModelPatch(kind, model, settings))
  }, [actions.saveSettings, kind, modeSettings.modelId, model, settings])

  /** Persists one nested provider default inside only the current media mode. */
  const saveOption = (patch: Record<string, unknown>): void => {
    if (kind === 'image') {
      void actions.saveSettings({ image: { providers: { openrouter: patch } } })
    } else if (kind === 'video') {
      void actions.saveSettings({ video: { providers: { openrouter: patch } } })
    } else if (kind === 'tts') {
      void actions.saveSettings({ tts: { providers: { openrouter: patch } } })
    } else {
      void actions.saveSettings({ stt: { providers: { openrouter: patch } } })
    }
  }

  /** Validates and saves the current mode's credential independently. */
  const saveCredential = async (): Promise<void> => {
    if (!apiKey.trim()) return
    setSavingKey(true)
    try {
      await actions.saveApiKey(kind, apiKey.trim())
    } finally {
      setSavingKey(false)
    }
  }

  /** Deletes this mode's encrypted key and clears its local field after success. */
  const deleteCredential = async (): Promise<void> => {
    if (await actions.deleteApiKey(kind)) setApiKey('')
  }

  /** Reconciles every dependent default before the selected model is persisted. */
  const changeModel = async (modelId: string): Promise<void> => {
    const selected = sortedModels.find((candidate) => candidate.id === modelId)
    if (selected) await actions.saveSettings(createCompatibleModelPatch(kind, selected, settings))
  }

  const image = settings.image.providers.openrouter
  const video = settings.video.providers.openrouter
  const tts = settings.tts.providers.openrouter
  const stt = settings.stt.providers.openrouter
  const ttsSpeedRange = getCapabilityRange(model, 'speed', { min: 0.25, max: 4 })

  return (
    <div className={styles.settingContainer}>
      <h2 className={styles.groupTitle}>
        {t('settings.media.providerHeading', { kind: kindLabel })}
      </h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.media.provider')}
            description={t('settings.media.providerDesc')}
          />
          <Select
            className={styles.compactControl ?? ''}
            value="openrouter"
            options={[{ value: 'openrouter', label: 'OpenRouter' }]}
          />
        </div>
      </section>

      <h2 className={styles.groupTitle}>{t('settings.media.connection')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.apiCreditNotice}>
          <KeyRound size={15} />
          <span>{t('settings.media.apiNotice')}</span>
          <Button
            className={styles.apiCreditLink ?? ''}
            type="link"
            size="small"
            icon={<ExternalLink size={13} />}
            onClick={() => void desktopActions.openExternal(OPENROUTER_KEYS_URL)}
          >
            {t('settings.media.getApiKey')}
          </Button>
        </div>
        <div className={`${styles.settingRow} ${styles.credentialRow}`}>
          <SettingLabel
            title={t('settings.media.apiKey')}
            description={t('settings.media.apiKeyDesc', {
              kind: kindLabel.toLocaleLowerCase(settings.uiLanguage),
            })}
          />
          <div className={styles.statusTag}>
            <Tag
              color={hasKey ? 'green' : 'warning'}
              icon={hasKey ? <CircleCheck size={12} /> : <KeyRound size={12} />}
            >
              {hasKey ? t('settings.media.configured') : t('settings.media.required')}
            </Tag>
          </div>
          <Input.Password
            className={styles.flexControl}
            value={apiKey}
            visibilityToggle
            placeholder={t('settings.media.pasteKey')}
            autoComplete="off"
            onChange={(event) => setApiKey(event.target.value)}
            onPressEnter={() => void saveCredential()}
          />
          <div className={styles.settingControl}>
            {hasKey && (
              <Button
                danger
                {...(!light ? { type: 'primary' as const } : {})}
                icon={<Trash2 size={14} />}
                onClick={() => void deleteCredential()}
              >
                {t('settings.media.delete')}
              </Button>
            )}
            <Button
              type="primary"
              {...(light ? { ghost: true } : {})}
              loading={savingKey}
              disabled={!apiKey.trim()}
              icon={<Save size={14} />}
              onClick={() => void saveCredential()}
            >
              {t('settings.media.save')}
            </Button>
          </div>
        </div>
        {balanceText && (
          <div className={styles.settingRow}>
            <SettingLabel
              title={t('settings.media.balance')}
              description={t('settings.media.balanceDesc')}
            />
            <div className={styles.settingControl}>
              <strong className={styles.balanceValue}>{balanceText}</strong>
              <Button
                type="text"
                aria-label={t('settings.media.refreshBalance')}
                icon={<RefreshCw size={14} />}
                onClick={() => void actions.refreshApiBalance(kind)}
              />
            </div>
          </div>
        )}
      </section>

      <h2 className={styles.groupTitle}>{t('settings.media.modelDefaults')}</h2>
      <section className={styles.settingGroup}>
        <div className={`${styles.settingRow} ${styles.stackedRow}`}>
          <SettingLabel
            title={t('settings.media.model')}
            description={t('settings.media.modelDesc')}
          />
          <div className={styles.fullControl}>
            <div className={`${styles.settingControl} ${styles.fullControl}`}>
              <Select
                className={`${styles.flexControl} ${styles.modelSelect}`}
                showSearch
                value={model?.id ?? ''}
                options={modelOptions}
                optionFilterProp="searchText"
                notFoundContent={t('settings.media.noModels')}
                onChange={(modelId: string) => void changeModel(modelId)}
              />
              <Button
                type="text"
                aria-label={t('settings.media.refreshModels')}
                icon={<RefreshCw size={15} />}
                onClick={() => void actions.refreshModels(kind)}
              />
            </div>
          </div>
        </div>
        {kind === 'image' ? (
          <>
            {model?.capabilities.aspect_ratio && (
              <div className={styles.settingRow}>
                <SettingLabel
                  title={t('settings.media.aspectRatio')}
                  description={t('settings.media.aspectRatioDesc')}
                />
                <Select
                  className={styles.compactControl ?? ''}
                  value={image.aspectRatio}
                  options={getCapabilityValues(model, 'aspect_ratio').map((value) => ({ value }))}
                  onChange={(aspectRatio) => saveOption({ aspectRatio })}
                />
              </div>
            )}
            {model?.capabilities.resolution && (
              <div className={styles.settingRow}>
                <SettingLabel
                  title={t('settings.media.resolution')}
                  description={t('settings.media.resolutionImgDesc')}
                />
                <Select
                  className={styles.compactControl ?? ''}
                  value={image.resolution}
                  options={getCapabilityValues(model, 'resolution').map((value) => ({ value }))}
                  onChange={(resolution) => saveOption({ resolution })}
                />
              </div>
            )}
            {model?.capabilities.quality && (
              <div className={styles.settingRow}>
                <SettingLabel
                  title={t('settings.media.quality')}
                  description={t('settings.media.qualityDesc')}
                />
                <Select
                  className={styles.compactControl ?? ''}
                  value={image.quality}
                  options={getCapabilityValues(model, 'quality', [
                    'auto',
                    'low',
                    'medium',
                    'high',
                  ]).map((value) => ({ value }))}
                  onChange={(quality) => saveOption({ quality })}
                />
              </div>
            )}
            {model?.capabilities.output_format && (
              <div className={styles.settingRow}>
                <SettingLabel
                  title={t('settings.media.format')}
                  description={t('settings.media.formatImgDesc')}
                />
                <Select
                  className={styles.compactControl ?? ''}
                  value={image.outputFormat}
                  options={getCapabilityValues(model, 'output_format', [
                    'png',
                    'jpeg',
                    'webp',
                    'svg',
                  ]).map((value) => ({ value }))}
                  onChange={(outputFormat) => saveOption({ outputFormat })}
                />
              </div>
            )}
            {model?.capabilities.n && (
              <div className={styles.settingRow}>
                <SettingLabel
                  title={t('settings.media.count')}
                  description={t('settings.media.countDesc')}
                />
                <InputNumber
                  min={1}
                  max={10}
                  value={image.count}
                  onChange={(count) => saveOption({ count: count ?? 1 })}
                />
              </div>
            )}
            {model?.capabilities.background && (
              <div className={styles.settingRow}>
                <SettingLabel
                  title={t('settings.media.background')}
                  description={t('settings.media.backgroundDesc')}
                />
                <Select
                  className={styles.compactControl ?? ''}
                  value={image.background}
                  options={getCapabilityValues(model, 'background', [
                    'auto',
                    'transparent',
                    'opaque',
                  ]).map((value) => ({ value }))}
                  onChange={(background) => saveOption({ background })}
                />
              </div>
            )}
            {model?.capabilities.output_compression && (
              <div className={styles.settingRow}>
                <SettingLabel
                  title={t('settings.media.compression')}
                  description={t('settings.media.compressionDesc')}
                />
                <InputNumber
                  min={0}
                  max={100}
                  value={image.outputCompression}
                  onChange={(outputCompression) =>
                    saveOption({ outputCompression: outputCompression ?? 90 })
                  }
                />
              </div>
            )}
            {model?.capabilities.seed && (
              <div className={styles.settingRow}>
                <SettingLabel
                  title={t('settings.media.seed')}
                  description={t('settings.media.seedImgDesc')}
                />
                <InputNumber
                  min={0}
                  value={image.seed}
                  placeholder="Automatic"
                  onChange={(seed) => saveOption({ seed })}
                />
              </div>
            )}
          </>
        ) : kind === 'video' ? (
          <>
            {Boolean(model?.supportedDurations.length) && (
              <div className={styles.settingRow}>
                <SettingLabel
                  title={t('settings.media.duration')}
                  description={t('settings.media.durationDesc')}
                />
                <Select
                  className={styles.compactControl ?? ''}
                  value={video.duration}
                  options={(model?.supportedDurations ?? []).map((value) => ({
                    value,
                    label: `${value}s`,
                  }))}
                  onChange={(duration) => saveOption({ duration })}
                />
              </div>
            )}
            {Boolean(model?.supportedAspectRatios.length) && (
              <div className={styles.settingRow}>
                <SettingLabel
                  title={t('settings.media.videoAspectRatio')}
                  description={t('settings.media.videoAspectRatioDesc')}
                />
                <Select
                  className={styles.compactControl ?? ''}
                  value={video.aspectRatio}
                  options={(model?.supportedAspectRatios ?? []).map((value) => ({ value }))}
                  onChange={(aspectRatio) => saveOption({ aspectRatio, size: '' })}
                />
              </div>
            )}
            {Boolean(model?.supportedResolutions.length) && (
              <div className={styles.settingRow}>
                <SettingLabel
                  title={t('settings.media.resolution')}
                  description={t('settings.media.resolutionVidDesc')}
                />
                <Select
                  className={styles.compactControl ?? ''}
                  value={video.resolution}
                  options={(model?.supportedResolutions ?? []).map((value) => ({ value }))}
                  onChange={(resolution) => saveOption({ resolution, size: '' })}
                />
              </div>
            )}
            {Boolean(model?.supportedSizes.length) && (
              <div className={styles.settingRow}>
                <SettingLabel
                  title={t('settings.media.exactSize')}
                  description={t('settings.media.exactSizeDesc')}
                />
                <Select
                  allowClear
                  className={styles.compactControl ?? ''}
                  value={video.size || undefined}
                  placeholder={t('settings.media.seedPlaceholder')}
                  options={(model?.supportedSizes ?? []).map((value) => ({ value }))}
                  onChange={(size) => saveOption({ size: size ?? '' })}
                />
              </div>
            )}
            {model?.supportsAudio && (
              <div className={styles.settingRow}>
                <SettingLabel
                  title={t('settings.media.audio')}
                  description={t('settings.media.audioDesc')}
                />
                <Switch
                  checked={video.generateAudio}
                  onChange={(generateAudio) => saveOption({ generateAudio })}
                />
              </div>
            )}
            {model?.capabilities.seed && (
              <div className={styles.settingRow}>
                <SettingLabel
                  title={t('settings.media.seed')}
                  description={t('settings.media.seedVidDesc')}
                />
                <InputNumber
                  min={0}
                  value={video.seed}
                  placeholder={t('settings.media.seedPlaceholder')}
                  onChange={(seed) => saveOption({ seed })}
                />
              </div>
            )}
          </>
        ) : kind === 'tts' ? (
          <>
            <div className={styles.settingRow}>
              <SettingLabel
                title={t('settings.media.voice')}
                description={t('settings.media.voiceDesc')}
              />
              {model?.supportsCustomVoice ? (
                <Input
                  className={styles.compactControl ?? ''}
                  value={tts.voice}
                  placeholder={t('settings.media.enterVoiceId')}
                  onChange={(event) => saveOption({ voice: event.target.value })}
                />
              ) : (
                <Select
                  showSearch
                  className={styles.compactControl ?? ''}
                  value={tts.voice || undefined}
                  placeholder={t('settings.media.selectVoice')}
                  options={(model?.supportedVoices ?? []).map((voice) => ({
                    value: voice,
                  }))}
                  onChange={(voice) => saveOption({ voice })}
                />
              )}
            </div>
            <div className={styles.settingRow}>
              <SettingLabel
                title={t('settings.media.format')}
                description={t('settings.media.formatTtsDesc')}
              />
              <Select
                className={styles.compactControl ?? ''}
                value={tts.responseFormat}
                options={[
                  { value: 'mp3', label: 'MP3' },
                  { value: 'pcm', label: 'PCM' },
                ]}
                onChange={(responseFormat) => saveOption({ responseFormat })}
              />
            </div>
            <div className={styles.settingRow}>
              <SettingLabel
                title={t('settings.media.speed')}
                description={t('settings.media.speedDesc')}
              />
              <InputNumber
                min={ttsSpeedRange.min}
                max={ttsSpeedRange.max}
                step={0.1}
                value={tts.speed}
                onChange={(speed) => saveOption({ speed: speed ?? 1 })}
              />
            </div>
          </>
        ) : (
          <>
            <div className={styles.settingRow}>
              <SettingLabel
                title={t('settings.media.language')}
                description={t('settings.media.languageDesc')}
              />
              <Select
                showSearch
                className={styles.compactControl ?? ''}
                value={stt.language}
                options={languageOptions}
                optionFilterProp="label"
                placeholder={t('settings.media.automaticDetection')}
                onChange={(language) => saveOption({ language })}
              />
            </div>
            <div className={styles.settingRow}>
              <SettingLabel
                title={t('settings.media.temperature')}
                description={t('settings.media.temperatureDesc')}
              />
              <InputNumber
                min={0}
                max={1}
                step={0.1}
                value={stt.temperature}
                onChange={(temperature) => saveOption({ temperature: temperature ?? 0 })}
              />
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export default MediaSettingsSection
