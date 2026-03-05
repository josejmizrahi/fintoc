"use client";

import { cn } from "@/lib/utils";
import { STATUS_COLORS, type StatusKey } from "@/lib/utils/constants";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_COLORS[status as StatusKey];

  const bg = config?.bg ?? "bg-gray-100";
  const text = config?.text ?? "text-gray-800";
  const label = config?.label ?? status;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        bg,
        text,
        status === "processing" && "animate-pulse",
        className
      )}
    >
      {label}
    </span>
  );
}
