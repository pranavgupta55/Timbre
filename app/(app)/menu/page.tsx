"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { fetchHighlightInventory, type ApprovedSource, type HighlightTrack } from "@/lib/highlights";

const formatDateLabel = (value?: string | null) => {
  if (!value) return "No uploads yet";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
};

export default function MenuPage() {
  const { user, loading, signOut } = useAuth();
  const [tracks, setTracks] = useState<HighlightTrack[]>([]);
  const [sources, setSources] = useState<ApprovedSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (loading) return;

    if (!user?.id) {
      setTracks([]);
      setSources([]);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;

    const loadInventory = async () => {
      setIsLoading(true);

      try {
        const inventory = await fetchHighlightInventory(user.id);
        if (isCancelled) return;

        setTracks(inventory.tracks);
        setSources(inventory.sources);
      } catch {
        if (isCancelled) return;

        setTracks([]);
        setSources([]);
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

  const accountName = useMemo(() => {
    const rawName =
      user?.user_metadata?.display_name ||
      user?.user_metadata?.name ||
      user?.email?.split("@")[0] ||
      "Operator";

    return typeof rawName === "string" ? rawName : "Operator";
  }, [user?.email, user?.user_metadata]);

  const latestUpload = sources[0]?.uploadedAt ?? null;

  return (
    <div className="flex h-full min-h-0 items-center">
      <section className="editor-surface w-full max-w-[760px] rounded-[32px] p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-accent-red">Account</div>
            <h1 className="mt-2 truncate font-serif text-3xl text-text-main sm:text-4xl">{accountName}</h1>
            <div className="mt-2 truncate font-sans text-sm text-text-dim">{user?.email ?? "Guest mode"}</div>
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-text-dim transition-colors hover:text-accent-red"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
            <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-text-dim">Approved songs</div>
            <div className="mt-2 font-serif text-3xl text-text-main">
              {isLoading ? <Loader2 className="h-6 w-6 animate-spin text-text-dim" /> : sources.length}
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
            <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-text-dim">Segments</div>
            <div className="mt-2 font-serif text-3xl text-text-main">
              {isLoading ? <Loader2 className="h-6 w-6 animate-spin text-text-dim" /> : tracks.length}
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
            <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-text-dim">Latest upload</div>
            <div className="mt-2 truncate font-sans text-sm text-text-main">{isLoading ? "Loading…" : formatDateLabel(latestUpload)}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
