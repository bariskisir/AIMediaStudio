/**
 * Renders the reusable settings shell and delegates each category to an isolated section.
 */

import {
  AudioLines,
  Info,
  Languages,
  Monitor,
  RefreshCw,
  ScrollText,
  Settings2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setSettingsSection, type SettingsSection } from '@renderer/store/appSlice'
import AboutSettingsSection from './sections/AboutSettingsSection'
import GeneralSettingsSection from './sections/GeneralSettingsSection'
import DisplaySettingsSection from './sections/DisplaySettingsSection'
import LoggingSettingsSection from './sections/LoggingSettingsSection'
import TranscriptionSettingsSection from './sections/TranscriptionSettingsSection'
import TranslationSettingsSection from './sections/TranslationSettingsSection'
import UpdatesSettingsSection from './sections/UpdatesSettingsSection'
import styles from './SettingsPage.module.scss'

/** Renders category navigation and the selected settings section. */
const SettingsPage = (): React.JSX.Element => {
  const dispatch = useAppDispatch()
  const section = useAppSelector((state) => state.app.settingsSection)
  const { t } = useTranslation()
  const menu: Array<{
    key: SettingsSection
    label: string
    icon: React.JSX.Element
  }> = [
    { key: 'general', label: t('settings.general'), icon: <Settings2 size={17} /> },
    { key: 'display', label: t('settings.display'), icon: <Monitor size={17} /> },
    {
      key: 'transcription',
      label: t('settings.transcription'),
      icon: <AudioLines size={17} />,
    },
    {
      key: 'translation',
      label: t('settings.translation'),
      icon: <Languages size={17} />,
    },
    { key: 'updates', label: t('settings.updates'), icon: <RefreshCw size={17} /> },
    { key: 'logging', label: t('settings.logging'), icon: <ScrollText size={17} /> },
    { key: 'about', label: t('settings.about'), icon: <Info size={17} /> },
  ]

  /** Resolves the active category component without keeping inactive forms mounted. */
  const renderSection = (): React.JSX.Element => {
    if (section === 'display') return <DisplaySettingsSection />
    if (section === 'transcription') return <TranscriptionSettingsSection />
    if (section === 'translation') return <TranslationSettingsSection />
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
