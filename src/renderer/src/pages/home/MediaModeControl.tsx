/**
 * Renders the four media workflows as a compact input-panel-responsive selector.
 */

import { AudioLines, Film, Image, Volume2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MediaKind } from '@shared/types'
import styles from './MediaModeControl.module.scss'

interface MediaModeControlProps {
  value: MediaKind
  onChange(value: MediaKind): void
}

/** Selects one workflow while preserving a radio-like accessible interaction model. */
const MediaModeControl = ({ value, onChange }: MediaModeControlProps): React.JSX.Element => {
  const { t } = useTranslation()

  const MODE_OPTIONS: Array<{
    value: MediaKind
    label: string
    icon: React.JSX.Element
  }> = [
    { value: 'image', label: t('modes.image'), icon: <Image size={13} /> },
    { value: 'video', label: t('modes.video'), icon: <Film size={13} /> },
    { value: 'tts', label: t('modes.tts'), icon: <Volume2 size={13} /> },
    { value: 'stt', label: t('modes.stt'), icon: <AudioLines size={13} /> },
  ]

  return (
    <div className={styles.control} role="radiogroup" aria-label="Media workflow">
      {MODE_OPTIONS.map((option) => (
        <label
          className={`${styles.option} ${value === option.value ? styles.selected : ''}`}
          key={option.value}
        >
          <input
            type="radio"
            name="media-workflow"
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          {option.icon}
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  )
}

export default MediaModeControl
