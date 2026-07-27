/**
 * Selects the reusable media settings form for video generation.
 */

import MediaSettingsSection from '../components/MediaSettingsSection'

/** Renders video-specific provider, key, model, and default controls. */
const VideoSettingsSection = (): React.JSX.Element => <MediaSettingsSection kind="video" />

export default VideoSettingsSection
