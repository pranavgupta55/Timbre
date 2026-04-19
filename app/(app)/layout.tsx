import type { ReactNode } from "react";
import { AudioDock } from "@/components/player/AudioDock";
import { WorkspaceNav } from "@/components/layout/WorkspaceNav";

export default function AppWorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <WorkspaceNav />
      <div className="relative z-10 xl:pl-[112px]">
        <main className="mx-auto flex h-dvh max-w-[1520px] flex-col overflow-hidden px-4 pb-[116px] pt-[76px] sm:px-6 sm:pb-[128px] sm:pt-[84px] lg:px-8 xl:pt-6">
          {children}
        </main>
      </div>
      <AudioDock />
    </>
  );
}
