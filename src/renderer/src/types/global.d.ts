/**
 * Adds the typed preload bridge to the renderer Window interface.
 */

import type { TranscriptApi } from '@shared/types'

declare global {
  interface Window {
    app: TranscriptApi
  }
}
