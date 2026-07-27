/**
 * Provides provider-neutral helpers for asynchronous video generation failures.
 */

/** Replaces opaque provider filtering failures with a safe and actionable explanation. */
export const toActionableVideoError = (message: string): string => {
  if (!/(?:content policy|filter|no output|without an output)/i.test(message)) return message
  return 'The video provider returned no output, most likely because its safety filter rejected the prompt. Try a clearly fictional or simulated description, remove sensitive real-world details, or choose another video model.'
}
