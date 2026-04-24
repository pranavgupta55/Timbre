"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Script from "next/script";
import { Check, FolderOpen, Library, Loader2, Play, Save, Trash2, Upload, Waves } from "lucide-react";
import { EditorTrackCard } from "@/components/editor/EditorTrackCard";
import { useEditorPlaybackController } from "@/components/editor/useEditorPlaybackController";
import { Badge } from "@/components/ui/TacticalUI";
import { useAuth } from "@/context/AuthContext";
import { useSetEditorAudioDock, type EditorDockOverlay } from "@/context/EditorAudioDockContext";
import {
  clearEditorDraftSnapshot,
  loadEditorDraftSnapshot,
  saveEditorDraftSnapshot,
  type PersistedEditorTrack,
  type PersistedTrackSegment,
  type TrackUploadMode,
} from "@/lib/editor-draft-storage";
import {
  buildSegmentStoragePath,
  deleteHighlightSourceAssets,
  downloadHighlightTrack,
  fetchHighlightInventory,
  sortHighlightTracksBySegment,
  stripExtension,
  type ApprovedSource,
  type HighlightTrack,
} from "@/lib/highlights";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const WAVEFORM_HEIGHT = 176;
const DEFAULT_SEGMENT_LENGTH = 15;
const DEFAULT_FADE_SECONDS = "2.0";
const LIBRARY_SEGMENT_FADE_SECONDS = "0.0";
const DEFAULT_TRACK_UPLOAD_MODE: TrackUploadMode = "merged";
const DEFAULT_TRACK_OUTPUT_GAIN = 1;

type StatusTone = "info" | "success" | "error";
type StatusMessage = { tone: StatusTone; text: string } | null;
type DragLane = "queued";
type DropLane = "approved" | "library" | null;
type ProcessedSegmentData = {
  id: string;
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  sampleCount: number;
};

type EncodableAudioData = Pick<ProcessedSegmentData, "left" | "right" | "sampleRate" | "sampleCount">;

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

const createSavedSegment = (start: number, end: number): PersistedTrackSegment => ({
  id: createSegmentId(),
  start,
  end,
  fadeInInput: LIBRARY_SEGMENT_FADE_SECONDS,
  fadeOutInput: LIBRARY_SEGMENT_FADE_SECONDS,
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

const areSegmentsEquivalent = (left: PersistedTrackSegment[], right: PersistedTrackSegment[]) =>
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
  uploadMode: DEFAULT_TRACK_UPLOAD_MODE,
  outputGain: DEFAULT_TRACK_OUTPUT_GAIN,
});

const normalizeEditorTrack = (track: PersistedEditorTrack): PersistedEditorTrack => ({
  ...track,
  uploadMode: track.uploadMode ?? DEFAULT_TRACK_UPLOAD_MODE,
  outputGain: clamp(track.outputGain ?? DEFAULT_TRACK_OUTPUT_GAIN, 0, 1),
});

const getAudioContextCtor = () =>
  window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

const decodeAudioArrayBuffer = async (arrayBuffer: ArrayBuffer) => {
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

const decodeAudioFile = async (file: File) => decodeAudioArrayBuffer(await file.arrayBuffer());

const buildProcessedSegmentData = ({
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

const encodeMp3Segment = (segment: EncodableAudioData) => {
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

const encodeWavPreview = (segment: EncodableAudioData) => {
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
  const setDockState = useSetEditorAudioDock();

  const [queuedTracks, setQueuedTracks] = useState<PersistedEditorTrack[]>([]);
  const [approvedTracks, setApprovedTracks] = useState<PersistedEditorTrack[]>([]);
  const [approvedLibrary, setApprovedLibrary] = useState<ApprovedSource[]>([]);
  const [approvedLibraryTracks, setApprovedLibraryTracks] = useState<HighlightTrack[]>([]);
  const [selectedQueuedId, setSelectedQueuedId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const [inventoryError, setInventoryError] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [isDraftHydrating, setIsDraftHydrating] = useState(true);
  const [isInventoryLoading, setIsInventoryLoading] = useState(true);
  const [isQueueing, setIsQueueing] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isClearingDraft, setIsClearingDraft] = useState(false);
  const [isEditorMuted, setIsEditorMuted] = useState(false);
  const [duplicateLibraryHashes, setDuplicateLibraryHashes] = useState<string[]>([]);
  const [recentQueuedIds, setRecentQueuedIds] = useState<string[]>([]);
  const [activeDropLane, setActiveDropLane] = useState<DropLane>(null);
  const [dragTrackId, setDragTrackId] = useState<string | null>(null);
  const [loadingLibrarySourceHash, setLoadingLibrarySourceHash] = useState<string | null>(null);
  const [isUploadingApproved, setIsUploadingApproved] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);

  const usesRemoteUpload =
    Boolean(user?.id) &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("placeholder") &&
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.includes("placeholder");

  const isInventorySyncing = usesRemoteUpload && isInventoryLoading;

  const selectedTrack = useMemo(
    () => queuedTracks.find((track) => track.id === selectedQueuedId) ?? queuedTracks[0] ?? null,
    [queuedTracks, selectedQueuedId],
  );
  const selectedTrackFile = selectedTrack?.file ?? null;
  const selectedTrackId = selectedTrack?.id ?? null;
  const editorOutputGain = selectedTrack?.outputGain ?? DEFAULT_TRACK_OUTPUT_GAIN;
  const deferredEditorOutputGain = useDeferredValue(editorOutputGain);

  const orderedSegments = useMemo(
    () => [...(selectedTrack?.segments ?? [])].sort((left, right) => left.start - right.start),
    [selectedTrack?.segments],
  );

  const librarySources = useMemo(() => {
    const queuedHashes = new Set(queuedTracks.map((track) => track.sourceHash));
    const approvedHashes = new Set(approvedTracks.map((track) => track.sourceHash));
    return approvedLibrary.filter((source) => !approvedHashes.has(source.sourceHash) && !queuedHashes.has(source.sourceHash));
  }, [approvedLibrary, approvedTracks, queuedTracks]);

  const pendingApprovedCount = useMemo(
    () => approvedTracks.filter((track) => track.uploadState !== "synced").length,
    [approvedTracks],
  );

  useEffect(() => {
    if (selectedQueuedId && queuedTracks.some((track) => track.id === selectedQueuedId)) {
      return;
    }

    setSelectedQueuedId(queuedTracks[0]?.id ?? null);
  }, [queuedTracks, selectedQueuedId]);

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

        setQueuedTracks((snapshot.queuedTracks ?? []).map(normalizeEditorTrack));
        setApprovedTracks(
          (snapshot.approvedTracks ?? []).map((track) => ({
            ...normalizeEditorTrack(track),
            uploadState: track.uploadState ?? (track.approvedAt ? "synced" : "pending"),
          })),
        );
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
      setApprovedLibraryTracks([]);
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
          setApprovedLibraryTracks(inventory.tracks);
        }
      } catch (error) {
        if (!isCancelled) {
          setApprovedLibrary([]);
          setApprovedLibraryTracks([]);
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

  const updateQueuedTrack = (trackId: string, updater: (track: PersistedEditorTrack) => PersistedEditorTrack) => {
    setQueuedTracks((currentTracks) => {
      let hasChanged = false;

      const nextTracks = currentTracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }

        const nextTrack = updater(track);
        if (nextTrack !== track) {
          hasChanged = true;
        }

        return nextTrack;
      });

      return hasChanged ? nextTracks : currentTracks;
    });
  };

  const updateApprovedTrack = (trackId: string, updater: (track: PersistedEditorTrack) => PersistedEditorTrack) => {
    setApprovedTracks((currentTracks) => {
      let hasChanged = false;

      const nextTracks = currentTracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }

        const nextTrack = updater(track);
        if (nextTrack !== track) {
          hasChanged = true;
        }

        return nextTrack;
      });

      return hasChanged ? nextTracks : currentTracks;
    });
  };
  const persistSelectedTrackActiveSegment = useCallback(
    (segmentId: string | null) => {
      if (!selectedTrackId) {
        return;
      }

      updateQueuedTrack(selectedTrackId, (track) =>
        track.activeSegmentId === segmentId
          ? track
          : {
              ...track,
              activeSegmentId: segmentId,
            },
      );
    },
    [selectedTrackId],
  );

  const persistSelectedTrackNormalizedSegments = useCallback(
    (nextSegments: PersistedTrackSegment[], nextActiveSegmentId: string | null) => {
      if (!selectedTrackId) {
        return;
      }

      updateQueuedTrack(selectedTrackId, (track) =>
        areSegmentsEquivalent(track.segments, nextSegments) && track.activeSegmentId === nextActiveSegmentId
          ? track
          : {
              ...track,
              segments: nextSegments,
              activeSegmentId: nextActiveSegmentId,
            },
      );
    },
    [selectedTrackId],
  );

  const persistSelectedTrackSegmentBounds = useCallback(
    (nextSegments: PersistedTrackSegment[]) => {
      if (!selectedTrackId) {
        return;
      }

      updateQueuedTrack(selectedTrackId, (track) =>
        areSegmentsEquivalent(track.segments, nextSegments)
          ? track
          : {
              ...track,
              segments: nextSegments,
            },
      );
    },
    [selectedTrackId],
  );

  const handlePlaybackError = useCallback((message: string) => {
    setStatusMessage({ tone: "error", text: message });
  }, []);

  const playbackController = useEditorPlaybackController({
    trackId: selectedTrackId,
    file: selectedTrackFile,
    segments: orderedSegments,
    persistedActiveSegmentId: selectedTrack?.activeSegmentId ?? null,
    outputGain: deferredEditorOutputGain,
    isMuted: isEditorMuted,
    waveformRef,
    onPersistActiveSegment: persistSelectedTrackActiveSegment,
    onPersistNormalizedSegments: persistSelectedTrackNormalizedSegments,
    onPersistSegmentBounds: persistSelectedTrackSegmentBounds,
    onError: handlePlaybackError,
  });

  const playbackMode = playbackController.mode;
  const displayCurrentTime = playbackController.displayCurrentTime;
  const displayDuration = playbackController.displayDuration;
  const displayIsPlaying = playbackController.displayIsPlaying;
  const currentTime = playbackController.sourceCurrentTime;
  const duration = playbackController.sourceDuration;
  const isFinalPreviewLoading = playbackController.isFinalPreviewLoading;
  const finalPreviewOverlays = playbackController.finalPreviewOverlays;
  const activeFinalPreviewOverlayId = playbackController.activeFinalPreviewOverlayId;
  const activeSegment = orderedSegments.find((segment) => segment.id === playbackController.activeSegmentId) ?? orderedSegments[0] ?? null;
  const togglePlayback = playbackController.togglePlayback;
  const seekTransport = playbackController.seekTransport;
  const skipTransportBy = playbackController.skipTransportBy;
  const jumpTransportOverlay = playbackController.jumpTransportOverlay;
  const playFinalPreview = playbackController.playFinalPreview;
  const previewSegment = playbackController.previewSegment;
  const seekSource = playbackController.seekSource;
  const pauseSource = playbackController.pauseSource;
  const setSourceActiveSegment = playbackController.setSourceActiveSegment;

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

  const setSelectedTrackUploadMode = (uploadMode: TrackUploadMode) => {
    const trackId = selectedTrack?.id;
    if (!trackId) return;

    updateQueuedTrack(trackId, (track) => ({
      ...track,
      uploadMode,
    }));
  };

  const setSelectedTrackOutputGain = (nextGain: number) => {
    const trackId = selectedTrack?.id;
    if (!trackId) return;

    const safeGain = clamp(nextGain, 0, 1);
    updateQueuedTrack(trackId, (track) => ({
      ...track,
      outputGain: safeGain,
    }));

    if (safeGain > 0 && isEditorMuted) {
      setIsEditorMuted(false);
    }
  };

  useEffect(() => {
    const handleSpacebarToggle = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName))
      ) {
        return;
      }

      const canToggle = playbackMode === "final-preview" ? displayDuration > 0 : duration > 0;
      if (!canToggle) {
        return;
      }

      event.preventDefault();
      void togglePlayback();
    };

    window.addEventListener("keydown", handleSpacebarToggle);
    return () => {
      window.removeEventListener("keydown", handleSpacebarToggle);
    };
  }, [displayDuration, duration, playbackMode, togglePlayback]);

  useEffect(() => {
    return () => {
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
      volume: editorOutputGain,
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
      onToggle: togglePlayback,
      onSeek: seekTransport,
      onSkipBack: () => skipTransportBy(-5),
      onSkipForward: () => skipTransportBy(5),
      onJumpToPreviousOverlay: () => jumpTransportOverlay(-1),
      onJumpToNextOverlay: () => jumpTransportOverlay(1),
      onSetVolume: setSelectedTrackOutputGain,
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
    editorOutputGain,
    isEditorMuted,
    orderedSegments,
    selectedTrack?.displayName,
    selectedTrack?.id,
    playbackMode,
    setDockState,
    seekTransport,
    skipTransportBy,
    jumpTransportOverlay,
    togglePlayback,
  ]);

  const addSegment = () => {
    const trackId = selectedTrack?.id;
    if (!trackId || duration <= 0) return;

    const seedTime = activeSegment ? activeSegment.end : currentTime;
    const window = getSuggestedSegmentWindow(duration, seedTime);
    const nextSegment = createSegment(window.start, window.end);

    updateQueuedTrack(trackId, (track) => ({
      ...track,
      segments: [...track.segments, nextSegment],
      activeSegmentId: nextSegment.id,
    }));

    setSourceActiveSegment(nextSegment.id, {
      persist: false,
      seekTime: nextSegment.start,
    });
  };

  const removeSegment = (segmentId: string) => {
    const trackId = selectedTrack?.id;
    if (!trackId) return;

    const nextSegments = orderedSegments.filter((segment) => segment.id !== segmentId);
    const nextActiveSegmentId =
      segmentId === playbackController.activeSegmentId ? nextSegments[0]?.id ?? null : playbackController.activeSegmentId;

    updateQueuedTrack(trackId, (track) => ({
      ...track,
      segments: nextSegments,
      activeSegmentId: nextActiveSegmentId,
    }));

    if (!nextSegments.length) {
      pauseSource();
      seekSource(0);
      return;
    }

    const nextActiveSegment = nextSegments.find((segment) => segment.id === nextActiveSegmentId) ?? nextSegments[0];
    setSourceActiveSegment(nextActiveSegment.id, {
      persist: false,
      seekTime: nextActiveSegment.start,
    });
  };

  const refreshInventory = async () => {
    if (!usesRemoteUpload || !user?.id) {
      return;
    }

    try {
      const inventory = await fetchHighlightInventory(user.id);
      setApprovedLibrary(inventory.sources);
      setApprovedLibraryTracks(inventory.tracks);
      setInventoryError("");
    } catch (error) {
      setInventoryError(error instanceof Error ? error.message : "Failed to refresh the approved library.");
    }
  };

  const uploadApprovedTrack = async (track: PersistedEditorTrack) => {
    if (!user?.id) {
      throw new Error("Sign in to upload approved tracks.");
    }

    const trackSegments = [...track.segments].sort((left, right) => left.start - right.start);
    if (!trackSegments.length) {
      throw new Error(`Add a segment before uploading ${track.displayName}.`);
    }

    const audioBuffer = await decodeAudioFile(track.file);
    const gainMultiplier = clamp(track.outputGain ?? DEFAULT_TRACK_OUTPUT_GAIN, 0, 1);
    const processedSegments = trackSegments.map((segment) =>
      buildProcessedSegmentData({
        segmentId: segment.id,
        audioBuffer,
        start: segment.start,
        end: segment.end,
        fadeInSeconds: parseFadeSeconds(segment.fadeInInput),
        fadeOutSeconds: parseFadeSeconds(segment.fadeOutInput),
        gainMultiplier,
      }),
    );

    await deleteHighlightSourceAssets(user.id, track.sourceHash);

    if ((track.uploadMode ?? DEFAULT_TRACK_UPLOAD_MODE) === "merged") {
      const storagePath = buildSegmentStoragePath(user.id, track.sourceHash, track.displayName, 0);
      const { error } = await supabase.storage.from("highlights").upload(storagePath, encodeMp3Segment(mergeProcessedSegments(processedSegments)), {
        contentType: "audio/mpeg",
        upsert: true,
      });

      if (error) {
        throw error;
      }

      return trackSegments.length;
    }

    for (const [index, segment] of processedSegments.entries()) {
      const storagePath = buildSegmentStoragePath(user.id, track.sourceHash, track.displayName, index);
      const { error } = await supabase.storage.from("highlights").upload(storagePath, encodeMp3Segment(segment), {
        contentType: "audio/mpeg",
        upsert: true,
      });

      if (error) {
        throw error;
      }
    }

    return trackSegments.length;
  };

  const loadLibrarySourceToApproved = async (source: ApprovedSource) => {
    if (!usesRemoteUpload || !user?.id) {
      setStatusMessage({ tone: "info", text: "Library loading is only available online." });
      return;
    }

    const sourceTracks = sortHighlightTracksBySegment(
      approvedLibraryTracks.filter((track) => track.sourceHash === source.sourceHash),
    );

    if (!sourceTracks.length) {
      setStatusMessage({ tone: "error", text: `No saved segments were found for ${source.sourceName}.` });
      return;
    }

    setLoadingLibrarySourceHash(source.sourceHash);
    setStatusMessage(null);

    try {
      const processedSegments: ProcessedSegmentData[] = [];

      for (const sourceTrack of sourceTracks) {
        const blob = await downloadHighlightTrack(sourceTrack.storage_path);
        const audioBuffer = await decodeAudioArrayBuffer(await blob.arrayBuffer());

        processedSegments.push(
          buildProcessedSegmentData({
            segmentId: createSegmentId(),
            audioBuffer,
            start: 0,
            end: audioBuffer.duration,
            fadeInSeconds: 0,
            fadeOutSeconds: 0,
          }),
        );
      }

      const mergedPreview = mergeProcessedSegments(processedSegments);
      const file = new File([encodeWavPreview(mergedPreview)], `${source.sourceName}.wav`, {
        type: "audio/wav",
        lastModified: Date.now(),
      });

      let offset = 0;
      const reconstructedSegments = processedSegments.map((segment) => {
        const segmentDuration = segment.sampleCount / segment.sampleRate;
        const nextSegment = createSavedSegment(offset, offset + segmentDuration);
        offset += segmentDuration;
        return nextSegment;
      });

      const loadedTrack = normalizeEditorTrack({
        ...createDraftTrack(file, source.sourceHash),
        displayName: source.sourceName,
        relativePath: source.sampleStoragePath,
        segments: reconstructedSegments,
        activeSegmentId: reconstructedSegments[0]?.id ?? null,
        approvedAt: source.uploadedAt,
        segmentCount: reconstructedSegments.length,
        uploadState: "synced",
        uploadMode: sourceTracks.length > 1 ? "separate" : "merged",
      });

      setApprovedTracks((current) => [loadedTrack, ...current.filter((item) => item.sourceHash !== source.sourceHash)]);
      setDuplicateLibraryHashes((current) => current.filter((hash) => hash !== source.sourceHash));
      setStatusMessage({
        tone: "success",
        text: `${source.sourceName} moved into Approved. Use Re-edit to adjust it.`,
      });
    } catch (error) {
      setStatusMessage({
        tone: "error",
        text: error instanceof Error ? error.message : `Failed to load ${source.sourceName} from the library.`,
      });
    } finally {
      setLoadingLibrarySourceHash(null);
    }
  };

  const handleUploadApprovedTracks = async () => {
    if (!usesRemoteUpload || !user?.id) {
      setStatusMessage({ tone: "info", text: "Uploads are only available while signed in." });
      return;
    }

    const tracksToUpload = approvedTracks.filter((track) => track.uploadState !== "synced");
    if (!tracksToUpload.length) {
      setStatusMessage({ tone: "info", text: "All approved songs are already uploaded." });
      return;
    }

    setIsUploadingApproved(true);
    setStatusMessage(null);

    let uploadedCount = 0;
    const failedTracks: string[] = [];

    for (const track of tracksToUpload) {
      updateApprovedTrack(track.id, (current) => ({ ...current, uploadState: "syncing" }));

      try {
        const segmentCount = await uploadApprovedTrack(track);
        const uploadedAt = new Date().toISOString();

        updateApprovedTrack(track.id, (current) => ({
          ...current,
          approvedAt: uploadedAt,
          segmentCount,
          uploadState: "synced",
        }));
        uploadedCount += 1;
      } catch (error) {
        console.error("Approved upload failed", error);
        updateApprovedTrack(track.id, (current) => ({ ...current, uploadState: "error" }));
        failedTracks.push(track.displayName);
      }
    }

    if (uploadedCount > 0) {
      await refreshInventory();
    }

    if (failedTracks.length > 0) {
      const summary =
        uploadedCount > 0
          ? `Uploaded ${uploadedCount} approved track${uploadedCount === 1 ? "" : "s"}. ${failedTracks.length} still need${failedTracks.length === 1 ? "s" : ""} attention.`
          : `Upload failed for ${failedTracks.join(", ")}.`;

      setStatusMessage({ tone: "error", text: summary });
    } else {
      setStatusMessage({
        tone: "success",
        text: `Uploaded ${uploadedCount} approved track${uploadedCount === 1 ? "" : "s"}.`,
      });
    }

    setIsUploadingApproved(false);
  };

  const approveTrack = (trackId: string) => {
    const track = queuedTracks.find((item) => item.id === trackId);
    if (!track) return;

    const trackSegments = [...track.segments].sort((left, right) => left.start - right.start);
    if (!trackSegments.length) {
      setSelectedQueuedId(trackId);
      setStatusMessage({ tone: "error", text: "Add a segment before approving." });
      return;
    }

    const approvedAt = new Date().toISOString();
    const nextApprovedTrack: PersistedEditorTrack = {
      ...track,
      segments: trackSegments,
      activeSegmentId: track.activeSegmentId ?? trackSegments[0]?.id ?? null,
      approvedAt,
      segmentCount: trackSegments.length,
      uploadState: usesRemoteUpload ? "pending" : "synced",
    };

    const remainingQueuedTracks = queuedTracks.filter((item) => item.id !== trackId);
    setQueuedTracks(remainingQueuedTracks);
    setSelectedQueuedId((current) => (current === trackId ? remainingQueuedTracks[0]?.id ?? null : current));
    setApprovedTracks((current) => [nextApprovedTrack, ...current.filter((item) => item.id !== trackId)]);
    setRecentQueuedIds((current) => current.filter((id) => id !== trackId));
    setStatusMessage({
      tone: "success",
      text: usesRemoteUpload ? `${track.displayName} approved locally. Upload when ready.` : `${track.displayName} approved.`,
    });
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
    void deleteTrack(trackId, "queued");
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

  const deleteTrack = async (trackId: string, lane: "queued" | "approved") => {
    const track = (lane === "queued" ? queuedTracks : approvedTracks).find((item) => item.id === trackId);
    if (!track) return;

    const isRemoteTrack = usesRemoteUpload && Boolean(user?.id) && approvedLibrary.some((source) => source.sourceHash === track.sourceHash);

    try {
      if (isRemoteTrack && user?.id) {
        await deleteHighlightSourceAssets(user.id, track.sourceHash);
        await refreshInventory();
      }

      if (lane === "queued") {
        const remainingQueuedTracks = queuedTracks.filter((item) => item.id !== trackId);
        setQueuedTracks(remainingQueuedTracks);
        setSelectedQueuedId((current) => (current === trackId ? remainingQueuedTracks[0]?.id ?? null : current));
        setRecentQueuedIds((current) => current.filter((id) => id !== trackId));
      } else {
        setApprovedTracks((current) => current.filter((item) => item.id !== trackId));
      }

      if (isRemoteTrack) {
        setStatusMessage({ tone: "success", text: `${track.displayName} deleted from the approved library.` });
      }
    } catch (error) {
      setStatusMessage({
        tone: "error",
        text: error instanceof Error ? error.message : `Failed to delete ${track.displayName}.`,
      });
    }
  };

  const dismissApprovedTrack = (trackId: string) => {
    void deleteTrack(trackId, "approved");
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

  const getApprovedTrackBadge = (track: PersistedEditorTrack) => {
    switch (track.uploadState) {
      case "pending":
        return { label: "Pending upload", variant: "gold" as const };
      case "syncing":
        return { label: "Uploading", variant: "blue" as const };
      case "error":
        return { label: "Upload error", variant: "red" as const };
      default:
        return { label: "Approved", variant: "green" as const };
    }
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
                {usesRemoteUpload && pendingApprovedCount > 0 ? <Badge variant="gold">{pendingApprovedCount} pending upload</Badge> : null}
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
                onClick={() => void handleUploadApprovedTracks()}
                disabled={!usesRemoteUpload || isUploadingApproved || pendingApprovedCount === 0 || isDraftHydrating}
                className="inline-flex items-center gap-2 rounded-full border border-accent-gold/28 bg-accent-gold/12 px-3.5 py-2 text-sm text-accent-gold transition-colors hover:bg-accent-gold/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-text-dim"
              >
                {isUploadingApproved ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isUploadingApproved ? "Uploading…" : pendingApprovedCount > 0 ? `Upload approved (${pendingApprovedCount})` : "Upload approved"}
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

        <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.85fr)_minmax(280px,0.9fr)_minmax(320px,1fr)]">
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
                <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(250px,0.72fr)]">
                  <div className="flex min-h-0 flex-col rounded-[26px] border border-white/10 bg-black/18 p-3">
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
                        onClick={() => void (playbackMode === "final-preview" ? togglePlayback() : playFinalPreview())}
                        disabled={isFinalPreviewLoading || !orderedSegments.length}
                        className="inline-flex items-center gap-2 rounded-full border border-accent-blue/20 bg-accent-blue/10 px-4 py-2 text-sm text-accent-blue transition-colors hover:bg-accent-blue/16 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-text-dim"
                      >
                        {isFinalPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        {playbackMode === "final-preview" && displayIsPlaying ? "Pause final" : "Play final"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void approveTrack(selectedTrack.id)}
                        disabled={!orderedSegments.length}
                        className="inline-flex items-center gap-2 rounded-full border border-accent-gold/28 bg-accent-gold/12 px-4 py-2 text-sm text-accent-gold transition-colors hover:bg-accent-gold/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-text-dim"
                      >
                        <Check className="h-4 w-4" />
                        Approve selected
                      </button>
                    </div>

                    <div className="mt-3 flex flex-col gap-3 rounded-[20px] border border-white/10 bg-white/[0.03] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-sans text-[11px] uppercase tracking-[0.16em] text-text-dim">Upload mode</div>
                        <div className="mt-2 inline-flex rounded-full border border-white/10 bg-black/20 p-1">
                          <button
                            type="button"
                            onClick={() => setSelectedTrackUploadMode("merged")}
                            className={cn(
                              "rounded-full px-3 py-1.5 text-xs transition-colors",
                              (selectedTrack.uploadMode ?? DEFAULT_TRACK_UPLOAD_MODE) === "merged"
                                ? "bg-accent-gold/14 text-accent-gold"
                                : "text-text-dim hover:text-text-main",
                            )}
                          >
                            Join clips
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedTrackUploadMode("separate")}
                            className={cn(
                              "rounded-full px-3 py-1.5 text-xs transition-colors",
                              (selectedTrack.uploadMode ?? DEFAULT_TRACK_UPLOAD_MODE) === "separate"
                                ? "bg-accent-blue/14 text-accent-blue"
                                : "text-text-dim hover:text-text-main",
                            )}
                          >
                            Separate clips
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-text-dim">
                        <Badge variant="dim">{Math.round(editorOutputGain * 100)}% output</Badge>
                        <span>Space toggles playback</span>
                      </div>
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
              {pendingApprovedCount > 0 ? <Badge variant="gold">{pendingApprovedCount} pending</Badge> : null}
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
              {approvedTracks.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-center font-sans text-sm text-text-dim">
                  Empty
                </div>
              ) : (
                <div className="space-y-3">
                  {approvedTracks.map((track) => {
                    const badge = getApprovedTrackBadge(track);

                    return (
                      <EditorTrackCard
                        key={track.id}
                        title={track.displayName}
                        subtitle={`${track.segmentCount ?? track.segments.length} segment${(track.segmentCount ?? track.segments.length) === 1 ? "" : "s"}`}
                        badgeLabel={badge.label}
                        badgeVariant={badge.variant}
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
                    );
                  })}
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
                    const isLoading = loadingLibrarySourceHash === source.sourceHash;

                    return (
                      <EditorTrackCard
                        key={source.sourceHash}
                        title={source.sourceName}
                        subtitle={`${source.segmentCount} segment${source.segmentCount === 1 ? "" : "s"}`}
                        badgeLabel={isDuplicate ? "Duplicate" : "Library"}
                        badgeVariant={isDuplicate ? "red" : "dim"}
                        isDuplicate={isDuplicate}
                        actionNode={
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void loadLibrarySourceToApproved(source);
                            }}
                            disabled={isLoading}
                            className="rounded-full border border-accent-blue/20 bg-accent-blue/10 px-3 py-1.5 text-xs text-accent-blue transition-colors hover:bg-accent-blue/16 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-text-dim"
                          >
                            {isLoading ? "Loading…" : "Move to approved"}
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
      </div>
    </>
  );
}
