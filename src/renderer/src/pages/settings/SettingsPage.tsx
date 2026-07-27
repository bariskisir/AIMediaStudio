/**
 * Renders settings navigation with independently authenticated media sections.
 */

import {
  AudioLines,
  Film,
  Image,
  Info,
  Monitor,
  RefreshCw,
  ScrollText,
  Settings2,
  Volume2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setSettingsSection, type SettingsSection } from '@renderer/store/appSlice'
import AboutSettingsSection from './sections/AboutSettingsSection'
import DisplaySettingsSection from './sections/DisplaySettingsSection'
import GeneralSettingsSection from './sections/GeneralSettingsSection'
import ImageSettingsSection from './sections/ImageSettingsSection'
import LoggingSettingsSection from './sections/LoggingSettingsSection'
import SpeechToTextSettingsSection from './sections/SpeechToTextSettingsSection'
import TextToSpeechSettingsSection from './sections/TextToSpeechSettingsSection'
import UpdatesSettingsSection from './sections/UpdatesSettingsSection'
import VideoSettingsSection from './sections/VideoSettingsSection'
import styles from './SettingsPage.module.scss'

/** Renders category navigation and only the selected settings form. */
const SettingsPage = (): React.JSX.Element => {
  const dispatch = useAppDispatch()
  const section = useAppSelector((state) => state.app.settingsSection)
  const { t } = useTranslation()
  const menu: Array<{ key: SettingsSection; label: string; icon: React.JSX.Element }> = [
    { key: 'general', label: t('settings.general'), icon: <Settings2 size={17} /> },
    { key: 'display', label: t('settings.display'), icon: <Monitor size={17} /> },
    { key: 'image', label: t('settings.media.image'), icon: <Image size={17} /> },
    { key: 'video', label: t('settings.media.video'), icon: <Film size={17} /> },
    { key: 'tts', label: t('settings.media.tts'), icon: <Volume2 size={17} /> },
    { key: 'stt', label: t('settings.media.stt'), icon: <AudioLines size={17} /> },
    { key: 'updates', label: t('settings.updates'), icon: <RefreshCw size={17} /> },
    { key: 'logging', label: t('settings.logging'), icon: <ScrollText size={17} /> },
    { key: 'about', label: t('settings.about'), icon: <Info size={17} /> },
  ]

  /** Resolves the active category without retaining inactive credentials in component state. */
  const renderSection = (): React.JSX.Element => {
    if (section === 'display') return <DisplaySettingsSection />
    if (section === 'image') return <ImageSettingsSection />
    if (section === 'video') return <VideoSettingsSection />
    if (section === 'tts') return <TextToSpeechSettingsSection />
    if (section === 'stt') return <SpeechToTextSettingsSection />
    if (section === 'updates') return <UpdatesSettingsSection />
    if (section === 'logging') return <LoggingSettingsSection />
    if (section === 'about') return <AboutSettingsSection />
    return <GeneralSettingsSection />
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.menu}>
        <div className={styles.menuTitle}>{t('settings.title')}</div>
        {menu.map((item) => (
          <button
            type="button"
            className={`${styles.menuItem} ${section === item.key ? styles.active : ''}`}
            key={item.key}
            onClick={() => dispatch(setSettingsSection(item.key))}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </aside>
      {renderSection()}
    </main>
  )
}

export default SettingsPage
