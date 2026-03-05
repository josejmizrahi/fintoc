"use client";

import { cn } from "@/lib/utils";
import { DateDisplay } from "@/components/shared/date-display";

export interface TimelineEvent {
  date: string | Date;
  label: string;
  description?: string;
  user?: string;
  active?: boolean;
}

interface TimelineProps {
  events: TimelineEvent[];
  className?: string;
}

export function Timeline({ events, className }: TimelineProps) {
  return (
    <div className={cn("relative space-y-0", className)}>
      {events.map((event, index) => {
        const isLast = index === events.length - 1;

        return (
          <div key={index} className="relative flex gap-4 pb-6 last:pb-0">
            {/* Vertical line */}
            {!isLast && (
              <div className="absolute left-[7px] top-4 h-full w-px bg-border" />
            )}

            {/* Dot */}
            <div className="relative z-10 mt-1.5 shrink-0">
              <div
                className={cn(
                  "size-[15px] rounded-full border-2",
                  event.active
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/30 bg-background"
                )}
              />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  "text-sm font-medium leading-tight",
                  event.active
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {event.label}
              </p>
              {event.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {event.description}
                </p>
              )}
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <DateDisplay date={event.date} showTime />
                {event.user && (
                  <>
                    <span>&middot;</span>
                    <span>{event.user}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
