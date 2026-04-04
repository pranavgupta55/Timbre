"use client";
import { createContext, useContext, useRef, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

export interface Track {
  id: string;
  filename: string;
  storage_path: string;
  fade_in_seconds: number;
  fade_out_seconds: number;
}

const AudioCtx = createContext<any>(null);
export const useAudio = () => useContext(AudioCtx);

export function AudioProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Dual player setup for gapless fades
  const audio1Ref = useRef<HTMLAudioElement | null>(null);
  const audio2Ref = useRef<HTMLAudioElement | null>(null);
  const activePlayer = useRef<1 | 2>(1);

  useEffect(() => {
    audio1Ref.current = new Audio();
    audio2Ref.current = new Audio();
    audio1Ref.current.crossOrigin = "anonymous";
    audio2Ref.current.crossOrigin = "anonymous";
  }, []);

  const playTrack = async (index: number) => {
    if (index < 0 || index >= queue.length) return;
    const track = queue[index];
    
    // JIT Loading
    const { data } = await supabase.storage.from('highlights').createSignedUrl(track.storage_path, 3600);
    if (!data) return;

    // Toggle player
    const player = activePlayer.current === 1 ? audio1Ref.current! : audio2Ref.current!;
    const oldPlayer = activePlayer.current === 1 ? audio2Ref.current! : audio1Ref.current!;
    
    player.src = data.signedUrl;
    player.volume = 0; // Start at 0 for fade in
    player.play();
    setIsPlaying(true);
    setCurrentIndex(index);

    // Linear Fade In (Manual JS interval implementation since Web Audio API requires user interaction to resume contexts reliably in NextJS)
    let vol = 0;
    const step = 0.05;
    const intervalTime = (track.fade_in_seconds * 1000) / (1 / step);
    
    const fadeInt = setInterval(() => {
      if (vol >= 1) { player.volume = 1; clearInterval(fadeInt); return; }
      vol += step;
      player.volume = Math.min(vol, 1);
    }, intervalTime);

    // Fade out old player if running
    if (!oldPlayer.paused) {
        let oldVol = oldPlayer.volume;
        const oldFadeInt = setInterval(() => {
            if (oldVol <= 0) { oldPlayer.pause(); oldPlayer.volume = 1; clearInterval(oldFadeInt); return; }
            oldVol -= step;
            oldPlayer.volume = Math.max(oldVol, 0);
        }, intervalTime);
    }
    
    activePlayer.current = activePlayer.current === 1 ? 2 : 1;
  };

  const next = () => playTrack(currentIndex + 1);
  const prev = () => playTrack(currentIndex - 1);

  return (
    <AudioCtx.Provider value={{ queue, setQueue, currentIndex, isPlaying, playTrack, next, prev }}>
      {children}
    </AudioCtx.Provider>
  );
}