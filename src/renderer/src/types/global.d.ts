/**
 * Adds the typed preload bridge to the renderer Window interface.
 */

import type { AIMediaStudioApi } from '@shared/types'

declare global {
  interface Window {
    app: AIMediaStudioApi
  }
}
