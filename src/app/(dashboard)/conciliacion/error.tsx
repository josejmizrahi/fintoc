'use client';

import { ErrorState } from '@/components/shared/error-state';

export default function ReconciliationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState message={error.message} onRetry={reset} />;
}
