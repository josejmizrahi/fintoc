"use client";

import { cn } from "@/lib/utils";

interface MoneyDisplayProps {
  amount: number;
  currency?: string;
  className?: string;
}

const formatters = new Map<string, Intl.NumberFormat>();

function getFormatter(currency: string): Intl.NumberFormat {
  if (!formatters.has(currency)) {
    formatters.set(
      currency,
      new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  return formatters.get(currency)!;
}

export function MoneyDisplay({
  amount,
  currency = "MXN",
  className,
}: MoneyDisplayProps) {
  const formatted = getFormatter(currency).format(amount);

  return (
    <span
      className={cn("font-mono text-right tabular-nums", className)}
    >
      {formatted}
    </span>
  );
}
