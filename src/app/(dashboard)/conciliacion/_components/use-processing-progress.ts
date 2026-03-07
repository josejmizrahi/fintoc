"use client";

import { useState, useCallback } from "react";

/* ---------- Progress simulation hook ---------- */

export function useProcessingProgress(steps: string[]) {
  const [step, setStep] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const start = useCallback(() => {
    setStep(0);
    setIsProcessing(true);
    let current = 0;
    const interval = setInterval(() => {
      current += 1;
      if (current >= steps.length) {
        clearInterval(interval);
      } else {
        setStep(current);
      }
    }, 1200);
    return () => clearInterval(interval);
  }, [steps.length]);

  const stop = useCallback(() => {
    setIsProcessing(false);
    setStep(0);
  }, []);

  const progressPercent = isProcessing
    ? Math.min(((step + 1) / steps.length) * 100, 95)
    : 0;

  return {
    step,
    isProcessing,
    start,
    stop,
    progressPercent,
    currentLabel: steps[step] ?? "",
  };
}
