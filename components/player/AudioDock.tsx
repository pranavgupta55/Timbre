"use client";

import {
  ChevronsLeft,
  ChevronsRight,
  ListMusic,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useAudio } from "@/context/AudioContext";
import { useEditorAudioDockState } from "@/context/EditorAudioDockContext";
import { cn } from "@/lib/utils";

const formatTime = (value: number) => {
  if (!Number.isFinite(value)) return "0:00";
  const totalSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
};

type Overlay = {
  id: string;
  start: number;
  end: number;
  isActive?: boolean;
};

function TransportButton({
  onClick,
  disabled = false,
  active = false,
  accent = "default",
  ariaLabel,
  children,
  className,
}: {
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  active?: boolean;
  accent?: "default" | "gold" | "green" | "blue";
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const accentClasses =
    accent === "gold"
      ? "border-accent-gold/35 bg-accent-gold/18 text-accent-gold shadow-[0_16px_40px_rgba(196,160,82,0.2)]"
      : accent === "green"
        ? "border-accent-green/35 bg-accent-green/15 text-accent-green"
        : accent === "blue"
          ? "border-accent-blue/35 bg-accent-blue/15 text-accent-blue"
          : active
            ? "border-accent-gold/25 bg-accent-gold/12 text-accent-gold"
            : "border-white/10 bg-white/5 text-text-dim hover:bg-white/10 hover:text-text-main";

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "rounded-full border p-2.5 transition-colors disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-text-dim",
        accentClasses,
        className,
      )}
    >
      {children}
    </button>
  );
}

function VolumeControl({
  volume,
  isMuted,
  onSetVolume,
  onToggleMute,
}: {
  volume: number;
  isMuted: boolean;
  onSetVolume: (volume: number) => void;
  onToggleMute: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-3 py-2">
      <button type="button" onClick={onToggleMute} className="text-text-dim transition-colors hover:text-text-main" aria-label="Toggle mute">
        {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(event) => onSetVolume(Number.parseFloat(event.target.value))}
        className="timbre-range timbre-range-volume block h-4 w-24 cursor-pointer"
        aria-label="Volume"
      />
    </div>
  );
}

function TransportTimeline({
  currentTime,
  duration,
  onSeek,
  overlays = [],
}: {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  overlays?: Overlay[];
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-11 text-right font-mono text-[11px] text-text-dim">{formatTime(currentTime)}</span>
      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
          <div className="relative h-1.5 overflow-hidden rounded-full bg-white/10">
            {overlays.map((overlay) => {
              const overlayWidth = duration > 0 ? ((overlay.end - overlay.start) / duration) * 100 : 0;
              const overlayLeft = duration > 0 ? (overlay.start / duration) * 100 : 0;

              return (
                <div
                  key={overlay.id}
                  className={cn(
                    "absolute inset-y-0 rounded-full border",
                    overlay.isActive ? "border-accent-gold/80 bg-accent-gold/28" : "border-accent-blue/40 bg-accent-blue/18",
                  )}
                  style={{
                    left: `${overlayLeft}%`,
                    width: `${overlayWidth}%`,
                  }}
                />
              );
            })}
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime || 0}
          onChange={(event) => onSeek(Number.parseFloat(event.target.value))}
          className="timbre-range timbre-range-seek absolute inset-x-0 top-1/2 z-10 block h-4 -translate-y-1/2 cursor-pointer"
          aria-label="Seek"
        />
      </div>
      <span className="w-11 font-mono text-[11px] text-text-dim">{formatTime(duration)}</span>
    </div>
  );
}

function TransportShell({
  title,
  subtitle,
  currentTime,
  duration,
  overlays,
  controls,
  rightNode,
  volume,
  isMuted,
  onSeek,
  onSetVolume,
  onToggleMute,
}: {
  title: string;
  subtitle?: string;
  currentTime: number;
  duration: number;
  overlays?: Overlay[];
  controls: ReactNode;
  rightNode: ReactNode;
  volume: number;
  isMuted: boolean;
  onSeek: (time: number) => void;
  onSetVolume: (volume: number) => void;
  onToggleMute: () => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:px-6">
      <div className="mx-auto w-full max-w-[1480px]">
        <div className="pointer-events-auto rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,10,11,0.94),rgba(17,17,16,0.88))] px-4 py-3 shadow-[0_30px_120px_rgba(0,0,0,0.44)] backdrop-blur-2xl sm:px-5">
          <div className="space-y-3 lg:hidden">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-serif text-lg text-text-main sm:text-xl">{title}</div>
                {subtitle ? <div className="mt-1 truncate font-sans text-xs text-text-dim">{subtitle}</div> : null}
              </div>
              <div className="shrink-0">{rightNode}</div>
            </div>

            <div className="flex items-center justify-center gap-2">{controls}</div>

            <TransportTimeline currentTime={currentTime} duration={duration} onSeek={onSeek} overlays={overlays} />

            <div className="flex justify-end">
              <VolumeControl volume={volume} isMuted={isMuted} onSetVolume={onSetVolume} onToggleMute={onToggleMute} />
            </div>
          </div>

          <div className="hidden items-center justify-between gap-5 lg:flex">
            <div className="min-w-0 w-[28%]">
              <div className="truncate font-serif text-xl text-text-main">{title}</div>
              {subtitle ? <div className="mt-1 truncate font-sans text-xs text-text-dim">{subtitle}</div> : null}
            </div>

            <div className="flex w-[42%] flex-col gap-4">
              <div className="flex items-center justify-center gap-3">{controls}</div>
              <TransportTimeline currentTime={currentTime} duration={duration} onSeek={onSeek} overlays={overlays} />
            </div>

            <div className="flex w-[26%] items-center justify-end gap-3">
              {rightNode}
              <VolumeControl volume={volume} isMuted={isMuted} onSetVolume={onSetVolume} onToggleMute={onToggleMute} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const dockState = useEditorAudioDockState();

  const queueCount = useMemo(
    () => manualQueue.length + Math.max(contextTracks.length - currentIndex - 1, 0),
    [contextTracks.length, currentIndex, manualQueue.length],
  );

  if (dockState) {
    const overlays = dockState.overlays.map((overlay) => ({
      ...overlay,
      isActive: overlay.isActive || overlay.id === dockState.activeOverlayId,
    }));

    return (
      <TransportShell
        title={dockState.title}
        subtitle={dockState.subtitle}
        currentTime={dockState.currentTime}
        duration={dockState.duration}
        overlays={overlays}
        onSeek={dockState.onSeek}
        volume={dockState.volume}
        isMuted={dockState.isMuted}
        onSetVolume={dockState.onSetVolume}
        onToggleMute={dockState.onToggleMute}
        rightNode={
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm",
              dockState.playbackMode === "final-preview"
                ? "border-accent-gold/20 bg-accent-gold/10 text-accent-gold"
                : "border-accent-blue/20 bg-accent-blue/10 text-accent-blue",
            )}
          >
            <ListMusic className="h-4 w-4" />
            {dockState.modeLabel ?? `${dockState.overlays.length} segment${dockState.overlays.length === 1 ? "" : "s"}`}
          </div>
        }
        controls={
          <>
            <TransportButton
              onClick={dockState.onJumpToPreviousOverlay}
              disabled={dockState.duration <= 0 || dockState.overlays.length === 0}
              ariaLabel="Previous segment"
            >
              <ChevronsLeft className="h-4 w-4" />
            </TransportButton>
            <TransportButton onClick={dockState.onSkipBack} disabled={dockState.duration <= 0} ariaLabel="Back 5 seconds">
              <RotateCcw className="h-4 w-4" />
            </TransportButton>
            <TransportButton
              onClick={dockState.onToggle}
              disabled={dockState.duration <= 0}
              accent="gold"
              ariaLabel={dockState.isPlaying ? "Pause" : "Play"}
              className="p-4"
            >
              {dockState.isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-[1px]" />}
            </TransportButton>
            <TransportButton onClick={dockState.onSkipForward} disabled={dockState.duration <= 0} ariaLabel="Forward 5 seconds">
              <RotateCw className="h-4 w-4" />
            </TransportButton>
            <TransportButton
              onClick={dockState.onJumpToNextOverlay}
              disabled={dockState.duration <= 0 || dockState.overlays.length === 0}
              ariaLabel="Next segment"
            >
              <ChevronsRight className="h-4 w-4" />
            </TransportButton>
          </>
        }
      />
    );
  }

  return (
    <TransportShell
      title={currentTrack?.title ?? "Nothing playing"}
      subtitle={currentTrack?.sourceName ?? "Shared playback queue"}
      currentTime={currentTime}
      duration={duration}
      overlays={[]}
      onSeek={seek}
      volume={volume}
      isMuted={isMuted}
      onSetVolume={setVolume}
      onToggleMute={toggleMute}
      rightNode={
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-dim">
          <ListMusic className="h-4 w-4" />
          {queueCount}
        </div>
      }
      controls={
        <>
          <TransportButton onClick={toggleShuffle} active={isShuffle} accent={isShuffle ? "blue" : "default"} ariaLabel="Toggle shuffle">
            <Shuffle className="h-4 w-4" />
          </TransportButton>
          <TransportButton onClick={() => void prev()} ariaLabel="Previous track">
            <SkipBack className="h-4 w-4" />
          </TransportButton>
          <TransportButton onClick={() => void toggle()} accent="gold" ariaLabel={isPlaying ? "Pause" : "Play"} className="p-4">
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-[1px]" />}
          </TransportButton>
          <TransportButton onClick={() => void next()} ariaLabel="Next track">
            <SkipForward className="h-4 w-4" />
          </TransportButton>
          <TransportButton
            onClick={cycleRepeatMode}
            active={repeatMode === "all"}
            accent={repeatMode === "all" ? "green" : "default"}
            ariaLabel="Toggle repeat"
          >
            <Repeat className="h-4 w-4" />
          </TransportButton>
        </>
      }
    />
  );
}
