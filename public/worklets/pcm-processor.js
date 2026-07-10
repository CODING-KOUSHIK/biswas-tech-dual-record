/**
 * public/worklets/pcm-processor.js
 * AudioWorklet processor: captures raw PCM Float32 samples and posts
 * them to the main thread in 4096-sample chunks.
 */

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 4096;
    this._recording = false;

    this.port.onmessage = (event) => {
      if (event.data === 'start') {
        this._recording = true;
        this._buffer = [];
      } else if (event.data === 'stop') {
        this._recording = false;
        // Flush any remaining samples
        if (this._buffer.length > 0) {
          this.port.postMessage({ type: 'chunk', samples: this._buffer.slice() });
          this._buffer = [];
        }
        this.port.postMessage({ type: 'done' });
      }
    };
  }

  process(inputs) {
    if (!this._recording) return true;

    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channel = input[0];

    for (let i = 0; i < channel.length; i++) {
      this._buffer.push(channel[i]);
      if (this._buffer.length >= this._bufferSize) {
        this.port.postMessage({ type: 'chunk', samples: this._buffer.slice() });
        this._buffer = [];
      }
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
