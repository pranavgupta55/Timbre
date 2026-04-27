"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AudioDock } from "@/components/player/AudioDock";
import { WorkspaceNav } from "@/components/layout/WorkspaceNav";
import { EditorAudioDockProvider } from "@/context/EditorAudioDockContext";
import { cn } from "@/lib/utils";

export default function AppWorkspaceLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isReelRoute = pathname === "/reel";

  return (
    <EditorAudioDockProvider>
      <WorkspaceNav />
      <div className="relative z-10 xl:pl-[112px]">
        <main
          className={cn(
            "mx-auto flex h-dvh min-w-0 max-w-[1680px] flex-col overflow-hidden px-4 lg:px-8 xl:pt-6",
            isReelRoute
              ? "pb-[calc(14.5rem+env(safe-area-inset-bottom))] pt-0 sm:px-6 sm:pb-[calc(15rem+env(safe-area-inset-bottom))] sm:pt-0 lg:pb-[128px]"
              : "pb-[calc(18rem+env(safe-area-inset-bottom))] pt-[76px] sm:px-6 sm:pt-[84px] lg:pb-[128px]",
          )}
        >
          {children}
        </main>
      </div>
      <AudioDock />
    </EditorAudioDockProvider>
  );
}
