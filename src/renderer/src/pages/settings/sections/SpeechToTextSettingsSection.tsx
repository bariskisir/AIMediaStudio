/**
 * Selects the reusable media settings form for speech-to-text generation.
 */

import MediaSettingsSection from '../components/MediaSettingsSection'

/** Renders STT-specific provider, key, model, and default controls. */
const SpeechToTextSettingsSection = (): React.JSX.Element => <MediaSettingsSection kind="stt" />

export default SpeechToTextSettingsSection
