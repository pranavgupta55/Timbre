import type { ReactNode } from "react";
import { ArrowUpRight, ExternalLink, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

export function Eyebrow({ title, count }: { title: string; count?: string }) {
  return (
    <div className="mb-4 flex flex-col gap-1">
      <span className="font-sans text-[10px] font-bold uppercase tracking-[0.15em] text-accent-red">
        {title}
      </span>
      {count && <span className="font-sans text-[11px] capitalize text-text-dim">{count}</span>}
    </div>
  );
}

export function Badge({
  children,
  variant = "red",
}: {
  children: ReactNode;
  variant?: "red" | "gold" | "green" | "dim" | "blue";
}) {
  const variants = {
    red: "border-accent-red/30 bg-accent-red/18 text-accent-red",
    green: "border-accent-green/25 bg-accent-green/12 text-accent-green",
    gold: "border-accent-gold/25 bg-accent-gold/12 text-accent-gold",
    blue: "border-accent-blue/25 bg-accent-blue/12 text-accent-blue",
    dim: "border-white/10 bg-white/5 text-text-dim",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 font-sans text-[10px] uppercase tracking-wider",
        variants[variant],
      )}
    >
      {children}
    </span>
  );
}

interface DataCardProps {
  label: string;
  subtitle?: string;
  state?: "default" | "active" | "locked";
  onClick?: () => void;
  rightNode?: ReactNode;
  type?: "button" | "submit";
}

export function DataCard({ label, subtitle, state = "default", onClick, rightNode, type = "button" }: DataCardProps) {
  const states = {
    default:
      "border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] text-text-main hover:-translate-y-0.5 hover:bg-white/[0.06]",
    active: "border-accent-green/30 bg-accent-green/14 text-white shadow-[0_16px_40px_rgba(103,185,143,0.16)]",
    locked: "cursor-not-allowed border-dashed border-white/10 bg-white/[0.02] text-text-dim opacity-70",
  };
  return (
    <button
      type={type}
      onClick={state !== "locked" ? onClick : undefined}
      disabled={state === "locked"}
      className={cn("flex w-full items-center justify-between rounded-[26px] border px-4 py-4 text-left transition-all", states[state])}
    >
      <div className="flex flex-col min-w-0">
        <span className="truncate font-sans text-sm">{label}</span>
        {subtitle && <span className="mt-1 font-sans text-xs text-text-dim">{subtitle}</span>}
      </div>
      {rightNode ? (
        <div className="ml-4 shrink-0">{rightNode}</div>
      ) : state === "locked" ? (
        <Lock className="ml-4 h-4 w-4 shrink-0 text-text-dim" />
      ) : (
        <ArrowUpRight className="ml-4 h-4 w-4 shrink-0 text-text-dim" />
      )}
    </button>
  );
}


interface CodeLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
}

export function CodeLink({ href, children, className }: CodeLinkProps) {
  if (/^https?:\/\//.test(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-accent-green/20 bg-accent-green/10 px-3 py-1.5 font-sans text-xs text-code-green transition-colors hover:bg-accent-green/18",
          className,
        )}
      >
        <ExternalLink className="h-3.5 w-3.5" />
        {children}
      </a>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-sans text-xs text-text-main transition-colors hover:bg-white/10 hover:text-accent-gold",
        className,
      )}
    >
      <ArrowUpRight className="h-3.5 w-3.5" />
      {children}
    </Link>
  );
}
