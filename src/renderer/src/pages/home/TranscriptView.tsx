/**
 * Renders source and translated live transcripts with sentence-level hover correspondence.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dropdown, type MenuProps } from 'antd'
import { AudioLines, Download, GripHorizontal, Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SESSION_FORMATS, type SessionFormat } from '@shared/types'
import { useAppSelector } from '@renderer/store'
import styles from './TranscriptView.module.scss'

interface TranscriptViewProps {
  onExport: (id: string, format: SessionFormat) => Promise<void>
}

/** Displays final and interim source text above its optional live translated sentences. */
const TranscriptView = ({ onExport }: TranscriptViewProps): React.JSX.Element => {
  const transcript = useAppSelector((state) => state.app.currentSession)
  const interim = useAppSelector((state) => state.app.interim)
  const compactMode = useAppSelector((state) => state.app.compactMode)
  const session = useAppSelector((state) => state.app.session.state)
  const settings = useAppSelector((state) => state.app.settings)
  const sourceScrollRef = useRef<HTMLDivElement>(null)
  const translationScrollRef = useRef<HTMLDivElement>(null)
  const panesRef = useRef<HTMLDivElement>(null)
  const [hoveredTranslationId, setHoveredTranslationId] = useState<string | null>(null)
  const [splitRatio, setSplitRatio] = useState(0.5)
  const dragging = useRef(false)
  const { t } = useTranslation()

  const handleDividerMouseDown = useCallback((event: React.MouseEvent): void => {
    event.preventDefault()
    dragging.current = true
    const onMove = (moveEvent: MouseEvent): void => {
      if (!dragging.current || !panesRef.current) return
      const rect = panesRef.current.getBoundingClientRect()
      const offset = moveEvent.clientY - rect.top
      const ratio = Math.max(0.15, Math.min(0.85, offset / rect.height))
      setSplitRatio(ratio)
    }
    const onUp = (): void => {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [])
  const finalText = useMemo(
    () =>
      transcript?.segments
        .map((segment) => segment.text.trim())
        .filter(Boolean)
        .join(' ') ?? '',
    [transcript?.segments],
  )
  const translations = useMemo(
    () =>
      [...(transcript?.translations ?? [])]
        .filter(
          (translation) =>
            translation.provider === settings.translationProvider &&
            translation.targetLanguage === settings.translationTargetLanguage,
        )
        .sort((left, right) => left.sourceStartIndex - right.sourceStartIndex),
    [settings.translationProvider, settings.translationTargetLanguage, transcript?.translations],
  )
  const translatedText = translations.map((translation) => translation.text.trim()).join(' ')
  const liveText = [finalText, interim.microphone, interim.speaker].filter(Boolean).join(' ')
  const translationEnabled = settings.translationEnabled
  const targetLanguageName = useMemo(() => {
    if (!translationEnabled) return ''
    const names = new Intl.DisplayNames([settings.uiLanguage, 'en'], { type: 'language' })
    return names.of(settings.translationTargetLanguage) ?? settings.translationTargetLanguage
  }, [settings.translationTargetLanguage, settings.uiLanguage, translationEnabled])

  /** Keeps each live pane pinned to its newest text while content grows. */
  useEffect(() => {
    if (liveText && sourceScrollRef.current) {
      sourceScrollRef.current.scrollTop = sourceScrollRef.current.scrollHeight
    }
  }, [liveText])

  useEffect(() => {
    if (translatedText && translationScrollRef.current) {
      translationScrollRef.current.scrollTop = translationScrollRef.current.scrollHeight
    }
  }, [translatedText])

  /** Splits source text around translated ranges so matching sentences can highlight together. */
  const renderMappedSourceText = (): React.ReactNode[] => {
    const nodes: React.ReactNode[] = []
    let cursor = 0

    translations.forEach((translation) => {
      const start = translation.sourceStartIndex
      const end = translation.sourceEndIndex
      if (start < cursor || end <= start || end > finalText.length) return
      if (start > cursor) nodes.push(finalText.slice(cursor, start))
      const highlighted = hoveredTranslationId === translation.id
      nodes.push(
        <mark
          className={`${styles.mappedSentence} ${highlighted ? styles.highlightedSentence : ''}`}
          key={translation.id}
          onMouseEnter={() => setHoveredTranslationId(translation.id)}
          onMouseLeave={() => setHoveredTranslationId(null)}
        >
          {finalText.slice(start, end)}
        </mark>,
      )
      cursor = end
    })

    if (cursor < finalText.length) nodes.push(finalText.slice(cursor))
    return nodes
  }

  const exportItems: MenuProps['items'] = SESSION_FORMATS.map((format) => ({
    key: format,
    label: t('transcript.exportAs', { format: format.toUpperCase() }),
  }))
  const hasContent = Boolean(liveText)

  return (
    <section className={styles.container}>
      <div ref={panesRef} className={styles.panes}>
        <div
          ref={sourceScrollRef}
          className={`${styles.scrollArea} selectable`}
          style={{ flex: translationEnabled ? splitRatio : 1 }}
        >
          {!hasContent ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <AudioLines size={25} />
              </div>
              <h2>{t('transcript.emptyTitle')}</h2>
              <p>{t('transcript.emptyDescription')}</p>
            </div>
          ) : (
            <div className={styles.transcriptBody}>
              <p className={styles.continuousText}>
                {renderMappedSourceText()}
                {finalText && (interim.microphone || interim.speaker) ? ' ' : ''}
                {(['microphone', 'speaker'] as const).map((source) =>
                  interim[source] ? (
                    <span className={styles.interimText} key={source}>
                      {interim[source].trim()}{' '}
                    </span>
                  ) : null,
                )}
              </p>
            </div>
          )}
        </div>

        {translationEnabled && (
          <>
            <button
              type="button"
              className={styles.translationDivider}
              aria-label={t('transcript.translationTo', { language: targetLanguageName })}
              onMouseDown={handleDividerMouseDown}
            >
              <GripHorizontal size={12} />
              <Languages size={13} />
              <span>{t('transcript.translationTo', { language: targetLanguageName })}</span>
            </button>
            <div
              ref={translationScrollRef}
              className={`${styles.scrollArea} ${styles.translationPane} selectable`}
              style={{ flex: `${1 - splitRatio}` }}
            >
              {translations.length === 0 ? (
                <div className={styles.translationEmpty}>{t('transcript.translationWaiting')}</div>
              ) : (
                <div className={styles.transcriptBody}>
                  <p className={styles.continuousText}>
                    {translations.map((translation, index) => (
                      <span key={translation.id}>
                        {index > 0 ? ' ' : ''}
                        <mark
                          className={`${styles.mappedSentence} ${hoveredTranslationId === translation.id ? styles.highlightedSentence : ''}`}
                          onMouseEnter={() => setHoveredTranslationId(translation.id)}
                          onMouseLeave={() => setHoveredTranslationId(null)}
                        >
                          {translation.text.trim()}
                        </mark>
                      </span>
                    ))}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {!compactMode && (
        <footer className={styles.footer}>
          <span className={`${styles.status} ${session === 'recording' ? styles.active : ''}`}>
            <span className={styles.statusDot} />
            {t(`status.${session}`)}
          </span>
          <span>{t('transcript.segments', { count: transcript?.segments.length ?? 0 })}</span>
          <span className={styles.footerSpacer} />
          {transcript && transcript.segments.length > 0 && (
            <Dropdown
              menu={{
                items: exportItems,
                onClick: ({ key }) => void onExport(transcript.id, key as SessionFormat),
              }}
              trigger={['click']}
            >
              <Button type="text" size="small" icon={<Download size={14} />}>
                {t('transcript.export')}
              </Button>
            </Dropdown>
          )}
        </footer>
      )}
    </section>
  )
}

export default TranscriptView
