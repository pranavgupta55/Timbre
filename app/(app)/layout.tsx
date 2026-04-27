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
            "min-w-0",
            isReelRoute
              ? "w-full min-h-dvh overflow-visible px-0 py-0 xl:mx-auto xl:flex xl:h-dvh xl:max-w-[1680px] xl:flex-col xl:overflow-hidden xl:px-8 xl:pt-6"
              : "mx-auto flex h-dvh max-w-[1680px] flex-col overflow-hidden px-4 pb-[calc(18rem+env(safe-area-inset-bottom))] pt-[76px] sm:px-6 sm:pt-[84px] lg:px-8 lg:pb-[128px] xl:pt-6",
          )}
        >
          {children}
        </main>
      </div>
      <AudioDock />
    </EditorAudioDockProvider>
  );
}
