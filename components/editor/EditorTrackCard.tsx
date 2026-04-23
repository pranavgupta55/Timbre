"use client";

import type { DragEvent, ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/TacticalUI";
import { cn } from "@/lib/utils";

type BadgeVariant = "red" | "gold" | "green" | "dim" | "blue";

interface EditorTrackCardProps {
  title: string;
  subtitle?: string;
  meta?: string;
  badgeLabel?: string;
  badgeVariant?: BadgeVariant;
  isSelected?: boolean;
  isDuplicate?: boolean;
  density?: "default" | "compact";
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
  density = "default",
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
        "group border transition-all",
        density === "compact" ? "rounded-[24px] px-3 py-2.5" : "rounded-[28px] px-4 py-4",
        onClick ? "cursor-pointer" : "",
        isSelected
          ? "border-accent-gold/35 bg-accent-gold/12 shadow-[0_20px_50px_rgba(211,170,78,0.14)]"
          : "border-white/10 bg-white/[0.04] hover:bg-white/[0.06]",
        isDuplicate && "border-accent-red/30 bg-accent-red/10",
      )}
    >
      <div className={cn("flex items-start justify-between", density === "compact" ? "gap-3" : "gap-4")}>
        <div className="min-w-0 flex-1">
          <div className={cn("flex min-w-0 items-center", density === "compact" ? "gap-2.5" : "gap-3")}>
            {draggable ? <GripVertical className={cn("shrink-0 text-text-dim", density === "compact" ? "h-3.5 w-3.5" : "h-4 w-4")} /> : null}
            <span className={cn("min-w-0 flex-1 truncate font-sans text-text-main", density === "compact" ? "text-[13px]" : "text-sm")}>{title}</span>
            {badgeLabel ? <Badge variant={badgeVariant}>{badgeLabel}</Badge> : null}
          </div>
          {subtitle ? <div className={cn("truncate font-sans text-xs text-text-dim", density === "compact" ? "mt-1.5" : "mt-2")}>{subtitle}</div> : null}
          {meta ? <div className={cn("font-sans text-xs text-text-soft", density === "compact" ? "mt-1.5 leading-5" : "mt-3 leading-6")}>{meta}</div> : null}
        </div>
        {actionNode ? <div className="shrink-0">{actionNode}</div> : null}
      </div>
    </div>
  );
}
