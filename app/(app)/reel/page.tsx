"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { QueuePanel } from "@/components/player/QueuePanel";
import { useAuth } from "@/context/AuthContext";
import { useAudio } from "@/context/AudioContext";
import { fetchHighlightInventory, type HighlightTrack } from "@/lib/highlights";
import { cn } from "@/lib/utils";

export default function ReelPage() {
  const { user, loading } = useAuth();
  const { currentTrack, startContext, playNext } = useAudio();

  const [tracks, setTracks] = useState<HighlightTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");

  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (loading) return;

    if (!user?.id) {
      setTracks([]);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;

    const loadInventory = async () => {
      setIsLoading(true);
      setLoadError("");

      try {
        const inventory = await fetchHighlightInventory(user.id);
        if (isCancelled) return;

        setTracks(inventory.tracks);
      } catch (error) {
        if (isCancelled) return;
        setTracks([]);
        setLoadError(error instanceof Error ? error.message : "Failed to load highlights.");
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadInventory();

    return () => {
      isCancelled = true;
    };
  }, [loading, user?.id]);

  const filteredTracks = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) return tracks;

    return tracks.filter((track) =>
      `${track.title} ${track.sourceName} ${track.subtitle}`.toLowerCase().includes(query),
    );
  }, [deferredSearch, tracks]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="min-w-0">
        <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-accent-red">Player</div>
        <h1 className="mt-1 truncate font-serif text-2xl text-text-main sm:text-4xl">Highlights</h1>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="editor-surface flex min-h-0 flex-col rounded-[32px] p-4 sm:p-5">
          <div className="mb-4 xl:hidden">
            <QueuePanel compact />
          </div>

          <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-text-dim">Library</div>
              {currentTrack ? (
                <div className="mt-2 min-w-0 rounded-2xl border border-accent-gold/20 bg-accent-gold/10 px-4 py-3">
                  <div className="truncate font-sans text-sm text-text-main">{currentTrack.title}</div>
                </div>
              ) : null}
            </div>

            <label className="flex w-full min-w-0 items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 sm:max-w-[320px]">
              <Search className="h-4 w-4 text-text-dim" />
              <input
                type="text"
                value={search}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  startTransition(() => setSearch(nextValue));
                }}
                placeholder="Search highlights"
                className="w-full bg-transparent text-sm text-text-main outline-none placeholder:text-text-dim"
              />
            </label>
          </div>

          {isLoading ? (
            <div className="flex min-h-0 flex-1 items-center justify-center gap-3 font-sans text-sm text-text-dim">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading highlights…
            </div>
          ) : loadError ? (
            <div className="mt-4 rounded-[24px] border border-accent-red/20 bg-accent-red/12 px-4 py-3 font-sans text-sm text-accent-red">
              {loadError}
            </div>
          ) : filteredTracks.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-[28px] border border-dashed border-white/10 bg-white/[0.03] px-6 py-10 text-center font-sans text-sm text-text-dim">
              No highlights found.
            </div>
          ) : (
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="space-y-3">
                {filteredTracks.map((track, index) => {
                  const isActive = currentTrack?.id === track.id;

                  return (
                    <div
                      key={track.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => startContext(filteredTracks, index, true)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          startContext(filteredTracks, index, true);
                        }
                      }}
                      className={cn(
                        "rounded-[26px] border px-4 py-4 transition-all",
                        isActive
                          ? "border-accent-green/25 bg-accent-green/12 shadow-[0_16px_40px_rgba(103,185,143,0.14)]"
                          : "border-white/10 bg-white/[0.04] hover:bg-white/[0.06]",
                      )}
                    >
                      <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-start min-[420px]:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-sans text-sm text-text-main">{track.title}</div>
                        </div>

                        <div className="flex min-w-0 flex-wrap items-center gap-2 min-[420px]:justify-end">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              playNext(track);
                            }}
                            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-text-main transition-colors hover:bg-white/10"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Next
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              startContext(filteredTracks, index, true);
                            }}
                            className={cn(
                              "inline-flex shrink-0 items-center rounded-full border px-3 py-1.5 text-xs transition-colors",
                              isActive
                                ? "border-accent-gold/28 bg-accent-gold/12 text-accent-gold"
                                : "border-white/10 bg-white/5 text-text-dim hover:bg-white/10 hover:text-text-main",
                            )}
                          >
                            {isActive ? "Active" : "Play"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <aside className="hidden min-h-0 xl:block">
          <QueuePanel className="h-full" />
        </aside>
      </div>
    </div>
  );
}
