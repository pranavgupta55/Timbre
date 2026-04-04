"use client";
import { Eyebrow, CodeLink } from "@/components/ui/TacticalUI";
import { useAuth } from "@/context/AuthContext";

export default function ReelPage() {
  const { signOut } = useAuth();

  return (
    <div className="space-y-12">
      <div>
        <Eyebrow title="AUDIO REEL" count="SYSTEM ONLINE" />
        <h1 className="font-serif text-5xl text-text-main" style={{ fontFamily: "var(--font-glosa)" }}>
          Global Highlights
        </h1>
      </div>
      
      <div className="rounded-xl border border-border-light bg-bg-panel p-6 shadow-2xl">
        <div className="font-mono text-sm text-text-dim text-center py-12">
          [ REEL_DATABASE_EMPTY ]
        </div>
      </div>

      <div className="flex gap-4">
        <CodeLink href="/editor">OPEN_EDITOR</CodeLink>
        <button onClick={signOut} className="font-mono text-xs text-text-dim hover:text-accent-red transition-colors">
          [ TERMINATE_SESSION ]
        </button>
      </div>
    </div>
  );
}