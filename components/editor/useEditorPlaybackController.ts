"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import type { PersistedTrackSegment } from "@/lib/editor-draft-storage";
import {
  WAVEFORM_HEIGHT,
  WAVEFORM_PEAK_SAMPLES,
  areSegmentsEquivalent,
  buildProcessedSegmentData,
  clamp,
  decodeAudioFile,
  encodeWavPreview,
  getWaveformPeakMagnitude,
  getWaveformReferencePeak,
  mergeProcessedSegments,
  normalizeSegmentsForDuration,
  parseFadeSeconds,
  scaleWaveformPeaks,
  type PlaybackOverlay,
} from "@/lib/editor-audio";
import { playMediaSafely } from "@/lib/media-playback";

export type EditorPlaybackMode = "source" | "final-preview";

type WaveformVisualState = {
  basePeaks: number[][];
  duration: number;
  referencePeak: number;
};

type SourceState = {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
};

type FinalPreviewState = {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isLoading: boolean;
  overlays: PlaybackOverlay[];
};

type UseEditorPlaybackControllerOptions = {
  trackId: string | null;
  file: File | null;
  segments: PersistedTrackSegment[];
  persistedActiveSegmentId: string | null;
  outputGain: number;
  isMuted: boolean;
  waveformRef: RefObject<HTMLDivElement | null>;
  onPersistActiveSegment: (segmentId: string | null) => void;
  onPersistNormalizedSegments: (segments: PersistedTrackSegment[], activeSegmentId: string | null) => void;
  onPersistSegmentBounds: (segments: PersistedTrackSegment[]) => void;
  onError?: (message: string) => void;
};

type UseEditorPlaybackControllerResult = {
  mode: EditorPlaybackMode;
  sourceCurrentTime: number;
  sourceDuration: number;
  sourceIsPlaying: boolean;
  displayCurrentTime: number;
  displayDuration: number;
  displayIsPlaying: boolean;
  activeSegmentId: string | null;
  activeFinalPreviewOverlayId: string | null;
  finalPreviewOverlays: PlaybackOverlay[];
  isFinalPreviewLoading: boolean;
  togglePlayback: () => Promise<void>;
  seekTransport: (time: number) => void;
  skipTransportBy: (deltaSeconds: number) => void;
  jumpTransportOverlay: (direction: -1 | 1) => void;
  playFinalPreview: () => Promise<void>;
  previewSegment: (segmentId: string) => void;
  seekSource: (time: number) => void;
  pauseSource: () => void;
  setSourceActiveSegment: (
    segmentId: string | null,
    options?: {
      persist?: boolean;
      seekTime?: number;
    },
  ) => void;
  reset: () => void;
};

const DEFAULT_SOURCE_STATE: SourceState = {
  currentTime: 0,
  duration: 0,
  isPlaying: false,
};

const DEFAULT_PREVIEW_STATE: FinalPreviewState = {
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  isLoading: false,
  overlays: [],
};

const useLatestRef = <T,>(value: T) => {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
};

export const useEditorPlaybackController = ({
  trackId,
  file,
  segments,
  persistedActiveSegmentId,
  outputGain,
  isMuted,
  waveformRef,
  onPersistActiveSegment,
  onPersistNormalizedSegments,
  onPersistSegmentBounds,
  onError,
}: UseEditorPlaybackControllerOptions): UseEditorPlaybackControllerResult => {
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<any>(null);
  const regionMapRef = useRef<Map<string, any>>(new Map());
  const waveformVisualStateRef = useRef<WaveformVisualState | null>(null);
  const previewStopTimeRef = useRef<number | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewSessionRef = useRef(0);
  const loadSessionRef = useRef(0);
  const sourceTimeRafRef = useRef<number | null>(null);
  const previewTimeRafRef = useRef<number | null>(null);
  const latestSourceTimeRef = useRef(0);
  const latestPreviewTimeRef = useRef(0);
  const sourceDurationRef = useRef(0);
  const segmentsRef = useRef<PersistedTrackSegment[]>(segments);
  const sourceStateRef = useRef<SourceState>(DEFAULT_SOURCE_STATE);
  const finalPreviewStateRef = useRef<FinalPreviewState>(DEFAULT_PREVIEW_STATE);
  const activeSegmentIdRef = useRef<string | null>(persistedActiveSegmentId ?? segments[0]?.id ?? null);

  const [mode, setMode] = useState<EditorPlaybackMode>("source");
  const [sourceState, setSourceState] = useState<SourceState>(DEFAULT_SOURCE_STATE);
  const [finalPreviewState, setFinalPreviewState] = useState<FinalPreviewState>(DEFAULT_PREVIEW_STATE);
  const [activeSegmentId, setActiveSegmentIdState] = useState<string | null>(persistedActiveSegmentId ?? segments[0]?.id ?? null);

  const persistActiveSegmentRef = useLatestRef(onPersistActiveSegment);
  const persistNormalizedSegmentsRef = useLatestRef(onPersistNormalizedSegments);
  const persistSegmentBoundsRef = useLatestRef(onPersistSegmentBounds);
  const errorHandlerRef = useLatestRef(onError);
  const outputGainRef = useLatestRef(outputGain);
  const isMutedRef = useLatestRef(isMuted);
  const segmentsPropRef = useLatestRef(segments);
  const persistedActiveSegmentIdRef = useLatestRef(persistedActiveSegmentId);
  const fileRef = useLatestRef(file);

  const setSourceStateValue = useCallback((updater: SourceState | ((current: SourceState) => SourceState)) => {
    setSourceState((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      const hasChanged =
        next.currentTime !== current.currentTime || next.duration !== current.duration || next.isPlaying !== current.isPlaying;
      const resolvedState = hasChanged ? next : current;

      sourceStateRef.current = resolvedState;
      sourceDurationRef.current = resolvedState.duration;
      return resolvedState;
    });
  }, []);

  const setFinalPreviewStateValue = useCallback((updater: FinalPreviewState | ((current: FinalPreviewState) => FinalPreviewState)) => {
    setFinalPreviewState((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      const hasChanged =
        next.currentTime !== current.currentTime ||
        next.duration !== current.duration ||
        next.isPlaying !== current.isPlaying ||
        next.isLoading !== current.isLoading ||
        next.overlays !== current.overlays;
      const resolvedState = hasChanged ? next : current;

      finalPreviewStateRef.current = resolvedState;
      return resolvedState;
    });
  }, []);

  const setActiveSegmentId = useCallback((segmentId: string | null) => {
    activeSegmentIdRef.current = segmentId;
    setActiveSegmentIdState((current) => (current === segmentId ? current : segmentId));
  }, []);

  const reportError = useCallback((message: string, error?: unknown) => {
    if (error) {
      console.error(message, error);
    }

    errorHandlerRef.current?.(message);
  }, [errorHandlerRef]);

  const clearSourceTimeRaf = useCallback(() => {
    if (sourceTimeRafRef.current !== null) {
      window.cancelAnimationFrame(sourceTimeRafRef.current);
      sourceTimeRafRef.current = null;
    }
  }, []);

  const clearPreviewTimeRaf = useCallback(() => {
    if (previewTimeRafRef.current !== null) {
      window.cancelAnimationFrame(previewTimeRafRef.current);
      previewTimeRafRef.current = null;
    }
  }, []);

  const flushSourceTime = useCallback(() => {
    sourceTimeRafRef.current = null;

    setSourceStateValue((current) =>
      current.currentTime === latestSourceTimeRef.current
        ? current
        : {
            ...current,
            currentTime: latestSourceTimeRef.current,
          },
    );
  }, [setSourceStateValue]);

  const scheduleSourceTimeUpdate = useCallback((time: number) => {
    latestSourceTimeRef.current = time;

    if (sourceTimeRafRef.current !== null) {
      return;
    }

    sourceTimeRafRef.current = window.requestAnimationFrame(flushSourceTime);
  }, [flushSourceTime]);

  const flushPreviewTime = useCallback(() => {
    previewTimeRafRef.current = null;

    setFinalPreviewStateValue((current) =>
      current.currentTime === latestPreviewTimeRef.current
        ? current
        : {
            ...current,
            currentTime: latestPreviewTimeRef.current,
          },
    );
  }, [setFinalPreviewStateValue]);

  const schedulePreviewTimeUpdate = useCallback((time: number) => {
    latestPreviewTimeRef.current = time;

    if (previewTimeRafRef.current !== null) {
      return;
    }

    previewTimeRafRef.current = window.requestAnimationFrame(flushPreviewTime);
  }, [flushPreviewTime]);

  const clearSegmentPreview = useCallback(() => {
    previewStopTimeRef.current = null;
  }, []);

  const applyRegionStyles = useCallback((selectedId: string | null) => {
    for (const [segmentId, region] of regionMapRef.current.entries()) {
      region.setOptions?.({
        color: segmentId === selectedId ? "rgba(211, 170, 78, 0.24)" : "rgba(127, 167, 217, 0.18)",
      });
    }
  }, []);

  const clearRegions = useCallback(() => {
    for (const region of regionMapRef.current.values()) {
      region.remove?.();
    }

    regionMapRef.current.clear();
  }, []);

  const createWaveRegion = useCallback((segment: PersistedTrackSegment, plugin: any) => {
    const region = plugin.addRegion({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      drag: true,
      resize: true,
      color: segment.id === activeSegmentIdRef.current ? "rgba(211, 170, 78, 0.24)" : "rgba(127, 167, 217, 0.18)",
    });

    regionMapRef.current.set(segment.id, region);
    return region;
  }, []);

  const rebuildRegions = useCallback((nextSegments: PersistedTrackSegment[], selectedId: string | null) => {
    const plugin = regionsRef.current;
    if (!plugin) {
      return;
    }

    clearRegions();
    nextSegments.forEach((segment) => createWaveRegion(segment, plugin));
    applyRegionStyles(selectedId);
  }, [applyRegionStyles, clearRegions, createWaveRegion]);

  const applyWaveformVisualGain = useCallback((waveSurfer: WaveSurfer, gainMultiplier: number) => {
    const waveformVisualState = waveformVisualStateRef.current;
    if (!waveformVisualState) {
      return;
    }

    waveSurfer.setOptions({
      peaks: scaleWaveformPeaks(waveformVisualState.basePeaks, gainMultiplier),
      duration: waveformVisualState.duration,
      normalize: true,
      maxPeak: waveformVisualState.referencePeak,
    });
  }, []);

  const destroyPreviewAudio = useCallback(() => {
    const audio = previewAudioRef.current;
    if (audio) {
      audio.pause();
      audio.ontimeupdate = null;
      audio.onloadedmetadata = null;
      audio.onplay = null;
      audio.onpause = null;
      audio.onended = null;
      audio.removeAttribute("src");
      previewAudioRef.current = null;
    }

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const resetFinalPreview = useCallback(() => {
    previewSessionRef.current += 1;
    clearPreviewTimeRaf();
    destroyPreviewAudio();
    setMode("source");
    setFinalPreviewStateValue(DEFAULT_PREVIEW_STATE);
  }, [clearPreviewTimeRaf, destroyPreviewAudio, setFinalPreviewStateValue]);

  const destroyWaveSurfer = useCallback(() => {
    clearSourceTimeRaf();
    clearRegions();
    waveformVisualStateRef.current = null;
    previewStopTimeRef.current = null;

    waveSurferRef.current?.destroy();
    waveSurferRef.current = null;
    regionsRef.current = null;

    setSourceStateValue(DEFAULT_SOURCE_STATE);
  }, [clearRegions, clearSourceTimeRaf, setSourceStateValue]);

  const syncRuntimeActiveSegmentForTime = useCallback((time: number) => {
    const containingSegment = segmentsRef.current.find((segment) => time >= segment.start && time <= segment.end);
    if (!containingSegment || containingSegment.id === activeSegmentIdRef.current) {
      return;
    }

    setActiveSegmentId(containingSegment.id);
    applyRegionStyles(containingSegment.id);
  }, [applyRegionStyles, setActiveSegmentId]);

  const setSourceActiveSegment = useCallback(
    (
      segmentId: string | null,
      options?: {
        persist?: boolean;
        seekTime?: number;
      },
    ) => {
      const nextPersist = options?.persist ?? true;
      const nextTime =
        options?.seekTime ??
        (segmentId ? segmentsRef.current.find((segment) => segment.id === segmentId)?.start ?? null : null);

      setActiveSegmentId(segmentId);
      applyRegionStyles(segmentId);

      if (nextPersist) {
        persistActiveSegmentRef.current(segmentId);
      }

      if (typeof nextTime === "number") {
        waveSurferRef.current?.setTime(nextTime);
        latestSourceTimeRef.current = nextTime;
        setSourceStateValue((current) => ({
          ...current,
          currentTime: nextTime,
        }));
      }
    },
    [applyRegionStyles, persistActiveSegmentRef, setActiveSegmentId, setSourceStateValue],
  );

  const seekSource = useCallback(
    (time: number) => {
      const waveSurfer = waveSurferRef.current;
      if (!waveSurfer || sourceDurationRef.current <= 0) {
        return;
      }

      resetFinalPreview();
      clearSegmentPreview();

      const nextTime = clamp(time, 0, sourceDurationRef.current);
      waveSurfer.setTime(nextTime);
      scheduleSourceTimeUpdate(nextTime);
      syncRuntimeActiveSegmentForTime(nextTime);
    },
    [clearSegmentPreview, resetFinalPreview, scheduleSourceTimeUpdate, syncRuntimeActiveSegmentForTime],
  );

  const pauseSource = useCallback(() => {
    clearSegmentPreview();
    waveSurferRef.current?.pause();
  }, [clearSegmentPreview]);

  const previewSegment = useCallback(
    (segmentId: string) => {
      const waveSurfer = waveSurferRef.current;
      const segment = segmentsRef.current.find((item) => item.id === segmentId);
      if (!waveSurfer || !segment) {
        return;
      }

      resetFinalPreview();
      clearSegmentPreview();
      setSourceActiveSegment(segmentId, {
        persist: true,
        seekTime: segment.start,
      });

      previewStopTimeRef.current = segment.end;
      void waveSurfer.play().catch((error) => {
        reportError("Failed to play the track preview.", error);
      });
    },
    [clearSegmentPreview, reportError, resetFinalPreview, setSourceActiveSegment],
  );

  const toggleSourcePlayback = useCallback(async () => {
    const waveSurfer = waveSurferRef.current;
    if (!waveSurfer || sourceDurationRef.current <= 0) {
      return;
    }

    resetFinalPreview();
    clearSegmentPreview();

    if (sourceStateRef.current.isPlaying) {
      waveSurfer.pause();
      return;
    }

    try {
      await waveSurfer.play();
    } catch (error) {
      reportError("Failed to start playback.", error);
    }
  }, [clearSegmentPreview, reportError, resetFinalPreview]);

  const jumpSourceSegment = useCallback(
    (direction: -1 | 1) => {
      if (!segmentsRef.current.length) {
        return;
      }

      const currentSegmentIndex = segmentsRef.current.findIndex((segment) => segment.id === activeSegmentIdRef.current);
      const fallbackIndex = segmentsRef.current.findIndex((segment) => sourceStateRef.current.currentTime < segment.end);
      const seedIndex =
        currentSegmentIndex >= 0
          ? currentSegmentIndex
          : fallbackIndex >= 0
            ? fallbackIndex
            : direction === 1
              ? -1
              : segmentsRef.current.length;
      const nextIndex = clamp(seedIndex + direction, 0, segmentsRef.current.length - 1);
      const nextSegment = segmentsRef.current[nextIndex];
      if (!nextSegment) {
        return;
      }

      resetFinalPreview();
      clearSegmentPreview();
      setSourceActiveSegment(nextSegment.id, {
        persist: true,
        seekTime: nextSegment.start,
      });
    },
    [clearSegmentPreview, resetFinalPreview, setSourceActiveSegment],
  );

  const seekFinalPreview = useCallback((time: number) => {
    const audio = previewAudioRef.current;
    if (!audio || finalPreviewStateRef.current.duration <= 0) {
      return;
    }

    const nextTime = clamp(time, 0, finalPreviewStateRef.current.duration);
    audio.currentTime = nextTime;
    latestPreviewTimeRef.current = nextTime;
    setFinalPreviewStateValue((current) => ({
      ...current,
      currentTime: nextTime,
    }));
  }, [setFinalPreviewStateValue]);

  const skipFinalPreviewBy = useCallback((deltaSeconds: number) => {
    seekFinalPreview(finalPreviewStateRef.current.currentTime + deltaSeconds);
  }, [seekFinalPreview]);

  const jumpFinalPreviewOverlay = useCallback((direction: -1 | 1) => {
    const overlays = finalPreviewStateRef.current.overlays;
    if (!overlays.length) {
      return;
    }

    const currentOverlayIndex = overlays.findIndex(
      (overlay) => finalPreviewStateRef.current.currentTime >= overlay.start && finalPreviewStateRef.current.currentTime <= overlay.end,
    );
    const fallbackIndex = overlays.findIndex((overlay) => finalPreviewStateRef.current.currentTime < overlay.end);
    const seedIndex =
      currentOverlayIndex >= 0
        ? currentOverlayIndex
        : fallbackIndex >= 0
          ? fallbackIndex
          : direction === 1
            ? -1
            : overlays.length;
    const nextIndex = clamp(seedIndex + direction, 0, overlays.length - 1);
    const nextOverlay = overlays[nextIndex];
    if (!nextOverlay) {
      return;
    }

    seekFinalPreview(nextOverlay.start);
  }, [seekFinalPreview]);

  const toggleFinalPreviewPlayback = useCallback(async () => {
    const audio = previewAudioRef.current;
    if (!audio) {
      return;
    }

    if (finalPreviewStateRef.current.isPlaying) {
      audio.pause();
      return;
    }

    try {
      await playMediaSafely(audio);
    } catch (error) {
      reportError("Failed to play the final preview.", error);
    }
  }, [reportError]);

  const playFinalPreview = useCallback(async () => {
    const selectedFile = fileRef.current;
    const trackSegments = [...segmentsRef.current].sort((left, right) => left.start - right.start);
    if (!selectedFile || trackSegments.length === 0) {
      return;
    }

    waveSurferRef.current?.pause();
    clearSegmentPreview();
    resetFinalPreview();

    const previewSessionId = previewSessionRef.current;
    setFinalPreviewStateValue((current) => ({
      ...current,
      isLoading: true,
    }));

    try {
      const audioBuffer = await decodeAudioFile(selectedFile);
      if (previewSessionId !== previewSessionRef.current) {
        return;
      }

      const processedSegments = trackSegments.map((segment) =>
        buildProcessedSegmentData({
          segmentId: segment.id,
          audioBuffer,
          start: segment.start,
          end: segment.end,
          fadeInSeconds: parseFadeSeconds(segment.fadeInInput),
          fadeOutSeconds: parseFadeSeconds(segment.fadeOutInput),
          gainMultiplier: clamp(outputGainRef.current, 0, 1),
        }),
      );
      const mergedPreview = mergeProcessedSegments(processedSegments);
      const previewUrl = URL.createObjectURL(encodeWavPreview(mergedPreview));
      const previewAudio = new Audio(previewUrl);
      const previewDuration = mergedPreview.sampleCount / mergedPreview.sampleRate;

      if (previewSessionId !== previewSessionRef.current) {
        URL.revokeObjectURL(previewUrl);
        return;
      }

      previewUrlRef.current = previewUrl;
      previewAudioRef.current = previewAudio;
      previewAudio.preload = "metadata";
      previewAudio.volume = 1;
      previewAudio.muted = isMutedRef.current;
      previewAudio.ontimeupdate = () => {
        schedulePreviewTimeUpdate(previewAudio.currentTime);
      };
      previewAudio.onloadedmetadata = () => {
        setFinalPreviewStateValue((current) => ({
          ...current,
          duration: Number.isFinite(previewAudio.duration) ? previewAudio.duration : previewDuration,
        }));
      };
      previewAudio.onplay = () => {
        setMode("final-preview");
        setFinalPreviewStateValue((current) => ({
          ...current,
          isPlaying: true,
          isLoading: false,
        }));
      };
      previewAudio.onpause = () => {
        if (previewAudio.ended) {
          return;
        }

        setFinalPreviewStateValue((current) => ({
          ...current,
          isPlaying: false,
        }));
      };
      previewAudio.onended = () => {
        setFinalPreviewStateValue((current) => ({
          ...current,
          isPlaying: false,
          currentTime: Number.isFinite(previewAudio.duration) ? previewAudio.duration : previewDuration,
        }));
      };

      setMode("final-preview");
      latestPreviewTimeRef.current = 0;
      setFinalPreviewStateValue({
        currentTime: 0,
        duration: previewDuration,
        isPlaying: false,
        isLoading: true,
        overlays: mergedPreview.overlays,
      });

      if (previewSessionId !== previewSessionRef.current) {
        return;
      }

      const didStartPlayback = await playMediaSafely(previewAudio);
      if (!didStartPlayback) {
        if (previewSessionId === previewSessionRef.current) {
          resetFinalPreview();
        }
      }
    } catch (error) {
      if (previewSessionId !== previewSessionRef.current) {
        return;
      }

      resetFinalPreview();
      reportError(error instanceof Error ? error.message : "Failed to build the final preview.", error);
    } finally {
      if (previewSessionId === previewSessionRef.current) {
        setFinalPreviewStateValue((current) =>
          current.isLoading
            ? {
                ...current,
                isLoading: false,
              }
            : current,
        );
      }
    }
  }, [
    clearSegmentPreview,
    fileRef,
    isMutedRef,
    outputGainRef,
    reportError,
    resetFinalPreview,
    schedulePreviewTimeUpdate,
    setFinalPreviewStateValue,
  ]);

  const togglePlayback = useCallback(async () => {
    if (mode === "final-preview") {
      await toggleFinalPreviewPlayback();
      return;
    }

    await toggleSourcePlayback();
  }, [mode, toggleFinalPreviewPlayback, toggleSourcePlayback]);

  const seekTransport = useCallback((time: number) => {
    if (mode === "final-preview") {
      seekFinalPreview(time);
      return;
    }

    seekSource(time);
  }, [mode, seekFinalPreview, seekSource]);

  const skipTransportBy = useCallback((deltaSeconds: number) => {
    if (mode === "final-preview") {
      skipFinalPreviewBy(deltaSeconds);
      return;
    }

    seekSource(sourceStateRef.current.currentTime + deltaSeconds);
  }, [mode, seekSource, skipFinalPreviewBy]);

  const jumpTransportOverlay = useCallback((direction: -1 | 1) => {
    if (mode === "final-preview") {
      jumpFinalPreviewOverlay(direction);
      return;
    }

    jumpSourceSegment(direction);
  }, [jumpFinalPreviewOverlay, jumpSourceSegment, mode]);

  useEffect(() => {
    segmentsRef.current = segments;

    const nextPersistedActiveSegmentId = persistedActiveSegmentId ?? segments[0]?.id ?? null;
    setActiveSegmentId(nextPersistedActiveSegmentId);
  }, [persistedActiveSegmentId, segments, setActiveSegmentId, trackId]);

  useEffect(() => {
    const waveSurfer = waveSurferRef.current;
    if (!waveSurfer) {
      return;
    }

    waveSurfer.setVolume(isMuted ? 0 : outputGain);
    applyWaveformVisualGain(waveSurfer, outputGain);

    const previewAudio = previewAudioRef.current;
    if (previewAudio) {
      previewAudio.muted = isMuted;
    }
  }, [applyWaveformVisualGain, isMuted, outputGain]);

  useEffect(() => {
    if (mode === "final-preview") {
      resetFinalPreview();
    }
  }, [outputGain, resetFinalPreview]);

  useEffect(() => {
    if (!trackId || !file || !waveformRef.current) {
      destroyWaveSurfer();
      resetFinalPreview();
      return;
    }

    loadSessionRef.current += 1;
    const currentLoadSession = loadSessionRef.current;
    let objectUrl: string | null = URL.createObjectURL(file);

    destroyWaveSurfer();
    resetFinalPreview();

    const nextWaveSurfer = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: "rgba(255, 255, 255, 0.16)",
      progressColor: "#F2EADC",
      cursorColor: "#D3AA4E",
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      height: WAVEFORM_HEIGHT,
      url: objectUrl,
    });
    nextWaveSurfer.setVolume(isMutedRef.current ? 0 : outputGainRef.current);

    const waveRegions = nextWaveSurfer.registerPlugin(RegionsPlugin.create());
    waveSurferRef.current = nextWaveSurfer;
    regionsRef.current = waveRegions;

    nextWaveSurfer.on("ready", (trackDuration) => {
      if (currentLoadSession !== loadSessionRef.current) {
        return;
      }

      const decodedData = nextWaveSurfer.getDecodedData();
      if (decodedData) {
        const basePeaks = nextWaveSurfer.exportPeaks({
          channels: Math.min(decodedData.numberOfChannels, 2),
          maxLength: WAVEFORM_PEAK_SAMPLES,
          precision: 10000,
        });

        waveformVisualStateRef.current = {
          basePeaks,
          duration: decodedData.duration,
          referencePeak: getWaveformReferencePeak(getWaveformPeakMagnitude(basePeaks)),
        };
        applyWaveformVisualGain(nextWaveSurfer, outputGainRef.current);
      }

      sourceDurationRef.current = trackDuration;
      const normalizedSegments = normalizeSegmentsForDuration(segmentsPropRef.current, trackDuration);
      const nextPersistedActiveSegmentId =
        normalizedSegments.find((segment) => segment.id === persistedActiveSegmentIdRef.current)?.id ?? normalizedSegments[0]?.id ?? null;

      segmentsRef.current = normalizedSegments;

      if (
        !areSegmentsEquivalent(normalizedSegments, segmentsPropRef.current) ||
        nextPersistedActiveSegmentId !== (persistedActiveSegmentIdRef.current ?? null)
      ) {
        persistNormalizedSegmentsRef.current(normalizedSegments, nextPersistedActiveSegmentId);
      }

      setActiveSegmentId(nextPersistedActiveSegmentId);
      rebuildRegions(normalizedSegments, nextPersistedActiveSegmentId);

      const initialSegment = normalizedSegments.find((segment) => segment.id === nextPersistedActiveSegmentId) ?? normalizedSegments[0] ?? null;
      const initialTime = initialSegment?.start ?? 0;
      latestSourceTimeRef.current = initialTime;
      nextWaveSurfer.setTime(initialTime);
      setSourceStateValue({
        currentTime: initialTime,
        duration: trackDuration,
        isPlaying: false,
      });
    });

    nextWaveSurfer.on("audioprocess", (time) => {
      if (currentLoadSession !== loadSessionRef.current) {
        return;
      }

      scheduleSourceTimeUpdate(time);
      syncRuntimeActiveSegmentForTime(time);

      const previewStopTime = previewStopTimeRef.current;
      if (previewStopTime !== null && time >= previewStopTime) {
        clearSegmentPreview();
        nextWaveSurfer.pause();
        nextWaveSurfer.setTime(previewStopTime);
        latestSourceTimeRef.current = previewStopTime;
        setSourceStateValue((current) => ({
          ...current,
          currentTime: previewStopTime,
        }));
      }
    });

    nextWaveSurfer.on("interaction", () => {
      if (currentLoadSession !== loadSessionRef.current) {
        return;
      }

      const nextTime = nextWaveSurfer.getCurrentTime();
      resetFinalPreview();
      clearSegmentPreview();
      latestSourceTimeRef.current = nextTime;
      setSourceStateValue((current) => ({
        ...current,
        currentTime: nextTime,
      }));
      syncRuntimeActiveSegmentForTime(nextTime);
    });

    nextWaveSurfer.on("play", () => {
      setSourceStateValue((current) =>
        current.isPlaying
          ? current
          : {
              ...current,
              isPlaying: true,
            },
      );
    });

    nextWaveSurfer.on("pause", () => {
      setSourceStateValue((current) =>
        current.isPlaying
          ? {
              ...current,
              isPlaying: false,
            }
          : current,
      );
    });

    nextWaveSurfer.on("finish", () => {
      clearSegmentPreview();
      setSourceStateValue((current) =>
        current.isPlaying
          ? {
              ...current,
              isPlaying: false,
            }
          : current,
      );
    });

    waveRegions.on("region-clicked", (region: any, event?: Event) => {
      event?.stopPropagation?.();
      resetFinalPreview();
      clearSegmentPreview();
      setSourceActiveSegment(region.id, {
        persist: true,
        seekTime: region.start,
      });
    });

    waveRegions.on("region-updated", (region: any) => {
      const currentSegment = segmentsRef.current.find((segment) => segment.id === region.id);
      if (!currentSegment || (currentSegment.start === region.start && currentSegment.end === region.end)) {
        return;
      }

      const nextSegments = segmentsRef.current.map((segment) =>
        segment.id === region.id
          ? {
              ...segment,
              start: region.start,
              end: region.end,
            }
          : segment,
      );

      segmentsRef.current = nextSegments;
      persistSegmentBoundsRef.current(nextSegments);

      if (region.id === activeSegmentIdRef.current) {
        latestSourceTimeRef.current = region.start;
        nextWaveSurfer.setTime(region.start);
        setSourceStateValue((current) => ({
          ...current,
          currentTime: region.start,
        }));
      }
    });

    return () => {
      destroyWaveSurfer();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };
  }, [
    applyWaveformVisualGain,
    clearSegmentPreview,
    destroyWaveSurfer,
    file,
    isMutedRef,
    outputGainRef,
    persistedActiveSegmentIdRef,
    persistNormalizedSegmentsRef,
    rebuildRegions,
    resetFinalPreview,
    scheduleSourceTimeUpdate,
    segmentsPropRef,
    setActiveSegmentId,
    setSourceActiveSegment,
    setSourceStateValue,
    syncRuntimeActiveSegmentForTime,
    trackId,
    waveformRef,
  ]);

  useEffect(() => {
    if (!waveSurferRef.current || !regionsRef.current || sourceDurationRef.current <= 0) {
      return;
    }

    const normalizedSegments = normalizeSegmentsForDuration(segments, sourceDurationRef.current);
    const nextPersistedActiveSegmentId =
      normalizedSegments.find((segment) => segment.id === persistedActiveSegmentId)?.id ?? normalizedSegments[0]?.id ?? null;
    const nextRuntimeActiveSegmentId = normalizedSegments.some((segment) => segment.id === activeSegmentIdRef.current)
      ? activeSegmentIdRef.current
      : nextPersistedActiveSegmentId;

    segmentsRef.current = normalizedSegments;

    if (!areSegmentsEquivalent(normalizedSegments, segments) || nextPersistedActiveSegmentId !== (persistedActiveSegmentId ?? null)) {
      persistNormalizedSegmentsRef.current(normalizedSegments, nextPersistedActiveSegmentId);
    }

    setActiveSegmentId(nextRuntimeActiveSegmentId);
    rebuildRegions(normalizedSegments, nextRuntimeActiveSegmentId);
  }, [persistNormalizedSegmentsRef, persistedActiveSegmentId, rebuildRegions, segments, setActiveSegmentId, trackId]);

  useEffect(() => {
    return () => {
      resetFinalPreview();
      destroyWaveSurfer();
      clearSourceTimeRaf();
      clearPreviewTimeRaf();
    };
  }, [clearPreviewTimeRaf, clearSourceTimeRaf, destroyWaveSurfer, resetFinalPreview]);

  const activeFinalPreviewOverlayId = useMemo(
    () =>
      finalPreviewState.overlays.find(
        (overlay) => finalPreviewState.currentTime >= overlay.start && finalPreviewState.currentTime <= overlay.end,
      )?.id ?? null,
    [finalPreviewState.currentTime, finalPreviewState.overlays],
  );

  return {
    mode,
    sourceCurrentTime: sourceState.currentTime,
    sourceDuration: sourceState.duration,
    sourceIsPlaying: sourceState.isPlaying,
    displayCurrentTime: mode === "final-preview" ? finalPreviewState.currentTime : sourceState.currentTime,
    displayDuration: mode === "final-preview" ? finalPreviewState.duration : sourceState.duration,
    displayIsPlaying: mode === "final-preview" ? finalPreviewState.isPlaying : sourceState.isPlaying,
    activeSegmentId,
    activeFinalPreviewOverlayId,
    finalPreviewOverlays: finalPreviewState.overlays,
    isFinalPreviewLoading: finalPreviewState.isLoading,
    togglePlayback,
    seekTransport,
    skipTransportBy,
    jumpTransportOverlay,
    playFinalPreview,
    previewSegment,
    seekSource,
    pauseSource,
    setSourceActiveSegment,
    reset: resetFinalPreview,
  };
};
