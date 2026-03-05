"use client";

import { format, formatDistanceToNow, parseISO } from "date-fns";
import { es } from "date-fns/locale";

import { cn } from "@/lib/utils";

interface DateDisplayProps {
  date: string | Date;
  showTime?: boolean;
  relative?: boolean;
  className?: string;
}

export function DateDisplay({
  date,
  showTime = false,
  relative = false,
  className,
}: DateDisplayProps) {
  const parsed = typeof date === "string" ? parseISO(date) : date;

  let display: string;

  if (relative) {
    display = formatDistanceToNow(parsed, { addSuffix: true, locale: es });
  } else if (showTime) {
    display = format(parsed, "dd MMM yyyy, HH:mm", { locale: es });
  } else {
    display = format(parsed, "dd MMM yyyy", { locale: es });
  }

  const fullDate = format(parsed, "dd/MM/yyyy HH:mm:ss", { locale: es });

  return (
    <time dateTime={parsed.toISOString()} title={fullDate} className={cn(className)}>
      {display}
    </time>
  );
}
