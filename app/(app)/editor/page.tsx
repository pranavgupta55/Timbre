"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Script from "next/script";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import { Check, FolderOpen, Library, Loader2, Play, Save, Trash2, Upload, Waves } from "lucide-react";
import { EditorTrackCard } from "@/components/editor/EditorTrackCard";
import { Badge } from "@/components/ui/TacticalUI";
import { useAuth } from "@/context/AuthContext";
import { useEditorAudioDock, type EditorDockOverlay } from "@/context/EditorAudioDockContext";
import {
  clearEditorDraftSnapshot,
  loadEditorDraftSnapshot,
  saveEditorDraftSnapshot,
  type PersistedEditorTrack,
  type PersistedTrackSegment,
} from "@/lib/editor-draft-storage";
import { buildSegmentStoragePath, fetchHighlightInventory, stripExtension, type ApprovedSource } from "@/lib/highlights";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const WAVEFORM_HEIGHT = 176;
const DEFAULT_SEGMENT_LENGTH = 15;
const DEFAULT_FADE_SECONDS = "2.0";

type StatusTone = "info" | "success" | "error";
type StatusMessage = { tone: StatusTone; text: string } | null;
type DragLane = "queued";
type DropLane = "approved" | "library" | null;
type PlaybackMode = "source" | "final-preview";
type ProcessedSegmentData = {
  id: string;
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  sampleCount: number;
};

const formatTime = (time: number) => {
  if (!Number.isFinite(time)) return "00:00.00";

  const minutes = Math.floor(time / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(time % 60)
    .toString()
    .padStart(2, "0");
  const milliseconds = Math.floor((time % 1) * 100)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${seconds}.${milliseconds}`;
};

const formatDateLabel = (value?: string | null) => {
  if (!value) return null;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getAudioExtension = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

const isAudioFile = (file: File) => {
  if (file.type.startsWith("audio/")) return true;

  return ["aac", "aiff", "alac", "flac", "m4a", "mp3", "ogg", "wav", "wma"].includes(getAudioExtension(file.name));
};

const parseFadeSeconds = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const normalizeFadeInput = (value: string) => parseFadeSeconds(value).toFixed(1);

const getRegionDuration = (start: number, end: number) => Math.max(0, end - start);

const createSegmentId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createSegment = (start: number, end: number): PersistedTrackSegment => ({
  id: createSegmentId(),
  start,
  end,
  fadeInInput: DEFAULT_FADE_SECONDS,
  fadeOutInput: DEFAULT_FADE_SECONDS,
});

const getSuggestedSegmentWindow = (trackDuration: number, seedTime: number) => {
  if (trackDuration <= 0) {
    return { start: 0, end: 0 };
  }

  const segmentLength = Math.min(DEFAULT_SEGMENT_LENGTH, trackDuration);
  const maxStart = Math.max(0, trackDuration - segmentLength);
  const start = clamp(seedTime, 0, maxStart);
  const end = Math.min(trackDuration, start + segmentLength);

  return { start, end };
};

const normalizeSegmentsForDuration = (segments: PersistedTrackSegment[], trackDuration: number) => {
  if (trackDuration <= 0) {
    return [];
  }

  const fallbackWindow = getSuggestedSegmentWindow(trackDuration, 0);
  const baseSegments = segments.length ? segments : [createSegment(fallbackWindow.start, fallbackWindow.end)];
  const minimumLength = Math.min(0.25, trackDuration);
  const maxStart = Math.max(0, trackDuration - minimumLength);

  return baseSegments.map((segment, index) => {
    const fallbackWindow = getSuggestedSegmentWindow(trackDuration, index * DEFAULT_SEGMENT_LENGTH);
    const start = clamp(Number.isFinite(segment.start) ? segment.start : fallbackWindow.start, 0, maxStart);
    const minimumEnd = Math.min(trackDuration, start + minimumLength);
    const defaultEnd = Math.min(trackDuration, start + DEFAULT_SEGMENT_LENGTH);
    const end = clamp(Number.isFinite(segment.end) ? segment.end : defaultEnd, minimumEnd, trackDuration);

    return {
      ...segment,
      id: segment.id || createSegmentId(),
      start,
      end: end > start ? end : fallbackWindow.end,
      fadeInInput: segment.fadeInInput || DEFAULT_FADE_SECONDS,
      fadeOutInput: segment.fadeOutInput || DEFAULT_FADE_SECONDS,
    };
  });
};

const getReadablePath = (file: File) => {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return relativePath && relativePath.trim().length > 0 ? relativePath : file.name;
};

const hashFile = async (file: File) => {
  const arrayBuffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const createDraftTrack = (file: File, sourceHash: string): PersistedEditorTrack => ({
  id: `${sourceHash}-${file.lastModified}`,
  file,
  sourceHash,
  displayName: stripExtension(file.name),
  relativePath: getReadablePath(file),
  addedAt: new Date().toISOString(),
  activeSegmentId: null,
  segments: [],
  approvedAt: null,
  segmentCount: null,
});

const getAudioContextCtor = () =>
  window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

const decodeAudioFile = async (file: File) => {
  const arrayBuffer = await file.arrayBuffer();
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

const buildProcessedSegmentData = ({
  segmentId,
  audioBuffer,
  start,
  end,
  fadeInSeconds,
  fadeOutSeconds,
}: {
  segmentId: string;
  audioBuffer: AudioBuffer;
  start: number;
  end: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
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

    left[index] *= gain;
    right[index] *= gain;
  }

  return {
    id: segmentId,
    left,
    right,
    sampleRate: audioBuffer.sampleRate,
    sampleCount,
  };
};

const encodeMp3Segment = (segment: ProcessedSegmentData) => {
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

const createProcessedSegment = ({
  audioBuffer,
  segmentId,
  start,
  end,
  fadeInSeconds,
  fadeOutSeconds,
}: {
  audioBuffer: AudioBuffer;
  segmentId: string;
  start: number;
  end: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}) =>
  encodeMp3Segment(
    buildProcessedSegmentData({
      segmentId,
      audioBuffer,
      start,
      end,
      fadeInSeconds,
      fadeOutSeconds,
    }),
  );

const mergeProcessedSegments = (segments: ProcessedSegmentData[]) => {
  if (!segments.length) {
    throw new Error("Add a segment before playing the final preview.");
  }

  const sampleRate = segments[0].sampleRate;
  const sampleCount = segments.reduce((total, segment) => total + segment.sampleCount, 0);
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);
  const overlays: EditorDockOverlay[] = [];

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

const encodeWavPreview = (segment: ReturnType<typeof mergeProcessedSegments>) => {
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

export default function EditorPage() {
  const { user, loading } = useAuth();
  const { setDockState } = useEditorAudioDock();

  const [queuedTracks, setQueuedTracks] = useState<PersistedEditorTrack[]>([]);
  const [approvedTracks, setApprovedTracks] = useState<PersistedEditorTrack[]>([]);
  const [approvedLibrary, setApprovedLibrary] = useState<ApprovedSource[]>([]);
  const [selectedQueuedId, setSelectedQueuedId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const [inventoryError, setInventoryError] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [isDraftHydrating, setIsDraftHydrating] = useState(true);
  const [isInventoryLoading, setIsInventoryLoading] = useState(true);
  const [isQueueing, setIsQueueing] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isClearingDraft, setIsClearingDraft] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("source");
  const [isPlaying, setIsPlaying] = useState(false);
  const [editorVolume, setEditorVolume] = useState(0.92);
  const [isEditorMuted, setIsEditorMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFinalPreviewLoading, setIsFinalPreviewLoading] = useState(false);
  const [isFinalPreviewPlaying, setIsFinalPreviewPlaying] = useState(false);
  const [finalPreviewCurrentTime, setFinalPreviewCurrentTime] = useState(0);
  const [finalPreviewDuration, setFinalPreviewDuration] = useState(0);
  const [finalPreviewOverlays, setFinalPreviewOverlays] = useState<EditorDockOverlay[]>([]);
  const [approvingTrackId, setApprovingTrackId] = useState<string | null>(null);
  const [duplicateLibraryHashes, setDuplicateLibraryHashes] = useState<string[]>([]);
  const [recentQueuedIds, setRecentQueuedIds] = useState<string[]>([]);
  const [activeDropLane, setActiveDropLane] = useState<DropLane>(null);
  const [dragTrackId, setDragTrackId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<any>(null);
  const regionMapRef = useRef<Map<string, any>>(new Map());
  const selectedTrackIdRef = useRef<string | null>(null);
  const segmentsRef = useRef<PersistedTrackSegment[]>([]);
  const activeSegmentIdRef = useRef<string | null>(null);
  const previewSegmentEndRef = useRef<number | null>(null);
  const finalPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const finalPreviewUrlRef = useRef<string | null>(null);

  const usesRemoteUpload =
    Boolean(user?.id) &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("placeholder") &&
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.includes("placeholder");

  const isInventorySyncing = usesRemoteUpload && isInventoryLoading;

  const selectedTrack = useMemo(
    () => queuedTracks.find((track) => track.id === selectedQueuedId) ?? queuedTracks[0] ?? null,
    [queuedTracks, selectedQueuedId],
  );

  const orderedSegments = useMemo(
    () => [...(selectedTrack?.segments ?? [])].sort((left, right) => left.start - right.start),
    [selectedTrack?.segments],
  );

  const activeSegment =
    orderedSegments.find((segment) => segment.id === selectedTrack?.activeSegmentId) ?? orderedSegments[0] ?? null;

  const activeFinalPreviewOverlayId =
    finalPreviewOverlays.find((overlay) => finalPreviewCurrentTime >= overlay.start && finalPreviewCurrentTime <= overlay.end)?.id ?? null;

  const displayCurrentTime = playbackMode === "final-preview" ? finalPreviewCurrentTime : currentTime;
  const displayDuration = playbackMode === "final-preview" ? finalPreviewDuration : duration;
  const displayIsPlaying = playbackMode === "final-preview" ? isFinalPreviewPlaying : isPlaying;

  const librarySources = useMemo(() => {
    const queuedHashes = new Set(queuedTracks.map((track) => track.sourceHash));
    const approvedHashes = new Set(approvedTracks.map((track) => track.sourceHash));
    return approvedLibrary.filter((source) => !approvedHashes.has(source.sourceHash) && !queuedHashes.has(source.sourceHash));
  }, [approvedLibrary, approvedTracks, queuedTracks]);

  useEffect(() => {
    if (selectedQueuedId && queuedTracks.some((track) => track.id === selectedQueuedId)) {
      return;
    }

    setSelectedQueuedId(queuedTracks[0]?.id ?? null);
  }, [queuedTracks, selectedQueuedId]);

  useEffect(() => {
    selectedTrackIdRef.current = selectedTrack?.id ?? null;
    segmentsRef.current = selectedTrack?.segments ?? [];
    activeSegmentIdRef.current = selectedTrack?.activeSegmentId ?? selectedTrack?.segments[0]?.id ?? null;
  }, [selectedTrack?.activeSegmentId, selectedTrack?.id, selectedTrack?.segments]);

  useEffect(() => {
    if (!folderInputRef.current) return;

    folderInputRef.current.setAttribute("webkitdirectory", "");
    folderInputRef.current.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const restoreDraft = async () => {
      try {
        const snapshot = await loadEditorDraftSnapshot();

        if (isCancelled || !snapshot) {
          return;
        }

        setQueuedTracks(snapshot.queuedTracks ?? []);
        setApprovedTracks(snapshot.approvedTracks ?? []);
        setSelectedQueuedId(snapshot.selectedQueuedId ?? snapshot.queuedTracks[0]?.id ?? null);
        setDraftSavedAt(snapshot.savedAt);
        setStatusMessage({ tone: "info", text: "Local draft restored." });
      } catch {
        if (!isCancelled) {
          setStatusMessage({ tone: "error", text: "Local drafts are unavailable in this browser." });
        }
      } finally {
        if (!isCancelled) {
          setIsDraftHydrating(false);
        }
      }
    };

    void restoreDraft();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading) return;

    if (!usesRemoteUpload || !user?.id) {
      setApprovedLibrary([]);
      setInventoryError("");
      setIsInventoryLoading(false);
      return;
    }

    let isCancelled = false;

    const loadInventory = async () => {
      setIsInventoryLoading(true);
      setInventoryError("");

      try {
        const inventory = await fetchHighlightInventory(user.id);

        if (!isCancelled) {
          setApprovedLibrary(inventory.sources);
        }
      } catch (error) {
        if (!isCancelled) {
          setApprovedLibrary([]);
          setInventoryError(error instanceof Error ? error.message : "Failed to load the approved library.");
        }
      } finally {
        if (!isCancelled) {
          setIsInventoryLoading(false);
        }
      }
    };

    void loadInventory();

    return () => {
      isCancelled = true;
    };
  }, [loading, user?.id, usesRemoteUpload]);

  const applyRegionStyles = (selectedId: string | null) => {
    for (const [segmentId, region] of regionMapRef.current.entries()) {
      region.setOptions?.({
        color: segmentId === selectedId ? "rgba(211, 170, 78, 0.24)" : "rgba(127, 167, 217, 0.18)",
      });
    }
  };

  const updateQueuedTrack = (trackId: string, updater: (track: PersistedEditorTrack) => PersistedEditorTrack) => {
    setQueuedTracks((currentTracks) =>
      currentTracks.map((track) => (track.id === trackId ? updater(track) : track)),
    );
  };

  const resetFinalPreview = useCallback(() => {
    const audio = finalPreviewAudioRef.current;
    if (audio) {
      audio.pause();
      audio.ontimeupdate = null;
      audio.onloadedmetadata = null;
      audio.onplay = null;
      audio.onpause = null;
      audio.onended = null;
      audio.removeAttribute("src");
      finalPreviewAudioRef.current = null;
    }

    if (finalPreviewUrlRef.current) {
      URL.revokeObjectURL(finalPreviewUrlRef.current);
      finalPreviewUrlRef.current = null;
    }

    setPlaybackMode("source");
    setIsFinalPreviewLoading(false);
    setIsFinalPreviewPlaying(false);
    setFinalPreviewCurrentTime(0);
    setFinalPreviewDuration(0);
    setFinalPreviewOverlays([]);
  }, []);

  const clearSegmentPreview = () => {
    previewSegmentEndRef.current = null;
  };

  const setTrackActiveSegment = (trackId: string, segmentId: string | null) => {
    updateQueuedTrack(trackId, (track) => ({
      ...track,
      activeSegmentId: segmentId,
    }));
  };

  const syncActiveSegmentForTime = (time: number) => {
    const trackId = selectedTrackIdRef.current;
    if (!trackId) return;

    const containingSegment = segmentsRef.current.find((segment) => time >= segment.start && time <= segment.end);
    if (!containingSegment || containingSegment.id === activeSegmentIdRef.current) {
      return;
    }

    activeSegmentIdRef.current = containingSegment.id;
    setTrackActiveSegment(trackId, containingSegment.id);
    applyRegionStyles(containingSegment.id);
  };

  const createWaveRegion = (segment: PersistedTrackSegment, plugin: any) => {
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
  };

  useEffect(() => {
    activeSegmentIdRef.current = selectedTrack?.activeSegmentId ?? null;
    applyRegionStyles(selectedTrack?.activeSegmentId ?? null);
  }, [selectedTrack?.activeSegmentId]);

  useEffect(() => {
    resetFinalPreview();
  }, [orderedSegments, resetFinalPreview, selectedTrack?.id]);

  useEffect(() => {
    const file = selectedTrack?.file;

    clearSegmentPreview();
    regionMapRef.current.clear();
    wavesurferRef.current?.destroy();
    wavesurferRef.current = null;
    regionsRef.current = null;

    if (!file || !waveformRef.current) {
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    const objectUrl = URL.createObjectURL(file);
    const waveSurfer = WaveSurfer.create({
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
    waveSurfer.setVolume(isEditorMuted ? 0 : editorVolume);

    const waveRegions = waveSurfer.registerPlugin(RegionsPlugin.create());

    waveSurfer.on("ready", (trackDuration) => {
      const normalizedSegments = normalizeSegmentsForDuration(selectedTrack.segments, trackDuration);
      const nextActiveSegmentId =
        normalizedSegments.find((segment) => segment.id === selectedTrack.activeSegmentId)?.id ?? normalizedSegments[0]?.id ?? null;

      updateQueuedTrack(selectedTrack.id, (track) => ({
        ...track,
        segments: normalizedSegments,
        activeSegmentId: nextActiveSegmentId,
      }));

      segmentsRef.current = normalizedSegments;
      activeSegmentIdRef.current = nextActiveSegmentId;

      normalizedSegments.forEach((segment) => createWaveRegion(segment, waveRegions));
      applyRegionStyles(nextActiveSegmentId);

      const initialSegment = normalizedSegments.find((segment) => segment.id === nextActiveSegmentId) ?? normalizedSegments[0] ?? null;
      if (initialSegment) {
        waveSurfer.setTime(initialSegment.start);
        setCurrentTime(initialSegment.start);
      }

      setDuration(trackDuration);
    });

    waveSurfer.on("audioprocess", (time) => {
      setCurrentTime(time);
      syncActiveSegmentForTime(time);

      const previewSegmentEnd = previewSegmentEndRef.current;
      if (previewSegmentEnd !== null && time >= previewSegmentEnd) {
        clearSegmentPreview();
        waveSurfer.pause();
        waveSurfer.setTime(previewSegmentEnd);
        setCurrentTime(previewSegmentEnd);
      }
    });

    waveSurfer.on("interaction", () => {
      const nextTime = waveSurfer.getCurrentTime();
      resetFinalPreview();
      clearSegmentPreview();
      setCurrentTime(nextTime);
      syncActiveSegmentForTime(nextTime);
    });

    waveSurfer.on("play", () => setIsPlaying(true));
    waveSurfer.on("pause", () => setIsPlaying(false));
    waveSurfer.on("finish", () => {
      clearSegmentPreview();
      setIsPlaying(false);
    });

    waveRegions.on("region-clicked", (region: any, event?: Event) => {
      event?.stopPropagation?.();

      const trackId = selectedTrackIdRef.current;
      if (!trackId) return;

      resetFinalPreview();
      clearSegmentPreview();
      setTrackActiveSegment(trackId, region.id);
      activeSegmentIdRef.current = region.id;
      applyRegionStyles(region.id);
      waveSurfer.setTime(region.start);
      setCurrentTime(region.start);
    });

    waveRegions.on("region-updated", (region: any) => {
      const trackId = selectedTrackIdRef.current;
      if (!trackId) return;

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

      updateQueuedTrack(trackId, (track) => ({
        ...track,
        segments: nextSegments,
      }));

      if (region.id === activeSegmentIdRef.current) {
        waveSurfer.setTime(region.start);
        setCurrentTime(region.start);
      }
    });

    wavesurferRef.current = waveSurfer;
    regionsRef.current = waveRegions;

    return () => {
      regionMapRef.current.clear();
      wavesurferRef.current = null;
      regionsRef.current = null;
      clearSegmentPreview();
      waveSurfer.destroy();
      URL.revokeObjectURL(objectUrl);
    };
  }, [resetFinalPreview, selectedTrack?.id]);

  useEffect(() => {
    wavesurferRef.current?.setVolume(isEditorMuted ? 0 : editorVolume);
    const finalPreviewAudio = finalPreviewAudioRef.current;
    if (!finalPreviewAudio) return;

    finalPreviewAudio.volume = editorVolume;
    finalPreviewAudio.muted = isEditorMuted;
  }, [editorVolume, isEditorMuted]);

  const handleFadeInputChange =
    (segmentId: string, key: "fadeInInput" | "fadeOutInput") => (event: ChangeEvent<HTMLInputElement>) => {
      const trackId = selectedTrack?.id;
      const nextValue = event.target.value;

      if (!trackId || (nextValue !== "" && !/^\d*\.?\d*$/.test(nextValue))) {
        return;
      }

      updateQueuedTrack(trackId, (track) => ({
        ...track,
        segments: track.segments.map((segment) => (segment.id === segmentId ? { ...segment, [key]: nextValue } : segment)),
      }));
    };

  const handleFadeBlur = (segmentId: string, key: "fadeInInput" | "fadeOutInput") => {
    const trackId = selectedTrack?.id;
    if (!trackId) return;

    updateQueuedTrack(trackId, (track) => ({
      ...track,
      segments: track.segments.map((segment) =>
        segment.id === segmentId ? { ...segment, [key]: normalizeFadeInput(segment[key]) } : segment,
      ),
    }));
  };

  const previewSegment = (segmentId: string) => {
    const segment = segmentsRef.current.find((item) => item.id === segmentId);
    if (!segment || !wavesurferRef.current) return;

    const trackId = selectedTrack?.id;
    if (!trackId) return;

    resetFinalPreview();
    setTrackActiveSegment(trackId, segmentId);
    activeSegmentIdRef.current = segmentId;
    applyRegionStyles(segmentId);
    wavesurferRef.current.pause();
    wavesurferRef.current.setTime(segment.start);
    setCurrentTime(segment.start);
    previewSegmentEndRef.current = segment.end;
    void wavesurferRef.current.play();
  };

  const seekTrack = (time: number) => {
    const waveSurfer = wavesurferRef.current;
    if (!waveSurfer || duration <= 0) return;

    resetFinalPreview();
    const nextTime = clamp(time, 0, duration);
    clearSegmentPreview();
    waveSurfer.setTime(nextTime);
    setCurrentTime(nextTime);
    syncActiveSegmentForTime(nextTime);
  };

  const skipTrackBy = (deltaSeconds: number) => {
    seekTrack(currentTime + deltaSeconds);
  };

  const toggleTrackPlayback = () => {
    const waveSurfer = wavesurferRef.current;
    if (!waveSurfer || duration <= 0) return;

    resetFinalPreview();
    clearSegmentPreview();

    if (isPlaying) {
      waveSurfer.pause();
      return;
    }

    void waveSurfer.play();
  };

  const jumpToSegment = (direction: -1 | 1) => {
    if (!orderedSegments.length) return;

    const currentSegmentIndex = orderedSegments.findIndex((segment) => segment.id === activeSegmentIdRef.current);
    const fallbackIndex = orderedSegments.findIndex((segment) => currentTime < segment.end);
    const seedIndex =
      currentSegmentIndex >= 0 ? currentSegmentIndex : fallbackIndex >= 0 ? fallbackIndex : direction === 1 ? -1 : orderedSegments.length;
    const nextIndex = clamp(seedIndex + direction, 0, orderedSegments.length - 1);
    const nextSegment = orderedSegments[nextIndex];
    const trackId = selectedTrack?.id;
    if (!trackId || !wavesurferRef.current) return;

    resetFinalPreview();
    clearSegmentPreview();
    setTrackActiveSegment(trackId, nextSegment.id);
    activeSegmentIdRef.current = nextSegment.id;
    applyRegionStyles(nextSegment.id);
    wavesurferRef.current.setTime(nextSegment.start);
    setCurrentTime(nextSegment.start);
  };

  const seekFinalPreview = (time: number) => {
    const audio = finalPreviewAudioRef.current;
    if (!audio || finalPreviewDuration <= 0) return;

    const nextTime = clamp(time, 0, finalPreviewDuration);
    audio.currentTime = nextTime;
    setFinalPreviewCurrentTime(nextTime);
  };

  const skipFinalPreviewBy = (deltaSeconds: number) => {
    seekFinalPreview(finalPreviewCurrentTime + deltaSeconds);
  };

  const jumpToFinalPreviewOverlay = (direction: -1 | 1) => {
    if (!finalPreviewOverlays.length) return;

    const currentOverlayIndex = finalPreviewOverlays.findIndex((overlay) => overlay.id === activeFinalPreviewOverlayId);
    const fallbackIndex = finalPreviewOverlays.findIndex((overlay) => finalPreviewCurrentTime < overlay.end);
    const seedIndex =
      currentOverlayIndex >= 0
        ? currentOverlayIndex
        : fallbackIndex >= 0
          ? fallbackIndex
          : direction === 1
            ? -1
            : finalPreviewOverlays.length;
    const nextIndex = clamp(seedIndex + direction, 0, finalPreviewOverlays.length - 1);
    seekFinalPreview(finalPreviewOverlays[nextIndex].start);
  };

  const toggleFinalPreviewPlayback = async () => {
    const audio = finalPreviewAudioRef.current;
    if (!audio) return;

    if (isFinalPreviewPlaying) {
      audio.pause();
      return;
    }

    try {
      await audio.play();
    } catch (error) {
      console.error("Final preview playback failed", error);
      setIsFinalPreviewPlaying(false);
      setStatusMessage({ tone: "error", text: "Failed to play the final preview." });
    }
  };

  const playFinalPreview = async () => {
    if (!selectedTrack) return;

    const trackSegments = [...orderedSegments].sort((left, right) => left.start - right.start);
    if (!trackSegments.length) {
      setStatusMessage({ tone: "info", text: "Add a segment before playing the final preview." });
      return;
    }

    wavesurferRef.current?.pause();
    clearSegmentPreview();
    resetFinalPreview();
    setIsFinalPreviewLoading(true);

    try {
      const audioBuffer = await decodeAudioFile(selectedTrack.file);
      const processedSegments = trackSegments.map((segment) =>
        buildProcessedSegmentData({
          segmentId: segment.id,
          audioBuffer,
          start: segment.start,
          end: segment.end,
          fadeInSeconds: parseFadeSeconds(segment.fadeInInput),
          fadeOutSeconds: parseFadeSeconds(segment.fadeOutInput),
        }),
      );
      const mergedPreview = mergeProcessedSegments(processedSegments);
      const previewUrl = URL.createObjectURL(encodeWavPreview(mergedPreview));
      const previewAudio = new Audio(previewUrl);
      const previewDuration = mergedPreview.sampleCount / mergedPreview.sampleRate;

      finalPreviewUrlRef.current = previewUrl;
      finalPreviewAudioRef.current = previewAudio;
      previewAudio.preload = "metadata";
      previewAudio.volume = editorVolume;
      previewAudio.muted = isEditorMuted;
      previewAudio.ontimeupdate = () => {
        setFinalPreviewCurrentTime(previewAudio.currentTime);
      };
      previewAudio.onloadedmetadata = () => {
        setFinalPreviewDuration(Number.isFinite(previewAudio.duration) ? previewAudio.duration : previewDuration);
      };
      previewAudio.onplay = () => {
        setPlaybackMode("final-preview");
        setIsFinalPreviewPlaying(true);
        setIsFinalPreviewLoading(false);
      };
      previewAudio.onpause = () => {
        if (!previewAudio.ended) {
          setIsFinalPreviewPlaying(false);
        }
      };
      previewAudio.onended = () => {
        setIsFinalPreviewPlaying(false);
        setFinalPreviewCurrentTime(Number.isFinite(previewAudio.duration) ? previewAudio.duration : previewDuration);
      };

      setPlaybackMode("final-preview");
      setFinalPreviewOverlays(mergedPreview.overlays);
      setFinalPreviewCurrentTime(0);
      setFinalPreviewDuration(previewDuration);

      await previewAudio.play();
    } catch (error) {
      resetFinalPreview();
      setStatusMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to build the final preview.",
      });
    } finally {
      setIsFinalPreviewLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      const audio = finalPreviewAudioRef.current;
      if (audio) {
        audio.pause();
        audio.ontimeupdate = null;
        audio.onloadedmetadata = null;
        audio.onplay = null;
        audio.onpause = null;
        audio.onended = null;
        audio.removeAttribute("src");
        finalPreviewAudioRef.current = null;
      }

      if (finalPreviewUrlRef.current) {
        URL.revokeObjectURL(finalPreviewUrlRef.current);
        finalPreviewUrlRef.current = null;
      }

      setDockState(null);
    };
  }, [setDockState]);

  useEffect(() => {
    setDockState({
      playbackMode,
      title: selectedTrack?.displayName ?? "Nothing selected",
      subtitle: playbackMode === "final-preview" ? "Final preview" : undefined,
      modeLabel: playbackMode === "final-preview" ? "Final" : `${orderedSegments.length} seg`,
      isPlaying: displayIsPlaying,
      currentTime: displayCurrentTime,
      duration: displayDuration,
      volume: editorVolume,
      isMuted: isEditorMuted,
      overlays:
        playbackMode === "final-preview"
          ? finalPreviewOverlays.map((overlay) => ({
              ...overlay,
              isActive: overlay.id === activeFinalPreviewOverlayId,
            }))
          : orderedSegments.map((segment) => ({
              id: segment.id,
              start: segment.start,
              end: segment.end,
              isActive: segment.id === activeSegment?.id,
            })),
      activeOverlayId: playbackMode === "final-preview" ? activeFinalPreviewOverlayId : activeSegment?.id ?? null,
      onToggle: playbackMode === "final-preview" ? toggleFinalPreviewPlayback : toggleTrackPlayback,
      onSeek: playbackMode === "final-preview" ? seekFinalPreview : seekTrack,
      onSkipBack: playbackMode === "final-preview" ? () => skipFinalPreviewBy(-5) : () => skipTrackBy(-5),
      onSkipForward: playbackMode === "final-preview" ? () => skipFinalPreviewBy(5) : () => skipTrackBy(5),
      onJumpToPreviousOverlay: playbackMode === "final-preview" ? () => jumpToFinalPreviewOverlay(-1) : () => jumpToSegment(-1),
      onJumpToNextOverlay: playbackMode === "final-preview" ? () => jumpToFinalPreviewOverlay(1) : () => jumpToSegment(1),
      onSetVolume: (nextVolume) => {
        const safeVolume = clamp(nextVolume, 0, 1);
        setEditorVolume(safeVolume);
        if (safeVolume > 0 && isEditorMuted) {
          setIsEditorMuted(false);
        }
      },
      onToggleMute: () => setIsEditorMuted((current) => !current),
    });
  }, [
    activeSegment?.id,
    activeFinalPreviewOverlayId,
    displayCurrentTime,
    displayDuration,
    displayIsPlaying,
    finalPreviewOverlays,
    currentTime,
    duration,
    editorVolume,
    isEditorMuted,
    orderedSegments,
    selectedTrack?.displayName,
    playbackMode,
    setDockState,
  ]);

  const addSegment = () => {
    const trackId = selectedTrack?.id;
    if (!trackId || !regionsRef.current || duration <= 0) return;

    clearSegmentPreview();
    const seedTime = activeSegment ? activeSegment.end : currentTime;
    const window = getSuggestedSegmentWindow(duration, seedTime);
    const nextSegment = createSegment(window.start, window.end);

    segmentsRef.current = [...segmentsRef.current, nextSegment];

    updateQueuedTrack(trackId, (track) => ({
      ...track,
      segments: [...track.segments, nextSegment],
      activeSegmentId: nextSegment.id,
    }));

    activeSegmentIdRef.current = nextSegment.id;
    createWaveRegion(nextSegment, regionsRef.current);
    applyRegionStyles(nextSegment.id);
    wavesurferRef.current?.setTime(nextSegment.start);
    setCurrentTime(nextSegment.start);
  };

  const removeSegment = (segmentId: string) => {
    const trackId = selectedTrack?.id;
    if (!trackId) return;

    clearSegmentPreview();
    const nextSegments = segmentsRef.current.filter((segment) => segment.id !== segmentId);
    const nextActiveSegmentId =
      segmentId === activeSegmentIdRef.current ? nextSegments[0]?.id ?? null : activeSegmentIdRef.current;

    const region = regionMapRef.current.get(segmentId);
    region?.remove?.();
    regionMapRef.current.delete(segmentId);

    segmentsRef.current = nextSegments;
    activeSegmentIdRef.current = nextActiveSegmentId;

    updateQueuedTrack(trackId, (track) => ({
      ...track,
      segments: nextSegments,
      activeSegmentId: nextActiveSegmentId,
    }));

    applyRegionStyles(nextActiveSegmentId);

    if (!nextSegments.length) {
      wavesurferRef.current?.pause();
      setIsPlaying(false);
      return;
    }

    const nextActiveSegment = nextSegments.find((segment) => segment.id === nextActiveSegmentId) ?? nextSegments[0];
    wavesurferRef.current?.setTime(nextActiveSegment.start);
    setCurrentTime(nextActiveSegment.start);
  };

  const refreshInventory = async () => {
    if (!usesRemoteUpload || !user?.id) {
      return;
    }

    try {
      const inventory = await fetchHighlightInventory(user.id);
      setApprovedLibrary(inventory.sources);
      setInventoryError("");
    } catch (error) {
      setInventoryError(error instanceof Error ? error.message : "Failed to refresh the approved library.");
    }
  };

  const approveTrack = async (trackId: string) => {
    const track = queuedTracks.find((item) => item.id === trackId);
    if (!track) return;

      const trackSegments = [...track.segments].sort((left, right) => left.start - right.start);
    if (!trackSegments.length) {
      setSelectedQueuedId(trackId);
      setStatusMessage({ tone: "error", text: "Add a segment before approving." });
      return;
    }

    setApprovingTrackId(trackId);
    setStatusMessage(null);

    try {
      const audioBuffer = await decodeAudioFile(track.file);

      for (const [index, segment] of trackSegments.entries()) {
        const blob = createProcessedSegment({
          audioBuffer,
          segmentId: segment.id,
          start: segment.start,
          end: segment.end,
          fadeInSeconds: parseFadeSeconds(segment.fadeInInput),
          fadeOutSeconds: parseFadeSeconds(segment.fadeOutInput),
        });

        if (usesRemoteUpload && user?.id) {
          const storagePath = buildSegmentStoragePath(user.id, track.sourceHash, track.displayName, index);
          const { error } = await supabase.storage.from("highlights").upload(storagePath, blob, {
            contentType: "audio/mpeg",
            upsert: true,
          });

          if (error) {
            throw error;
          }
        }
      }

      const approvedAt = new Date().toISOString();
      const nextApprovedTrack: PersistedEditorTrack = {
        ...track,
        approvedAt,
        segmentCount: trackSegments.length,
      };

      const remainingQueuedTracks = queuedTracks.filter((item) => item.id !== trackId);
      setQueuedTracks(remainingQueuedTracks);
      setSelectedQueuedId((current) => (current === trackId ? remainingQueuedTracks[0]?.id ?? null : current));
      setApprovedTracks((current) => [nextApprovedTrack, ...current.filter((item) => item.id !== trackId)]);
      setRecentQueuedIds((current) => current.filter((id) => id !== trackId));

      if (usesRemoteUpload && user?.id) {
        await refreshInventory();
      }

      setStatusMessage({
        tone: "success",
        text: `${track.displayName} approved.`,
      });
    } catch (error) {
      setStatusMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to process and upload the selected track.",
      });
    } finally {
      setApprovingTrackId(null);
    }
  };

  const handleQueueSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter(isAudioFile);
    event.target.value = "";

    if (!files.length) {
      setStatusMessage({ tone: "info", text: "No audio files were detected in that selection." });
      return;
    }

    setIsQueueing(true);
    setStatusMessage(null);

    try {
      const queuedHashes = new Set(queuedTracks.map((track) => track.sourceHash));
      const approvedHashes = new Set(approvedTracks.map((track) => track.sourceHash));
      const libraryHashes = new Set(approvedLibrary.map((source) => source.sourceHash));
      const nextTracks: PersistedEditorTrack[] = [];
      const remoteDuplicates = new Set<string>();
      let draftDuplicateCount = 0;

      for (const file of files) {
        const sourceHash = await hashFile(file);

        if (libraryHashes.has(sourceHash)) {
          remoteDuplicates.add(sourceHash);
          continue;
        }

        if (queuedHashes.has(sourceHash) || approvedHashes.has(sourceHash)) {
          draftDuplicateCount += 1;
          continue;
        }

        queuedHashes.add(sourceHash);
        nextTracks.push(createDraftTrack(file, sourceHash));
      }

      setDuplicateLibraryHashes(Array.from(remoteDuplicates));
      setRecentQueuedIds(nextTracks.map((track) => track.id));

      if (!nextTracks.length) {
        const approvedDuplicateCount = remoteDuplicates.size;
        const parts = [];

        if (approvedDuplicateCount > 0) {
          parts.push(`${approvedDuplicateCount} already in the approved library`);
        }

        if (draftDuplicateCount > 0) {
          parts.push(`${draftDuplicateCount} already in this draft`);
        }

        setStatusMessage({
          tone: "info",
          text: parts.length ? `Nothing new was added. ${parts.join(". ")}.` : "Nothing new was added.",
        });
        return;
      }

      setQueuedTracks((current) => [...current, ...nextTracks]);
      setSelectedQueuedId((current) => current ?? nextTracks[0]?.id ?? null);

      const approvedDuplicateCount = remoteDuplicates.size;
      const summaryParts = [`Queued ${nextTracks.length} new track${nextTracks.length === 1 ? "" : "s"}.`];

      if (approvedDuplicateCount > 0) {
        summaryParts.push(`${approvedDuplicateCount} already approved and skipped.`);
      }

      if (draftDuplicateCount > 0) {
        summaryParts.push(`${draftDuplicateCount} already in this draft and skipped.`);
      }

      setStatusMessage({ tone: "success", text: summaryParts.join(" ") });
    } catch {
      setStatusMessage({ tone: "error", text: "Failed to inspect the selected files." });
    } finally {
      setIsQueueing(false);
    }
  };

  const handleSaveDraft = async () => {
    setIsSavingDraft(true);

    try {
      const savedAt = new Date().toISOString();
      await saveEditorDraftSnapshot({
        queuedTracks,
        approvedTracks,
        selectedQueuedId,
        savedAt,
      });

      setDraftSavedAt(savedAt);
      setStatusMessage({ tone: "success", text: "Saved locally." });
    } catch {
      setStatusMessage({ tone: "error", text: "Failed to save locally." });
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleClearDraft = async () => {
    setIsClearingDraft(true);

    try {
      await clearEditorDraftSnapshot();
      setQueuedTracks([]);
      setApprovedTracks([]);
      setSelectedQueuedId(null);
      setDuplicateLibraryHashes([]);
      setRecentQueuedIds([]);
      setDraftSavedAt(null);
      setStatusMessage({ tone: "info", text: "Local draft cleared." });
    } catch {
      setStatusMessage({ tone: "error", text: "Failed to clear the local draft." });
    } finally {
      setIsClearingDraft(false);
    }
  };

  const removeQueuedTrack = (trackId: string) => {
    const remainingQueuedTracks = queuedTracks.filter((track) => track.id !== trackId);
    setQueuedTracks(remainingQueuedTracks);
    setSelectedQueuedId((current) => (current === trackId ? remainingQueuedTracks[0]?.id ?? null : current));
    setRecentQueuedIds((current) => current.filter((id) => id !== trackId));
  };

  const requeueApprovedTrack = (trackId: string) => {
    const track = approvedTracks.find((item) => item.id === trackId);
    if (!track) return;

    const nextQueuedTrack: PersistedEditorTrack = {
      ...track,
      approvedAt: null,
      segmentCount: null,
    };

    setApprovedTracks((current) => current.filter((item) => item.id !== trackId));
    setQueuedTracks((current) => [nextQueuedTrack, ...current.filter((item) => item.id !== trackId)]);
    setSelectedQueuedId(trackId);
    setStatusMessage({ tone: "info", text: `${track.displayName} moved back to queue.` });
  };

  const dismissApprovedTrack = (trackId: string) => {
    setApprovedTracks((current) => current.filter((track) => track.id !== trackId));
  };

  const beginTrackDrag = (trackId: string, lane: DragLane) => (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", JSON.stringify({ trackId, lane }));
    setDragTrackId(trackId);
  };

  const clearDragState = () => {
    setDragTrackId(null);
    setActiveDropLane(null);
  };

  const readDraggedTrackId = (event: DragEvent<HTMLElement>) => {
    if (dragTrackId) return dragTrackId;

    try {
      const payload = JSON.parse(event.dataTransfer.getData("text/plain")) as { trackId?: string };
      return payload.trackId ?? null;
    } catch {
      return null;
    }
  };

  const handleApprovedLaneDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();

    const nextTrackId = readDraggedTrackId(event);
    clearDragState();

    if (!nextTrackId) return;

    const track = queuedTracks.find((item) => item.id === nextTrackId);
    if (!track) return;

    if (!track.segments.length) {
      setSelectedQueuedId(track.id);
      setStatusMessage({ tone: "info", text: "Track loaded." });
      return;
    }

    void approveTrack(track.id);
  };

  const handleLibraryLaneDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();

    clearDragState();
  };

  return (
    <>
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js" strategy="lazyOnload" />

      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
        <section className="editor-surface shrink-0 rounded-[28px] px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-accent-red">Editor</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="font-serif text-2xl text-text-main sm:text-3xl">Audio editor</h1>
                {usesRemoteUpload ? <Badge variant="green">Online</Badge> : <Badge variant="dim">Local mode</Badge>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {draftSavedAt ? <Badge variant="blue">Local {formatDateLabel(draftSavedAt)}</Badge> : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                onChange={handleQueueSelection}
              />
              <input
                ref={folderInputRef}
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                onChange={handleQueueSelection}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isQueueing || isInventorySyncing || isDraftHydrating}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-2 text-sm text-text-main transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:text-text-dim"
              >
                {isQueueing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Add files
              </button>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                disabled={isQueueing || isInventorySyncing || isDraftHydrating}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-2 text-sm text-text-main transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:text-text-dim"
              >
                <FolderOpen className="h-4 w-4" />
                Add folder
              </button>
              <button
                type="button"
                onClick={() => void handleSaveDraft()}
                disabled={isSavingDraft || isDraftHydrating}
                className="inline-flex items-center gap-2 rounded-full border border-accent-blue/20 bg-accent-blue/10 px-3.5 py-2 text-sm text-accent-blue transition-colors hover:bg-accent-blue/16 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-text-dim"
              >
                {isSavingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save locally
              </button>
              <button
                type="button"
                onClick={() => void handleClearDraft()}
                disabled={isClearingDraft}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm text-text-dim transition-colors hover:bg-white/[0.06] hover:text-text-main disabled:cursor-not-allowed"
              >
                {isClearingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Clear local
              </button>
            </div>
          </div>

          {statusMessage ? (
            <div
              className={cn(
                "mt-3 rounded-[20px] border px-3.5 py-2 font-sans text-xs",
                statusMessage.tone === "error" && "border-accent-red/25 bg-accent-red/12 text-accent-red",
                statusMessage.tone === "success" && "border-accent-green/20 bg-accent-green/12 text-accent-green",
                statusMessage.tone === "info" && "border-white/10 bg-white/[0.04] text-text-soft",
              )}
            >
              {statusMessage.text}
            </div>
          ) : null}
        </section>

        <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.95fr)_minmax(220px,0.72fr)_minmax(220px,0.72fr)]">
          <div className="grid min-h-0 gap-3 xl:grid-rows-[minmax(360px,1.3fr)_minmax(230px,0.9fr)]">
            <section className="editor-surface flex min-h-0 flex-col rounded-[28px] p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-3">
                <div className="min-w-0">
                  <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-text-dim">Inspector</div>
                  {selectedTrack ? (
                    <div className="mt-2 truncate font-serif text-[1.7rem] text-text-main">{selectedTrack.displayName}</div>
                  ) : (
                    <div className="mt-2 font-serif text-[1.7rem] text-text-main">Nothing selected</div>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge variant="dim">{selectedTrack ? `${orderedSegments.length} seg` : "Empty"}</Badge>
                  <Badge variant="dim">
                    {formatTime(displayCurrentTime)} / {formatTime(displayDuration)}
                  </Badge>
                </div>
              </div>

              {!selectedTrack ? (
                <div className="flex min-h-0 flex-1 items-center justify-center rounded-[26px] border border-dashed border-white/10 bg-white/[0.03] px-6 py-8 text-center font-sans text-sm text-text-dim">
                  {isInventorySyncing ? "Syncing…" : "Queue a track"}
                </div>
              ) : (
                <div className="mt-4 grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(250px,0.72fr)]">
                  <div className="min-h-0 rounded-[26px] border border-white/10 bg-black/18 p-3">
                    <div className="relative overflow-hidden rounded-[18px]" style={{ height: `${WAVEFORM_HEIGHT}px` }}>
                      <div ref={waveformRef} className="relative z-10 h-full w-full" />

                      {duration > 0 && orderedSegments.length > 0 ? (
                        <div className="pointer-events-none absolute inset-0 z-30">
                          {orderedSegments.map((segment) => {
                            const segmentDuration = getRegionDuration(segment.start, segment.end);
                            const fadeInDuration = Math.min(parseFadeSeconds(segment.fadeInInput), segmentDuration);
                            const fadeOutDuration = Math.min(parseFadeSeconds(segment.fadeOutInput), segmentDuration);
                            const isActive = segment.id === activeSegment?.id;

                            return (
                              <div
                                key={segment.id}
                                className="absolute inset-y-1"
                                style={{
                                  left: `${(segment.start / duration) * 100}%`,
                                  width: `${(segmentDuration / duration) * 100}%`,
                                }}
                              >
                                <div
                                  className={cn(
                                    "absolute inset-0 rounded-sm border",
                                    isActive ? "border-accent-gold/80 bg-accent-gold/12" : "border-accent-blue/60 bg-accent-blue/10",
                                  )}
                                />

                                {fadeInDuration > 0 ? (
                                  <div
                                    className="absolute inset-y-0 left-0 rounded-l-sm border-l border-accent-gold"
                                    style={{
                                      width: `${(fadeInDuration / segmentDuration) * 100}%`,
                                      backgroundImage:
                                        "repeating-linear-gradient(135deg, rgba(211,170,78,0.5) 0px, rgba(211,170,78,0.5) 8px, rgba(211,170,78,0.14) 8px, rgba(211,170,78,0.14) 16px), linear-gradient(to right, rgba(211,170,78,0.42), rgba(211,170,78,0))",
                                    }}
                                  />
                                ) : null}

                                {fadeOutDuration > 0 ? (
                                  <div
                                    className="absolute inset-y-0 right-0 rounded-r-sm border-r border-accent-gold"
                                    style={{
                                      width: `${(fadeOutDuration / segmentDuration) * 100}%`,
                                      backgroundImage:
                                        "repeating-linear-gradient(225deg, rgba(211,170,78,0.5) 0px, rgba(211,170,78,0.5) 8px, rgba(211,170,78,0.14) 8px, rgba(211,170,78,0.14) 16px), linear-gradient(to left, rgba(211,170,78,0.42), rgba(211,170,78,0))",
                                    }}
                                  />
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={addSegment}
                        disabled={duration <= 0}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-text-main transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:text-text-dim"
                      >
                        <Waves className="h-4 w-4" />
                        Add segment
                      </button>
                      <button
                        type="button"
                        onClick={() => void (playbackMode === "final-preview" && finalPreviewAudioRef.current ? toggleFinalPreviewPlayback() : playFinalPreview())}
                        disabled={isFinalPreviewLoading || !orderedSegments.length}
                        className="inline-flex items-center gap-2 rounded-full border border-accent-blue/20 bg-accent-blue/10 px-4 py-2 text-sm text-accent-blue transition-colors hover:bg-accent-blue/16 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-text-dim"
                      >
                        {isFinalPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        {playbackMode === "final-preview" && displayIsPlaying ? "Pause final" : "Play final"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void approveTrack(selectedTrack.id)}
                        disabled={approvingTrackId === selectedTrack.id || !orderedSegments.length}
                        className="inline-flex items-center gap-2 rounded-full border border-accent-gold/28 bg-accent-gold/12 px-4 py-2 text-sm text-accent-gold transition-colors hover:bg-accent-gold/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-text-dim"
                      >
                        {approvingTrackId === selectedTrack.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                        Approve selected
                      </button>
                    </div>
                  </div>

                  <div className="flex min-h-0 flex-col rounded-[26px] border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
                      <div className="font-sans text-sm text-text-main">Segments</div>
                      <div className="flex items-center gap-2">
                        <Badge variant="dim">{orderedSegments.length}</Badge>
                        {displayIsPlaying ? <Badge variant="gold">{playbackMode === "final-preview" ? "Final" : "Playing"}</Badge> : null}
                      </div>
                    </div>

                    <div className="mt-3 min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
                      {orderedSegments.length === 0 ? (
                        <div className="rounded-[18px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-5 text-center font-sans text-sm text-text-dim">
                          Empty
                        </div>
                      ) : (
                        orderedSegments.map((segment, index) => {
                          const isActive = segment.id === activeSegment?.id;

                          return (
                            <div
                              key={segment.id}
                              className={cn(
                                "rounded-[18px] border px-3 py-2.5 transition-colors",
                                isActive ? "border-accent-gold/30 bg-accent-gold/10" : "border-white/10 bg-white/[0.03]",
                              )}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="font-sans text-sm text-text-main">S{String(index + 1).padStart(2, "0")}</div>
                                  <div className="font-sans text-xs text-text-dim">{formatTime(segment.start)} - {formatTime(segment.end)}</div>
                                </div>
                                {isActive ? <Badge variant="gold">Active</Badge> : null}
                              </div>

                              <div className="mt-2.5 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => previewSegment(segment.id)}
                                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-text-main transition-colors hover:bg-white/[0.08]"
                                >
                                  Preview
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeSegment(segment.id)}
                                  className="rounded-full border border-accent-red/20 bg-accent-red/10 px-3 py-1.5 text-xs text-accent-red transition-colors hover:bg-accent-red/16"
                                >
                                  Remove
                                </button>
                              </div>

                              <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                                <label className="block">
                                  <div className="mb-1 font-sans text-[11px] uppercase tracking-[0.14em] text-text-dim">In</div>
                                  <input
                                    inputMode="decimal"
                                    value={segment.fadeInInput}
                                    onChange={handleFadeInputChange(segment.id, "fadeInInput")}
                                    onBlur={() => handleFadeBlur(segment.id, "fadeInInput")}
                                    className="w-full rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5 text-sm text-text-main outline-none transition-colors focus:border-accent-gold/35"
                                  />
                                </label>
                                <label className="block">
                                  <div className="mb-1 font-sans text-[11px] uppercase tracking-[0.14em] text-text-dim">Out</div>
                                  <input
                                    inputMode="decimal"
                                    value={segment.fadeOutInput}
                                    onChange={handleFadeInputChange(segment.id, "fadeOutInput")}
                                    onBlur={() => handleFadeBlur(segment.id, "fadeOutInput")}
                                    className="w-full rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5 text-sm text-text-main outline-none transition-colors focus:border-accent-gold/35"
                                  />
                                </label>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="editor-surface flex min-h-0 flex-col rounded-[28px] p-4">
              <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-text-dim">Queue</div>
                  <div className="mt-1.5 font-sans text-base text-text-main">{queuedTracks.length}</div>
                </div>
                {recentQueuedIds.length ? <Badge variant="blue">{recentQueuedIds.length} new</Badge> : null}
              </div>

              <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
                {queuedTracks.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-center font-sans text-sm text-text-dim">
                    Empty
                  </div>
                ) : (
                  <div className="space-y-2">
                    {queuedTracks.map((track) => {
                      const isSelected = selectedTrack?.id === track.id;

                      return (
                        <EditorTrackCard
                          key={track.id}
                          title={track.displayName}
                          density="compact"
                          badgeLabel={isSelected ? "Editing" : recentQueuedIds.includes(track.id) ? "New" : undefined}
                          badgeVariant={isSelected ? "gold" : "blue"}
                          isSelected={isSelected}
                          draggable
                          onClick={() => setSelectedQueuedId(track.id)}
                          onDragStart={beginTrackDrag(track.id, "queued")}
                          onDragEnd={clearDragState}
                          actionNode={
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                removeQueuedTrack(track.id);
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-text-dim transition-colors hover:bg-accent-red/12 hover:text-accent-red"
                              aria-label={`Remove ${track.displayName}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>

          <section
            className="editor-surface editor-drop-target flex min-h-0 flex-col rounded-[28px] p-3.5 sm:p-4"
            data-drop-active={activeDropLane === "approved" ? "true" : "false"}
            onDragOver={(event) => {
              event.preventDefault();
              setActiveDropLane("approved");
            }}
            onDrop={handleApprovedLaneDrop}
            onDragLeave={() => {
              if (activeDropLane === "approved") {
                setActiveDropLane(null);
              }
            }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
              <div>
                <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-text-dim">Approved</div>
                <div className="mt-1.5 font-sans text-base text-text-main">{approvedTracks.length}</div>
              </div>
              {approvingTrackId ? <Badge variant="gold">Approving</Badge> : null}
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
              {approvedTracks.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-center font-sans text-sm text-text-dim">
                  Empty
                </div>
              ) : (
                <div className="space-y-3">
                  {approvedTracks.map((track) => (
                    <EditorTrackCard
                      key={track.id}
                      title={track.displayName}
                      subtitle={`${track.segmentCount ?? track.segments.length} segment${(track.segmentCount ?? track.segments.length) === 1 ? "" : "s"}`}
                      badgeLabel="Approved"
                      badgeVariant="green"
                      actionNode={
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              requeueApprovedTrack(track.id);
                            }}
                            className="rounded-full border border-accent-blue/20 bg-accent-blue/10 px-3 py-1.5 text-xs text-accent-blue transition-colors hover:bg-accent-blue/16"
                          >
                            Re-edit
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              dismissApprovedTrack(track.id);
                            }}
                            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-text-dim transition-colors hover:bg-accent-red/12 hover:text-accent-red"
                            aria-label={`Delete ${track.displayName}`}
                          >
                            Delete
                          </button>
                        </div>
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          <section
            className="editor-surface editor-drop-target flex min-h-0 flex-col rounded-[28px] p-3.5 sm:p-4"
            data-drop-active={activeDropLane === "library" ? "true" : "false"}
            onDragOver={(event) => {
              event.preventDefault();
              setActiveDropLane("library");
            }}
            onDrop={handleLibraryLaneDrop}
            onDragLeave={() => {
              if (activeDropLane === "library") {
                setActiveDropLane(null);
              }
            }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
              <div>
                <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-text-dim">Approved library</div>
                <div className="mt-1.5 font-sans text-base text-text-main">{librarySources.length}</div>
              </div>
              <Link
                href="/reel"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-text-main transition-colors hover:bg-white/[0.08]"
              >
                <Library className="h-4 w-4" />
                Player
              </Link>
            </div>

            {duplicateLibraryHashes.length ? (
              <div className="mt-4 rounded-[22px] border border-accent-red/20 bg-accent-red/10 px-4 py-3 font-sans text-sm text-accent-red">
                {duplicateLibraryHashes.length} skipped.
              </div>
            ) : null}

            {inventoryError ? (
              <div className="mt-4 rounded-[22px] border border-accent-red/20 bg-accent-red/10 px-4 py-3 font-sans text-sm text-accent-red">
                {inventoryError}
              </div>
            ) : null}

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
              {isInventoryLoading ? (
                <div className="flex h-full items-center justify-center gap-3 rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-center font-sans text-sm text-text-dim">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : librarySources.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-center font-sans text-sm text-text-dim">
                  Empty
                </div>
              ) : (
                <div className="space-y-3">
                  {librarySources.map((source) => {
                    const isDuplicate = duplicateLibraryHashes.includes(source.sourceHash);

                    return (
                      <EditorTrackCard
                        key={source.sourceHash}
                        title={source.sourceName}
                        subtitle={`${source.segmentCount} segment${source.segmentCount === 1 ? "" : "s"}`}
                        badgeLabel={isDuplicate ? "Duplicate" : "Library"}
                        badgeVariant={isDuplicate ? "red" : "dim"}
                        isDuplicate={isDuplicate}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
