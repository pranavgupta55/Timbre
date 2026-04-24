"use client";

import { createContext, useContext, useRef, useSyncExternalStore, type ReactNode } from "react";

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

type EditorAudioDockStore = {
  getSnapshot: () => EditorAudioDockState | null;
  setState: (state: EditorAudioDockState | null) => void;
  subscribe: (listener: () => void) => () => void;
};

const createEditorAudioDockStore = (): EditorAudioDockStore => {
  let dockState: EditorAudioDockState | null = null;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => dockState,
    setState: (nextState) => {
      if (Object.is(dockState, nextState)) {
        return;
      }

      dockState = nextState;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const EditorAudioDockStoreContext = createContext<EditorAudioDockStore | undefined>(undefined);
const EditorAudioDockDispatchContext = createContext<((state: EditorAudioDockState | null) => void) | undefined>(undefined);

export function EditorAudioDockProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<EditorAudioDockStore | null>(null);

  if (!storeRef.current) {
    storeRef.current = createEditorAudioDockStore();
  }

  return (
    <EditorAudioDockDispatchContext.Provider value={storeRef.current.setState}>
      <EditorAudioDockStoreContext.Provider value={storeRef.current}>{children}</EditorAudioDockStoreContext.Provider>
    </EditorAudioDockDispatchContext.Provider>
  );
}

export const useEditorAudioDockState = () => {
  const store = useContext(EditorAudioDockStoreContext);
  if (store === undefined) {
    throw new Error("useEditorAudioDockState must be used within an EditorAudioDockProvider");
  }

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
};

export const useSetEditorAudioDock = () => {
  const context = useContext(EditorAudioDockDispatchContext);
  if (context === undefined) {
    throw new Error("useSetEditorAudioDock must be used within an EditorAudioDockProvider");
  }

  return context;
};

export const useEditorAudioDock = () => ({
  dockState: useEditorAudioDockState(),
  setDockState: useSetEditorAudioDock(),
});
