"use client";

import type { LucideIcon } from "lucide-react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface KpiCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  destructive?: boolean;
  className?: string;
}

const trendConfig = {
  up: { icon: TrendingUp, color: "text-green-600" },
  down: { icon: TrendingDown, color: "text-red-600" },
  neutral: { icon: Minus, color: "text-muted-foreground" },
};

export function KpiCard({
  title,
  value,
  icon: Icon,
  description,
  trend,
  trendValue,
  destructive = false,
  className,
}: KpiCardProps) {
  const TrendIcon = trend ? trendConfig[trend].icon : null;
  const trendColor = trend ? trendConfig[trend].color : "";

  return (
    <Card className={cn(destructive && "border-destructive/50", className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon
          className={cn(
            "size-5",
            destructive ? "text-destructive" : "text-muted-foreground"
          )}
        />
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "text-2xl font-bold",
            destructive && "text-destructive"
          )}
        >
          {value}
        </div>
        {(description || trend) && (
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            {TrendIcon && (
              <>
                <TrendIcon className={cn("size-3", trendColor)} />
                {trendValue && (
                  <span className={trendColor}>{trendValue}</span>
                )}
              </>
            )}
            {description && <span>{description}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
