import type { ReactNode } from "react";
import { AudioDock } from "@/components/player/AudioDock";
import { WorkspaceNav } from "@/components/layout/WorkspaceNav";
import { EditorAudioDockProvider } from "@/context/EditorAudioDockContext";

export default function AppWorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <EditorAudioDockProvider>
      <WorkspaceNav />
      <div className="relative z-10 xl:pl-[112px]">
        <main className="mx-auto flex h-dvh max-w-[1680px] flex-col overflow-hidden px-4 pb-[184px] pt-[76px] sm:px-6 sm:pb-[148px] sm:pt-[84px] lg:px-8 lg:pb-[128px] xl:pt-6">
          {children}
        </main>
      </div>
      <AudioDock />
    </EditorAudioDockProvider>
  );
}
