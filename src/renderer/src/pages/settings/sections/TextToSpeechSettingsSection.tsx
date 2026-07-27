/**
 * Selects the reusable media settings form for text-to-speech generation.
 */

import MediaSettingsSection from '../components/MediaSettingsSection'

/** Renders TTS-specific provider, key, model, and default controls. */
const TextToSpeechSettingsSection = (): React.JSX.Element => <MediaSettingsSection kind="tts" />

export default TextToSpeechSettingsSection
