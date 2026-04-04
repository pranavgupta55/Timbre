"use client";
import { useState, useRef, useEffect } from "react";
import WaveSurfer from 'wavesurfer.js';
// @ts-ignore - lamejs lacks types, this suppresses the warning
import lamejs from 'lamejs';
import { Eyebrow, Badge, DataCard } from "@/components/ui/TacticalUI";

export default function EditorPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState<Blob[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);

  // Clean up waveform on unmount
  useEffect(() => {
    return () => wavesurfer.current?.destroy();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      setFile(f);
      
      if (!wavesurfer.current && waveformRef.current) {
        wavesurfer.current = WaveSurfer.create({
          container: waveformRef.current,
          waveColor: 'rgba(255,255,255,0.2)', // --border-dashed
          progressColor: '#E8E0D4', // --text-main
          cursorColor: '#C4A052', // --accent-gold
          barWidth: 2,
        });
      }
      wavesurfer.current?.loadBlob(f);
    }
  };

  // The Magic Pure JS MP3 Trimmer
  const extractSegment = async () => {
    if (!file || !wavesurfer.current) return;
    setIsExtracting(true);
    
    try {
      // 1. Get audio data
      const arrayBuffer = await file.arrayBuffer();
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      // 2. Define trim times (hardcoded 0 to 10 seconds for now, we will add UI for this later)
      const startSec = 0; 
      const endSec = Math.min(10, audioBuffer.duration); 

      // 3. Slice the buffer
      const startSample = Math.floor(startSec * audioBuffer.sampleRate);
      const endSample = Math.floor(endSec * audioBuffer.sampleRate);
      
      const leftChannel = audioBuffer.getChannelData(0).slice(startSample, endSample);
      const rightChannel = audioBuffer.numberOfChannels > 1 
        ? audioBuffer.getChannelData(1).slice(startSample, endSample) 
        : leftChannel; // duplicate mono to stereo

      // 4. Setup MP3 Encoder (128kbps)
      const encoder = new lamejs.Mp3Encoder(2, audioBuffer.sampleRate, 128);
      
      // Convert Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767) required by lamejs
      const leftInt16 = new Int16Array(leftChannel.length);
      const rightInt16 = new Int16Array(rightChannel.length);
      for (let i = 0; i < leftChannel.length; i++) {
          leftInt16[i] = leftChannel[i] < 0 ? leftChannel[i] * 32768 : leftChannel[i] * 32767;
          rightInt16[i] = rightChannel[i] < 0 ? rightChannel[i] * 32768 : rightChannel[i] * 32767;
      }

      // Encode in chunks to prevent freezing the main thread completely
      const sampleBlockSize = 1152;
      const mp3Data = [];
      
      for (let i = 0; i < leftInt16.length; i += sampleBlockSize) {
          const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
          const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);
          const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
          if (mp3buf.length > 0) mp3Data.push(mp3buf);
      }
      const finalBuf = encoder.flush();
      if (finalBuf.length > 0) mp3Data.push(finalBuf);

      // 5. Save the Blob
      const blob = new Blob(mp3Data, { type: 'audio/mp3' });
      setPending([...pending, blob]);

    } catch (e) {
      console.error("Extraction failed", e);
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div className="space-y-12">
      <div>
        <Eyebrow title="WORKSPACE" count="AUDIO PROCESSING ONLINE" />
        <h1 className="font-serif text-5xl text-text-main" style={{ fontFamily: "var(--font-glosa)" }}>Audio Editor</h1>
      </div>

      <div className="rounded-xl border border-border-light bg-bg-panel p-6 shadow-2xl">
        {!file ? (
          <label className="block w-full border border-dashed border-border-dashed bg-bg-panel p-12 text-center cursor-pointer hover:bg-white/[0.02] transition-colors">
            <input type="file" accept="audio/mp3" className="hidden" onChange={handleFileUpload} />
            <span className="font-mono text-sm text-text-dim">[ AWAITING_AUDIO_INPUT ]</span>
          </label>
        ) : (
          <div className="space-y-6">
            <Eyebrow title="INSPECTOR" count={file.name} />
            
            {/* Waveform Container */}
            <div ref={waveformRef} className="w-full rounded bg-bg-inspector p-4 border border-border-light min-h-[100px]" />
            
            <div className="flex justify-between items-center border-t border-border-light/50 pt-4">
              <div className="flex gap-4">
                <div className="space-y-1">
                  <label className="font-sans text-[10px] uppercase text-text-dim">Fade In (s)</label>
                  <input type="number" defaultValue={2} className="w-16 font-mono bg-transparent text-accent-gold outline-none border-b border-border-light" />
                </div>
                <div className="space-y-1">
                  <label className="font-sans text-[10px] uppercase text-text-dim">Fade Out (s)</label>
                  <input type="number" defaultValue={2} className="w-16 font-mono bg-transparent text-accent-gold outline-none border-b border-border-light" />
                </div>
              </div>
              
              <button 
                onClick={extractSegment} 
                disabled={isExtracting}
                className={`font-sans text-[10px] uppercase tracking-widest text-text-main border border-border-light px-4 py-2 transition-colors ${isExtracting ? 'bg-bg-panel text-text-dim cursor-not-allowed' : 'bg-bg-base hover:bg-white/5'}`}
              >
                {isExtracting ? "PROCESSING..." : "EXTRACT SEGMENT"}
              </button>
            </div>
          </div>
        )}
      </div>

      {pending.length > 0 && (
        <div className="space-y-4">
          <Eyebrow title="PENDING UPLOADS" count={`${pending.length} files`} />
          {pending.map((p, i) => (
            <DataCard 
              key={i} 
              label={`Segment_${i}.mp3`} 
              subtitle={`${(p.size / 1024 / 1024).toFixed(2)} MB`} 
              rightNode={<Badge variant="dim">READY</Badge>} 
            />
          ))}
          <button className="w-full font-mono text-sm border border-accent-green text-accent-green bg-accent-green/10 py-3 mt-4 hover:bg-accent-green/20 transition-colors rounded">
            UPLOAD TO HIGHLIGHT REEL
          </button>
        </div>
      )}
    </div>
  );
}