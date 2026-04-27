import type { ReactNode } from "react";
import { AudioDock } from "@/components/player/AudioDock";
import { WorkspaceNav } from "@/components/layout/WorkspaceNav";
import { EditorAudioDockProvider } from "@/context/EditorAudioDockContext";

export default function AppWorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <EditorAudioDockProvider>
      <WorkspaceNav />
      <div className="relative z-10 xl:pl-[112px]">
        <main className="mx-auto flex h-dvh min-w-0 max-w-[1680px] flex-col overflow-hidden px-4 pb-[calc(18rem+env(safe-area-inset-bottom))] pt-[76px] sm:px-6 sm:pt-[84px] lg:px-8 lg:pb-[128px] xl:pt-6">
          {children}
        </main>
      </div>
      <AudioDock />
    </EditorAudioDockProvider>
  );
}
