/**
 * Contains the isolated AudioWorklet source used for 16 kHz mono PCM16 conversion.
 */

export const PCM_WORKLET_SOURCE = `
/** Converts Web Audio float frames into bounded PCM16 chunks. */
class TranscriptPcmProcessor extends AudioWorkletProcessor {
  /** Initializes the resampler and output buffers. */
  constructor(options) {
    super()
    this.targetRate = options.processorOptions.targetRate
    this.chunkSize = options.processorOptions.chunkSize
    this.position = 0
    this.output = []
    this.levelTick = 0
    this.levelInterval = Math.max(1, Math.round(sampleRate / 128 / 10))
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'flush') this.flush()
    }
  }

  /** Downsamples each render quantum and reports both PCM and meter data. */
  process(inputs) {
    const channels = inputs[0]
    const firstChannel = channels && channels[0]
    if (!channels || channels.length === 0 || !firstChannel || firstChannel.length === 0) return true
    const mono = new Float32Array(firstChannel.length)
    for (let index = 0; index < mono.length; index += 1) {
      let sample = 0
      for (let channel = 0; channel < channels.length; channel += 1) {
        sample += channels[channel][index] || 0
      }
      mono[index] = sample / channels.length
    }
    const ratio = sampleRate / this.targetRate
    let position = this.position
    let energy = 0
    for (let index = 0; index < mono.length; index += 1) energy += mono[index] * mono[index]
    while (position < mono.length) {
      const sample = Math.max(-1, Math.min(1, mono[Math.floor(position)] || 0))
      this.output.push(sample < 0 ? sample * 32768 : sample * 32767)
      position += ratio
    }
    this.position = position - mono.length
    this.levelTick += 1
    if (this.levelTick >= this.levelInterval) {
      this.port.postMessage({ type: 'level', value: Math.sqrt(energy / mono.length) })
      this.levelTick = 0
    }
    while (this.output.length >= this.chunkSize) {
      const pcm = Int16Array.from(this.output.splice(0, this.chunkSize))
      this.port.postMessage({ type: 'pcm', buffer: pcm.buffer }, [pcm.buffer])
    }
    return true
  }

  /** Emits the last partial packet and confirms that the renderer can close safely. */
  flush() {
    if (this.output.length > 0) {
      const pcm = Int16Array.from(this.output.splice(0))
      this.port.postMessage({ type: 'pcm', buffer: pcm.buffer }, [pcm.buffer])
    }
    this.port.postMessage({ type: 'flushed' })
  }
}

registerProcessor('transcript-pcm-processor', TranscriptPcmProcessor)
`
