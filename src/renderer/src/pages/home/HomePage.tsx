/**
 * Composes the transcript-specific controls and full-space transcript surface.
 */

import ControlBar from './ControlBar'
import TranscriptView from './TranscriptView'
import SessionsSidebar from '@renderer/components/sidebar/SessionsSidebar'
import { useAppSelector } from '@renderer/store'
import { useRecordingActions } from '@renderer/hooks/useRecordingActions'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useSessionActions } from '@renderer/hooks/useSessionActions'
import styles from './HomePage.module.scss'

/** Renders the primary live transcription workspace. */
const HomePage = (): React.JSX.Element => {
  const compactMode = useAppSelector((state) => state.app.compactMode)
  const recordingActions = useRecordingActions()
  const settingsActions = useSettingsActions()
  const sessionActions = useSessionActions()
  return (
    <main className={styles.container}>
      {!compactMode && <SessionsSidebar />}
      <section className={styles.workspace}>
        {!compactMode && (
          <ControlBar
            captureService={recordingActions.captureService}
            onSettingsChange={settingsActions.saveSettings}
            onStart={recordingActions.startRecording}
            onStop={recordingActions.stopRecording}
          />
        )}
        <TranscriptView onExport={sessionActions.exportSession} />
      </section>
    </main>
  )
}

export default HomePage
