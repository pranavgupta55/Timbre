"use client";

import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import Script from "next/script";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Badge, DataCard, Eyebrow } from "@/components/ui/TacticalUI";

const WAVEFORM_HEIGHT = 160;
const DEFAULT_SEGMENT_LENGTH = 15;
const DEFAULT_FADE_SECONDS = "2.0";
const UPLOADED_SOURCE_MANIFEST_KEY = "timbre-uploaded-source-manifest";

type UploadedManifestEntry = {
  hash: string;
  sourceName: string;
  sourceSize: number;
  storagePath: string | null;
  uploadedAt: string;
};

type QueueItem = {
  id: string;
  file: File;
  sourceHash: string;
  displayName: string;
  relativePath: string;
};

type TrackSegment = {
  id: string;
  start: number;
  end: number;
  fadeInInput: string;
  fadeOutInput: string;
};

type SessionUpload = {
  id: string;
  label: string;
  status: "uploaded" | "approved";
  timestamp: string;
};

const formatTime = (time: number) => {
  if (Number.isNaN(time)) return "00:00.00";
  const m = Math.floor(time / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(time % 60)
    .toString()
    .padStart(2, "0");
  const ms = Math.floor((time % 1) * 100)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}.${ms}`;
};

const getAudioExtension = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

const isAudioFile = (file: File) => {
  if (file.type.startsWith("audio/")) return true;

  return [
    "aac",
    "aiff",
    "alac",
    "flac",
    "m4a",
    "mp3",
    "ogg",
    "wav",
    "wma",
  ].includes(getAudioExtension(file.name));
};

const parseFadeSeconds = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const normalizeFadeInput = (value: string) => parseFadeSeconds(value).toFixed(1);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const stripExtension = (name: string) => name.replace(/\.[^.]+$/, "");

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "segment";

const getRegionDuration = (start: number, end: number) => Math.max(0, end - start);

const createSegmentId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createSegment = (start: number, end: number): TrackSegment => ({
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

  const maxStart = Math.max(0, trackDuration - Math.min(DEFAULT_SEGMENT_LENGTH, trackDuration));
  const start = clamp(seedTime, 0, maxStart);
  const end = Math.min(trackDuration, start + DEFAULT_SEGMENT_LENGTH);
  return { start, end };
};

const buildSegmentStoragePath = (userId: string, item: QueueItem, segmentIndex: number) => {
  const safeName = slugify(stripExtension(item.displayName));
  return `${userId}/${item.sourceHash}__${safeName}__segment-${String(segmentIndex + 1).padStart(2, "0")}.mp3`;
};

const readManifestFromStorage = () => {
  if (typeof window === "undefined") return {} as Record<string, UploadedManifestEntry>;

  try {
    const raw = window.localStorage.getItem(UPLOADED_SOURCE_MANIFEST_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, UploadedManifestEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
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

const createProcessedSegment = async ({
  file,
  start,
  end,
  fadeInSeconds,
  fadeOutSeconds,
}: {
  file: File;
  start: number;
  end: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}) => {
  const arrayBuffer = await file.arrayBuffer();
  const AudioContextCtor =
    window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextCtor) {
    throw new Error("Audio processing is not supported in this browser.");
  }

  const audioCtx = new AudioContextCtor();

  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const startSample = Math.floor(start * audioBuffer.sampleRate);
    const endSample = Math.floor(end * audioBuffer.sampleRate);
    const sampleCount = Math.max(0, endSample - startSample);

    if (sampleCount <= 0) {
      throw new Error("Selected segment is empty.");
    }

    const leftSource = audioBuffer.getChannelData(0).slice(startSample, endSample);
    const rightSource =
      audioBuffer.numberOfChannels > 1
        ? audioBuffer.getChannelData(1).slice(startSample, endSample)
        : leftSource.slice();

    const fadeInSamples = clamp(Math.floor(fadeInSeconds * audioBuffer.sampleRate), 0, sampleCount);
    const fadeOutSamples = clamp(Math.floor(fadeOutSeconds * audioBuffer.sampleRate), 0, sampleCount);

    for (let i = 0; i < sampleCount; i += 1) {
      let gain = 1;

      if (fadeInSamples > 0 && i < fadeInSamples) {
        gain = Math.min(gain, fadeInSamples === 1 ? 1 : i / (fadeInSamples - 1));
      }

      if (fadeOutSamples > 0 && i >= sampleCount - fadeOutSamples) {
        const fadeOutIndex = i - (sampleCount - fadeOutSamples);
        const fadeOutGain = fadeOutSamples === 1 ? 0 : 1 - fadeOutIndex / (fadeOutSamples - 1);
        gain = Math.min(gain, fadeOutGain);
      }

      leftSource[i] *= gain;
      rightSource[i] *= gain;
    }

    const lamejs = (window as Window & typeof globalThis & { lamejs?: any }).lamejs;
    if (!lamejs) {
      throw new Error("MP3 encoder failed to load from CDN.");
    }

    const encoder = new lamejs.Mp3Encoder(2, audioBuffer.sampleRate, 128);
    const leftInt16 = new Int16Array(sampleCount);
    const rightInt16 = new Int16Array(sampleCount);

    for (let i = 0; i < sampleCount; i += 1) {
      const leftSample = clamp(leftSource[i], -1, 1);
      const rightSample = clamp(rightSource[i], -1, 1);
      leftInt16[i] = leftSample < 0 ? leftSample * 32768 : leftSample * 32767;
      rightInt16[i] = rightSample < 0 ? rightSample * 32768 : rightSample * 32767;
    }

    const sampleBlockSize = 1152;
    const mp3Data: ArrayBuffer[] = [];

    for (let i = 0; i < leftInt16.length; i += sampleBlockSize) {
      const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
      const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);
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
  } finally {
    await audioCtx.close();
  }
};

export default function EditorPage() {
  const { user } = useAuth();

  const [sourceQueue, setSourceQueue] = useState<QueueItem[]>([]);
  const [segments, setSegments] = useState<TrackSegment[]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [sessionUploads, setSessionUploads] = useState<SessionUpload[]>([]);
  const [uploadedManifest, setUploadedManifest] = useState<Record<string, UploadedManifestEntry>>({});
  const [isQueueing, setIsQueueing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [queueMessage, setQueueMessage] = useState("");
  const [editorMessage, setEditorMessage] = useState("");
  const [editorError, setEditorError] = useState("");

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const regions = useRef<any>(null);
  const regionMapRef = useRef<Map<string, any>>(new Map());
  const segmentsRef = useRef<TrackSegment[]>([]);
  const activeSegmentIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadedHashesRef = useRef<Set<string>>(new Set());

  const currentItem = sourceQueue[0] ?? null;
  const activeSegment = segments.find((segment) => segment.id === activeSegmentId) ?? segments[0] ?? null;
  const orderedSegments = [...segments].sort((left, right) => left.start - right.start);
  const usesRemoteUpload =
    Boolean(user?.id) &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("placeholder") &&
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.includes("placeholder");

  const persistManifest = (nextManifest: Record<string, UploadedManifestEntry>) => {
    uploadedHashesRef.current = new Set(Object.keys(nextManifest));
    setUploadedManifest(nextManifest);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(UPLOADED_SOURCE_MANIFEST_KEY, JSON.stringify(nextManifest));
    }
  };

  const mergeManifestEntries = (entries: UploadedManifestEntry[]) => {
    if (!entries.length) return;

    setUploadedManifest((previous) => {
      const nextManifest = { ...previous };

      for (const entry of entries) {
        nextManifest[entry.hash] = {
          ...nextManifest[entry.hash],
          ...entry,
        };
      }

      uploadedHashesRef.current = new Set(Object.keys(nextManifest));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(UPLOADED_SOURCE_MANIFEST_KEY, JSON.stringify(nextManifest));
      }

      return nextManifest;
    });
  };

  const applyRegionStyles = (selectedId: string | null) => {
    for (const [segmentId, region] of regionMapRef.current.entries()) {
      region.setOptions?.({
        color: segmentId === selectedId ? "rgba(196, 160, 82, 0.24)" : "rgba(173, 84, 75, 0.22)",
      });
    }
  };

  const createWaveRegion = (segment: TrackSegment, plugin: any) => {
    const region = plugin.addRegion({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      color: segment.id === activeSegmentIdRef.current ? "rgba(196, 160, 82, 0.24)" : "rgba(173, 84, 75, 0.22)",
      drag: true,
      resize: true,
    });

    regionMapRef.current.set(segment.id, region);
    return region;
  };

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    activeSegmentIdRef.current = activeSegmentId;
    applyRegionStyles(activeSegmentId);
  }, [activeSegmentId]);

  useEffect(() => {
    persistManifest(readManifestFromStorage());
  }, []);

  useEffect(() => {
    if (!folderInputRef.current) return;

    folderInputRef.current.setAttribute("webkitdirectory", "");
    folderInputRef.current.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (!usesRemoteUpload || !user?.id) return;

    let isCancelled = false;

    const hydrateRemoteManifest = async () => {
      const { data, error } = await supabase.storage.from("highlights").list(user.id, {
        limit: 1000,
        sortBy: { column: "name", order: "desc" },
      });

      if (isCancelled || error || !data?.length) return;

      const remoteEntries = data.flatMap<UploadedManifestEntry>((item) => {
        const [hash, slugWithExtension] = item.name.split("__");
        if (!hash) return [];

        return [
          {
            hash,
            sourceName: slugWithExtension ? stripExtension(slugWithExtension).replace(/-/g, " ") : item.name,
            sourceSize: 0,
            storagePath: `${user.id}/${item.name}`,
            uploadedAt: item.created_at ?? new Date().toISOString(),
          },
        ];
      });

      mergeManifestEntries(remoteEntries);
    };

    void hydrateRemoteManifest();

    return () => {
      isCancelled = true;
    };
  }, [usesRemoteUpload, user?.id]);

  useEffect(() => {
    const file = currentItem?.file;

    setSegments([]);
    setActiveSegmentId(null);
    segmentsRef.current = [];
    activeSegmentIdRef.current = null;
    regionMapRef.current.clear();

    if (!file || !waveformRef.current) {
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setEditorError("");

    const objectUrl = URL.createObjectURL(file);
    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: "rgba(255, 255, 255, 0.18)",
      progressColor: "#E8E0D4",
      cursorColor: "#C4A052",
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      height: WAVEFORM_HEIGHT,
      normalize: true,
      url: objectUrl,
    });

    const wsRegions = ws.registerPlugin(RegionsPlugin.create());

    ws.on("ready", (trackDuration) => {
      setDuration(trackDuration);
      const window = getSuggestedSegmentWindow(trackDuration, 0);
      const initialSegment = createSegment(window.start, window.end);

      setSegments([initialSegment]);
      segmentsRef.current = [initialSegment];
      setActiveSegmentId(initialSegment.id);
      activeSegmentIdRef.current = initialSegment.id;
      createWaveRegion(initialSegment, wsRegions);
      applyRegionStyles(initialSegment.id);
    });

    ws.on("audioprocess", (time) => {
      setCurrentTime(time);

      const currentSegments = segmentsRef.current;
      const currentActiveId = activeSegmentIdRef.current;
      const currentActiveSegment = currentSegments.find((segment) => segment.id === currentActiveId) ?? currentSegments[0];

      if (currentActiveSegment && time >= currentActiveSegment.end) {
        ws.pause();
        ws.setTime(currentActiveSegment.start);
        setCurrentTime(currentActiveSegment.start);
      }
    });

    ws.on("interaction", () => {
      setCurrentTime(ws.getCurrentTime());
    });

    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));

    wsRegions.on("region-clicked", (region: any, event?: Event) => {
      event?.stopPropagation?.();
      setActiveSegmentId(region.id);
      activeSegmentIdRef.current = region.id;
      setCurrentTime(region.start);
      ws.setTime(region.start);
    });

    wsRegions.on("region-updated", (region: any) => {
      setSegments((currentSegments) =>
        currentSegments.map((segment) =>
          segment.id === region.id
            ? {
                ...segment,
                start: region.start,
                end: region.end,
              }
            : segment,
        ),
      );

      const currentActiveId = activeSegmentIdRef.current;
      if (region.id === currentActiveId) {
        setCurrentTime(region.start);
        ws.setTime(region.start);
      }
    });

    wavesurfer.current = ws;
    regions.current = wsRegions;

    return () => {
      wavesurfer.current = null;
      regions.current = null;
      regionMapRef.current.clear();
      ws.destroy();
      URL.revokeObjectURL(objectUrl);
    };
  }, [currentItem]);

  const handleFadeInputChange =
    (segmentId: string, key: "fadeInInput" | "fadeOutInput") => (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      if (nextValue === "" || /^\d*\.?\d*$/.test(nextValue)) {
        setSegments((currentSegments) =>
          currentSegments.map((segment) => (segment.id === segmentId ? { ...segment, [key]: nextValue } : segment)),
        );
      }
    };

  const handleFadeBlur = (segmentId: string, key: "fadeInInput" | "fadeOutInput") => {
    setSegments((currentSegments) =>
      currentSegments.map((segment) =>
        segment.id === segmentId ? { ...segment, [key]: normalizeFadeInput(segment[key]) } : segment,
      ),
    );
  };

  const handleQueueSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter(isAudioFile);
    event.target.value = "";

    if (!files.length) {
      setQueueMessage("No audio files were detected in that selection.");
      return;
    }

    setIsQueueing(true);
    setQueueMessage("");
    setEditorError("");
    setEditorMessage("");

    try {
      const existingHashes = new Set([...uploadedHashesRef.current, ...sourceQueue.map((item) => item.sourceHash)]);
      const nextItems: QueueItem[] = [];
      let duplicateCount = 0;

      for (const file of files) {
        const hash = await hashFile(file);
        if (existingHashes.has(hash)) {
          duplicateCount += 1;
          continue;
        }

        existingHashes.add(hash);
        nextItems.push({
          id: `${hash}-${file.lastModified}`,
          file,
          sourceHash: hash,
          displayName: file.name,
          relativePath: getReadablePath(file),
        });
      }

      if (!nextItems.length) {
        setQueueMessage(
          duplicateCount > 0
            ? `Skipped ${duplicateCount} file${duplicateCount === 1 ? "" : "s"} that were already uploaded or already queued.`
            : "Nothing new was added to the queue.",
        );
        return;
      }

      setSourceQueue((currentQueue) => [...currentQueue, ...nextItems]);

      const addedCount = nextItems.length;
      const duplicateSummary =
        duplicateCount > 0
          ? ` ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} skipped before queueing.`
          : "";
      setQueueMessage(`Queued ${addedCount} new track${addedCount === 1 ? "" : "s"}.${duplicateSummary}`);
    } catch (error) {
      console.error(error);
      setEditorError("Failed to inspect the selected files.");
    } finally {
      setIsQueueing(false);
    }
  };

  const focusSegment = (segmentId: string) => {
    const segment = segmentsRef.current.find((item) => item.id === segmentId);
    if (!segment || !wavesurfer.current) return;

    setActiveSegmentId(segmentId);
    activeSegmentIdRef.current = segmentId;
    setCurrentTime(segment.start);
    wavesurfer.current.setTime(segment.start);
  };

  const previewSegment = (segmentId: string) => {
    const segment = segmentsRef.current.find((item) => item.id === segmentId);
    if (!segment || !wavesurfer.current) return;

    setActiveSegmentId(segmentId);
    activeSegmentIdRef.current = segmentId;
    wavesurfer.current.pause();
    wavesurfer.current.setTime(segment.start);
    setCurrentTime(segment.start);
    wavesurfer.current.play();
  };

  const addSegment = () => {
    if (!regions.current || duration <= 0) return;

    const seedTime = activeSegment ? activeSegment.end : currentTime;
    const window = getSuggestedSegmentWindow(duration, seedTime);
    const nextSegment = createSegment(window.start, window.end);

    setSegments((currentSegments) => [...currentSegments, nextSegment]);
    segmentsRef.current = [...segmentsRef.current, nextSegment];
    setActiveSegmentId(nextSegment.id);
    activeSegmentIdRef.current = nextSegment.id;
    createWaveRegion(nextSegment, regions.current);
    applyRegionStyles(nextSegment.id);
    wavesurfer.current?.setTime(nextSegment.start);
    setCurrentTime(nextSegment.start);
    setEditorMessage(`Added segment ${segmentsRef.current.length}. Tune its fades below.`);
  };

  const removeSegment = (segmentId: string) => {
    const nextSegments = segmentsRef.current.filter((segment) => segment.id !== segmentId);
    const region = regionMapRef.current.get(segmentId);
    region?.remove?.();
    regionMapRef.current.delete(segmentId);

    setSegments(nextSegments);
    segmentsRef.current = nextSegments;

    if (activeSegmentIdRef.current === segmentId) {
      const nextActiveSegment = nextSegments[0] ?? null;
      const nextActiveId = nextActiveSegment?.id ?? null;
      setActiveSegmentId(nextActiveId);
      activeSegmentIdRef.current = nextActiveId;
      applyRegionStyles(nextActiveId);

      if (nextActiveSegment && wavesurfer.current) {
        wavesurfer.current.setTime(nextActiveSegment.start);
        setCurrentTime(nextActiveSegment.start);
      }
    }

    if (nextSegments.length === 0) {
      setIsPlaying(false);
      wavesurfer.current?.pause();
    }
  };

  const registerUploadedSource = (item: QueueItem, storagePath: string | null, segmentCount: number) => {
    const entry: UploadedManifestEntry = {
      hash: item.sourceHash,
      sourceName: item.displayName,
      sourceSize: item.file.size,
      storagePath,
      uploadedAt: new Date().toISOString(),
    };

    mergeManifestEntries([entry]);
    setSessionUploads((current) => [
      {
        id: item.id,
        label: `${item.displayName} (${segmentCount} segment${segmentCount === 1 ? "" : "s"})`,
        status: storagePath ? "uploaded" : "approved",
        timestamp: entry.uploadedAt,
      },
      ...current,
    ]);
  };

  const approveCurrentTrack = async () => {
    if (!currentItem) return;

    if (orderedSegments.length === 0) {
      setEditorError("Add at least one segment before approving this track.");
      return;
    }

    setIsApproving(true);
    setEditorError("");
    setEditorMessage("");

    try {
      for (const [index, segment] of orderedSegments.entries()) {
        const blob = await createProcessedSegment({
          file: currentItem.file,
          start: segment.start,
          end: segment.end,
          fadeInSeconds: parseFadeSeconds(segment.fadeInInput),
          fadeOutSeconds: parseFadeSeconds(segment.fadeOutInput),
        });

        if (usesRemoteUpload && user?.id) {
          const storagePath = buildSegmentStoragePath(user.id, currentItem, index);
          const { error } = await supabase.storage.from("highlights").upload(storagePath, blob, {
            contentType: "audio/mpeg",
            upsert: true,
          });

          if (error) {
            throw error;
          }
        }
      }

      const manifestStoragePath =
        usesRemoteUpload && user?.id ? `${user.id}/${currentItem.sourceHash}__${slugify(stripExtension(currentItem.displayName))}` : null;

      registerUploadedSource(currentItem, manifestStoragePath, orderedSegments.length);
      setSourceQueue((currentQueue) => currentQueue.slice(1));
      setEditorMessage(
        usesRemoteUpload && user?.id
          ? `${currentItem.displayName} approved with ${orderedSegments.length} segment${orderedSegments.length === 1 ? "" : "s"} and uploaded.`
          : `${currentItem.displayName} approved with ${orderedSegments.length} segment${orderedSegments.length === 1 ? "" : "s"} in local mode.`,
      );
    } catch (error) {
      console.error(error);
      setEditorError(error instanceof Error ? error.message : "Failed to process and upload this track.");
    } finally {
      setIsApproving(false);
    }
  };

  return (
    <>
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js" strategy="lazyOnload" />

      <div className="space-y-12">
        <div>
          <Eyebrow title="WORKSPACE" count="AUDIO PROCESSING ONLINE" />
          <h1 className="font-serif text-5xl text-text-main" style={{ fontFamily: "var(--font-glosa)" }}>
            Audio Editor
          </h1>
        </div>

        <div className="rounded-xl border border-border-light bg-bg-panel p-6 shadow-2xl">
          <div className="flex flex-col gap-4 border-b border-border-light/50 pb-6 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <Eyebrow title="SOURCE QUEUE" count={`${sourceQueue.length} waiting / ${Object.keys(uploadedManifest).length} already approved`} />
              <p className="max-w-2xl font-mono text-[10px] uppercase tracking-wider text-text-dim">
                Upload single files or whole folders. Duplicate songs are filtered before they enter the queue, including tracks approved in previous sessions on this browser.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <input
                ref={fileInputRef}
                id="audio-upload-files"
                name="audio-upload-files"
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                onChange={handleQueueSelection}
              />
              <input
                ref={folderInputRef}
                id="audio-upload-folder"
                name="audio-upload-folder"
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                onChange={handleQueueSelection}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isQueueing}
                className="border border-border-light bg-bg-base px-4 py-2 font-sans text-[10px] uppercase tracking-widest text-text-main transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:text-text-dim"
              >
                {isQueueing ? "INSPECTING..." : "ADD FILES"}
              </button>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                disabled={isQueueing}
                className="border border-border-light bg-bg-base px-4 py-2 font-sans text-[10px] uppercase tracking-widest text-text-main transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:text-text-dim"
              >
                {isQueueing ? "INSPECTING..." : "ADD FOLDER"}
              </button>
            </div>
          </div>

          {queueMessage && (
            <div className="mt-4 rounded border border-accent-gold/20 bg-accent-gold/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-accent-gold">
              {queueMessage}
            </div>
          )}

          {!currentItem ? (
            <div className="mt-6 border border-dashed border-border-dashed bg-bg-panel p-12 text-center">
              <span className="font-mono text-sm text-text-dim">[ AWAITING_AUDIO_QUEUE ]</span>
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <Eyebrow title="INSPECTOR" count={currentItem.displayName} />
                  <div className="font-mono text-[10px] uppercase tracking-wider text-text-dim">{currentItem.relativePath}</div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="font-mono text-xs text-text-dim">
                    {formatTime(currentTime)} <span className="text-border-dashed">/</span> {formatTime(duration)}
                  </div>
                  <button
                    type="button"
                    onClick={addSegment}
                    disabled={isApproving || duration <= 0}
                    className="border border-accent-gold/30 bg-accent-gold/10 px-3 py-2 font-sans text-[10px] uppercase tracking-widest text-accent-gold transition-colors hover:bg-accent-gold/20 disabled:cursor-not-allowed disabled:border-border-light disabled:bg-bg-base disabled:text-text-dim"
                  >
                    ADD SEGMENT
                  </button>
                </div>
              </div>

              <div className="rounded border border-border-light bg-bg-inspector p-4">
                <div className="relative overflow-hidden rounded" style={{ height: `${WAVEFORM_HEIGHT}px` }}>
                  <div ref={waveformRef} className="relative z-10 h-full w-full" />

                  {duration > 0 && orderedSegments.length > 0 && (
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
                              className={`absolute inset-0 rounded-sm border ${
                                isActive ? "border-accent-gold/90 bg-accent-gold/8" : "border-accent-red/60 bg-accent-red/8"
                              }`}
                            />

                            {fadeInDuration > 0 && (
                              <div
                                className="absolute inset-y-0 left-0 rounded-l-sm border-l border-accent-gold"
                                style={{
                                  width: `${(fadeInDuration / segmentDuration) * 100}%`,
                                  backgroundImage:
                                    "repeating-linear-gradient(135deg, rgba(196,160,82,0.55) 0px, rgba(196,160,82,0.55) 8px, rgba(196,160,82,0.18) 8px, rgba(196,160,82,0.18) 16px), linear-gradient(to right, rgba(196,160,82,0.45), rgba(196,160,82,0))",
                                }}
                              />
                            )}

                            {fadeOutDuration > 0 && (
                              <div
                                className="absolute inset-y-0 right-0 rounded-r-sm border-r border-accent-gold"
                                style={{
                                  width: `${(fadeOutDuration / segmentDuration) * 100}%`,
                                  backgroundImage:
                                    "repeating-linear-gradient(225deg, rgba(196,160,82,0.55) 0px, rgba(196,160,82,0.55) 8px, rgba(196,160,82,0.18) 8px, rgba(196,160,82,0.18) 16px), linear-gradient(to left, rgba(196,160,82,0.45), rgba(196,160,82,0))",
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {(editorError || editorMessage) && (
                <div
                  className={`rounded border px-3 py-2 font-mono text-[10px] uppercase tracking-wider ${
                    editorError
                      ? "border-accent-red/20 bg-accent-red/10 text-accent-red"
                      : "border-accent-green/20 bg-accent-green/10 text-accent-green"
                  }`}
                >
                  {editorError || editorMessage}
                </div>
              )}

              <div className="space-y-4 border-t border-border-light/50 pt-4">
                <div className="flex items-center justify-between">
                  <Eyebrow title="SEGMENTS" count={`${orderedSegments.length} prepared from this song`} />
                </div>

                {orderedSegments.length > 0 ? (
                  <div className="grid gap-4">
                    {orderedSegments.map((segment, index) => {
                      const segmentDuration = getRegionDuration(segment.start, segment.end);
                      const isActive = segment.id === activeSegment?.id;

                      return (
                        <div
                          key={segment.id}
                          className={`rounded-md border px-4 py-4 transition-colors ${
                            isActive ? "border-accent-gold/60 bg-accent-gold/10" : "border-border-light bg-bg-base/50"
                          }`}
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-2">
                              <div className="flex items-center gap-3">
                                <span className="font-sans text-sm uppercase tracking-[0.15em] text-text-main">
                                  Segment {String(index + 1).padStart(2, "0")}
                                </span>
                                <Badge variant={isActive ? "gold" : "dim"}>{isActive ? "ACTIVE" : "READY"}</Badge>
                              </div>
                              <div className="font-mono text-[10px] uppercase tracking-wider text-text-dim">
                                {formatTime(segment.start)} <span className="text-border-dashed">to</span> {formatTime(segment.end)}{" "}
                                <span className="text-border-dashed">/</span> {formatTime(segmentDuration)}
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-3">
                              <button
                                type="button"
                                onClick={() => focusSegment(segment.id)}
                                className="border border-border-light bg-bg-panel px-3 py-2 font-sans text-[10px] uppercase tracking-widest text-text-main transition-colors hover:bg-white/5"
                              >
                                FOCUS
                              </button>
                              <button
                                type="button"
                                onClick={() => previewSegment(segment.id)}
                                className="border border-border-light bg-bg-panel px-3 py-2 font-sans text-[10px] uppercase tracking-widest text-text-main transition-colors hover:bg-white/5"
                              >
                                {isActive && isPlaying ? "RESET" : "PLAY PREVIEW"}
                              </button>
                              <button
                                type="button"
                                onClick={() => removeSegment(segment.id)}
                                disabled={isApproving}
                                className="border border-accent-red/30 bg-accent-red/10 px-3 py-2 font-sans text-[10px] uppercase tracking-widest text-accent-red transition-colors hover:bg-accent-red/20 disabled:cursor-not-allowed disabled:border-border-light disabled:bg-bg-base disabled:text-text-dim"
                              >
                                REMOVE
                              </button>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-6">
                            <div className="flex flex-col space-y-1">
                              <label htmlFor={`fade-in-${segment.id}`} className="font-sans text-[10px] uppercase text-text-dim">
                                Fade In (s)
                              </label>
                              <input
                                id={`fade-in-${segment.id}`}
                                name={`fade-in-${segment.id}`}
                                inputMode="decimal"
                                value={segment.fadeInInput}
                                onChange={handleFadeInputChange(segment.id, "fadeInInput")}
                                onBlur={() => handleFadeBlur(segment.id, "fadeInInput")}
                                className="w-24 border-b border-border-light bg-transparent font-mono text-accent-gold outline-none"
                              />
                            </div>

                            <div className="flex flex-col space-y-1">
                              <label htmlFor={`fade-out-${segment.id}`} className="font-sans text-[10px] uppercase text-text-dim">
                                Fade Out (s)
                              </label>
                              <input
                                id={`fade-out-${segment.id}`}
                                name={`fade-out-${segment.id}`}
                                inputMode="decimal"
                                value={segment.fadeOutInput}
                                onChange={handleFadeInputChange(segment.id, "fadeOutInput")}
                                onBlur={() => handleFadeBlur(segment.id, "fadeOutInput")}
                                className="w-24 border-b border-border-light bg-transparent font-mono text-accent-gold outline-none"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-md border border-border-light bg-bg-panel px-4 py-6 font-mono text-[10px] uppercase tracking-wider text-text-dim">
                    No segments are defined yet. Add one from the waveform.
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={approveCurrentTrack}
                    disabled={isApproving || orderedSegments.length === 0}
                    className={`px-4 py-2 font-sans text-[10px] uppercase tracking-widest border transition-colors ${
                      isApproving || orderedSegments.length === 0
                        ? "cursor-not-allowed border-border-light bg-bg-panel text-text-dim"
                        : "border-accent-red/30 bg-accent-red/10 text-accent-red hover:bg-accent-red/20"
                    }`}
                  >
                    {isApproving ? "UPLOADING..." : `APPROVE & UPLOAD ${orderedSegments.length} SEGMENT${orderedSegments.length === 1 ? "" : "S"}`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {(sourceQueue.length > 0 || sessionUploads.length > 0) && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="space-y-4">
              <Eyebrow title="UP NEXT" count={`${Math.max(sourceQueue.length - 1, 0)} remaining after current`} />
              {sourceQueue.slice(1).length > 0 ? (
                sourceQueue.slice(1, 7).map((item) => (
                  <DataCard
                    key={item.id}
                    label={item.displayName}
                    subtitle={item.relativePath}
                    rightNode={<Badge variant="dim">QUEUED</Badge>}
                  />
                ))
              ) : (
                <div className="rounded-md border border-border-light bg-bg-panel px-4 py-6 font-mono text-[10px] uppercase tracking-wider text-text-dim">
                  No additional tracks are waiting in the queue.
                </div>
              )}
            </div>

            <div className="space-y-4">
              <Eyebrow title="SESSION LEDGER" count={`${sessionUploads.length} approved this session`} />
              {sessionUploads.length > 0 ? (
                sessionUploads.slice(0, 6).map((item) => (
                  <DataCard
                    key={item.id}
                    label={item.label}
                    subtitle={new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    rightNode={<Badge variant={item.status === "uploaded" ? "green" : "gold"}>{item.status.toUpperCase()}</Badge>}
                  />
                ))
              ) : (
                <div className="rounded-md border border-border-light bg-bg-panel px-4 py-6 font-mono text-[10px] uppercase tracking-wider text-text-dim">
                  Approved tracks will appear here as you work through the queue.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
