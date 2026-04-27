"use client";

import { Trash2 } from "lucide-react";
import { useAudio } from "@/context/AudioContext";
import { cn } from "@/lib/utils";

interface QueuePanelProps {
  className?: string;
  compact?: boolean;
}

export function QueuePanel({ className, compact = false }: QueuePanelProps) {
  const { currentTrack, manualQueue, contextTracks, currentIndex, removeFromManualQueue, clearManualQueue } = useAudio();

  const upcomingContextTracks = contextTracks.slice(currentIndex + 1, currentIndex + (compact ? 5 : 9));
  const visibleManualQueue = compact ? manualQueue.slice(0, 3) : manualQueue;
  const compactUpcomingTracks = compact
    ? [
        ...visibleManualQueue.map((track) => ({ track, source: "manual" as const })),
        ...upcomingContextTracks
          .slice(0, Math.max(0, 4 - visibleManualQueue.length))
          .map((track) => ({ track, source: "context" as const })),
      ]
    : [];
  const hiddenQueueCount = manualQueue.length - visibleManualQueue.length;
  const sectionGapClass = compact ? "space-y-4" : "space-y-5";
  const itemSpacingClass = compact ? "space-y-2" : "space-y-3";
  const maxUpcomingHeight = compact ? "max-h-40" : "max-h-64";

  return (
    <div
      className={cn(
        compact
          ? "min-w-0 w-full overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-3.5 shadow-[0_22px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl sm:p-4"
          : "min-w-0 w-full overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-4 shadow-[0_22px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl sm:p-5",
        className,
      )}
    >
      <div className={sectionGapClass}>
        <section className="min-w-0 space-y-3">
          <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-text-dim">Current queue</div>
          {currentTrack ? (
            <div className={cn("min-w-0 rounded-3xl border border-accent-gold/20 bg-accent-gold/10", compact ? "p-3.5" : "p-4")}>
              <div className={cn("truncate font-serif text-text-main", compact ? "text-lg" : "text-xl")}>{currentTrack.title}</div>
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-4 font-sans text-sm text-text-dim">
              Nothing playing.
            </div>
          )}
        </section>

        <section className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-text-dim">Up next</div>
            {manualQueue.length > 0 ? (
              <button
                type="button"
                onClick={clearManualQueue}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-text-dim transition-colors hover:text-text-main"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </button>
            ) : null}
          </div>

          {compactUpcomingTracks.length > 0 ? (
            <ul className={itemSpacingClass}>
              {compactUpcomingTracks.map(({ track, source }, index) => (
                <li
                  key={`${track.id}-${index}`}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate font-sans text-sm text-text-main">{track.title}</div>
                  </div>
                  {source === "manual" ? (
                    <button
                      type="button"
                      onClick={() => removeFromManualQueue(track.id)}
                      className="rounded-full border border-white/10 px-3 py-1 text-xs text-text-dim transition-colors hover:border-accent-red/20 hover:text-accent-red"
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-4 font-sans text-sm text-text-dim">
              Queue is empty.
            </div>
          )}

          {compact && hiddenQueueCount > 0 ? (
            <div className="font-sans text-[11px] uppercase tracking-[0.16em] text-text-dim">+{hiddenQueueCount} more queued</div>
          ) : null}
        </section>

        {compact ? null : (
          <section className="min-w-0 space-y-3">
            <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-text-dim">More from library</div>

            {upcomingContextTracks.length > 0 ? (
              <ul className={cn(itemSpacingClass, maxUpcomingHeight, "overflow-y-auto pr-1")}>
                {upcomingContextTracks.map((track, index) => (
                  <li
                    key={`${track.id}-${index}`}
                    className="rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-3"
                  >
                    <div className="truncate font-sans text-sm text-text-main">{track.title}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-4 font-sans text-sm text-text-dim">
                End of queue.
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
