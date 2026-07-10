// lib/wav-encoder.ts — PCM Float32 → WAV (16-bit PCM) encoder

/**
 * Encode collected PCM Float32 chunks into a WAV Blob at 44100Hz mono.
 */
export function encodeWAV(chunks: Float32Array[], sampleRate: number): Blob {
  const totalSamples = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  const pcm16 = float32ToInt16(merged);
  const wavBuffer = buildWavBuffer(pcm16, sampleRate, 1);
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

function float32ToInt16(buffer: Float32Array): Int16Array {
  const out = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function buildWavBuffer(
  pcm16: Int16Array,
  sampleRate: number,
  numChannels: number
): ArrayBuffer {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm16.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const samples = new Int16Array(buffer, 44);
  samples.set(pcm16);
  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Trim both chunk arrays to the shorter length for exact duration match.
 */
export function matchDuration(
  chunksA: Float32Array[],
  chunksB: Float32Array[]
): { chunksA: Float32Array[]; chunksB: Float32Array[] } {
  const totalA = chunksA.reduce((s, c) => s + c.length, 0);
  const totalB = chunksB.reduce((s, c) => s + c.length, 0);
  const minSamples = Math.min(totalA, totalB);

  function trim(chunks: Float32Array[], limit: number): Float32Array[] {
    const result: Float32Array[] = [];
    let remaining = limit;
    for (const chunk of chunks) {
      if (remaining <= 0) break;
      if (chunk.length <= remaining) {
        result.push(chunk);
        remaining -= chunk.length;
      } else {
        result.push(chunk.slice(0, remaining));
        remaining = 0;
      }
    }
    return result;
  }

  return {
    chunksA: trim(chunksA, minSamples),
    chunksB: trim(chunksB, minSamples),
  };
}
