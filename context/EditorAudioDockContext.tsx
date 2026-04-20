"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type EditorDockOverlay = {
  id: string;
  start: number;
  end: number;
  isActive?: boolean;
};

export type EditorAudioDockState = {
  playbackMode: "source" | "final-preview";
  title: string;
  subtitle?: string;
  modeLabel?: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  overlays: EditorDockOverlay[];
  activeOverlayId?: string | null;
  onToggle: () => void | Promise<void>;
  onSeek: (time: number) => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onJumpToPreviousOverlay: () => void;
  onJumpToNextOverlay: () => void;
  onSetVolume: (volume: number) => void;
  onToggleMute: () => void;
};

type EditorAudioDockContextValue = {
  dockState: EditorAudioDockState | null;
  setDockState: (state: EditorAudioDockState | null) => void;
};

const EditorAudioDockContext = createContext<EditorAudioDockContextValue | null>(null);

export function EditorAudioDockProvider({ children }: { children: ReactNode }) {
  const [dockState, setDockState] = useState<EditorAudioDockState | null>(null);

  const value = useMemo(
    () => ({
      dockState,
      setDockState,
    }),
    [dockState],
  );

  return <EditorAudioDockContext.Provider value={value}>{children}</EditorAudioDockContext.Provider>;
}

export const useEditorAudioDock = () => {
  const context = useContext(EditorAudioDockContext);
  if (!context) {
    throw new Error("useEditorAudioDock must be used within an EditorAudioDockProvider");
  }

  return context;
};
