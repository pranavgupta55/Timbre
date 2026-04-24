import { supabase } from "@/lib/supabase";

export type HighlightTrack = {
  id: string;
  filename: string;
  storage_path: string;
  sourceHash: string;
  sourceName: string;
  segmentIndex: number;
  title: string;
  subtitle: string;
  uploadedAt: string;
};

export type ApprovedSource = {
  sourceHash: string;
  sourceName: string;
  segmentCount: number;
  sampleStoragePath: string;
  uploadedAt: string;
};

const SEGMENT_PATTERN = /segment-(\d+)/i;

export const stripExtension = (name: string) => name.replace(/\.[^.]+$/, "");

const capitalizeWord = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export const titleCase = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => capitalizeWord(word))
    .join(" ");

export const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-") || "segment";

const humanizeSlug = (value: string) => titleCase(value.replace(/-/g, " ").trim() || "Untitled Source");

export const parseHighlightStorageName = (filename: string) => {
  if (!filename.toLowerCase().endsWith(".mp3")) {
    return null;
  }

  const [sourceHash, sourceSlug, segmentToken] = filename.split("__");
  if (!sourceHash || !sourceSlug) {
    return null;
  }

  const segmentIndexMatch = segmentToken?.match(SEGMENT_PATTERN);
  const segmentIndex = segmentIndexMatch ? Number.parseInt(segmentIndexMatch[1] ?? "1", 10) : 1;

  return {
    filename,
    sourceHash,
    sourceName: humanizeSlug(stripExtension(sourceSlug)),
    segmentIndex,
  };
};

export const buildSegmentStoragePath = (userId: string, sourceHash: string, displayName: string, segmentIndex: number) =>
  `${userId}/${sourceHash}__${slugify(stripExtension(displayName))}__segment-${String(segmentIndex + 1).padStart(2, "0")}.mp3`;

export const describeHighlightTrack = (sourceName: string, segmentIndex: number) => ({
  title: sourceName,
  subtitle: `Segment ${String(segmentIndex).padStart(2, "0")}`,
});

type StorageListItem = {
  id?: string | null;
  name: string;
  created_at?: string | null;
};

export const sortHighlightTracksBySegment = (tracks: HighlightTrack[]) =>
  [...tracks].sort((left, right) => left.segmentIndex - right.segmentIndex);

export async function fetchHighlightInventory(userId: string) {
  const { data, error } = await supabase.storage.from("highlights").list(userId, {
    limit: 1000,
    sortBy: { column: "created_at", order: "desc" },
  });

  if (error) {
    throw error;
  }

  const sourceMap = new Map<string, ApprovedSource>();
  const tracks: HighlightTrack[] = [];

  for (const item of (data ?? []) as StorageListItem[]) {
    const parsed = parseHighlightStorageName(item.name);
    if (!parsed) {
      continue;
    }

    const storagePath = `${userId}/${item.name}`;
    const uploadedAt = item.created_at ?? new Date().toISOString();
    const details = describeHighlightTrack(parsed.sourceName, parsed.segmentIndex);

    tracks.push({
      id: item.id ?? storagePath,
      filename: item.name,
      storage_path: storagePath,
      sourceHash: parsed.sourceHash,
      sourceName: parsed.sourceName,
      segmentIndex: parsed.segmentIndex,
      title: details.title,
      subtitle: details.subtitle,
      uploadedAt,
    });

    const existingSource = sourceMap.get(parsed.sourceHash);
    if (existingSource) {
      existingSource.segmentCount += 1;
      if (new Date(uploadedAt).getTime() > new Date(existingSource.uploadedAt).getTime()) {
        existingSource.uploadedAt = uploadedAt;
        existingSource.sampleStoragePath = storagePath;
      }
      continue;
    }

    sourceMap.set(parsed.sourceHash, {
      sourceHash: parsed.sourceHash,
      sourceName: parsed.sourceName,
      segmentCount: 1,
      sampleStoragePath: storagePath,
      uploadedAt,
    });
  }

  const sources = Array.from(sourceMap.values()).sort(
    (left, right) => new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime(),
  );

  const sourceOrder = new Map(sources.map((source, index) => [source.sourceHash, index]));

  tracks.sort((left, right) => {
    const sourceDelta = (sourceOrder.get(left.sourceHash) ?? 0) - (sourceOrder.get(right.sourceHash) ?? 0);
    return sourceDelta !== 0 ? sourceDelta : left.segmentIndex - right.segmentIndex;
  });

  return { sources, tracks };
}

export async function downloadHighlightTrack(storagePath: string) {
  const { data, error } = await supabase.storage.from("highlights").download(storagePath);

  if (error || !data) {
    throw error ?? new Error("Failed to download the saved highlight.");
  }

  return data;
}

export async function deleteHighlightSourceAssets(userId: string, sourceHash: string) {
  const { data, error } = await supabase.storage.from("highlights").list(userId, {
    limit: 1000,
  });

  if (error) {
    throw error;
  }

  const pathsToRemove = ((data ?? []) as StorageListItem[])
    .filter((item) => item.name.startsWith(`${sourceHash}__`))
    .map((item) => `${userId}/${item.name}`);

  if (!pathsToRemove.length) {
    return;
  }

  const { error: removeError } = await supabase.storage.from("highlights").remove(pathsToRemove);

  if (removeError) {
    throw removeError;
  }
}
