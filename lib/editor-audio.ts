"use client";

import type { PersistedTrackSegment } from "@/lib/editor-draft-storage";

export const WAVEFORM_HEIGHT = 176;
export const DEFAULT_SEGMENT_LENGTH = 15;
export const DEFAULT_FADE_SECONDS = "2.0";
export const LIBRARY_SEGMENT_FADE_SECONDS = "0.0";
export const DEFAULT_TRACK_OUTPUT_GAIN = 1;
export const WAVEFORM_PEAK_SAMPLES = 1400;

const WAVEFORM_TARGET_FILL_RATIO = 0.9;

export type PlaybackOverlay = {
  id: string;
  start: number;
  end: number;
  isActive?: boolean;
};

export type ProcessedSegmentData = {
  id: string;
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  sampleCount: number;
};

type EncodableAudioData = Pick<ProcessedSegmentData, "left" | "right" | "sampleRate" | "sampleCount">;

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const parseFadeSeconds = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export const normalizeFadeInput = (value: string) => parseFadeSeconds(value).toFixed(1);

const getAudioContextCtor = () =>
  window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

export const decodeAudioArrayBuffer = async (arrayBuffer: ArrayBuffer) => {
  const AudioContextCtor = getAudioContextCtor();

  if (!AudioContextCtor) {
    throw new Error("Audio processing is not supported in this browser.");
  }

  const audioCtx = new AudioContextCtor();

  try {
    return await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await audioCtx.close();
  }
};

export const decodeAudioFile = async (file: File) => decodeAudioArrayBuffer(await file.arrayBuffer());

export const getWaveformPeakMagnitude = (channels: number[][]) =>
  channels.reduce((currentMax, channel) => {
    let channelPeak = currentMax;

    for (const sample of channel) {
      const magnitude = Math.abs(sample);
      if (magnitude > channelPeak) {
        channelPeak = magnitude;
      }
    }

    return channelPeak;
  }, 0);

export const scaleWaveformPeaks = (channels: number[][], gainMultiplier: number) =>
  channels.map((channel) => channel.map((sample) => Math.round(sample * gainMultiplier * 10000) / 10000));

export const getWaveformReferencePeak = (sourcePeak: number) => {
  const safePeak = sourcePeak > 0 ? sourcePeak : 1;
  return safePeak / WAVEFORM_TARGET_FILL_RATIO;
};

export const createSegmentId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const createSegment = (start: number, end: number): PersistedTrackSegment => ({
  id: createSegmentId(),
  start,
  end,
  fadeInInput: DEFAULT_FADE_SECONDS,
  fadeOutInput: DEFAULT_FADE_SECONDS,
});

export const createSavedSegment = (start: number, end: number): PersistedTrackSegment => ({
  id: createSegmentId(),
  start,
  end,
  fadeInInput: LIBRARY_SEGMENT_FADE_SECONDS,
  fadeOutInput: LIBRARY_SEGMENT_FADE_SECONDS,
});

export const getSuggestedSegmentWindow = (trackDuration: number, seedTime: number) => {
  if (trackDuration <= 0) {
    return { start: 0, end: 0 };
  }

  const segmentLength = Math.min(DEFAULT_SEGMENT_LENGTH, trackDuration);
  const maxStart = Math.max(0, trackDuration - segmentLength);
  const start = clamp(seedTime, 0, maxStart);
  const end = Math.min(trackDuration, start + segmentLength);

  return { start, end };
};

export const normalizeSegmentsForDuration = (segments: PersistedTrackSegment[], trackDuration: number) => {
  if (trackDuration <= 0) {
    return [];
  }

  const fallbackWindow = getSuggestedSegmentWindow(trackDuration, 0);
  const baseSegments = segments.length ? segments : [createSegment(fallbackWindow.start, fallbackWindow.end)];
  const minimumLength = Math.min(0.25, trackDuration);
  const maxStart = Math.max(0, trackDuration - minimumLength);

  return baseSegments.map((segment, index) => {
    const defaultWindow = getSuggestedSegmentWindow(trackDuration, index * DEFAULT_SEGMENT_LENGTH);
    const start = clamp(Number.isFinite(segment.start) ? segment.start : defaultWindow.start, 0, maxStart);
    const minimumEnd = Math.min(trackDuration, start + minimumLength);
    const defaultEnd = Math.min(trackDuration, start + DEFAULT_SEGMENT_LENGTH);
    const end = clamp(Number.isFinite(segment.end) ? segment.end : defaultEnd, minimumEnd, trackDuration);

    return {
      ...segment,
      id: segment.id || createSegmentId(),
      start,
      end: end > start ? end : defaultWindow.end,
      fadeInInput: segment.fadeInInput || DEFAULT_FADE_SECONDS,
      fadeOutInput: segment.fadeOutInput || DEFAULT_FADE_SECONDS,
    };
  });
};

export const areSegmentsEquivalent = (left: PersistedTrackSegment[], right: PersistedTrackSegment[]) =>
  left.length === right.length &&
  left.every((segment, index) => {
    const other = right[index];

    return (
      other &&
      segment.id === other.id &&
      segment.start === other.start &&
      segment.end === other.end &&
      segment.fadeInInput === other.fadeInInput &&
      segment.fadeOutInput === other.fadeOutInput
    );
  });

export const buildProcessedSegmentData = ({
  segmentId,
  audioBuffer,
  start,
  end,
  fadeInSeconds,
  fadeOutSeconds,
  gainMultiplier = DEFAULT_TRACK_OUTPUT_GAIN,
}: {
  segmentId: string;
  audioBuffer: AudioBuffer;
  start: number;
  end: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  gainMultiplier?: number;
}): ProcessedSegmentData => {
  const startSample = Math.floor(start * audioBuffer.sampleRate);
  const endSample = Math.floor(end * audioBuffer.sampleRate);
  const sampleCount = Math.max(0, endSample - startSample);

  if (sampleCount <= 0) {
    throw new Error("Selected segment is empty.");
  }

  const left = Float32Array.from(audioBuffer.getChannelData(0).slice(startSample, endSample));
  const right =
    audioBuffer.numberOfChannels > 1
      ? Float32Array.from(audioBuffer.getChannelData(1).slice(startSample, endSample))
      : Float32Array.from(left);

  const fadeInSamples = clamp(Math.floor(fadeInSeconds * audioBuffer.sampleRate), 0, sampleCount);
  const fadeOutSamples = clamp(Math.floor(fadeOutSeconds * audioBuffer.sampleRate), 0, sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    let gain = 1;

    if (fadeInSamples > 0 && index < fadeInSamples) {
      gain = Math.min(gain, fadeInSamples === 1 ? 1 : index / (fadeInSamples - 1));
    }

    if (fadeOutSamples > 0 && index >= sampleCount - fadeOutSamples) {
      const fadeOutIndex = index - (sampleCount - fadeOutSamples);
      const fadeOutGain = fadeOutSamples === 1 ? 0 : 1 - fadeOutIndex / (fadeOutSamples - 1);
      gain = Math.min(gain, fadeOutGain);
    }

    left[index] *= gain * gainMultiplier;
    right[index] *= gain * gainMultiplier;
  }

  return {
    id: segmentId,
    left,
    right,
    sampleRate: audioBuffer.sampleRate,
    sampleCount,
  };
};

export const mergeProcessedSegments = (segments: ProcessedSegmentData[]) => {
  if (!segments.length) {
    throw new Error("Add a segment before playing the final preview.");
  }

  const sampleRate = segments[0].sampleRate;
  const sampleCount = segments.reduce((total, segment) => total + segment.sampleCount, 0);
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);
  const overlays: PlaybackOverlay[] = [];

  let offset = 0;
  for (const segment of segments) {
    left.set(segment.left, offset);
    right.set(segment.right, offset);

    const start = offset / sampleRate;
    offset += segment.sampleCount;
    overlays.push({
      id: segment.id,
      start,
      end: offset / sampleRate,
    });
  }

  return {
    id: "final-preview",
    left,
    right,
    sampleRate,
    sampleCount,
    overlays,
  };
};

const writeWavLabel = (view: DataView, offset: number, text: string) => {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
};

export const encodeWavPreview = (segment: EncodableAudioData) => {
  const channelCount = 2;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + segment.sampleCount * blockAlign);
  const view = new DataView(buffer);

  writeWavLabel(view, 0, "RIFF");
  view.setUint32(4, 36 + segment.sampleCount * blockAlign, true);
  writeWavLabel(view, 8, "WAVE");
  writeWavLabel(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, segment.sampleRate, true);
  view.setUint32(28, segment.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeWavLabel(view, 36, "data");
  view.setUint32(40, segment.sampleCount * blockAlign, true);

  let offset = 44;
  for (let index = 0; index < segment.sampleCount; index += 1) {
    const leftSample = clamp(segment.left[index], -1, 1);
    const rightSample = clamp(segment.right[index], -1, 1);
    view.setInt16(offset, leftSample < 0 ? leftSample * 32768 : leftSample * 32767, true);
    view.setInt16(offset + 2, rightSample < 0 ? rightSample * 32768 : rightSample * 32767, true);
    offset += blockAlign;
  }

  return new Blob([buffer], { type: "audio/wav" });
};

export const encodeMp3Segment = (segment: EncodableAudioData) => {
  const lamejs = (window as Window & typeof globalThis & { lamejs?: any }).lamejs;
  if (!lamejs) {
    throw new Error("MP3 encoder failed to load.");
  }

  const encoder = new lamejs.Mp3Encoder(2, segment.sampleRate, 128);
  const leftInt16 = new Int16Array(segment.sampleCount);
  const rightInt16 = new Int16Array(segment.sampleCount);

  for (let index = 0; index < segment.sampleCount; index += 1) {
    const leftSample = clamp(segment.left[index], -1, 1);
    const rightSample = clamp(segment.right[index], -1, 1);
    leftInt16[index] = leftSample < 0 ? leftSample * 32768 : leftSample * 32767;
    rightInt16[index] = rightSample < 0 ? rightSample * 32768 : rightSample * 32767;
  }

  const blockSize = 1152;
  const mp3Data: ArrayBuffer[] = [];

  for (let index = 0; index < leftInt16.length; index += blockSize) {
    const leftChunk = leftInt16.subarray(index, index + blockSize);
    const rightChunk = rightInt16.subarray(index, index + blockSize);
    const mp3Buffer = encoder.encodeBuffer(leftChunk, rightChunk);

    if (mp3Buffer.length > 0) {
      mp3Data.push(Uint8Array.from(mp3Buffer).buffer);
    }
  }

  const finalBuffer = encoder.flush();
  if (finalBuffer.length > 0) {
    mp3Data.push(Uint8Array.from(finalBuffer).buffer);
  }

  return new Blob(mp3Data, { type: "audio/mpeg" });
};
