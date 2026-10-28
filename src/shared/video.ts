/**
 * Provides provider-neutral helpers for asynchronous video generation failures.
 */

/** Replaces opaque provider filtering or server failures with an actionable explanation. */
export const toActionableVideoError = (message: string): string => {
  const serverStatus = /\bHTTP (5\d\d)\b/i.exec(message)?.[1]
  if (serverStatus) {
    return `The video provider is temporarily unavailable (HTTP ${serverStatus}). Wait a moment and try again, or choose another video model.`
  }
  if (!/(?:content policy|filter|no output|without an output)/i.test(message)) return message
  return 'The video provider returned no output, most likely because its safety filter rejected the prompt. Try a clearly fictional or simulated description, remove sensitive real-world details, or choose another video model.'
}
