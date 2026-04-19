"use client";

import type { DragEvent, ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/TacticalUI";
import { cn } from "@/lib/utils";

type BadgeVariant = "red" | "gold" | "green" | "dim" | "blue";

interface EditorTrackCardProps {
  title: string;
  subtitle: string;
  meta?: string;
  badgeLabel?: string;
  badgeVariant?: BadgeVariant;
  isSelected?: boolean;
  isDuplicate?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  actionNode?: ReactNode;
}

export function EditorTrackCard({
  title,
  subtitle,
  meta,
  badgeLabel,
  badgeVariant = "dim",
  isSelected = false,
  isDuplicate = false,
  draggable = false,
  onClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  actionNode,
}: EditorTrackCardProps) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      draggable={draggable}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onKeyDown={(event) => {
        if (onClick && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "group rounded-[28px] border px-4 py-4 transition-all",
        onClick ? "cursor-pointer" : "",
        isSelected
          ? "border-accent-gold/35 bg-accent-gold/12 shadow-[0_20px_50px_rgba(211,170,78,0.14)]"
          : "border-white/10 bg-white/[0.04] hover:bg-white/[0.06]",
        isDuplicate && "border-accent-red/30 bg-accent-red/10",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            {draggable ? <GripVertical className="h-4 w-4 shrink-0 text-text-dim" /> : null}
            <span className="truncate font-sans text-sm text-text-main">{title}</span>
            {badgeLabel ? <Badge variant={badgeVariant}>{badgeLabel}</Badge> : null}
          </div>
          <div className="mt-2 truncate font-sans text-xs text-text-dim">{subtitle}</div>
          {meta ? <div className="mt-3 font-sans text-xs leading-6 text-text-soft">{meta}</div> : null}
        </div>
        {actionNode ? <div className="shrink-0">{actionNode}</div> : null}
      </div>
    </div>
  );
}
