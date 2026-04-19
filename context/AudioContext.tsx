"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";

export interface Track {
  id: string;
  filename: string;
  storage_path: string;
  sourceHash: string;
  sourceName: string;
  segmentIndex: number;
  title: string;
  subtitle: string;
  uploadedAt: string;
}

type RepeatMode = "off" | "all";

interface AudioContextType {
  contextTracks: Track[];
  manualQueue: Track[];
  currentTrack: Track | null;
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isShuffle: boolean;
  repeatMode: RepeatMode;
  volume: number;
  isMuted: boolean;
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => Promise<void>;
  playTrack: (index: number, autoplay?: boolean) => void;
  startContext: (tracks: Track[], startIndex?: number, autoplay?: boolean) => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  seek: (time: number) => void;
  addToQueue: (track: Track) => void;
  playNext: (track: Track) => void;
  removeFromManualQueue: (trackId: string) => void;
  clearManualQueue: () => void;
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
}

const AudioCtx = createContext<AudioContextType | null>(null);

const shuffleArray = <T,>(values: T[]) => {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

const buildPlaybackContext = (tracks: Track[], startIndex: number, shuffleEnabled: boolean) => {
  if (!shuffleEnabled || tracks.length <= 1) {
    return { orderedTracks: tracks, activeIndex: startIndex };
  }

  const safeStartIndex = Math.min(Math.max(startIndex, 0), tracks.length - 1);
  const selectedTrack = tracks[safeStartIndex];
  const remainingTracks = tracks.filter((_, index) => index !== safeStartIndex);

  return {
    orderedTracks: [selectedTrack, ...shuffleArray(remainingTracks)],
    activeIndex: 0,
  };
};

export const useAudio = () => {
  const context = useContext(AudioCtx);
  if (!context) {
    throw new Error("useAudio must be used within an AudioProvider");
  }
  return context;
};

export function AudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const shouldBePlayingRef = useRef(false);

  const [contextTracks, setContextTracks] = useState<Track[]>([]);
  const [originalContextTracks, setOriginalContextTracks] = useState<Track[]>([]);
  const [manualQueue, setManualQueue] = useState<Track[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [currentIndex, setCurrentIndex] = useState(-1);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isShuffle, setIsShuffle] = useState(true);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [volume, setVolumeState] = useState(0.92);
  const [isMuted, setIsMuted] = useState(false);

  const selectContextTrack = useCallback(
    (index: number, autoplay = true) => {
      const nextTrack = contextTracks[index];
      if (!nextTrack) return;

      setCurrentIndex(index);
      setCurrentTrack(nextTrack);
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(autoplay);
    },
    [contextTracks],
  );

  const startContext = useCallback(
    (tracks: Track[], startIndex = 0, autoplay = true) => {
      if (!tracks.length) {
        return;
      }

      const { orderedTracks, activeIndex } = buildPlaybackContext(tracks, startIndex, isShuffle);

      setOriginalContextTracks(tracks);
      setContextTracks(orderedTracks);
      setManualQueue([]);
      setCurrentIndex(activeIndex);
      setCurrentTrack(orderedTracks[activeIndex] ?? null);
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(autoplay);
    },
    [isShuffle],
  );

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!currentTrack && contextTracks.length > 0) {
      selectContextTrack(currentIndex >= 0 ? currentIndex : 0, true);
      return;
    }

    setIsPlaying(true);

    try {
      await audio.play();
    } catch (error) {
      console.error("Audio play failed", error);
      setIsPlaying(false);
    }
  }, [contextTracks.length, currentIndex, currentTrack, selectContextTrack]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(async () => {
    if (isPlaying) {
      pause();
      return;
    }

    await play();
  }, [isPlaying, pause, play]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.currentTime = time;
    setCurrentTime(time);
  }, []);

  const next = useCallback(async () => {
    if (manualQueue.length > 0) {
      const [nextManualTrack, ...remainingQueue] = manualQueue;
      setManualQueue(remainingQueue);
      setCurrentTrack(nextManualTrack ?? null);
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(true);
      return;
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex < contextTracks.length) {
      selectContextTrack(nextIndex, true);
      return;
    }

    if (repeatMode === "all" && originalContextTracks.length > 0) {
      startContext(originalContextTracks, 0, true);
      return;
    }

    setIsPlaying(false);
    audioRef.current?.pause();
  }, [
    contextTracks.length,
    currentIndex,
    currentTrack,
    manualQueue,
    originalContextTracks,
    repeatMode,
    seek,
    selectContextTrack,
    startContext,
  ]);

  const prev = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.currentTime > 2) {
      seek(0);
      return;
    }

    if (currentIndex > 0) {
      selectContextTrack(currentIndex - 1, true);
      return;
    }

    seek(0);
  }, [currentIndex, seek, selectContextTrack]);

  const addToQueue = useCallback((track: Track) => {
    setManualQueue((currentQueue) => [...currentQueue, track]);
  }, []);

  const playNext = useCallback((track: Track) => {
    setManualQueue((currentQueue) => [track, ...currentQueue]);
  }, []);

  const removeFromManualQueue = useCallback((trackId: string) => {
    setManualQueue((currentQueue) => currentQueue.filter((track) => track.id !== trackId));
  }, []);

  const clearManualQueue = useCallback(() => {
    setManualQueue([]);
  }, []);

  const toggleShuffle = useCallback(() => {
    if (!originalContextTracks.length) {
      setIsShuffle((current) => !current);
      return;
    }

    if (isShuffle) {
      const currentTrackId = currentTrack?.id;
      const restoredIndex = originalContextTracks.findIndex((track) => track.id === currentTrackId);
      setContextTracks(originalContextTracks);
      setCurrentIndex(restoredIndex >= 0 ? restoredIndex : 0);
      setIsShuffle(false);
      return;
    }

    const currentTrackId = currentTrack?.id;
    const currentTrackIndex = originalContextTracks.findIndex((track) => track.id === currentTrackId);
    const { orderedTracks, activeIndex } = buildPlaybackContext(
      originalContextTracks,
      currentTrackIndex >= 0 ? currentTrackIndex : 0,
      true,
    );

    setContextTracks(orderedTracks);
    setCurrentIndex(activeIndex);
    setIsShuffle(true);
  }, [currentTrack?.id, isShuffle, originalContextTracks]);

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((current) => (current === "off" ? "all" : "off"));
  }, []);

  const setVolume = useCallback(
    (nextVolume: number) => {
      const safeVolume = Math.min(1, Math.max(0, nextVolume));
      setVolumeState(safeVolume);
      if (safeVolume > 0 && isMuted) {
        setIsMuted(false);
      }
    },
    [isMuted],
  );

  const toggleMute = useCallback(() => {
    setIsMuted((current) => !current);
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.crossOrigin = "anonymous";
    audio.volume = volume;
    audio.muted = isMuted;
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    shouldBePlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.muted = isMuted;
  }, [isMuted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };

    const handleLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };

    const handlePlay = () => {
      setIsPlaying(true);
    };

    const handlePause = () => {
      if (!audio.ended) {
        setIsPlaying(false);
      }
    };

    const handleEnded = () => {
      void next();
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [next]);

  useEffect(() => {
    let isCancelled = false;

    const loadTrackSource = async () => {
      const audio = audioRef.current;
      if (!audio) return;

      if (!currentTrack) {
        audio.pause();
        audio.removeAttribute("src");
        setCurrentTime(0);
        setDuration(0);
        return;
      }

      const { data, error } = await supabase.storage.from("highlights").createSignedUrl(currentTrack.storage_path, 3600);
      if (isCancelled || !audio) return;

      if (error || !data?.signedUrl) {
        console.error("Failed to sign track URL", error);
        setIsPlaying(false);
        return;
      }

      if (audio.src !== data.signedUrl) {
        audio.src = data.signedUrl;
        audio.load();
      }

      setCurrentTime(0);

      if (shouldBePlayingRef.current) {
        try {
          await audio.play();
        } catch (playError) {
          console.error("Failed to start playback", playError);
          setIsPlaying(false);
        }
      }
    };

    void loadTrackSource();

    return () => {
      isCancelled = true;
    };
  }, [currentTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    if (isPlaying) {
      void audio.play().catch((error) => {
        console.error("Playback toggle failed", error);
        setIsPlaying(false);
      });
      return;
    }

    audio.pause();
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";

    if (!currentTrack) {
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.sourceName,
      album: "Timbre Highlights",
    });

    navigator.mediaSession.setActionHandler("play", () => {
      void play();
    });
    navigator.mediaSession.setActionHandler("pause", pause);
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      void prev();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      void next();
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") {
        seek(details.seekTime);
      }
    });

    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
      navigator.mediaSession.setActionHandler("seekto", null);
    };
  }, [currentTrack, isPlaying, next, pause, play, prev, seek]);

  const value = useMemo<AudioContextType>(
    () => ({
      contextTracks,
      manualQueue,
      currentTrack,
      currentIndex,
      isPlaying,
      currentTime,
      duration,
      isShuffle,
      repeatMode,
      volume,
      isMuted,
      play,
      pause,
      toggle,
      playTrack: selectContextTrack,
      startContext,
      next,
      prev,
      seek,
      addToQueue,
      playNext,
      removeFromManualQueue,
      clearManualQueue,
      toggleShuffle,
      cycleRepeatMode,
      setVolume,
      toggleMute,
    }),
    [
      addToQueue,
      clearManualQueue,
      contextTracks,
      currentIndex,
      currentTime,
      currentTrack,
      duration,
      isMuted,
      isPlaying,
      isShuffle,
      manualQueue,
      next,
      pause,
      play,
      playNext,
      prev,
      removeFromManualQueue,
      repeatMode,
      seek,
      selectContextTrack,
      setVolume,
      startContext,
      toggle,
      toggleMute,
      toggleShuffle,
      cycleRepeatMode,
      volume,
    ],
  );

  return <AudioCtx.Provider value={value}>{children}</AudioCtx.Provider>;
}
