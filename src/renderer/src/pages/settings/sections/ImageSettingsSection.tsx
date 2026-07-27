/**
 * Selects the reusable media settings form for image generation.
 */

import MediaSettingsSection from '../components/MediaSettingsSection'

/** Renders image-specific provider, key, model, and default controls. */
const ImageSettingsSection = (): React.JSX.Element => <MediaSettingsSection kind="image" />

export default ImageSettingsSection
