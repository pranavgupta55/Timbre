"use client";

import { ListMusic, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useMemo } from "react";
import { useAudio } from "@/context/AudioContext";
import { cn } from "@/lib/utils";

const formatTime = (value: number) => {
  if (!Number.isFinite(value)) return "0:00";
  const totalSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
};

export function AudioDock() {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    isShuffle,
    repeatMode,
    volume,
    isMuted,
    manualQueue,
    contextTracks,
    currentIndex,
    toggle,
    next,
    prev,
    seek,
    toggleShuffle,
    cycleRepeatMode,
    setVolume,
    toggleMute,
  } = useAudio();

  const queueCount = useMemo(
    () => manualQueue.length + Math.max(contextTracks.length - currentIndex - 1, 0),
    [contextTracks.length, currentIndex, manualQueue.length],
  );

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:px-6">
      <div className="mx-auto w-full max-w-[1480px]">
        <div className="pointer-events-auto rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,10,11,0.94),rgba(17,17,16,0.88))] px-4 py-3 shadow-[0_30px_120px_rgba(0,0,0,0.44)] backdrop-blur-2xl sm:px-5">
          <div className="space-y-3 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-serif text-lg text-text-main sm:text-xl">{currentTrack?.title ?? "Nothing playing"}</div>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-dim">
                <ListMusic className="h-4 w-4" />
                {queueCount}
              </div>
            </div>

            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={toggleShuffle}
                className={cn(
                  "rounded-full border p-2.5 transition-colors",
                  isShuffle ? "border-accent-blue/35 bg-accent-blue/15 text-accent-blue" : "border-white/10 bg-white/5 text-text-dim",
                )}
                aria-label="Toggle shuffle"
              >
                <Shuffle className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void prev()}
                className="rounded-full border border-white/10 bg-white/5 p-2.5 text-text-main"
                aria-label="Previous track"
              >
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void toggle()}
                className="rounded-full border border-accent-gold/35 bg-accent-gold/18 p-4 text-accent-gold shadow-[0_16px_40px_rgba(196,160,82,0.2)]"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-[1px]" />}
              </button>
              <button
                type="button"
                onClick={() => void next()}
                className="rounded-full border border-white/10 bg-white/5 p-2.5 text-text-main"
                aria-label="Next track"
              >
                <SkipForward className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={cycleRepeatMode}
                className={cn(
                  "rounded-full border p-2.5 transition-colors",
                  repeatMode === "all"
                    ? "border-accent-green/35 bg-accent-green/15 text-accent-green"
                    : "border-white/10 bg-white/5 text-text-dim",
                )}
                aria-label="Toggle repeat"
              >
                <Repeat className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="w-9 text-right font-mono text-[11px] text-text-dim">{formatTime(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime || 0}
                onChange={(event) => seek(Number.parseFloat(event.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-accent-gold"
              />
              <span className="w-9 font-mono text-[11px] text-text-dim">{formatTime(duration)}</span>
            </div>
          </div>

          <div className="hidden items-center justify-between gap-5 lg:flex">
            <div className="min-w-0 w-[28%]">
              <div className="truncate font-serif text-xl text-text-main">{currentTrack?.title ?? "Nothing playing"}</div>
            </div>

            <div className="flex w-[40%] flex-col gap-4">
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={toggleShuffle}
                  className={cn(
                    "rounded-full border p-2.5 transition-colors",
                    isShuffle
                      ? "border-accent-blue/35 bg-accent-blue/15 text-accent-blue"
                      : "border-white/10 bg-white/5 text-text-dim hover:text-text-main",
                  )}
                >
                  <Shuffle className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void prev()}
                  className="rounded-full border border-white/10 bg-white/5 p-2.5 text-text-main transition-colors hover:bg-white/10"
                >
                  <SkipBack className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void toggle()}
                  className="rounded-full border border-accent-gold/35 bg-accent-gold/18 p-4 text-accent-gold shadow-[0_16px_40px_rgba(196,160,82,0.2)]"
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-[1px]" />}
                </button>
                <button
                  type="button"
                  onClick={() => void next()}
                  className="rounded-full border border-white/10 bg-white/5 p-2.5 text-text-main transition-colors hover:bg-white/10"
                >
                  <SkipForward className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={cycleRepeatMode}
                  className={cn(
                    "rounded-full border p-2.5 transition-colors",
                    repeatMode === "all"
                      ? "border-accent-green/35 bg-accent-green/15 text-accent-green"
                      : "border-white/10 bg-white/5 text-text-dim hover:text-text-main",
                  )}
                >
                  <Repeat className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center gap-3">
                <span className="w-11 text-right font-mono text-[11px] text-text-dim">{formatTime(currentTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.1}
                  value={currentTime || 0}
                  onChange={(event) => seek(Number.parseFloat(event.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-accent-gold"
                />
                <span className="w-11 font-mono text-[11px] text-text-dim">{formatTime(duration)}</span>
              </div>
            </div>

            <div className="flex w-[26%] items-center justify-end gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-dim">
                <ListMusic className="h-4 w-4" />
                {queueCount}
              </div>
              <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-3 py-2">
                <button type="button" onClick={toggleMute} className="text-text-dim transition-colors hover:text-text-main">
                  {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(event) => setVolume(Number.parseFloat(event.target.value))}
                  className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-white/10 accent-accent-gold"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
