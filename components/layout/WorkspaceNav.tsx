"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Music4, Waves } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

const NAV_ITEMS = [
  { href: "/editor", label: "Editor", number: "01", icon: Waves },
  { href: "/reel", label: "Player", number: "02", icon: Music4 },
] as const;

export function MobileWorkspaceNav({ className }: { className?: string }) {
  const pathname = usePathname();
  const { signOut } = useAuth();

  return (
    <div className={cn("mx-auto flex max-w-[1480px] items-center gap-2", className)}>
      <Link href="/menu" className="flex shrink-0 items-center text-text-main transition-colors hover:text-accent-gold" aria-label="Open menu">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 font-serif text-lg text-accent-gold shadow-[0_14px_30px_rgba(0,0,0,0.22)]">
          T
        </div>
      </Link>

      <nav className="ml-auto flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors",
                isActive
                  ? "bg-accent-gold/14 text-accent-gold"
                  : "text-text-dim hover:text-text-main",
              )}
            >
              <Icon className="h-4 w-4" />
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => void signOut()}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-text-dim transition-colors hover:text-accent-red"
        aria-label="Sign out"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

export function WorkspaceNav() {
  const pathname = usePathname();
  const { signOut } = useAuth();
  const hideMobileHeader = pathname === "/reel";

  return (
    <>
      {hideMobileHeader ? null : (
        <header className="fixed inset-x-0 top-0 z-40 border-b border-border-light/60 bg-bg-base/84 backdrop-blur-xl xl:hidden">
          <MobileWorkspaceNav className="px-3 py-2 sm:px-4" />
        </header>
      )}

      <aside className="fixed left-6 top-1/2 z-40 hidden -translate-y-1/2 xl:block">
        <div className="flex w-[86px] flex-col gap-3 rounded-[28px] border border-white/10 bg-black/35 p-3 shadow-[0_28px_90px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
          <Link
            href="/menu"
            aria-label="Open menu"
            className="flex h-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] font-serif text-2xl text-accent-gold transition-colors hover:border-accent-gold/30 hover:bg-accent-gold/10"
          >
            T
          </Link>

          <nav className="flex flex-col gap-2">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group flex flex-col items-center gap-2 rounded-2xl border px-2 py-3 text-center transition-all",
                    isActive
                      ? "border-accent-gold/30 bg-accent-gold/12 text-text-main shadow-[0_18px_40px_rgba(196,160,82,0.14)]"
                      : "border-white/10 bg-white/[0.03] text-text-dim hover:border-white/20 hover:bg-white/[0.05] hover:text-text-main",
                  )}
                >
                  <span className={cn("font-mono text-[10px]", isActive ? "text-accent-gold" : "text-text-dim")}>{item.number}</span>
                  <Icon className={cn("h-4 w-4", isActive ? "text-accent-gold" : "text-text-dim")} />
                  <span className="font-sans text-xs leading-tight">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-text-dim transition-colors hover:border-accent-red/20 hover:bg-accent-red/10 hover:text-accent-red"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>
    </>
  );
}
